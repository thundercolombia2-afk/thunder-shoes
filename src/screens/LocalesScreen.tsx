/**
 * Locales. Una pestaña por local; para cada uno muestra:
 *   · el stock que TIENE ese local (por talla), y
 *   · las entregas que le han llegado desde bodega (salidas), con fecha y
 *     referencia.
 * Es la vista de control del dueño: qué hay en cada local y de dónde salió.
 */

import { useEffect, useMemo, useState } from 'react'
import { useCatalog, useStores } from '@/app/hooks'
import { movementRepository } from '@/data/repositories/movementRepository'
import { bodegaRepository } from '@/data/repositories/bodegaRepository'
import { parseLocationKey, stockAt, storeKey } from '@/domain/locations'
import { formatShortDate, formatTime } from '@/lib/format'
import type { Bodega, Movement } from '@/domain/models'

export function LocalesScreen() {
  const { data: stores } = useStores()
  const { data: catalog } = useCatalog()
  const [bodegas, setBodegas] = useState<Bodega[]>([])
  const [movs, setMovs] = useState<Movement[]>([])
  const [loading, setLoading] = useState(true)
  const [storeId, setStoreId] = useState('')

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

  const deliveries = useMemo(
    () => (store ? movs.filter((m) => m.type === 'salida' && m.toLocation === key) : []),
    [movs, key, store],
  )

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

          {/* Stock del local */}
          <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <h2 style={{ margin: 0, font: '700 16px var(--font-display)' }}>Stock que tiene el local</h2>
            <div style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-sm)', overflow: 'hidden' }}>
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
            </div>
          </section>

          {/* Entregas desde bodega */}
          <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <h2 style={{ margin: 0, font: '700 16px var(--font-display)' }}>Entregas desde bodega</h2>
            <div style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-sm)', overflow: 'hidden' }}>
              {loading ? (
                <Empty text="Cargando entregas…" />
              ) : deliveries.length === 0 ? (
                <Empty text="Todavía no hay entregas registradas a este local." />
              ) : (
                deliveries.map((m) => (
                  <div key={m.id} className="iw-row" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: '1px solid var(--border-subtle)' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ font: '700 14px var(--font-body)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {m.snapshot.productName} · T{m.snapshot.size}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                        {formatShortDate(m.occurredAt)} · {formatTime(m.occurredAt)} · desde {fromName(m.fromLocation)} · {m.userName}
                      </div>
                    </div>
                    <span style={{ font: '700 17px var(--font-display)', color: 'var(--color-success)', whiteSpace: 'nowrap' }}>+{m.quantity}</span>
                  </div>
                ))
              )}
            </div>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Muestra las entregas más recientes.</span>
          </section>
        </>
      )}
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 }}>{text}</div>
}
