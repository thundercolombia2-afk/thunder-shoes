/**
 * Dashboard. Lee los agregados de `dailyStats` (constante en lecturas, no
 * escala con el histórico) y el catálogo en vivo para nombres y alertas.
 * La utilidad se difumina salvo en modo admin, igual que el diseño.
 */

import { useMemo } from 'react'
import { useCatalog, useStats, useStores } from '@/app/hooks'
import { useSession } from '@/app/session'
import { useIsMobile } from '@/app/useMediaQuery'
import { formatLongDate, formatMoney, weekdayFromDayKey } from '@/lib/format'
import { RoleBadge } from './_shared'
import { Icon } from '@/ui/Icon'
import type { DailyStats } from '@/domain/models'

const STORE_COLORS = ['var(--iw-plum)', '#b58900', 'var(--color-success)', 'var(--iw-orange-red)']

export function DashboardScreen() {
  const { data: days } = useStats(7)
  const { data: catalog } = useCatalog()
  const { data: stores } = useStores()
  const { user, can } = useSession()
  const adminUnlocked = can('seeCosts')
  const isMobile = useIsMobile()

  const today: DailyStats | undefined = days.at(-1)

  const totalStock = useMemo(() => catalog.reduce((s, r) => s + r.totalStock, 0), [catalog])
  const nameById = useMemo(
    () => new Map<string, string>(catalog.map((r) => [r.product.id as string, r.product.name])),
    [catalog],
  )

  const alerts = useMemo(
    () =>
      catalog
        .flatMap((r) => r.variants.filter((v) => v.stock <= v.minStock).map((v) => ({ name: r.product.name, size: v.size, stock: v.stock })))
        .slice(0, 6),
    [catalog],
  )
  const alertCount = useMemo(
    () => catalog.reduce((s, r) => s + r.variants.filter((v) => v.stock <= v.minStock).length, 0),
    [catalog],
  )

  // Top 5 por unidades vendidas acumuladas en los días cargados.
  const top5 = useMemo(() => {
    const totals = new Map<string, number>()
    for (const d of days) {
      for (const [productId, units] of Object.entries(d.unitsByProduct)) {
        totals.set(productId, (totals.get(productId) ?? 0) + units)
      }
    }
    return [...totals.entries()]
      .filter(([, u]) => u > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id, units]) => ({ name: nameById.get(id) ?? 'Referencia', units }))
  }, [days, nameById])

  const mask = (value: string) => (adminUnlocked ? value : '••••')

  return (
    <div style={{ padding: '18px 20px 32px', display: 'flex', flexDirection: 'column', gap: 16 }} className="iw-fade">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1 }}>
          <h1 style={{ margin: 0, font: '700 24px var(--font-display)' }}>Dashboard</h1>
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Hoy · {formatLongDate(new Date())}</span>
        </div>
        {user ? <RoleBadge role={user.role} /> : null}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12 }}>
        <div style={{ background: 'var(--iw-plum)', color: '#fff', borderRadius: 'var(--radius-lg)', padding: '16px 18px', boxShadow: 'var(--shadow-md)' }}>
          <div style={{ fontSize: 12, opacity: 0.75, fontWeight: 700 }}>Ventas de hoy</div>
          <div style={{ font: '700 26px var(--font-display)' }}>{formatMoney(today?.salesTotal ?? 0)}</div>
          <div style={{ fontSize: 12, opacity: 0.8, marginTop: 4 }}>
            {stores.map((s) => `${s.code} · ${formatMoney(today?.salesByStore[s.id] ?? 0)}`).join('   ')}
          </div>
        </div>

        <PlainCard label="Stock total" value={String(totalStock)} foot={`${alertCount} alertas de stock bajo`} footColor="var(--color-danger)" />
        <PlainCard label="Compras de hoy" value={formatMoney(today?.purchasesTotal ?? 0)} foot={`${today?.purchasesCount ?? 0} ingresos de stock`} />

        <div
          style={{
            position: 'relative',
            background: 'linear-gradient(135deg,var(--iw-plum),var(--iw-plum-dark))',
            color: '#fff',
            borderRadius: 'var(--radius-lg)',
            padding: '16px 18px',
            boxShadow: 'var(--shadow-md)',
            overflow: 'hidden',
          }}
        >
          <div style={{ fontSize: 12, opacity: 0.75, fontWeight: 700 }}>Utilidad de hoy</div>
          <div style={{ font: '700 26px var(--font-display)', filter: adminUnlocked ? 'none' : 'blur(7px)' }}>
            {mask(formatMoney(today?.margin ?? 0))}
          </div>
          {!adminUnlocked ? (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                background: 'rgba(10,10,11,.45)',
                backdropFilter: 'blur(2px)',
                font: '700 13px var(--font-body)',
              }}
            >
              <Icon name="lock" size={16} color="var(--iw-yellow)" strokeWidth={2.2} /> Solo administrador
            </div>
          ) : null}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1.4fr 1fr', gap: 14 }}>
        <TrendChart days={days} stores={stores.map((s) => ({ id: s.id, code: s.code }))} />
        <Top5 items={top5} />
      </div>

      <div style={{ background: 'rgba(224,52,29,.06)', border: '1px solid rgba(224,52,29,.18)', borderRadius: 'var(--radius-lg)', padding: '16px 18px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <Icon name="warning" size={18} color="var(--color-danger)" strokeWidth={2.2} />
          <span style={{ font: '700 15px var(--font-display)', color: 'var(--color-danger)' }}>Alertas de stock bajo</span>
        </div>
        {alerts.length === 0 ? (
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Sin alertas: todo el inventario está por encima del mínimo.</span>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {alerts.map((a, i) => (
              <div key={`${a.name}-${a.size}-${i}`} style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: '8px 13px', display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontWeight: 700, fontSize: 13 }}>{a.name}</span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  Talla {a.size} · quedan <b style={{ color: 'var(--color-danger)' }}>{a.stock}</b>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function PlainCard({ label, value, foot, footColor }: { label: string; value: string; foot: string; footColor?: string }) {
  return (
    <div style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', padding: '16px 18px', boxShadow: 'var(--shadow-sm)' }}>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 700 }}>{label}</div>
      <div style={{ font: '700 26px var(--font-display)' }}>{value}</div>
      <div style={{ fontSize: 12, color: footColor ?? 'var(--text-muted)', marginTop: 4, fontWeight: footColor ? 700 : 400 }}>{foot}</div>
    </div>
  )
}

function TrendChart({ days, stores }: { days: DailyStats[]; stores: { id: string; code: string }[] }) {
  const width = 320
  const height = 140
  const maxV = Math.max(
    1,
    ...days.flatMap((d) => stores.map((s) => d.salesByStore[s.id] ?? 0)),
  )
  const pointsFor = (storeId: string) =>
    days
      .map((d, i) => {
        const x = days.length <= 1 ? 0 : (i * width) / (days.length - 1)
        const y = 125 - ((d.salesByStore[storeId] ?? 0) / maxV) * 105
        return `${x.toFixed(0)},${y.toFixed(0)}`
      })
      .join(' ')

  return (
    <div style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', padding: 18, boxShadow: 'var(--shadow-sm)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <span style={{ font: '700 15px var(--font-display)' }}>Tendencia de ventas (7 días)</span>
        <div style={{ display: 'flex', gap: 12, fontSize: 11, fontWeight: 700, flexWrap: 'wrap' }}>
          {stores.map((s, i) => (
            <span key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 5, color: STORE_COLORS[i % STORE_COLORS.length] }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: STORE_COLORS[i % STORE_COLORS.length] }} />
              {s.code}
            </span>
          ))}
        </div>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height="150" preserveAspectRatio="none">
        {[35, 70, 105].map((y) => (
          <line key={y} x1="0" y1={y} x2={width} y2={y} stroke="var(--border-subtle)" strokeWidth="1" />
        ))}
        {stores.map((s, i) => (
          <polyline
            key={s.id}
            points={pointsFor(s.id)}
            fill="none"
            stroke={STORE_COLORS[i % STORE_COLORS.length]}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
        {days.map((d) => (
          <span key={d.dayKey}>{weekdayFromDayKey(d.dayKey)}</span>
        ))}
      </div>
    </div>
  )
}

function Top5({ items }: { items: { name: string; units: number }[] }) {
  const max = items[0]?.units ?? 1
  return (
    <div style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', padding: 18, boxShadow: 'var(--shadow-sm)' }}>
      <span style={{ font: '700 15px var(--font-display)' }}>Top 5 más vendidas</span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 14 }}>
        {items.length === 0 ? (
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Todavía no hay ventas registradas.</span>
        ) : (
          items.map((t, i) => (
            <div key={t.name} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                <span style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {i + 1}. {t.name}
                </span>
                <span style={{ fontWeight: 700, color: 'var(--iw-orange)', whiteSpace: 'nowrap' }}>{t.units} pares</span>
              </div>
              <div style={{ height: 8, background: 'var(--iw-sand)', borderRadius: 'var(--radius-pill)', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${Math.round((t.units / max) * 100)}%`, background: 'linear-gradient(90deg,#ffd100,#e6b800)', borderRadius: 'var(--radius-pill)' }} />
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
