/**
 * Locales. Una pestaña por local y, dentro, cuatro sub-pestañas:
 *   · Vendido  — las ventas que hizo ese local.
 *   · Devuelto — las devoluciones registradas en ese local.
 *   · Stock    — lo que TIENE ese local, por talla.
 *   · Entregas — lo que le llegó desde bodega (salidas), con fecha y referencia.
 * Es la vista de control del dueño: qué hizo y qué tiene cada local.
 */

import { useEffect, useMemo, useState } from 'react'
import { useCatalog, useStores } from '@/app/hooks'
import { movementRepository } from '@/data/repositories/movementRepository'
import { bodegaRepository } from '@/data/repositories/bodegaRepository'
import { parseLocationKey, stockAt, storeKey } from '@/domain/locations'
import { formatMoney, formatShortDate, formatTime } from '@/lib/format'
import type { Bodega, Movement } from '@/domain/models'

type Tab = 'vendido' | 'devuelto' | 'stock' | 'entregas'
const TABS: { key: Tab; label: string }[] = [
  { key: 'vendido', label: 'Vendido' },
  { key: 'devuelto', label: 'Devuelto' },
  { key: 'stock', label: 'Stock' },
  { key: 'entregas', label: 'Entregas' },
]

export function LocalesScreen() {
  const { data: stores } = useStores()
  const { data: catalog } = useCatalog()
  const [bodegas, setBodegas] = useState<Bodega[]>([])
  const [movs, setMovs] = useState<Movement[]>([])
  const [loading, setLoading] = useState(true)
  const [storeId, setStoreId] = useState('')
  const [tab, setTab] = useState<Tab>('vendido')

  useEffect(() => bodegaRepository.subscribe(setBodegas), [])
  useEffect(() => {
    movementRepository
      .listRecent()
      .then(setMovs)
      .catch(() => undefined)
      .finally(() => setLoading(false))
  }, [])

  const store = stores.find((s) => s.id === storeId) ?? stores[0]
  const key = store ? storeKey(store.id) : ''

  // Movimientos de ESTE local (listRecent ya viene de más reciente a más antiguo).
  const sales = useMemo(
    () => (store ? movs.filter((m) => m.type === 'sale' && m.storeId === store.id) : []),
    [movs, store],
  )
  const returns = useMemo(
    () => (store ? movs.filter((m) => m.type === 'return' && m.storeId === store.id) : []),
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

  const salesTotal = useMemo(() => sales.reduce((s, m) => s + m.total, 0), [sales])
  const salesUnits = useMemo(() => sales.reduce((s, m) => s + m.quantity, 0), [sales])
  const returnsTotal = useMemo(() => returns.reduce((s, m) => s + m.total, 0), [returns])
  const returnsUnits = useMemo(() => returns.reduce((s, m) => s + m.quantity, 0), [returns])
  const deliveriesUnits = useMemo(() => deliveries.reduce((s, m) => s + m.quantity, 0), [deliveries])
  const stockUnits = useMemo(() => stockRows.reduce((s, r) => s + r.total, 0), [stockRows])

  const fromName = (locKey?: string) => {
    if (!locKey) return '—'
    const ref = parseLocationKey(locKey)
    if (!ref) return locKey
    if (ref.kind === 'bodega') return bodegas.find((b) => b.id === ref.id)?.code ?? 'Bodega'
    return `Local ${ref.id}`
  }

  return (
    <div style={{ padding: '18px 20px 28px', display: 'flex', flexDirection: 'column', gap: 18, width: '100%', boxSizing: 'border-box' }} className="iw-fade">
      <h1 style={{ margin: 0, font: '700 24px var(--font-display)' }}>Locales</h1>

      {stores.length === 0 ? (
        <Empty text="No hay locales todavía. Corre npm run seed:scaffold para crear 163 y 173." />
      ) : (
        <>
          {/* Pestañas por local */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {stores.map((s) => {
              const on = s.id === (store?.id ?? '')
              return (
                <button
                  key={s.id}
                  onClick={() => setStoreId(s.id)}
                  className="iw-press"
                  style={{
                    padding: '11px 18px',
                    borderRadius: 'var(--radius-lg)',
                    font: '700 14px var(--font-body)',
                    cursor: 'pointer',
                    border: `1px solid ${on ? 'var(--iw-plum)' : 'var(--border-subtle)'}`,
                    background: on ? 'var(--iw-plum)' : 'var(--surface-card)',
                    color: on ? '#fff' : 'var(--text-secondary)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  Local {s.code}
                </button>
              )
            })}
          </div>

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
              <SummaryBar label={`${sales.length} ${sales.length === 1 ? 'venta' : 'ventas'} · ${salesUnits} pares`} value={formatMoney(salesTotal)} />
              <Card>
                {loading ? (
                  <Empty text="Cargando ventas…" />
                ) : sales.length === 0 ? (
                  <Empty text="Este local todavía no tiene ventas registradas." />
                ) : (
                  sales.map((m) => (
                    <MovRow
                      key={m.id}
                      title={`${m.snapshot.productName} · T${m.snapshot.size}`}
                      sub={[formatShortDate(m.occurredAt), formatTime(m.occurredAt), m.payment, m.userName].filter(Boolean).join(' · ')}
                      qty={`×${m.quantity}`}
                      value={formatMoney(m.total)}
                    />
                  ))
                )}
              </Card>
            </section>
          ) : tab === 'devuelto' ? (
            <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <SummaryBar label={`${returns.length} ${returns.length === 1 ? 'devolución' : 'devoluciones'} · ${returnsUnits} pares`} value={formatMoney(returnsTotal)} />
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
                      value={formatMoney(m.total)}
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
                  deliveries.map((m) => (
                    <MovRow
                      key={m.id}
                      title={`${m.snapshot.productName} · T${m.snapshot.size}`}
                      sub={`${formatShortDate(m.occurredAt)} · ${formatTime(m.occurredAt)} · desde ${fromName(m.fromLocation)} · ${m.userName}`}
                      qty={`+${m.quantity}`}
                      qtyColor="var(--color-success)"
                    />
                  ))
                )}
              </Card>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Muestra las entregas más recientes.</span>
            </section>
          )}
        </>
      )}
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

function SummaryBar({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, background: 'var(--surface-sunken)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: '10px 15px' }}>
      <span style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 700, minWidth: 0 }}>{label}</span>
      <span style={{ font: '700 var(--font-display)', fontSize: 'clamp(15px, 4.5vw, 18px)', whiteSpace: 'nowrap' }}>{value}</span>
    </div>
  )
}

function MovRow({ title, sub, qty, qtyColor, value }: { title: string; sub: string; qty: string; qtyColor?: string; value?: string }) {
  return (
    <div className="iw-row" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: '1px solid var(--border-subtle)' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ font: '700 14px var(--font-body)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</div>
      </div>
      <span style={{ font: '700 15px var(--font-display)', color: qtyColor ?? 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{qty}</span>
      {value ? <span style={{ font: '700 15px var(--font-display)', whiteSpace: 'nowrap', minWidth: 72, textAlign: 'right' }}>{value}</span> : null}
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 }}>{text}</div>
}
