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
  type Transaction,
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
  VOID_RETURN_REASON,
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
import { allocateReturn } from '@/domain/deliveries'
import { groupSales, matchesCustomer, normalize, type Sale } from '@/domain/sales'
import { toDayKey } from '@/lib/format'
import { DEMO } from '@/config'
import { demoBackend } from '../demoBackend'

export interface MovementActor {
  storeId: StoreId
  userId: UserId
  userName: string
}

/** Anular una venta: la devolución que la revierte (ver `voidSaleLine`). */
export interface VoidOptions {
  voidSaleId?: string
  voidReason?: string
}

/**
 * Lee, dentro de la transacción, la venta que se va a anular y decide:
 *  · si su plata se había contado (`cobrado`) o no (`pendiente`);
 *  · en qué día se contó: el de la venta, o el del último paso a `cobrado`
 *    (`saleStatusAt`) si era por transportadora y se cobró después.
 * Rechaza las ventas ya anuladas o devueltas.
 */
async function readVoidableSale(
  tx: Transaction,
  saleId: string,
): Promise<{ sale: Movement; counted: boolean; statsDayKey: string }> {
  const snap = await tx.get(doc(movementsRef(), saleId))
  if (!snap.exists()) throw new DomainError('BARCODE_NOT_FOUND', 'Esa venta ya no existe')
  const sale = movementFromDoc(snap as QueryDocumentSnapshot<DocumentData>)
  if (sale.type !== 'sale') throw new DomainError('ALREADY_RETURNED', 'Ese movimiento no es una venta')
  const status = sale.saleStatus ?? 'cobrado'
  if (status === 'anulado') throw new DomainError('ALREADY_RETURNED', 'Esa venta ya está anulada')
  if (status === 'devuelto') throw new DomainError('ALREADY_RETURNED', 'Esa venta ya se devolvió: no se puede anular')
  const counted = status === 'cobrado'
  const statsDayKey = counted && sale.saleStatusAt ? toDayKey(sale.saleStatusAt) : sale.dayKey
  return { sale, counted, statsDayKey }
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
    options?: VoidOptions,
  ): Promise<Movement[]> {
    const lines = mergeDrafts(drafts)
    if (lines.length === 0) {
      throw new DomainError('INVALID_QUANTITY', 'No hay nada que registrar')
    }
    if (options?.voidSaleId && (lines.length !== 1 || lines[0]?.type !== 'return')) {
      throw new DomainError('INVALID_QUANTITY', 'Una anulación es una sola devolución')
    }
    if (DEMO) return demoBackend.recordMany(lines, actor, meta, options)

    const occurredAt = new Date()
    const dayKey = toDayKey(occurredAt)
    // Un solo id para todas las líneas de la operación. Si viene uno en `meta`
    // es una devolución: se cuelga de la venta original en vez de crear otra.
    const saleId = meta?.saleId ?? doc(movementsRef()).id

    // Retornos a bodega: de qué entregas pueden venir sus pares. Las consultas
    // no caben dentro de la transacción (Firestore no admite consultas ahí),
    // así que se buscan antes y adentro se RE-LEE cada entrega para repartir
    // contra su `returnedQty` fresco.
    const candidatesByLine = await Promise.all(
      lines.map((draft) => (draft.type === 'retorno' ? loadReturnCandidates(draft) : Promise.resolve([]))),
    )

    return runTransaction(db, async (tx) => {
      // Firestore exige TODAS las lecturas antes de cualquier escritura.
      const refs = lines.map((draft) => splitVariantId(draft.variantId))
      const snaps = await Promise.all(
        refs.map(({ productId, size }) =>
          Promise.all([tx.get(productRef(productId)), tx.get(variantRef(productId, size))]),
        ),
      )
      const candidateSnaps = await Promise.all(
        candidatesByLine.map((candidates) => Promise.all(candidates.map((c) => tx.get(doc(movementsRef(), c.id))))),
      )
      // Anulación: se relee la venta DENTRO de la transacción. Su estado decide
      // si la plata se había contado y en qué día; leído afuera podría haber
      // cambiado (alguien la marca cobrada justo ahora).
      const voided = options?.voidSaleId ? await readVoidableSale(tx, options.voidSaleId) : null

      const movements: Movement[] = []
      // Paralelo a `movements`: si esa línea le mueve la aguja a `dailyStats`.
      // Una venta 'pendiente' no cuenta todavía, y su eventual devolución
      // tampoco debe restar lo que nunca se sumó (ver `saleWasCounted`).
      const counted: boolean[] = []
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
        // Una anulación SÍ puede tocar una referencia desactivada: se puede anular
        // una venta vieja de un modelo que ya no se vende.
        if (!product.active && !voided) throw new DomainError('PRODUCT_INACTIVE', 'Referencia desactivada')

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
        if (draft.deliveryId) movement.deliveryId = draft.deliveryId
        // Estado de cobro: solo en ventas, y solo si no es el normal (cobrado),
        // para no engordar cada asiento del libro mayor con un valor por defecto.
        // `statusOverride` (Cobrar/Pendiente explícito desde Entregas) manda
        // sobre lo que se infiera del método de pago.
        if (draft.type === 'sale') {
          const status = meta?.statusOverride ?? defaultSaleStatus(meta?.payment)
          if (status !== 'cobrado') movement.saleStatus = status
          counted.push(status === 'cobrado')
        } else if (draft.type === 'return' && voided) {
          // La anulación resta solo lo que se había contado: una venta que
          // seguía 'pendiente' nunca entró a `dailyStats`.
          counted.push(voided.counted)
          movement.voidOf = String(voided.sale.id)
          movement.voidReason = options?.voidReason ?? ''
        } else if (draft.type === 'return') {
          counted.push(draft.saleWasCounted ?? true)
        } else {
          counted.push(true)
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

      // Reparto de cada retorno contra sus entregas (ver `allocateReturn`). Se
      // hace aquí, con las entregas recién leídas en la transacción: si dos
      // retornos compiten por la misma entrega, Firestore reintenta y el
      // segundo reparte contra lo que dejó el primero.
      //
      // Todas las entregas que toca la operación apuntan (`lastReturnId`) al
      // MISMO asiento: el primer retorno del lote (de ese encargado). Las reglas lo buscan con
      // getAfter, y Firestore limita cuántos documentos distintos puede
      // consultar una regla por escritura: con un retorno distinto por entrega,
      // un retorno de 19+ tallas se rechazaba entero.
      const deliveryUpdates = new Map<string, { returnedQty: number; lastReturnId: string }>()
      movements.forEach((movement, i) => {
        if (movement.type !== 'retorno') return
        const candidates = (candidatesByLine[i] ?? []).flatMap((c, j) => {
          const fresh = candidateSnaps[i]?.[j]
          // Una entrega que ya no existe (se vació el historial entre la
          // consulta y la transacción) no se reparte: actualizarla tumbaría
          // el retorno entero.
          if (!fresh?.exists()) return []
          const returnedQty = deliveryUpdates.get(c.id)?.returnedQty ?? Number(fresh.data().returnedQty ?? 0)
          return [{ ...c, returnedQty }]
        })
        const allocations = allocateReturn(movement.quantity, candidates)
        if (allocations.length === 0) return
        // Ancla: el primer retorno del lote del MISMO encargado (la regla exige
        // que coincida con el de la entrega). Hoy todo el lote es de uno solo.
        const anchor = movements.find((m) => m.type === 'retorno' && m.targetUserId === movement.targetUserId) ?? movement
        const anchorId = String(anchor.id)
        movement.deliveryAllocations = allocations
        for (const a of allocations) {
          const before = candidates.find((c) => c.id === a.deliveryId)?.returnedQty ?? 0
          deliveryUpdates.set(a.deliveryId, { returnedQty: before + a.quantity, lastReturnId: anchorId })
        }
      })

      // ── Escrituras ────────────────────────────────────────────────────────
      deliveryUpdates.forEach((update, deliveryId) => {
        tx.update(doc(movementsRef(), deliveryId), update)
      })
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

      // Resumen por REFERENCIA (`Product.stock` / `Product.stockByLocation`): el
      // mismo delta agregado al documento del producto, para que la lista de
      // inventario no tenga que leer las ~1.750 variantes del catálogo.
      //
      // Se acumula por producto ANTES de escribir: un carrito con la talla 40 y
      // la 42 de la misma referencia son dos líneas, pero un solo documento de
      // producto. Dos `tx.update` al mismo documento en una transacción son una
      // escritura ambigua; una sola con el delta sumado no lo es.
      //
      // El documento del producto ya se leyó arriba (`tx.get(productRef(...))`),
      // así que esto no cuesta ninguna lectura extra: solo una escritura más por
      // referencia distinta del carrito.
      const productRollups = new Map<ProductId, { delta: number; byLocation: Map<string, number> }>()
      writes.forEach(({ productId, delta, locDeltas }) => {
        const rollup = productRollups.get(productId) ?? { delta: 0, byLocation: new Map<string, number>() }
        rollup.delta += delta
        for (const { key, delta: d } of locDeltas) {
          rollup.byLocation.set(key, (rollup.byLocation.get(key) ?? 0) + d)
        }
        productRollups.set(productId, rollup)
      })

      productRollups.forEach((rollup, productId) => {
        // Sin `updatedAt`: ese campo significa "cuándo se editó la referencia"
        // (nombre, precio), y una venta no edita la referencia. Tocarlo aquí
        // ensuciaría ese significado y ensancharía el permiso de las reglas.
        const update: DocumentData = { stock: increment(rollup.delta) }
        rollup.byLocation.forEach((d, key) => {
          update[`stockByLocation.${key}`] = increment(d)
        })
        tx.update(productRef(productId), update)
      })

      // Una anulación saca la plata del día en que se CONTÓ la venta (como si
      // nunca hubiera pasado), no de hoy como una devolución.
      const statsDayKey = voided?.statsDayKey ?? dayKey
      tx.set(dailyStatsRef(statsDayKey), buildDailyDelta(movements, counted, actor.storeId, occurredAt, statsDayKey), {
        merge: true,
      })

      if (voided) {
        const voidMovement = movements[0]
        if (!voidMovement) throw new DomainError('INVALID_QUANTITY', 'No se registró la anulación')
        // La regla de Firestore exige que esta devolución se cree en la MISMA
        // escritura (`voidMovementId`) y que anulado sea definitivo.
        tx.update(doc(movementsRef(), String(voided.sale.id)), {
          saleStatus: 'anulado',
          saleStatusAt: serverTimestamp(),
          saleStatusBy: actor.userName,
          saleStatusByUid: actor.userId,
          voidMovementId: String(voidMovement.id),
          voidReason: options?.voidReason ?? '',
        })
      }

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
          // Si la venta seguía 'pendiente', esa plata nunca entró a
          // `dailyStats`: la devolución no debe restarla. Si ya estaba
          // 'cobrado', sí hay que revertirla, igual que siempre.
          saleWasCounted: (sale.saleStatus ?? 'cobrado') === 'cobrado',
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
   * ANULA una línea de venta registrada por error (con el PIN de la dueña, que
   * verifica la pantalla). Es como si nunca hubiera pasado:
   *  · el par vuelve a la ubicación de donde salió;
   *  · la plata sale del día en que se CONTÓ como ingreso (el de la venta, o el
   *    del cobro si era por transportadora); si seguía pendiente, no se resta
   *    nada porque nunca se contó;
   *  · si se había cobrado desde una entrega, esa entrega vuelve a "por cobrar"
   *    (la devolución cuelga del mismo `saleId`);
   *  · la venta queda en el historial marcada `anulado`, con quién, cuándo y
   *    el motivo. Es DEFINITIVO.
   *
   * Es UN asiento de devolución con `voidOf` más el cambio de estado de la
   * venta, en una sola transacción. Igual que `returnSaleToBodega`, comprueba
   * contra el libro mayor que a la línea no le hayan devuelto nada: un par
   * devuelto (o ya anulado) no se puede anular.
   */
  async voidSaleLine(sale: Movement, reason: string, actor: MovementActor): Promise<Movement> {
    if (sale.type !== 'sale') {
      throw new DomainError('ALREADY_RETURNED', 'Ese movimiento no es una venta')
    }
    // Antes que el libro mayor: así una venta ya anulada dice eso, y no "ya le
    // devolvieron pares" (su anulación es una devolución).
    if (sale.saleStatus === 'anulado') throw new DomainError('ALREADY_RETURNED', 'Esa venta ya está anulada')
    const saleId = sale.saleId ?? sale.id
    const related = await this.listBySaleIds([saleId])
    if (related.some((m) => m.voidOf === String(sale.id))) {
      throw new DomainError('ALREADY_RETURNED', 'Esa venta ya está anulada')
    }
    const line = groupSales(related)
      .find((s) => s.saleId === saleId)
      ?.lines.find((l) => String(l.variantId) === String(sale.variantId))
    const remaining = line ? line.remaining : sale.quantity
    if (remaining < sale.quantity) {
      throw new DomainError('ALREADY_RETURNED', 'A esa venta ya le devolvieron pares: no se puede anular', { remaining })
    }

    // Firmada contra el local que HIZO la venta, para que la plata salga del
    // desglose por local correcto.
    const asSaleStore: MovementActor = { ...actor, storeId: sale.storeId }
    const [movement] = await this.recordMany(
      [
        {
          type: 'return',
          variantId: sale.variantId,
          quantity: sale.quantity,
          returnReason: VOID_RETURN_REASON,
          // De vuelta a donde salió el par (local o bodega).
          toLocation: sale.fromLocation ?? storeKey(sale.storeId),
          // Precio y costo CONGELADOS en la venta: revierte exactamente lo que entró.
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
      { voidSaleId: String(sale.id), voidReason: reason.trim() },
    )
    if (!movement) throw new DomainError('INVALID_QUANTITY', 'No se registró la anulación')
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
   * SÍ mueve `dailyStats`, pero solo en el ida-y-vuelta cobrado↔pendiente: es
   * la única transición que cambia si esa plata ya es ingreso real. Se abona
   * al día en que se confirma el cobro (HOY), no al día en que se hizo la
   * venta — así una venta por transportadora que se despachó el 11 y se
   * confirma el 25 aparece como ingreso el 25, que es cuando entró la plata
   * de verdad. La transición a/desde `devuelto` no toca `dailyStats` aquí: de
   * eso ya se encarga el asiento de devolución (`returnSaleToBodega`).
   */
  async setSaleStatus(
    movementId: string,
    status: SaleStatus,
    actor: Pick<MovementActor, 'userId' | 'userName'>,
  ): Promise<void> {
    if (DEMO) return demoBackend.setSaleStatus(movementId, status, actor)
    const ref = doc(movementsRef(), movementId)
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref)
      if (!snap.exists()) throw new DomainError('BARCODE_NOT_FOUND', 'Esa venta ya no existe')
      const current = movementFromDoc(snap as QueryDocumentSnapshot<DocumentData>)
      const from = current.saleStatus ?? 'cobrado'

      tx.update(ref, {
        saleStatus: status,
        // `serverTimestamp` y no la hora del equipo: la regla exige que
        // coincida con `request.time`, y así la firma no se puede falsear.
        saleStatusAt: serverTimestamp(),
        saleStatusBy: actor.userName,
        saleStatusByUid: actor.userId,
      })

      const becomesCollected = from === 'pendiente' && status === 'cobrado'
      const becomesPending = from === 'cobrado' && status === 'pendiente'
      if (!becomesCollected && !becomesPending) return

      const now = new Date()
      const sign = becomesCollected ? 1 : -1
      tx.set(
        dailyStatsRef(toDayKey(now)),
        {
          dayKey: toDayKey(now),
          updatedAt: Timestamp.fromDate(now),
          margin: increment(sign * current.margin),
          salesTotal: increment(sign * current.total),
          salesCount: increment(sign),
          unitsSold: increment(sign * current.quantity),
          salesByStore: { [current.storeId]: increment(sign * current.total) },
          unitsByProduct: { [current.productId]: increment(sign * current.quantity) },
        },
        { merge: true },
      )
    })
  },

  /**
   * Marca (o desmarca) una ENTREGA como pendiente por confirmar, sin
   * registrar ninguna venta todavía: es solo la bandera que hace que aparezca
   * en la pestaña Pendiente. Las reglas de Firestore exigen que quien la toca
   * sea el ENCARGADO (`targetUserId`) al que bodega se la asignó — nadie más
   * puede marcarla ni desmarcarla, aunque sí pueden verla.
   */
  async setDeliveryPending(
    movementId: string,
    pending: boolean,
    actor: Pick<MovementActor, 'userId' | 'userName'>,
  ): Promise<void> {
    if (DEMO) return demoBackend.setDeliveryPending(movementId, pending, actor)
    await updateDoc(doc(movementsRef(), movementId), {
      deliveryPending: pending,
      deliveryPendingAt: serverTimestamp(),
      deliveryPendingBy: actor.userName,
      deliveryPendingByUid: actor.userId,
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
    /**
     * Rango de días (inclusive). Se filtra EN EL SERVIDOR: filtrar en memoria
     * una página de 40 dejaba vacío cualquier día viejo. Con fecha, el orden
     * pasa a ser dayKey + occurredAt, que cubren los índices `dayKey+occurredAt`
     * y `type+dayKey+occurredAt`; combinarla con storeId/productId pediría
     * índices que no existen.
     */
    fromDayKey?: string
    toDayKey?: string
    cursor?: QueryDocumentSnapshot<DocumentData> | undefined
  } = {}): Promise<{
    movements: Movement[]
    cursor: QueryDocumentSnapshot<DocumentData> | undefined
    hasMore: boolean
  }> {
    if (DEMO) {
      return demoBackend.listPage({
        ...(options.type ? { type: options.type } : {}),
        ...(options.fromDayKey ? { fromDayKey: options.fromDayKey } : {}),
        ...(options.toDayKey ? { toDayKey: options.toDayKey } : {}),
      })
    }
    const pageSize = options.pageSize ?? 40
    const byDay = !!(options.fromDayKey || options.toDayKey)
    const constraints = [
      ...(options.type ? [where('type', '==', options.type)] : []),
      ...(options.storeId ? [where('storeId', '==', options.storeId)] : []),
      ...(options.productId ? [where('productId', '==', options.productId)] : []),
      ...(options.fromDayKey ? [where('dayKey', '>=', options.fromDayKey)] : []),
      ...(options.toDayKey ? [where('dayKey', '<=', options.toDayKey)] : []),
      // Firestore exige ordenar primero por el campo del rango.
      ...(byDay ? [orderBy('dayKey', 'desc')] : []),
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
   * Ventas de un rango de días, más reciente primero: la tabla de Ingresos.
   * Consulta el rango de verdad en vez de filtrar los últimos N movimientos,
   * que dejaban por fuera cualquier día viejo aunque la tarjeta de Ventas
   * (que sale de dailyStats) sí lo sumara.
   */
  async listSalesInRange(fromDayKey: string, toDayKey_: string): Promise<Movement[]> {
    if (DEMO) {
      const all = await demoBackend.listForExport(fromDayKey, toDayKey_)
      return all.filter((m) => m.type === 'sale')
    }
    const snap = await getDocs(
      query(
        movementsRef(),
        where('type', '==', 'sale'),
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
   * Movimientos que mira la pantalla de Locales, desde `fromDayKey` HASTA HOY
   * (no hasta el "Hasta" del filtro): para saber cuánto de una entrega ya se
   * vendió o volvió a bodega hacen falta las ventas y retornos POSTERIORES a
   * ella. La pantalla recorta al rango elegido al mostrar. Antes se usaban los
   * últimos 300 movimientos del sistema y todo lo viejo se perdía.
   */
  async listForLocales(fromDayKey: string): Promise<Movement[]> {
    if (DEMO) {
      const all = await demoBackend.listForExport(fromDayKey, '9999-12-31')
      return all.filter((m) => LOCALES_TYPES.includes(m.type))
    }
    const snap = await getDocs(
      query(
        movementsRef(),
        where('type', 'in', LOCALES_TYPES),
        where('dayKey', '>=', fromDayKey),
        orderBy('dayKey', 'desc'),
        orderBy('occurredAt', 'desc'),
        limit(5000),
      ),
    )
    return snap.docs.map(movementFromDoc)
  },

  /**
   * Lo que está PENDIENTE sin importar la fecha: entregas marcadas pendiente y
   * ventas sin cobrar, más las ventas cobradas desde esas entregas y las
   * devoluciones de esas ventas (para saber cuánto les queda). Un pendiente es
   * plata en la calle: no puede desaparecer porque cae fuera del rango.
   *
   * Todas son consultas de igualdad sobre UN campo (sin orderBy), así que
   * usan los índices automáticos y no necesitan índices compuestos. Solo las
   * entregas tienen `deliveryPending`, solo las ventas `saleStatus` y
   * `deliveryId`, así que no hace falta filtrar por tipo.
   */
  async listOpenPending(): Promise<Movement[]> {
    if (DEMO) return demoBackend.listOpenPending()
    const [deliveriesSnap, salesSnap] = await Promise.all([
      getDocs(query(movementsRef(), where('deliveryPending', '==', true))),
      getDocs(query(movementsRef(), where('saleStatus', '==', 'pendiente'))),
    ])
    const deliveries = deliveriesSnap.docs.map(movementFromDoc)
    const pendingSales = salesSnap.docs.map(movementFromDoc)

    const deliveryIds = deliveries.map((d) => d.id)
    const linkedSales = (
      await Promise.all(
        chunk(deliveryIds, 30).map((ids) => getDocs(query(movementsRef(), where('deliveryId', 'in', ids)))),
      )
    ).flatMap((snap) => snap.docs.map(movementFromDoc))

    // Devoluciones de esas ventas: comparten el `saleId` (o el id) de la venta.
    const saleIds = [...new Set([...pendingSales, ...linkedSales].map((m) => m.saleId ?? m.id))]
    const returns = (
      await Promise.all(chunk(saleIds, 30).map((ids) => getDocs(query(movementsRef(), where('saleId', 'in', ids)))))
    )
      .flatMap((snap) => snap.docs.map(movementFromDoc))
      .filter((m) => m.type === 'return')

    return [...deliveries, ...pendingSales, ...linkedSales, ...returns]
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
 * Entregas de las que puede venir un retorno: salidas de la MISMA talla al
 * MISMO encargado y hacia el MISMO local del que sale el retorno, con cuántos
 * pares lleva cobrados cada una (ventas con `deliveryId`, netas de las
 * devoluciones de esas ventas). Todas las consultas son de igualdad, así que
 * no necesitan índices compuestos.
 */
async function loadReturnCandidates(
  draft: MovementDraft,
): Promise<{ id: string; occurredAt: Date; quantity: number; returnedQty: number; soldQty: number }[]> {
  if (!draft.targetUserId || !draft.fromLocation) return []
  const snap = await getDocs(
    query(
      movementsRef(),
      where('type', '==', 'salida'),
      where('variantId', '==', draft.variantId),
      where('targetUserId', '==', draft.targetUserId),
    ),
  )
  // Las ya retornadas por completo no pueden recibir nada: se descartan antes
  // de consultar sus ventas y de re-leerlas en la transacción.
  const deliveries = snap.docs
    .map(movementFromDoc)
    .filter((m) => m.toLocation === draft.fromLocation && (m.returnedQty ?? 0) < m.quantity)
  if (deliveries.length === 0) return []

  const ids = deliveries.map((d) => String(d.id))
  const sales = (
    await Promise.all(chunk(ids, 30).map((part) => getDocs(query(movementsRef(), where('deliveryId', 'in', part)))))
  )
    .flatMap((s) => s.docs.map(movementFromDoc))
    .filter((m) => m.type === 'sale')
  const soldBySale = new Map<string, { deliveryId: string; variantId: string }>()
  const sold = new Map<string, number>()
  for (const m of sales) {
    if (!m.deliveryId) continue
    soldBySale.set(m.saleId ?? String(m.id), { deliveryId: m.deliveryId, variantId: String(m.variantId) })
    sold.set(m.deliveryId, (sold.get(m.deliveryId) ?? 0) + m.quantity)
  }
  const saleIds = [...soldBySale.keys()]
  const returns = (
    await Promise.all(chunk(saleIds, 30).map((part) => getDocs(query(movementsRef(), where('saleId', 'in', part)))))
  )
    .flatMap((s) => s.docs.map(movementFromDoc))
    .filter((m) => m.type === 'return')
  for (const r of returns) {
    const origin = soldBySale.get(r.saleId ?? '')
    if (!origin || origin.variantId !== String(r.variantId)) continue
    sold.set(origin.deliveryId, (sold.get(origin.deliveryId) ?? 0) - r.quantity)
  }

  return deliveries.map((d) => ({
    id: String(d.id),
    occurredAt: d.occurredAt,
    quantity: d.quantity,
    returnedQty: d.returnedQty ?? 0,
    soldQty: sold.get(String(d.id)) ?? 0,
  }))
}

/** Tipos que usa la pantalla de Locales: ventas, devoluciones, entregas y retornos. */
const LOCALES_TYPES: MovementType[] = ['sale', 'return', 'salida', 'retorno']

/** Parte una lista en trozos: un `in` de Firestore admite hasta 30 valores. */
function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
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
function buildDailyDelta(
  movements: Movement[],
  counted: boolean[],
  storeId: StoreId,
  now: Date,
  statsDayKey?: string,
): DocumentData {
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

  const dayKey = statsDayKey ?? movements[0]?.dayKey ?? toDayKey(now)

  movements.forEach((m, i) => {
    const isCounted = counted[i] ?? true
    switch (m.type as MovementType) {
      case 'sale':
        // Una venta 'pendiente' (por transportadora, sin confirmar todavía) no
        // es ingreso real hasta que alguien la marque 'cobrado': se cuenta ese
        // día, no el día en que salió mercancía.
        if (!isCounted) break
        totals.margin += m.margin
        totals.salesTotal += m.total
        totals.salesCount += 1
        totals.unitsSold += m.quantity
        totals.byStore += m.total
        bump(m.productId, m.quantity)
        break
      case 'purchase':
        totals.margin += m.margin
        totals.purchasesTotal += m.total
        totals.purchasesCount += 1
        break
      case 'return':
        // El valor de lo que volvió se registra siempre, haya entrado la plata
        // o no. Pero si la venta que revierte nunca se contó como ingreso
        // (seguía 'pendiente'), no hay nada que restar de `salesTotal`: restar
        // igual la dejaría en negativo por plata que jamás entró.
        // Una ANULACIÓN no es una devolución: la venta nunca debió existir, así
        // que no suma a "devoluciones"; solo revierte lo que se había contado.
        if (!m.voidOf) totals.returnsTotal += m.total
        if (!isCounted) break
        totals.margin += m.margin
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
      default:
        totals.margin += m.margin
    }
  })

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
