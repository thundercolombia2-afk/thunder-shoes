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
  serverTimestamp,
  startAfter,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
  type CollectionReference,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase/firestore'
import { db } from '../firebase'
import { dailyStatsCol, dailyStatsRef, movementsRef, productRef, variantRef } from '../paths'
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
  type SaleMeta,
  type SaleStatus,
  type Size,
  type StoreId,
  type UserId,
} from '@/domain/models'
import {
  assertMovementIsValid,
  calculateMovement,
  defaultSaleStatus,
  DomainError,
  locationDeltas,
} from '@/domain/rules'
import { bodegaKey, storeKey } from '@/domain/locations'
import { groupSales, matchesCustomer, normalize, type Sale } from '@/domain/sales'
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
    meta?: SaleMeta,
  ): Promise<RecordedMovement> {
    const [movement] = await this.recordMany([draft], actor, meta)
    if (!movement) throw new DomainError('INVALID_QUANTITY', 'No se registró nada')
    return { movement, stockAfter: movement.stockAfter }
  },

  /**
   * Registra un CARRITO completo en una sola transacción.
   *
   * Todas las líneas entran o no entra ninguna: si al último par le falta
   * stock, no queda una venta a medias con dos pares descontados y el tercero
   * no. Las líneas comparten `saleId`, forma de pago y cliente, así que el
   * historial puede reconstruir el tiquete.
   */
  async recordMany(
    drafts: MovementDraft[],
    actor: MovementActor,
    meta?: SaleMeta,
  ): Promise<Movement[]> {
    const lines = mergeDrafts(drafts)
    if (lines.length === 0) {
      throw new DomainError('INVALID_QUANTITY', 'No hay nada que registrar')
    }
    if (DEMO) return demoBackend.recordMany(lines, actor, meta)

    const occurredAt = new Date()
    const dayKey = toDayKey(occurredAt)
    // Un solo id para todas las líneas de la operación. Si viene uno en `meta`
    // es una devolución: se cuelga de la venta original en vez de crear otra.
    const saleId = meta?.saleId ?? doc(movementsRef()).id

    return runTransaction(db, async (tx) => {
      // Firestore exige TODAS las lecturas antes de cualquier escritura.
      const refs = lines.map((draft) => splitVariantId(draft.variantId))
      const snaps = await Promise.all(
        refs.map(({ productId, size }) =>
          Promise.all([tx.get(productRef(productId)), tx.get(variantRef(productId, size))]),
        ),
      )

      const movements: Movement[] = []
      const writes: {
        productId: ProductId
        size: Size
        delta: number
        locDeltas: { key: string; delta: number }[]
      }[] = []

      lines.forEach((draft, i) => {
        const pair = snaps[i]
        const location = refs[i]
        if (!pair || !location) throw new DomainError('BARCODE_NOT_FOUND', 'La referencia ya no existe')
        const [productSnap, variantSnap] = pair
        if (!productSnap.exists() || !variantSnap.exists()) {
          throw new DomainError('BARCODE_NOT_FOUND', 'La referencia ya no existe')
        }

        const product = productFromDoc(productSnap as QueryDocumentSnapshot<DocumentData>)
        const variant = variantFromDoc(variantSnap as QueryDocumentSnapshot<DocumentData>)
        if (!product.active) throw new DomainError('PRODUCT_INACTIVE', 'Referencia desactivada')

        // Ubicaciones efectivas: una venta sale del local del vendedor y una
        // devolución de cliente vuelve a ese mismo local, aunque la UI no las
        // mande explícitas. Las entradas y traslados sí las traen en el draft.
        const eff = resolveLocations(draft, actor.storeId)

        // Revalidación autoritativa contra el stock recién leído del servidor.
        assertMovementIsValid(eff, variant)
        const totals = calculateMovement(eff, product, variant)
        const locDeltas = locationDeltas(eff)

        const movement: Movement = {
          id: doc(movementsRef()).id as Movement['id'],
          type: draft.type,
          productId: location.productId,
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
        if (draft.bajaReason) movement.bajaReason = draft.bajaReason
        if (eff.fromLocation) movement.fromLocation = eff.fromLocation
        if (eff.toLocation) movement.toLocation = eff.toLocation
        // A quién se le entregó / de quién se recibió (traslados de bodega).
        if (draft.targetUserId) movement.targetUserId = draft.targetUserId
        if (draft.targetUserName) movement.targetUserName = draft.targetUserName
        // Estado de cobro: solo en ventas, y solo si no es el normal (cobrado),
        // para no engordar cada asiento del libro mayor con un valor por defecto.
        if (draft.type === 'sale') {
          const status = defaultSaleStatus(meta?.payment)
          if (status !== 'cobrado') movement.saleStatus = status
        }
        // Siempre: sin `saleId` no se puede reconstruir el tiquete ni saber
        // qué se devolvió de qué venta.
        movement.saleId = saleId
        if (meta?.payment) movement.payment = meta.payment
        if (meta?.customerName) movement.customerName = meta.customerName
        if (meta?.customerPhone) movement.customerPhone = meta.customerPhone

        movements.push(movement)
        writes.push({ ...location, delta: totals.stockDelta, locDeltas })
      })

      // ── Escrituras ────────────────────────────────────────────────────────
      movements.forEach((movement) => {
        // El documento se arma campo por campo: `id` vive en la ruta, no dentro,
        // y Firestore rechaza cualquier propiedad con valor `undefined`.
        const { id, occurredAt: _occurredAt, ...fields } = movement
        tx.set(doc(movementsRef(), id), {
          ...fields,
          occurredAt: Timestamp.fromDate(occurredAt),
        })
      })

      // `increment` en vez de escribir el número calculado: el servidor aplica
      // el delta, así que el valor final es correcto aunque haya reintentos. Se
      // toca el total (`stock`) y cada ubicación afectada (`stockByLocation.*`).
      writes.forEach(({ productId, size, delta, locDeltas }) => {
        const update: DocumentData = {
          stock: increment(delta),
          updatedAt: Timestamp.fromDate(occurredAt),
        }
        for (const { key, delta: d } of locDeltas) {
          update[`stockByLocation.${key}`] = increment(d)
        }
        tx.update(variantRef(productId, size), update)
      })

      tx.set(dailyStatsRef(dayKey), buildDailyDelta(movements, actor.storeId, occurredAt), {
        merge: true,
      })

      return movements
    })
  },

  /**
   * Devuelve a BODEGA un par vendido que el cliente no pagó (lo típico de la
   * venta por transportadora: el paquete regresa al almacén, no al local).
   *
   * Es UN SOLO asiento de devolución cuyo destino es la bodega, no dos: así el
   * stock y los contadores del día se escriben en una única transacción y no
   * puede quedar una devolución escrita sin su traslado. La devolución se
   * valora con el precio y el costo CONGELADOS en la venta, para revertir
   * exactamente lo que entró aunque el precio haya cambiado desde entonces.
   *
   * Antes de escribir comprueba contra el libro mayor que a esa línea todavía
   * le quede algo por devolver. Ese es el candado real contra la doble
   * devolución: cubre tanto el reintento tras un error como el par que ya se
   * devolvió por caja, y no depende de que el estado se haya alcanzado a
   * marcar.
   */
  async returnSaleToBodega(
    sale: Movement,
    bodegaId: string,
    actor: MovementActor,
  ): Promise<Movement> {
    if (sale.type !== 'sale') {
      throw new DomainError('ALREADY_RETURNED', 'Ese movimiento no es una venta')
    }
    const saleId = sale.saleId ?? sale.id
    const related = await this.listBySaleIds([saleId])
    const line = groupSales(related)
      .find((s) => s.saleId === saleId)
      ?.lines.find((l) => String(l.variantId) === String(sale.variantId))
    // Sin línea reconstruida no hay con qué comparar: se deja pasar solo si el
    // estado tampoco dice que ya se devolvió.
    const remaining = line ? line.remaining : sale.saleStatus === 'devuelto' ? 0 : sale.quantity
    if (remaining < sale.quantity) {
      throw new DomainError('ALREADY_RETURNED', 'Ese par ya se devolvió', { remaining })
    }

    // El asiento se firma contra el local que HIZO la venta, no contra el de
    // quien está mirando la pantalla: si no, la plata se le restaría al local
    // equivocado en el resumen por local del dashboard.
    const asSaleStore: MovementActor = { ...actor, storeId: sale.storeId }
    const [movement] = await this.recordMany(
      [
        {
          type: 'return',
          variantId: sale.variantId,
          quantity: sale.quantity,
          returnReason: 'Devolución de transportadora',
          toLocation: bodegaKey(bodegaId),
          unitPriceOverride: sale.snapshot.unitPrice,
          unitCostOverride: sale.snapshot.unitCost,
        },
      ],
      asSaleStore,
      {
        payment: sale.payment ?? '',
        saleId,
        ...(sale.customerName ? { customerName: sale.customerName } : {}),
        ...(sale.customerPhone ? { customerPhone: sale.customerPhone } : {}),
      },
    )
    if (!movement) throw new DomainError('INVALID_QUANTITY', 'No se registró la devolución')

    // Marcar el estado es lo último y no es crítico: si falla, el candado de
    // arriba impide que la devolución se repita.
    await this.setSaleStatus(sale.id, 'devuelto', actor)
    return movement
  },

  /**
   * Cambia el ESTADO DE COBRO de una línea de venta (cobrado / pendiente /
   * devuelto).
   *
   * Es la única excepción a la inmutabilidad del libro mayor, y a propósito la
   * más estrecha posible: no toca importes, cantidades ni stock — solo el
   * estado y su firma. Las reglas de Firestore verifican exactamente eso.
   *
   * No mueve `dailyStats`: la venta ya entró el día que se hizo. Lo pendiente
   * se ve aparte en la vista de cada local, y si el cliente no paga, la
   * devolución (un asiento nuevo) es la que revierte la plata.
   */
  async setSaleStatus(
    movementId: string,
    status: SaleStatus,
    actor: Pick<MovementActor, 'userId' | 'userName'>,
  ): Promise<void> {
    if (DEMO) return demoBackend.setSaleStatus(movementId, status, actor)
    await updateDoc(doc(movementsRef(), movementId), {
      saleStatus: status,
      // `serverTimestamp` y no la hora del equipo: la regla exige que coincida
      // con `request.time`, y así la firma del cambio no se puede falsear.
      saleStatusAt: serverTimestamp(),
      saleStatusBy: actor.userName,
      saleStatusByUid: actor.userId,
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

  /**
   * Busca ventas por nombre o celular del cliente, para devolver contra la
   * venta original en vez de "a ojo".
   *
   * Firestore no sabe buscar "contiene" ni ignorar tildes, así que se trae una
   * ventana de las ventas recientes y se afina en memoria. A la escala de dos
   * locales son unos cientos de documentos y sale prácticamente gratis; si un
   * día el histórico crece, la ventana marca el límite honesto: solo busca en
   * las últimas `WINDOW` líneas de venta.
   */
  async searchSales(term: string, max = 12): Promise<Sale[]> {
    const needle = normalize(term)
    if (needle.length < 2) return []
    if (DEMO) return demoBackend.searchSales(needle, max)

    const WINDOW = 400
    const snap = await getDocs(
      query(movementsRef(), where('type', '==', 'sale'), orderBy('occurredAt', 'desc'), limit(WINDOW)),
    )

    const saleIds: string[] = []
    for (const docSnap of snap.docs) {
      const m = movementFromDoc(docSnap)
      const id = m.saleId ?? m.id
      if (saleIds.includes(id)) continue
      if (matchesCustomer(m, needle)) saleIds.push(id)
      if (saleIds.length >= max) break
    }
    if (saleIds.length === 0) return []

    // Segundo viaje: trae el tiquete COMPLETO de cada venta encontrada, con sus
    // devoluciones, que pueden ser posteriores a la ventana anterior.
    const movements = await this.listBySaleIds(saleIds)
    return groupSales(movements).sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
  },

  /**
   * Busca las ventas que incluyeron una VARIANTE concreta (el par escaneado).
   * Es la vía real de la devolución: el cliente rara vez deja nombre o celular,
   * pero siempre trae el zapato — se escanea y aquí aparecen sus ventas, de la
   * más reciente a la más antigua, para amarrar la devolución a la correcta.
   */
  async searchSalesByVariant(variantId: string, max = 12): Promise<Sale[]> {
    if (DEMO) return demoBackend.searchSalesByVariant(variantId, max)

    const WINDOW = 400
    const snap = await getDocs(
      query(movementsRef(), where('type', '==', 'sale'), orderBy('occurredAt', 'desc'), limit(WINDOW)),
    )

    const saleIds: string[] = []
    for (const docSnap of snap.docs) {
      const m = movementFromDoc(docSnap)
      if (String(m.variantId) !== String(variantId)) continue
      const id = m.saleId ?? m.id
      if (saleIds.includes(id)) continue
      saleIds.push(id)
      if (saleIds.length >= max) break
    }
    if (saleIds.length === 0) return []

    const movements = await this.listBySaleIds(saleIds)
    return groupSales(movements).sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
  },

  /** Todos los movimientos de una o varias ventas (líneas y devoluciones). */
  async listBySaleIds(saleIds: string[]): Promise<Movement[]> {
    if (saleIds.length === 0) return []
    if (DEMO) return demoBackend.listBySaleIds(saleIds)
    // `in` acepta hasta 30 valores por consulta.
    const chunks: string[][] = []
    for (let i = 0; i < saleIds.length; i += 30) chunks.push(saleIds.slice(i, i + 30))
    const snaps = await Promise.all(
      chunks.map((chunk) => getDocs(query(movementsRef(), where('saleId', 'in', chunk)))),
    )
    return snaps.flatMap((snap) => snap.docs.map(movementFromDoc))
  },

  async getById(id: string): Promise<Movement | null> {
    if (DEMO) return demoBackend.getById(id)
    const snap = await getDoc(doc(movementsRef(), id))
    return snap.exists() ? movementFromDoc(snap as QueryDocumentSnapshot<DocumentData>) : null
  },

  /**
   * Últimos movimientos, sin filtrar por tipo en el servidor (así no hace falta
   * índice compuesto). Quien llama filtra en memoria. Para la vista de Locales,
   * que mira las salidas recientes hacia cada local.
   */
  async listRecent(max = 300): Promise<Movement[]> {
    if (DEMO) return demoBackend.listRecent(max)
    const snap = await getDocs(query(movementsRef(), orderBy('occurredAt', 'desc'), limit(max)))
    return snap.docs.map(movementFromDoc)
  },

  /**
   * Vacía TODO el historial: borra el libro mayor de movimientos y reinicia el
   * dashboard (dailyStats). Acción de la DUEÑA para "empezar limpio". No toca el
   * stock del inventario (es una proyección aparte). Es IRREVERSIBLE.
   *
   * Se borra por lotes de 400 (tope de una escritura por lotes es 500). Para dos
   * locales el volumen es pequeño; si algún día crece mucho, esto habría que
   * moverlo a una Cloud Function.
   */
  async wipeAllHistory(): Promise<{ movements: number; stats: number }> {
    if (DEMO) return demoBackend.wipeAllHistory()
    const deleteAll = async (colRef: CollectionReference) => {
      let total = 0
      for (;;) {
        const snap = await getDocs(query(colRef, limit(400)))
        if (snap.empty) break
        const batch = writeBatch(db)
        snap.docs.forEach((d) => batch.delete(d.ref))
        await batch.commit()
        total += snap.size
        if (snap.size < 400) break
      }
      return total
    }
    const movements = await deleteAll(movementsRef())
    const stats = await deleteAll(dailyStatsCol())
    return { movements, stats }
  },
}

/**
 * Une líneas repetidas de la misma variante. Sin esto, dos líneas del mismo
 * código leerían el mismo documento y cada una validaría contra el stock
 * ORIGINAL, dejando pasar una venta que en conjunto no alcanza.
 */
/**
 * Rellena las ubicaciones que la UI puede omitir: una venta sale del local del
 * vendedor y la devolución de un cliente regresa a ese mismo local. Entradas y
 * traslados llevan sus ubicaciones explícitas en el draft.
 */
function resolveLocations(draft: MovementDraft, storeId: StoreId): MovementDraft {
  const eff: MovementDraft = { ...draft }
  if (draft.type === 'sale' && !eff.fromLocation) eff.fromLocation = storeKey(storeId)
  if (draft.type === 'return' && !eff.toLocation) eff.toLocation = storeKey(storeId)
  return eff
}

function mergeDrafts(drafts: MovementDraft[]): MovementDraft[] {
  const byVariant = new Map<string, MovementDraft>()
  for (const draft of drafts) {
    if (draft.quantity <= 0) continue
    // La clave incluye las ubicaciones: no se pueden fundir dos líneas de la
    // misma variante que salen o entran a lugares distintos.
    const key = `${draft.type}:${draft.variantId}:${draft.fromLocation ?? ''}:${draft.toLocation ?? ''}`
    const previous = byVariant.get(key)
    byVariant.set(
      key,
      previous ? { ...previous, quantity: previous.quantity + draft.quantity } : { ...draft },
    )
  }
  return [...byVariant.values()]
}

/**
 * Deltas del agregado diario para todas las líneas de la operación.
 *
 * OJO: aquí el local sale de `actor.storeId`, no de las ubicaciones. Quien
 * registre un movimiento a nombre de OTRO local tiene que firmarlo con el local
 * correcto (lo hace `returnSaleToBodega`), o el agregado por local se descuadra.
 * La UI resuelve lo mismo con `movementLocalId`; si algún día se unifican, este
 * es el sitio que hay que cambiar.
 *
 * Se suman en memoria y se envían como UN `increment` por campo: dos
 * `increment()` sobre la misma clave en el mismo objeto se pisarían. Entre
 * transacciones distintas `increment` sigue siendo seguro — el servidor aplica
 * el delta sin leer el valor previo, así que dos cajas vendiendo a la vez no
 * pierden ninguna venta.
 */
function buildDailyDelta(movements: Movement[], storeId: StoreId, now: Date): DocumentData {
  const totals = {
    margin: 0,
    salesTotal: 0,
    purchasesTotal: 0,
    returnsTotal: 0,
    salesCount: 0,
    purchasesCount: 0,
    unitsSold: 0,
    byStore: 0,
  }
  const unitsByProduct = new Map<string, number>()
  const bump = (productId: ProductId, units: number) =>
    unitsByProduct.set(productId, (unitsByProduct.get(productId) ?? 0) + units)

  const dayKey = movements[0]?.dayKey ?? toDayKey(now)

  for (const m of movements) {
    totals.margin += m.margin
    switch (m.type as MovementType) {
      case 'sale':
        totals.salesTotal += m.total
        totals.salesCount += 1
        totals.unitsSold += m.quantity
        totals.byStore += m.total
        bump(m.productId, m.quantity)
        break
      case 'purchase':
        totals.purchasesTotal += m.total
        totals.purchasesCount += 1
        break
      case 'return':
        totals.returnsTotal += m.total
        // Una devolución revierte la venta: unidades, plata del día y plata del
        // local. `salesTotal` tiene que bajar igual que `salesByStore` — si no,
        // el titular "Ventas de hoy" queda inflado mientras el desglose por
        // local baja, y con la venta por transportadora (que se devuelve una
        // semana después) eso pasaría todas las semanas.
        totals.salesTotal -= m.total
        totals.salesCount -= 1
        totals.unitsSold -= m.quantity
        totals.byStore -= m.total
        bump(m.productId, -m.quantity)
        break
    }
  }

  const delta: DocumentData = {
    dayKey,
    updatedAt: Timestamp.fromDate(now),
  }
  if (totals.margin) delta.margin = increment(totals.margin)
  if (totals.salesTotal) delta.salesTotal = increment(totals.salesTotal)
  if (totals.purchasesTotal) delta.purchasesTotal = increment(totals.purchasesTotal)
  if (totals.returnsTotal) delta.returnsTotal = increment(totals.returnsTotal)
  if (totals.salesCount) delta.salesCount = increment(totals.salesCount)
  if (totals.purchasesCount) delta.purchasesCount = increment(totals.purchasesCount)
  if (totals.unitsSold) delta.unitsSold = increment(totals.unitsSold)
  // OJO: con `set(..., { merge: true })` una clave con punto ("salesByStore.163")
  // crea un campo LITERAL en la raíz, no anida el mapa (eso solo lo hace
  // `update()`). Por eso se arma el objeto ANIDADO: el merge lo fusiona en
  // profundidad y `increment` se aplica al campo interno.
  if (totals.byStore) delta.salesByStore = { [storeId]: increment(totals.byStore) }
  const unitsDelta: DocumentData = {}
  for (const [productId, units] of unitsByProduct) {
    if (units) unitsDelta[productId] = increment(units)
  }
  if (Object.keys(unitsDelta).length > 0) delta.unitsByProduct = unitsDelta
  return delta
}
