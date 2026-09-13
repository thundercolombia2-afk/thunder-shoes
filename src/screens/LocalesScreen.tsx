/**
 * Locales. Una pestaña por local y, dentro, cinco sub-pestañas:
 *   · Entregas  — lo que le llegó desde bodega (salidas), con fecha y referencia.
 *                 El ENCARGADO (targetUserId, "a quién se le entregó") puede
 *                 Cobrarla (abre el modal y registra la venta) o marcarla
 *                 Pendiente (sin modal: solo la pasa al tab Pendiente y
 *                 desaparece de acá). Los demás usuarios solo ven, sin botones.
 *   · Pendiente — dos listas: las entregas que su encargado marcó pendiente
 *                 (ahí sí cobra, con modal, o la retorna a Entregas) y las
 *                 ventas ya registradas que siguen sin cobrarse (por
 *                 transportadora).
 *   · Vendido   — las ventas que hizo ese local.
 *   · Devuelto  — las devoluciones registradas en ese local.
 *   · Stock     — lo que TIENE ese local, por talla.
 * Es la vista de control del dueño: qué hizo y qué tiene cada local.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useBodegas, useCatalog, useStores, useVariantsWithStock } from '@/app/hooks'
import { useSession } from '@/app/session'
import { movementRepository, type MovementActor } from '@/data/repositories/movementRepository'
import { stockAt, storeKey } from '@/domain/locations'
import { errorMessage, movementLocalId, SALE_STATUS_LABEL, saleStatusOf } from '@/domain/rules'
import { formatShortDate, formatTime } from '@/lib/format'
import { Button } from '@/ui/Button'
import { Money } from '@/ui/Money'
import { ChipPicker, ModalHeader, movementPlace, QuantityStepper, SALE_STATUS_TONE, SaleStatusChip } from './_shared'
import { CobroModal, ErrorNote, Overlay } from './SellModals'
import { mulMoney, type Bodega, type Money as MoneyAmount, type Movement, type SaleStatus, type Store } from '@/domain/models'

type Tab = 'entregas' | 'pendiente' | 'vendido' | 'devuelto' | 'stock'
// Entregas va primero: es lo primero que revisa el local al abrir la pantalla.
const TABS: { key: Tab; label: string }[] = [
  { key: 'entregas', label: 'Entregas' },
  { key: 'pendiente', label: 'Pendiente' },
  { key: 'vendido', label: 'Vendido' },
  { key: 'devuelto', label: 'Devuelto' },
  { key: 'stock', label: 'Stock' },
]

export function LocalesScreen() {
  const { data: stores } = useStores()
  const { data: catalog } = useCatalog()
  // Solo esta pantalla y el par de cambio necesitan tallas de TODO el catálogo
  // (el desglose por talla del stock del local). Es más caro que la lista, y por
  // eso no lo usan las pantallas de entrada.
  const { variants: variantsWithStock } = useVariantsWithStock()
  const { user, actor } = useSession()
  const bodegas = useBodegas()
  const [movs, setMovs] = useState<Movement[]>([])
  const [loading, setLoading] = useState(true)
  const [storeId, setStoreId] = useState('')
  const [tab, setTab] = useState<Tab>('entregas')
  /** Línea de venta a la que se le va a dar retorno a bodega. */
  const [returning, setReturning] = useState<Movement | null>(null)
  /** Entrega de bodega que se está cobrando (se vendió después de recibirla). */
  const [charging, setCharging] = useState<Movement | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  /** Error del último intento de cobrar/marcar pendiente, para no fallar en silencio. */
  const [actionError, setActionError] = useState('')
  /** Movimiento cuya tarjeta de detalle está abierta (info completa, sin recortar). */
  const [detail, setDetail] = useState<Movement | null>(null)

  /** El ENCARGADO de una entrega es la única persona que puede cobrarla o marcarla pendiente. */
  const isMine = useCallback((m: Movement) => !!user && m.targetUserId === user.id, [user])

  const reload = useCallback(() => {
    movementRepository
      .listRecent()
      .then(setMovs)
      .catch(() => undefined)
      .finally(() => setLoading(false))
  }, [])
  useEffect(() => reload(), [reload])

  /**
   * Marca la línea de venta como cobrada o pendiente. El estado se refleja de
   * una en pantalla (sin recargar la lista entera) porque el cambio es de un
   * solo campo y no toca stock ni importes.
   */
  const setStatus = async (m: Movement, status: SaleStatus) => {
    if (!actor) return
    setBusyId(m.id)
    setActionError('')
    try {
      await movementRepository.setSaleStatus(m.id, status, actor)
      setMovs((prev) => prev.map((x) => (x.id === m.id ? { ...x, saleStatus: status } : x)))
    } catch (e) {
      // Si falla (permisos, conexión), se avisa y la lista se recarga para mostrar la verdad.
      setActionError(errorMessage(e))
      reload()
    } finally {
      setBusyId(null)
    }
  }

  /**
   * Marca una entrega como pendiente, sin abrir ningún diálogo ni registrar
   * venta: solo pasa "de Entregas a Pendiente" a la vista. La venta de verdad
   * se crea después, cuando el encargado toque "Cobrar" (ahí sí con cantidad,
   * pago y cliente).
   */
  const setDeliveryPending = async (m: Movement, pending: boolean) => {
    if (!actor) return
    setBusyId(m.id)
    setActionError('')
    try {
      await movementRepository.setDeliveryPending(m.id, pending, actor)
      setMovs((prev) => prev.map((x) => (x.id === m.id ? { ...x, deliveryPending: pending } : x)))
    } catch (e) {
      setActionError(errorMessage(e))
      reload()
    } finally {
      setBusyId(null)
    }
  }

  const store = stores.find((s) => s.id === storeId) ?? stores[0]
  const key = store ? storeKey(store.id) : ''

  // Movimientos de ESTE local (listRecent ya viene de más reciente a más antiguo).
  const sales = useMemo(
    () => (store ? movs.filter((m) => m.type === 'sale' && movementLocalId(m) === store.id) : []),
    [movs, store],
  )

  /**
   * Cuántos pares se devolvieron de cada línea vendida, según el libro mayor.
   * Sin esto, una venta devuelta POR CAJA (que no toca el estado de cobro)
   * seguiría ofreciendo "Cobrar": el operador marcaría como cobrado un par que
   * ya volvió. La verdad la manda el asiento, no el estado.
   */
  const returnedByLine = useMemo(() => {
    const acc = new Map<string, number>()
    for (const m of movs) {
      if (m.type !== 'return') continue
      const key = `${m.saleId ?? m.id}:${String(m.variantId)}`
      acc.set(key, (acc.get(key) ?? 0) + m.quantity)
    }
    return acc
  }, [movs])
  /**
   * Cuántos pares lleva vendidos cada entrega, según las ventas que se cobraron
   * desde ella (`deliveryId`). Una venta hecha escaneando NO cuenta aquí: no
   * hay forma de saber de qué entrega salió ese par. Si ya se vendió por
   * escáner, el cobro de la entrega falla por stock insuficiente, que es la
   * red de seguridad real.
   */
  const soldByDelivery = useMemo(() => {
    const acc = new Map<string, number>()
    // Qué venta salió de qué entrega, para poder devolverle el pendiente si el
    // cliente devuelve el par: si no, la entrega quedaría "vendida" para
    // siempre y no se podría volver a cobrar lo que sigue en el local.
    const deliveryBySale = new Map<string, string>()
    for (const m of movs) {
      if (m.type === 'sale' && m.deliveryId) deliveryBySale.set(m.saleId ?? m.id, m.deliveryId)
    }
    const bump = (deliveryId: string, delta: number) =>
      acc.set(deliveryId, (acc.get(deliveryId) ?? 0) + delta)
    for (const m of movs) {
      if (m.type === 'sale' && m.deliveryId) bump(m.deliveryId, m.quantity)
      else if (m.type === 'return') {
        const deliveryId = deliveryBySale.get(m.saleId ?? m.id)
        if (deliveryId) bump(deliveryId, -m.quantity)
      }
    }
    return acc
  }, [movs])
  /**
   * Cuántos pares de cada entrega ya volvieron a bodega por un retorno del
   * escáner (Bodega → Retorno). Ese retorno es genérico —no sabe de qué
   * entrega salió el par, solo de qué referencia y de qué encargado—, así que
   * se reparte contra sus entregas de más antigua a más nueva (FIFO): la
   * mercancía que se devuelve es, en la práctica, la que más tiempo lleva ahí.
   */
  const returnedByDelivery = useMemo(() => {
    const acc = new Map<string, number>()
    const pool = new Map<string, number>()
    for (const m of movs) {
      if (m.type !== 'retorno' || !m.targetUserId) continue
      const key = `${String(m.variantId)}|${m.targetUserId}`
      pool.set(key, (pool.get(key) ?? 0) + m.quantity)
    }
    // `movs` viene de más reciente a más antigua; se recorre al revés para
    // consumir el pool empezando por la entrega más vieja.
    const deliveriesChrono = movs.filter((m) => m.type === 'salida').slice().reverse()
    for (const d of deliveriesChrono) {
      if (!d.targetUserId) continue
      const key = `${String(d.variantId)}|${d.targetUserId}`
      const available = pool.get(key) ?? 0
      if (available <= 0) continue
      const take = Math.min(d.quantity, available)
      acc.set(d.id, take)
      pool.set(key, available - take)
    }
    return acc
  }, [movs])
  /** Lo que le queda a la entrega después de descontar lo ya retornado a bodega. */
  const effectiveQtyOf = useCallback(
    (m: Movement) => m.quantity - Math.min(m.quantity, Math.max(0, returnedByDelivery.get(m.id) ?? 0)),
    [returnedByDelivery],
  )
  const pendingOf = useCallback(
    (m: Movement) => {
      // Lo vendido se acota al tamaño de la entrega YA NETA de retornos: una
      // devolución no puede dejar "por cobrar" más pares de los que quedan.
      const effective = effectiveQtyOf(m)
      const sold = Math.min(effective, Math.max(0, soldByDelivery.get(m.id) ?? 0))
      return effective - sold
    },
    [soldByDelivery, effectiveQtyOf],
  )

  /**
   * Precio VIGENTE de la variante. El del snapshot de la entrega es el del día
   * en que salió de bodega, y entre la entrega y el cobro pueden pasar semanas:
   * la venta se registra al precio de hoy, así que el diálogo tiene que cobrar
   * ese mismo, o las vueltas en efectivo saldrían mal.
   */
  const livePriceOf = useCallback(
    (variantId: string) => {
      // El id de variante es "productId:talla", así que la referencia sale de ahí
      // sin recorrer tallas. Además funciona con una talla ya agotada, que es el
      // caso real: el par se entregó y puede haberse vendido el resto.
      const productId = String(variantId).split(':')[0]
      return catalog.find((r) => String(r.product.id) === productId)?.product.price ?? null
    },
    [catalog],
  )

  const isReturned = useCallback(
    (m: Movement) =>
      (returnedByLine.get(`${m.saleId ?? m.id}:${String(m.variantId)}`) ?? 0) >= m.quantity,
    [returnedByLine],
  )
  const returns = useMemo(
    () => (store ? movs.filter((m) => m.type === 'return' && movementLocalId(m) === store.id) : []),
    [movs, store],
  )
  const deliveries = useMemo(
    () => (store ? movs.filter((m) => m.type === 'salida' && m.toLocation === key) : []),
    [movs, key, store],
  )
  /** Entregas que el encargado marcó pendiente y todavía no se han cobrado del todo. */
  const pendingDeliveries = useMemo(
    () => deliveries.filter((m) => m.deliveryPending && pendingOf(m) > 0),
    [deliveries, pendingOf],
  )
  /**
   * Entregas del tab "Entregas": una vez marcada pendiente, se muda al tab
   * Pendiente; una vez retornada por completo a bodega, desaparece — ya no
   * está en el local.
   */
  const activeDeliveries = useMemo(
    () => deliveries.filter((m) => !m.deliveryPending && effectiveQtyOf(m) > 0),
    [deliveries, effectiveQtyOf],
  )

  // Tallas con stock EN ESTE LOCAL, agrupadas por referencia. Salen de la
  // suscripción a tallas con stock (no del catálogo, que ya no las trae): una
  // talla con cantidad en una ubicación tiene por definición `stock > 0`, así que
  // el desglose es exactamente el mismo que antes.
  const sizesByProduct = useMemo(() => {
    const byProduct = new Map<string, { size: number; qty: number }[]>()
    for (const v of variantsWithStock) {
      const qty = stockAt(v.stockByLocation, key)
      if (qty <= 0) continue
      const bucket = byProduct.get(String(v.productId))
      if (bucket) bucket.push({ size: v.size, qty })
      else byProduct.set(String(v.productId), [{ size: v.size, qty }])
    }
    for (const bucket of byProduct.values()) bucket.sort((a, b) => a.size - b.size)
    return byProduct
  }, [variantsWithStock, key])

  const stockRows = useMemo(() => {
    if (!store) return []
    return catalog
      .map((r) => {
        const sizes = sizesByProduct.get(String(r.product.id)) ?? []
        return { product: r.product, sizes, total: sizes.reduce((s, x) => s + x.qty, 0) }
      })
      .filter((x) => x.total > 0)
      .sort((a, b) => a.product.name.localeCompare(b.product.name))
  }, [catalog, sizesByProduct, store])

  // El titular va NETO, igual que el dashboard: lo devuelto no es plata vendida.
  // Lo devuelto no desaparece, se ve en su propia casilla del desglose de abajo.
  const netSales = useMemo(() => sales.filter((m) => !isReturned(m)), [sales, isReturned])
  const salesTotal = useMemo(() => netSales.reduce((s, m) => s + m.total, 0), [netSales])
  const salesUnits = useMemo(() => netSales.reduce((s, m) => s + m.quantity, 0), [netSales])
  /**
   * Ventas YA registradas (por transportadora, escaneadas) que siguen sin
   * cobrarse. Las entregas marcadas pendiente desde Entregas NO están acá
   * todavía: como no generan venta hasta que se cobran, viven en
   * `pendingDeliveries`.
   */
  const pendingSales = useMemo(
    () => sales.filter((m) => !isReturned(m) && saleStatusOf(m) === 'pendiente'),
    [sales, isReturned],
  )
  const pendingTotal = useMemo(() => pendingSales.reduce((s, m) => s + m.total, 0), [pendingSales])
  /** Desglose por estado de cobro: cuánto entró ya y cuánto está en la calle. */
  const byStatus = useMemo(() => {
    const acc: Record<SaleStatus, { total: number; count: number }> = {
      cobrado: { total: 0, count: 0 },
      pendiente: { total: 0, count: 0 },
      devuelto: { total: 0, count: 0 },
    }
    for (const m of sales) {
      const bucket = acc[isReturned(m) ? 'devuelto' : saleStatusOf(m)]
      bucket.total += m.total
      bucket.count += 1
    }
    return acc
  }, [sales, isReturned])
  const returnsTotal = useMemo(() => returns.reduce((s, m) => s + m.total, 0), [returns])
  const returnsUnits = useMemo(() => returns.reduce((s, m) => s + m.quantity, 0), [returns])
  const deliveriesUnits = useMemo(
    () => activeDeliveries.reduce((s, m) => s + effectiveQtyOf(m), 0),
    [activeDeliveries, effectiveQtyOf],
  )
  const stockUnits = useMemo(() => stockRows.reduce((s, r) => s + r.total, 0), [stockRows])

  return (
    <div style={{ padding: '18px 20px 28px', display: 'flex', flexDirection: 'column', gap: 18, width: '100%', boxSizing: 'border-box' }} className="iw-fade">
      <h1 style={{ margin: 0, font: '700 24px var(--font-display)' }}>Locales</h1>

      {stores.length === 0 ? (
        <Empty text="No hay locales todavía. Corre npm run seed:scaffold para crear 163 y 173." />
      ) : (
        <>
          {/* Pestañas por local */}
          <ChipPicker
            items={stores}
            selectedId={store?.id ?? ''}
            onSelect={setStoreId}
            label={(s) => `Local ${s.code}`}
            size="lg"
          />

          {/* Sub-pestañas: vendido / devuelto / stock / entregas */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', borderBottom: '1px solid var(--border-subtle)', paddingBottom: 2 }}>
            {TABS.map((t) => {
              const on = t.key === tab
              return (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className="iw-press"
                  style={{
                    padding: '9px 15px',
                    borderRadius: 'var(--radius-md) var(--radius-md) 0 0',
                    font: '700 13.5px var(--font-body)',
                    cursor: 'pointer',
                    border: 'none',
                    borderBottom: `2.5px solid ${on ? 'var(--iw-plum)' : 'transparent'}`,
                    background: 'transparent',
                    color: on ? 'var(--iw-plum)' : 'var(--text-muted)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {t.label}
                </button>
              )
            })}
          </div>

          <ErrorNote text={actionError} />

          {/* Contenido de la sub-pestaña */}
          {tab === 'pendiente' ? (
            <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <div style={{ font: '700 13px var(--font-body)', color: 'var(--text-secondary)', marginBottom: 8 }}>
                  Entregas por confirmar · {pendingDeliveries.length}
                </div>
                <Card>
                  {loading ? (
                    <Empty text="Cargando pendientes…" />
                  ) : pendingDeliveries.length === 0 ? (
                    <Empty text="No hay entregas marcadas pendiente en este local." />
                  ) : (
                    pendingDeliveries.map((m) => {
                      const effective = effectiveQtyOf(m)
                      const pending = pendingOf(m)
                      const sold = effective - pending
                      return (
                        <MovRow
                          key={m.id}
                          title={`${m.snapshot.productName} · T${m.snapshot.size}`}
                          sub={deliverySub(m, stores, bodegas)}
                          qty={`+${effective}`}
                          qtyColor="var(--color-success)"
                          onOpen={() => setDetail(m)}
                          badge={
                            sold > 0 ? (
                              <span style={{ font: '700 10.5px var(--font-body)', padding: '3px 9px', borderRadius: 'var(--radius-pill)', background: SALE_STATUS_TONE.cobrado.chip, color: SALE_STATUS_TONE.cobrado.text, whiteSpace: 'nowrap' }}>
                                vendido {sold} de {effective}
                              </span>
                            ) : undefined
                          }
                          actions={
                            actor && isMine(m) ? (
                              <>
                                <Button variant="success" size="sm" onClick={() => setCharging(m)}>
                                  Cobrar{pending < m.quantity ? ` ${pending}` : ''}
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  disabled={busyId === m.id}
                                  onClick={() => void setDeliveryPending(m, false)}
                                >
                                  Retornar a Entregas
                                </Button>
                              </>
                            ) : null
                          }
                        />
                      )
                    })
                  )}
                </Card>
              </div>

              <div>
                <SummaryBar
                  label={`${pendingSales.length} ${pendingSales.length === 1 ? 'venta' : 'ventas'} sin cobrar`}
                  value={<Money value={pendingTotal} />}
                />
                <Card>
                  {loading ? (
                    <Empty text="Cargando pendientes…" />
                  ) : pendingSales.length === 0 ? (
                    <Empty text="No hay ventas pendientes por cobrar en este local." />
                  ) : (
                    pendingSales.map((m) => (
                      <SaleRow
                        key={m.id}
                        movement={m}
                        returned={false}
                        busy={busyId === m.id}
                        canAct={actor !== null}
                        onStatus={(status) => void setStatus(m, status)}
                        onReturnToBodega={() => setReturning(m)}
                        onOpen={() => setDetail(m)}
                      />
                    ))
                  )}
                </Card>
              </div>
            </section>
          ) : tab === 'vendido' ? (
            <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <SummaryBar label={`${netSales.length} ${netSales.length === 1 ? 'venta' : 'ventas'} · ${salesUnits} pares`} value={<Money value={salesTotal} />} />
              <StatusBreakdown byStatus={byStatus} />
              <Card>
                {loading ? (
                  <Empty text="Cargando ventas…" />
                ) : netSales.length === 0 ? (
                  <Empty text="Este local todavía no tiene ventas registradas." />
                ) : (
                  netSales.map((m) => (
                    <SaleRow
                      key={m.id}
                      movement={m}
                      returned={false}
                      busy={busyId === m.id}
                      canAct={actor !== null}
                      onStatus={(status) => void setStatus(m, status)}
                      onReturnToBodega={() => setReturning(m)}
                      onOpen={() => setDetail(m)}
                    />
                  ))
                )}
              </Card>
            </section>
          ) : tab === 'devuelto' ? (
            <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <SummaryBar label={`${returns.length} ${returns.length === 1 ? 'devolución' : 'devoluciones'} · ${returnsUnits} pares`} value={<Money value={returnsTotal} />} />
              <Card>
                {loading ? (
                  <Empty text="Cargando devoluciones…" />
                ) : returns.length === 0 ? (
                  <Empty text="Este local todavía no tiene devoluciones registradas." />
                ) : (
                  returns.map((m) => (
                    <MovRow
                      key={m.id}
                      title={`${m.snapshot.productName} · T${m.snapshot.size}`}
                      sub={[formatShortDate(m.occurredAt), formatTime(m.occurredAt), m.returnReason, m.userName].filter(Boolean).join(' · ')}
                      qty={`+${m.quantity}`}
                      qtyColor="var(--color-success)"
                      value={<Money value={m.total} />}
                      onOpen={() => setDetail(m)}
                    />
                  ))
                )}
              </Card>
            </section>
          ) : tab === 'stock' ? (
            <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <SummaryBar label={`${stockRows.length} ${stockRows.length === 1 ? 'referencia' : 'referencias'}`} value={`${stockUnits} pares`} />
              <Card>
                {stockRows.length === 0 ? (
                  <Empty text="Este local no tiene stock todavía. Le llega con una salida de bodega." />
                ) : (
                  stockRows.map((row) => (
                    <div key={row.product.id} className="iw-row" style={{ padding: '13px 16px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ font: '700 14.5px var(--font-display)' }}>{row.product.name}</div>
                          <div style={{ font: '600 11px var(--font-mono)', color: 'var(--text-muted)' }}>{row.product.sku}</div>
                        </div>
                        <div style={{ font: '700 18px var(--font-display)' }}>{row.total}</div>
                      </div>
                      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                        {row.sizes.map((s) => (
                          <div key={s.size} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 34, background: 'var(--iw-off-white)', border: '1px solid var(--border-subtle)', borderRadius: 8, padding: '3px 6px' }}>
                            <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700 }}>{s.size}</span>
                            <span style={{ font: '700 13px var(--font-display)' }}>{s.qty}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </Card>
            </section>
          ) : (
            <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <SummaryBar label={`${activeDeliveries.length} ${activeDeliveries.length === 1 ? 'entrega' : 'entregas'}`} value={`${deliveriesUnits} pares`} />
              <Card>
                {loading ? (
                  <Empty text="Cargando entregas…" />
                ) : activeDeliveries.length === 0 ? (
                  <Empty text="Todavía no hay entregas registradas a este local." />
                ) : (
                  activeDeliveries.map((m) => {
                    const effective = effectiveQtyOf(m)
                    const pending = pendingOf(m)
                    const sold = effective - pending
                    return (
                      <MovRow
                        key={m.id}
                        title={`${m.snapshot.productName} · T${m.snapshot.size}`}
                        sub={deliverySub(m, stores, bodegas)}
                        qty={`+${effective}`}
                        qtyColor="var(--color-success)"
                        onOpen={() => setDetail(m)}
                        badge={
                          sold > 0 ? (
                            <span style={{ font: '700 10.5px var(--font-body)', padding: '3px 9px', borderRadius: 'var(--radius-pill)', background: SALE_STATUS_TONE.cobrado.chip, color: SALE_STATUS_TONE.cobrado.text, whiteSpace: 'nowrap' }}>
                              vendido {sold} de {effective}
                            </span>
                          ) : undefined
                        }
                        actions={
                          actor && pending > 0 && isMine(m) ? (
                            <>
                              <Button variant="success" size="sm" onClick={() => setCharging(m)}>
                                Cobrar{pending < m.quantity ? ` ${pending}` : ''}
                              </Button>
                              <Button
                                variant="accent"
                                size="sm"
                                disabled={busyId === m.id}
                                onClick={() => void setDeliveryPending(m, true)}
                              >
                                Pendiente{pending < m.quantity ? ` ${pending}` : ''}
                              </Button>
                            </>
                          ) : null
                        }
                      />
                    )
                  })
                )}
              </Card>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Muestra las entregas más recientes. Solo el encargado de cada una (a quien se le entregó) puede cobrarla o marcarla pendiente. Al marcarla pendiente se muda al tab Pendiente.
              </span>
            </section>
          )}
        </>
      )}

      {charging && actor ? (
        <CobrarEntregaModal
          delivery={charging}
          maxQuantity={pendingOf(charging)}
          unitPrice={livePriceOf(charging.variantId) ?? charging.snapshot.unitPrice}
          storeCode={store?.code ?? ''}
          actor={actor}
          onClose={() => setCharging(null)}
          onDone={() => {
            setCharging(null)
            reload()
          }}
        />
      ) : null}

      {returning && actor ? (
        <ReturnToBodegaModal
          movement={returning}
          bodegas={bodegas}
          actor={actor}
          onClose={() => setReturning(null)}
          onDone={() => {
            setReturning(null)
            reload()
          }}
        />
      ) : null}

      {detail ? (
        <MovementDetailModal movement={detail} stores={stores} bodegas={bodegas} onClose={() => setDetail(null)} />
      ) : null}
    </div>
  )
}

// ── Cobro de las ventas por transportadora ───────────────────────────────────

/**
 * Cuánto de lo vendido ya entró y cuánto sigue en la calle. Lo devuelto no
 * entra aquí: esas ventas ya no aparecen en Vendido, viven en su propio tab.
 */
function StatusBreakdown({
  byStatus,
}: {
  byStatus: Record<SaleStatus, { total: number; count: number }>
}) {
  const shown = (['cobrado', 'pendiente'] as SaleStatus[]).filter((s) => byStatus[s].count > 0)
  if (shown.length < 2) return null // con un solo estado el desglose no aporta
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {shown.map((s) => (
        <div
          key={s}
          style={{
            flex: '1 1 140px',
            background: 'var(--surface-card)',
            border: `1px solid ${SALE_STATUS_TONE[s].border}`,
            borderRadius: 'var(--radius-md)',
            padding: '9px 13px',
          }}
        >
          <div style={{ fontSize: 11.5, fontWeight: 700, color: SALE_STATUS_TONE[s].text }}>
            {SALE_STATUS_LABEL[s]} · {byStatus[s].count}
          </div>
          <div style={{ font: '700 15px var(--font-display)' }}>
            <Money value={byStatus[s].total} />
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * Una línea vendida, con su estado de cobro.
 *
 * Lo vendido por transportadora se despacha hoy y se paga como una semana
 * después —y si el cliente no lo paga, el par vuelve—. Por eso cada línea se
 * puede marcar `Pendiente` mientras la plata no llegue, y después `Cobrar`
 * (entró) o `Retorno a bodega` (no lo pagaron y el zapato regresa).
 */
function SaleRow({
  movement: m,
  returned,
  busy,
  canAct,
  onStatus,
  onReturnToBodega,
  onOpen,
}: {
  movement: Movement
  /** Ya tiene su devolución escrita en el libro mayor. */
  returned: boolean
  busy: boolean
  canAct: boolean
  onStatus: (status: SaleStatus) => void
  onReturnToBodega: () => void
  /** Abre la tarjeta de detalle completo (sin recortar) de esta línea. */
  onOpen?: () => void
}) {
  const status = returned ? 'devuelto' : saleStatusOf(m)
  return (
    <MovRow
      title={`${m.snapshot.productName} · T${m.snapshot.size}`}
      sub={[formatShortDate(m.occurredAt), formatTime(m.occurredAt), m.payment, m.customerName, m.userName]
        .filter(Boolean)
        .join(' · ')}
      qty={`×${m.quantity}`}
      value={<Money value={m.total} />}
      badge={<SaleStatusChip status={status} />}
      dim={busy}
      highlight={status === 'pendiente'}
      onOpen={onOpen}
      actions={
        canAct && status !== 'devuelto' ? (
          <>
            {status !== 'cobrado' ? (
              <Button variant="success" size="sm" disabled={busy} onClick={() => onStatus('cobrado')}>
                Cobrar
              </Button>
            ) : (
              <Button variant="accent" size="sm" disabled={busy} onClick={() => onStatus('pendiente')}>
                Pendiente
              </Button>
            )}
            {status === 'pendiente' ? (
              <Button variant="danger" size="sm" disabled={busy} onClick={onReturnToBodega}>
                Retorno a bodega
              </Button>
            ) : null}
          </>
        ) : null
      }
    />
  )
}

/**
 * Cobrar lo que se entregó desde bodega y se vendió DESPUÉS.
 *
 * En temporada no hay tiempo de cobrar par por par: se despacha la mercancía
 * desde bodega y más tarde, con calma, se confirma qué de lo entregado se
 * vendió. Registra una venta de verdad, ya COBRADA —descuenta el stock del
 * local que recibió y la plata entra al día— amarrada a la entrega, para que
 * la fila sepa cuánto le falta por vender. Solo el ENCARGADO de la entrega
 * llega hasta aquí (Entregas y Pendiente ocultan el botón a los demás).
 */
function CobrarEntregaModal({
  delivery,
  maxQuantity,
  unitPrice,
  storeCode,
  actor,
  onClose,
  onDone,
}: {
  delivery: Movement
  /** Pares de esa entrega que todavía no se han cobrado. */
  maxQuantity: number
  /** Precio vigente del par: es al que se va a registrar la venta. */
  unitPrice: MoneyAmount
  storeCode: string
  actor: MovementActor
  onClose: () => void
  onDone: () => void
}) {
  const [quantity, setQuantity] = useState(1)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // El local es el DESTINO de la entrega, no el de quien mira la pantalla: la
  // venta descuenta de donde está el zapato y se le abona a ese local.
  const localId = movementLocalId(delivery)
  const total = mulMoney(unitPrice, quantity)

  const submit = async (payment: string, customerName: string, customerPhone: string) => {
    setBusy(true)
    setError('')
    try {
      await movementRepository.recordMany(
        [
          {
            type: 'sale',
            variantId: delivery.variantId,
            quantity,
            fromLocation: storeKey(localId),
            deliveryId: delivery.id,
          },
        ],
        { ...actor, storeId: localId as MovementActor['storeId'] },
        {
          payment,
          statusOverride: 'cobrado',
          ...(customerName ? { customerName } : {}),
          ...(customerPhone ? { customerPhone } : {}),
        },
      )
      onDone()
    } catch (e) {
      setError(errorMessage(e))
      setBusy(false)
    }
  }

  return (
    <CobroModal
      total={total}
      fromStore={storeCode ? `Local ${storeCode}` : ''}
      busy={busy}
      error={error}
      title="Cobrar entrega"
      confirmLabel="Registrar venta"
      onClose={onClose}
      onConfirm={(payment, name, phone) => void submit(payment, name, phone)}
      extra={
        <div style={{ marginTop: 14, background: 'var(--surface-muted)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', padding: '13px 16px' }}>
          <div style={{ font: '700 15px var(--font-display)' }}>
            {delivery.snapshot.productName} · T{delivery.snapshot.size}
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 3 }}>
            Entregados {delivery.quantity} · por cobrar {maxQuantity}
            {delivery.targetUserName ? ` · para ${delivery.targetUserName}` : ''}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 6, lineHeight: 1.45 }}>
            Úsalo solo si esta venta <b>no se cobró ya con el escáner</b>: una venta escaneada no
            se puede amarrar a una entrega, así que cobrarla aquí de nuevo la registraría dos veces.
          </div>
          <div style={{ marginTop: 12 }}>
            <QuantityStepper
              value={quantity}
              onDec={() => setQuantity((q) => Math.max(1, q - 1))}
              onInc={() => setQuantity((q) => Math.min(maxQuantity, q + 1))}
            />
          </div>
        </div>
      }
    />
  )
}

/**
 * Retorno a bodega de una venta que el cliente no pagó: solo elige la bodega y
 * confirma. La operación entera (anular la venta, meter el par a la bodega y
 * marcar la línea) vive en el repositorio, que es donde se puede garantizar que
 * o pasa todo o no pasa nada.
 */
function ReturnToBodegaModal({
  movement: m,
  bodegas,
  actor,
  onClose,
  onDone,
}: {
  movement: Movement
  bodegas: Bodega[]
  actor: MovementActor
  onClose: () => void
  onDone: () => void
}) {
  const active = useMemo(() => bodegas.filter((b) => b.active), [bodegas])
  const [bodegaId, setBodegaId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [failed, setFailed] = useState(false)
  const bodega = active.find((b) => b.id === bodegaId) ?? active[0]

  const submit = async () => {
    if (!bodega) return
    setBusy(true)
    setError('')
    try {
      await movementRepository.returnSaleToBodega(m, bodega.id, actor)
      onDone()
    } catch (e) {
      setError(errorMessage(e))
      // Tras un fallo no se deja reintentar a ciegas: puede que la devolución
      // sí se haya escrito. Se cierra y se recarga para ver el estado real.
      setFailed(true)
      setBusy(false)
    }
  }

  return (
    <Overlay onClose={onClose} width={440}>
      <ModalHeader title="Retorno a bodega" onClose={onClose} />

      <div style={{ background: 'var(--surface-muted)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', padding: '12px 15px', marginBottom: 14 }}>
        <div style={{ font: '700 15px var(--font-display)' }}>
          {m.snapshot.productName} · T{m.snapshot.size} · ×{m.quantity}
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 3 }}>
          {[formatShortDate(m.occurredAt), m.payment, m.customerName].filter(Boolean).join(' · ')}
        </div>
      </div>

      <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
        Se anula la venta (la plata sale de los totales) y el par queda en la bodega que elijas.
      </p>

      {active.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--color-danger)', fontWeight: 700 }}>
          No hay bodegas activas. Crea una en Configuración.
        </div>
      ) : (
        <div style={{ marginBottom: 14 }}>
          <ChipPicker
            items={active}
            selectedId={bodega?.id ?? ''}
            onSelect={setBodegaId}
            label={(b) => b.code}
          />
        </div>
      )}

      <ErrorNote text={error} />

      <div style={{ display: 'flex', gap: 10, marginTop: 18, justifyContent: 'flex-end' }}>
        <Button variant="outline" onClick={failed ? onDone : onClose}>
          {failed ? 'Cerrar y actualizar' : 'Cancelar'}
        </Button>
        {!failed ? (
          <Button onClick={() => void submit()} disabled={busy || !bodega}>
            {busy ? 'Registrando…' : `Retornar a ${bodega?.code ?? 'bodega'}`}
          </Button>
        ) : null}
      </div>
    </Overlay>
  )
}

/** Subtítulo de una entrega: cuándo, desde qué bodega, quién la hizo y A QUIÉN. */
function deliverySub(m: Movement, stores: Store[], bodegas: Bodega[]): string {
  const place = movementPlace(m, stores, bodegas)
  return [
    formatShortDate(m.occurredAt),
    formatTime(m.occurredAt),
    place.bodega ? `desde ${place.bodega}` : '',
    place.person ? `para ${place.person}` : '',
    m.userName,
  ]
    .filter(Boolean)
    .join(' · ')
}

/**
 * Tarjeta con el detalle completo de un movimiento, sin recortar nada. La fila
 * en pantalla angosta corta el subtítulo (bodega, encargado, etc.); esta
 * tarjeta es donde se ve todo, tocando la fila.
 */
function MovementDetailModal({
  movement: m,
  stores,
  bodegas,
  onClose,
}: {
  movement: Movement
  stores: Store[]
  bodegas: Bodega[]
  onClose: () => void
}) {
  const place = movementPlace(m, stores, bodegas)
  const status: SaleStatus | null = m.type === 'sale' ? saleStatusOf(m) : null
  return (
    <Overlay onClose={onClose} width={420}>
      <ModalHeader title={`${m.snapshot.productName} · T${m.snapshot.size}`} onClose={onClose} />
      <div style={{ marginTop: 6 }}>
        <DetailRow label="SKU" value={m.snapshot.sku} />
        <DetailRow label="Código de barras" value={m.snapshot.barcode} />
        <DetailRow label="Cantidad" value={`${m.quantity} ${m.quantity === 1 ? 'par' : 'pares'}`} />
        <DetailRow label="Valor" value={<Money value={m.total} />} />
        <DetailRow label="Fecha" value={`${formatShortDate(m.occurredAt)} · ${formatTime(m.occurredAt)}`} />
        {status ? <DetailRow label="Estado de cobro" value={<SaleStatusChip status={status} />} /> : null}
        {m.type === 'sale' ? (
          <>
            <DetailRow label="Método de pago" value={m.payment} />
            <DetailRow label="Cliente" value={m.customerName} />
            <DetailRow label="Teléfono" value={m.customerPhone} />
            <DetailRow label="Registrada por" value={m.userName} />
          </>
        ) : null}
        {m.type === 'salida' ? (
          <>
            <DetailRow label="Desde bodega" value={place.bodega} />
            <DetailRow label="Encargado" value={m.targetUserName} />
            <DetailRow label="Despachada por" value={m.userName} />
            {m.deliveryPending ? (
              <DetailRow
                label="Marcada pendiente"
                value={[m.deliveryPendingBy, m.deliveryPendingAt ? formatShortDate(m.deliveryPendingAt) : '']
                  .filter(Boolean)
                  .join(' · ')}
              />
            ) : null}
          </>
        ) : null}
        {m.type === 'return' ? (
          <>
            <DetailRow label="Razón" value={m.returnReason} />
            <DetailRow label="Registrada por" value={m.userName} />
          </>
        ) : null}
      </div>
    </Overlay>
  )
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === undefined || value === null || value === '') return null
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 12,
        padding: '10px 0',
        borderBottom: '1px solid var(--border-subtle)',
      }}
    >
      <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 700 }}>{label}</span>
      <span style={{ fontSize: 13.5, color: 'var(--text-primary)', fontWeight: 700, textAlign: 'right' }}>{value}</span>
    </div>
  )
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-sm)', overflow: 'hidden' }}>
      {children}
    </div>
  )
}

function SummaryBar({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, background: 'var(--surface-sunken)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: '10px 15px' }}>
      <span style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 700, minWidth: 0 }}>{label}</span>
      <span style={{ font: '700 var(--font-display)', fontSize: 'clamp(15px, 4.5vw, 18px)', whiteSpace: 'nowrap' }}>{value}</span>
    </div>
  )
}

/**
 * Una línea de movimiento. `badge` y `actions` son opcionales: las ventas les
 * cuelgan su estado de cobro y sus botones, y las demás pestañas usan la fila
 * pelada de siempre.
 */
function MovRow({
  title,
  sub,
  qty,
  qtyColor,
  value,
  badge,
  actions,
  dim,
  highlight,
  onOpen,
}: {
  title: string
  sub: string
  qty: string
  qtyColor?: string
  value?: React.ReactNode
  badge?: React.ReactNode
  actions?: React.ReactNode
  dim?: boolean
  highlight?: boolean
  /** Si se pasa, la fila se puede tocar/clicar para ver el detalle completo. */
  onOpen?: (() => void) | undefined
}) {
  return (
    <div
      className="iw-row"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 9,
        padding: '12px 16px',
        borderBottom: '1px solid var(--border-subtle)',
        opacity: dim ? 0.55 : 1,
        background: highlight ? 'rgba(255,209,0,.06)' : undefined,
      }}
    >
      <div
        onClick={onOpen}
        role={onOpen ? 'button' : undefined}
        style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: onOpen ? 'pointer' : undefined }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ font: '700 14px var(--font-body)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</div>
        </div>
        {badge}
        <span style={{ font: '700 15px var(--font-display)', color: qtyColor ?? 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{qty}</span>
        {value ? <span style={{ font: '700 15px var(--font-display)', whiteSpace: 'nowrap', minWidth: 72, textAlign: 'right' }}>{value}</span> : null}
        {onOpen ? <span style={{ color: 'var(--text-muted)', fontSize: 18, lineHeight: 1 }}>›</span> : null}
      </div>
      {actions ? <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{actions}</div> : null}
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 }}>{text}</div>
}
