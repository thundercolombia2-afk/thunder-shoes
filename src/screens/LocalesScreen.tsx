/**
 * Locales. Una pestaña por local y, dentro, cuatro sub-pestañas:
 *   · Vendido  — las ventas que hizo ese local.
 *   · Devuelto — las devoluciones registradas en ese local.
 *   · Stock    — lo que TIENE ese local, por talla.
 *   · Entregas — lo que le llegó desde bodega (salidas), con fecha y referencia.
 * Es la vista de control del dueño: qué hizo y qué tiene cada local.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useBodegas, useCatalog, useStores } from '@/app/hooks'
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

type Tab = 'vendido' | 'devuelto' | 'stock' | 'entregas'
// Entregas va primero: es lo primero que revisa el local al abrir la pantalla.
const TABS: { key: Tab; label: string }[] = [
  { key: 'entregas', label: 'Entregas' },
  { key: 'vendido', label: 'Vendido' },
  { key: 'devuelto', label: 'Devuelto' },
  { key: 'stock', label: 'Stock' },
]

export function LocalesScreen() {
  const { data: stores } = useStores()
  const { data: catalog } = useCatalog()
  const { actor } = useSession()
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
    try {
      await movementRepository.setSaleStatus(m.id, status, actor)
      setMovs((prev) => prev.map((x) => (x.id === m.id ? { ...x, saleStatus: status } : x)))
    } catch {
      // Si falla (permisos, conexión), la lista se recarga y muestra la verdad.
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
  const pendingOf = useCallback(
    (m: Movement) => {
      // Lo vendido se acota al tamaño de la entrega: una devolución no puede
      // dejar "por cobrar" más pares de los que se entregaron.
      const sold = Math.min(m.quantity, Math.max(0, soldByDelivery.get(m.id) ?? 0))
      return m.quantity - sold
    },
    [soldByDelivery],
  )

  /**
   * Precio VIGENTE de la variante. El del snapshot de la entrega es el del día
   * en que salió de bodega, y entre la entrega y el cobro pueden pasar semanas:
   * la venta se registra al precio de hoy, así que el diálogo tiene que cobrar
   * ese mismo, o las vueltas en efectivo saldrían mal.
   */
  const livePriceOf = useCallback(
    (variantId: string) =>
      catalog.find((r) => r.variants.some((v) => String(v.id) === String(variantId)))?.product.price ??
      null,
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

  const stockRows = useMemo(() => {
    if (!store) return []
    return catalog
      .map((r) => {
        const sizes = r.variants
          .map((v) => ({ size: v.size, qty: stockAt(v.stockByLocation, key) }))
          .filter((x) => x.qty > 0)
          .sort((a, b) => a.size - b.size)
        return { product: r.product, sizes, total: sizes.reduce((s, x) => s + x.qty, 0) }
      })
      .filter((x) => x.total > 0)
      .sort((a, b) => a.product.name.localeCompare(b.product.name))
  }, [catalog, key, store])

  // El titular va NETO, igual que el dashboard: lo devuelto no es plata vendida.
  // Lo devuelto no desaparece, se ve en su propia casilla del desglose de abajo.
  const netSales = useMemo(() => sales.filter((m) => !isReturned(m)), [sales, isReturned])
  const salesTotal = useMemo(() => netSales.reduce((s, m) => s + m.total, 0), [netSales])
  const salesUnits = useMemo(() => netSales.reduce((s, m) => s + m.quantity, 0), [netSales])
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
  const deliveriesUnits = useMemo(() => deliveries.reduce((s, m) => s + m.quantity, 0), [deliveries])
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

          {/* Contenido de la sub-pestaña */}
          {tab === 'vendido' ? (
            <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <SummaryBar label={`${netSales.length} ${netSales.length === 1 ? 'venta' : 'ventas'} · ${salesUnits} pares`} value={<Money value={salesTotal} />} />
              <StatusBreakdown byStatus={byStatus} />
              <Card>
                {loading ? (
                  <Empty text="Cargando ventas…" />
                ) : sales.length === 0 ? (
                  <Empty text="Este local todavía no tiene ventas registradas." />
                ) : (
                  sales.map((m) => (
                    <SaleRow
                      key={m.id}
                      movement={m}
                      returned={isReturned(m)}
                      busy={busyId === m.id}
                      canAct={actor !== null}
                      onStatus={(status) => void setStatus(m, status)}
                      onReturnToBodega={() => setReturning(m)}
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
              <SummaryBar label={`${deliveries.length} ${deliveries.length === 1 ? 'entrega' : 'entregas'}`} value={`${deliveriesUnits} pares`} />
              <Card>
                {loading ? (
                  <Empty text="Cargando entregas…" />
                ) : deliveries.length === 0 ? (
                  <Empty text="Todavía no hay entregas registradas a este local." />
                ) : (
                  deliveries.map((m) => {
                    const pending = pendingOf(m)
                    const sold = m.quantity - pending
                    return (
                      <MovRow
                        key={m.id}
                        title={`${m.snapshot.productName} · T${m.snapshot.size}`}
                        sub={deliverySub(m, stores, bodegas)}
                        qty={`+${m.quantity}`}
                        qtyColor="var(--color-success)"
                        badge={
                          sold > 0 ? (
                            <span style={{ font: '700 10.5px var(--font-body)', padding: '3px 9px', borderRadius: 'var(--radius-pill)', background: SALE_STATUS_TONE.cobrado.chip, color: SALE_STATUS_TONE.cobrado.text, whiteSpace: 'nowrap' }}>
                              vendido {sold} de {m.quantity}
                            </span>
                          ) : undefined
                        }
                        actions={
                          actor && pending > 0 ? (
                            <Button variant="success" size="sm" onClick={() => setCharging(m)}>
                              Cobrar{pending < m.quantity ? ` ${pending}` : ''}
                            </Button>
                          ) : null
                        }
                      />
                    )
                  })
                )}
              </Card>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Muestra las entregas más recientes.</span>
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
    </div>
  )
}

// ── Cobro de las ventas por transportadora ───────────────────────────────────

/** Cuánto de lo vendido ya entró y cuánto sigue en la calle. */
function StatusBreakdown({
  byStatus,
}: {
  byStatus: Record<SaleStatus, { total: number; count: number }>
}) {
  const shown = (['cobrado', 'pendiente', 'devuelto'] as SaleStatus[]).filter(
    (s) => byStatus[s].count > 0,
  )
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
}: {
  movement: Movement
  /** Ya tiene su devolución escrita en el libro mayor. */
  returned: boolean
  busy: boolean
  canAct: boolean
  onStatus: (status: SaleStatus) => void
  onReturnToBodega: () => void
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
 * vendió. Registra una venta de verdad —descuenta el stock del local que
 * recibió y la plata entra al día— amarrada a la entrega, para que la fila
 * sepa cuánto le falta por vender. Pide los mismos datos que el cobro normal,
 * así que vender por transportadora desde aquí también nace "pendiente".
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ font: '700 14px var(--font-body)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</div>
        </div>
        {badge}
        <span style={{ font: '700 15px var(--font-display)', color: qtyColor ?? 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{qty}</span>
        {value ? <span style={{ font: '700 15px var(--font-display)', whiteSpace: 'nowrap', minWidth: 72, textAlign: 'right' }}>{value}</span> : null}
      </div>
      {actions ? <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{actions}</div> : null}
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 }}>{text}</div>
}
