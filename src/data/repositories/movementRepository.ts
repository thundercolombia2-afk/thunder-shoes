/**
 * Registro de movimientos. La operación crítica de toda la aplicación.
 */

import {
  doc,
  getDoc,
  getDocs,
  increment,
  limit,
  orderBy,
  query,
  runTransaction,
  startAfter,
  Timestamp,
  where,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase/firestore'
import { db } from '../firebase'
import { dailyStatsRef, movementsRef, productRef, variantRef } from '../paths'
import {
  movementFromDoc,
  productFromDoc,
  splitVariantId,
  variantFromDoc,
} from '../converters'
import {
  type Movement,
  type MovementDraft,
  type MovementType,
  type ProductId,
  type StoreId,
  type UserId,
} from '@/domain/models'
import { assertMovementIsValid, calculateMovement, DomainError } from '@/domain/rules'
import { toDayKey } from '@/lib/format'
import { DEMO } from '@/config'
import { demoBackend } from '../demoBackend'

export interface MovementActor {
  storeId: StoreId
  userId: UserId
  userName: string
}

export interface RecordedMovement {
  movement: Movement
  stockAfter: number
}

export const movementRepository = {
  /**
   * Registra un movimiento de forma atómica.
   *
   * Escribe TRES cosas en una sola transacción:
   *   1. el asiento en `movements` (inmutable),
   *   2. el nuevo stock en la variante,
   *   3. los contadores del día en `dailyStats`.
   *
   * La transacción vuelve a leer el stock del servidor y revalida antes de
   * escribir. Ese es el punto clave frente al prototipo: si dos cajas venden
   * el último par al mismo tiempo, Firestore detecta que el documento cambió,
   * reintenta la transacción, la segunda revalidación falla y esa venta se
   * rechaza — en vez de dejar el stock en −1.
   */
  async record(
    draft: MovementDraft,
    actor: MovementActor,
  ): Promise<RecordedMovement> {
    if (DEMO) return demoBackend.record(draft, actor)
    const { productId, size } = splitVariantId(draft.variantId)
    const newMovementRef = doc(movementsRef())
    const occurredAt = new Date()
    const dayKey = toDayKey(occurredAt)

    return runTransaction(db, async (tx) => {
      // ── Lecturas ──────────────────────────────────────────────────────────
      const [productSnap, variantSnap] = await Promise.all([
        tx.get(productRef(productId)),
        tx.get(variantRef(productId, size)),
      ])
      if (!productSnap.exists() || !variantSnap.exists()) {
        throw new DomainError('BARCODE_NOT_FOUND', 'La referencia ya no existe')
      }

      const product = productFromDoc(productSnap as QueryDocumentSnapshot<DocumentData>)
      const variant = variantFromDoc(variantSnap as QueryDocumentSnapshot<DocumentData>)
      if (!product.active) {
        throw new DomainError('PRODUCT_INACTIVE', 'Referencia desactivada')
      }

      // Revalidación autoritativa contra el stock recién leído del servidor.
      assertMovementIsValid(draft, variant)
      const totals = calculateMovement(draft, product, variant)

      // ── Escrituras ────────────────────────────────────────────────────────
      const movement: Movement = {
        id: newMovementRef.id as Movement['id'],
        type: draft.type,
        productId,
        variantId: draft.variantId,
        snapshot: {
          productName: product.name,
          brand: product.brand,
          sku: product.sku,
          barcode: variant.barcode,
          size: variant.size,
          unitPrice: totals.unitPrice,
          unitCost: totals.unitCost,
        },
        quantity: draft.quantity,
        stockDelta: totals.stockDelta,
        stockAfter: totals.stockAfter,
        total: totals.total,
        margin: totals.margin,
        storeId: actor.storeId,
        userId: actor.userId,
        userName: actor.userName,
        occurredAt,
        dayKey,
      }
      if (draft.returnReason) movement.returnReason = draft.returnReason

      // El documento se arma campo por campo: `id` vive en la ruta, no dentro,
      // y Firestore rechaza cualquier propiedad con valor `undefined`.
      const { id: _id, occurredAt: _occurredAt, ...movementFields } = movement
      tx.set(newMovementRef, {
        ...movementFields,
        occurredAt: Timestamp.fromDate(occurredAt),
      })

      // `increment` en vez de escribir el número calculado: el servidor aplica
      // el delta, así que el valor final es correcto aunque haya reintentos.
      tx.update(variantRef(productId, size), {
        stock: increment(totals.stockDelta),
        updatedAt: Timestamp.fromDate(occurredAt),
      })

      tx.set(
        dailyStatsRef(dayKey),
        buildDailyDelta(draft.type, movement, actor.storeId, occurredAt),
        { merge: true },
      )

      return { movement, stockAfter: totals.stockAfter }
    })
  },

  /**
   * Historial paginado. Nunca trae la colección completa: el libro mayor
   * crece sin techo y una lectura sin `limit` costaría más cada mes.
   */
  async listPage(options: {
    pageSize?: number
    type?: MovementType
    storeId?: StoreId
    productId?: ProductId
    cursor?: QueryDocumentSnapshot<DocumentData> | undefined
  } = {}): Promise<{
    movements: Movement[]
    cursor: QueryDocumentSnapshot<DocumentData> | undefined
    hasMore: boolean
  }> {
    if (DEMO) return demoBackend.listPage(options.type ? { type: options.type } : {})
    const pageSize = options.pageSize ?? 40
    const constraints = [
      ...(options.type ? [where('type', '==', options.type)] : []),
      ...(options.storeId ? [where('storeId', '==', options.storeId)] : []),
      ...(options.productId ? [where('productId', '==', options.productId)] : []),
      orderBy('occurredAt', 'desc'),
      ...(options.cursor ? [startAfter(options.cursor)] : []),
      // Pedimos uno de más para saber si hay página siguiente sin contar todo.
      limit(pageSize + 1),
    ]

    const snap = await getDocs(query(movementsRef(), ...constraints))
    const hasMore = snap.docs.length > pageSize
    const docs = hasMore ? snap.docs.slice(0, pageSize) : snap.docs

    return {
      movements: docs.map(movementFromDoc),
      cursor: docs.at(-1),
      hasMore,
    }
  },

  /** Todos los movimientos de un rango de días, para exportar a CSV. */
  async listForExport(fromDayKey: string, toDayKey_: string): Promise<Movement[]> {
    if (DEMO) return demoBackend.listForExport(fromDayKey, toDayKey_)
    const snap = await getDocs(
      query(
        movementsRef(),
        where('dayKey', '>=', fromDayKey),
        where('dayKey', '<=', toDayKey_),
        orderBy('dayKey', 'desc'),
        orderBy('occurredAt', 'desc'),
        limit(5000),
      ),
    )
    return snap.docs.map(movementFromDoc)
  },

  async getById(id: string): Promise<Movement | null> {
    if (DEMO) return demoBackend.getById(id)
    const snap = await getDoc(doc(movementsRef(), id))
    return snap.exists() ? movementFromDoc(snap as QueryDocumentSnapshot<DocumentData>) : null
  },
}

/**
 * Deltas del agregado diario. Se aplican con `increment` para que sumar dos
 * ventas simultáneas no pierda ninguna: cada una suma su parte en el servidor
 * sin leer el valor previo.
 */
function buildDailyDelta(
  type: MovementType,
  movement: Movement,
  storeId: StoreId,
  now: Date,
): DocumentData {
  const base: DocumentData = {
    dayKey: movement.dayKey,
    margin: increment(movement.margin),
    updatedAt: Timestamp.fromDate(now),
  }

  switch (type) {
    case 'sale':
      return {
        ...base,
        salesTotal: increment(movement.total),
        salesCount: increment(1),
        unitsSold: increment(movement.quantity),
        [`salesByStore.${storeId}`]: increment(movement.total),
        [`unitsByProduct.${movement.productId}`]: increment(movement.quantity),
      }
    case 'purchase':
      return {
        ...base,
        purchasesTotal: increment(movement.total),
        purchasesCount: increment(1),
      }
    case 'return':
      return {
        ...base,
        returnsTotal: increment(movement.total),
        // Una devolución revierte unidades vendidas del día.
        unitsSold: increment(-movement.quantity),
        [`salesByStore.${storeId}`]: increment(-movement.total),
        [`unitsByProduct.${movement.productId}`]: increment(-movement.quantity),
      }
  }
}
