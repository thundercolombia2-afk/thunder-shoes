/**
 * Dashboard. Lee los agregados de `dailyStats` (constante en lecturas, no
 * escala con el histórico) y el catálogo en vivo para nombres y alertas.
 * La utilidad se difumina salvo en modo admin, igual que el diseño.
 */

import { useEffect, useMemo, useState } from 'react'
import { useCatalog, useStats, useStores } from '@/app/hooks'
import { useSession } from '@/app/session'
import { useIsMobile } from '@/app/useMediaQuery'
import { movementRepository } from '@/data/repositories/movementRepository'
import { expenseRepository } from '@/data/repositories/expenseRepository'
import { formatLongDate, formatMoney, formatMoneyInput, formatShortDate, parseMoneyInput, weekdayFromDayKey } from '@/lib/format'
import { RoleBadge } from './_shared'
import { Icon } from '@/ui/Icon'
import { money, type DailyStats, type Expense, type Movement, type Store } from '@/domain/models'

const STORE_COLORS = ['var(--iw-plum)', '#b58900', 'var(--color-success)', 'var(--iw-orange-red)']

export function DashboardScreen() {
  const { data: days } = useStats(7)
  const { data: catalog } = useCatalog()
  const { data: stores } = useStores()
  const { user, can } = useSession()
  const adminUnlocked = can('seeCosts')
  const isMobile = useIsMobile()

  // Ingresos (ventas) y egresos (gastos a mano) para las tablas.
  const [movs, setMovs] = useState<Movement[]>([])
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [tab, setTab] = useState<'ingresos' | 'egresos'>('ingresos')
  useEffect(() => {
    movementRepository.listRecent().then(setMovs).catch(() => undefined)
  }, [])
  useEffect(() => expenseRepository.subscribe(setExpenses), [])
  const incomes = useMemo(() => movs.filter((m) => m.type === 'sale'), [movs])

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
          <h1 style={{ margin: 0, font: '700 24px var(--font-display)' }}>Ingresos y egresos</h1>
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
        <PlainCard label="Entradas de hoy" value={formatMoney(today?.purchasesTotal ?? 0)} foot={`${today?.purchasesCount ?? 0} ingresos de stock`} />

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

      {/* ── Ingresos / Egresos ─────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', borderBottom: '1px solid var(--border-subtle)', marginTop: 4 }}>
        {(['ingresos', 'egresos'] as const).map((t) => {
          const on = t === tab
          return (
            <button
              key={t}
              onClick={() => setTab(t)}
              className="iw-press"
              style={{
                padding: '9px 16px',
                borderRadius: 'var(--radius-md) var(--radius-md) 0 0',
                font: '700 14px var(--font-body)',
                cursor: 'pointer',
                border: 'none',
                borderBottom: `2.5px solid ${on ? 'var(--iw-plum)' : 'transparent'}`,
                background: 'transparent',
                color: on ? 'var(--iw-plum)' : 'var(--text-muted)',
                textTransform: 'capitalize',
              }}
            >
              {t}
            </button>
          )
        })}
      </div>

      {tab === 'ingresos' ? (
        <IncomeTab incomes={incomes} stores={stores} />
      ) : (
        <ExpenseTab
          expenses={expenses}
          canAdd={adminUnlocked}
          actor={user ? { userId: user.id, userName: user.name } : null}
        />
      )}
    </div>
  )
}

/** Tabla de INGRESOS: las ventas (concepto, detalle, cantidad, valor, fecha,
 *  local, vendedor), de más reciente a más antigua. */
function IncomeTab({ incomes, stores }: { incomes: Movement[]; stores: Store[] }) {
  const storeCode = (id: string) => stores.find((s) => s.id === id)?.code ?? id
  const total = incomes.reduce((s, m) => s + m.total, 0)
  const units = incomes.reduce((s, m) => s + m.quantity, 0)
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <SummaryBar label={`${incomes.length} ${incomes.length === 1 ? 'venta' : 'ventas'} · ${units} pares`} value={formatMoney(total)} />
      <TableCard headers={['Concepto', 'Detalle', 'Cant.', 'Valor', 'Fecha', 'Local', 'Vendedor']}>
        {incomes.length === 0 ? (
          <EmptyRow cols={7} text="Todavía no hay ventas registradas." />
        ) : (
          incomes.map((m) => (
            <tr key={m.id} style={{ borderTop: '1px solid var(--border-subtle)' }}>
              <Td><b>Venta</b></Td>
              <Td>{m.snapshot.productName} · T{m.snapshot.size}{m.payment ? ` · ${m.payment}` : ''}</Td>
              <Td>{m.quantity}</Td>
              <Td strong>{formatMoney(m.total)}</Td>
              <Td>{formatShortDate(m.occurredAt)}</Td>
              <Td>{storeCode(m.storeId)}</Td>
              <Td>{m.userName}</Td>
            </tr>
          ))
        )}
      </TableCard>
    </section>
  )
}

/** Tabla + formulario de EGRESOS (gastos a mano). */
function ExpenseTab({
  expenses,
  canAdd,
  actor,
}: {
  expenses: Expense[]
  canAdd: boolean
  actor: { userId: string; userName: string } | null
}) {
  const [concept, setConcept] = useState('')
  const [detail, setDetail] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [value, setValue] = useState('')
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  const total = expenses.reduce((s, e) => s + e.value, 0)
  const canSubmit = canAdd && !!actor && concept.trim().length > 0 && parseMoneyInput(value) > 0 && !saving

  const submit = async () => {
    if (!actor) return
    setMsg('')
    if (!concept.trim()) return setMsg('Escribe el concepto del egreso.')
    if (parseMoneyInput(value) <= 0) return setMsg('El valor debe ser mayor a cero.')
    setSaving(true)
    try {
      // La fecha se interpreta al mediodía local para no cruzar el cambio de día.
      const occurredAt = new Date(`${date}T12:00:00`)
      await expenseRepository.create(
        { concept: concept.trim(), detail: detail.trim(), quantity: Math.max(0, Math.floor(Number(quantity) || 0)), value: money(parseMoneyInput(value)), occurredAt },
        actor,
      )
      setConcept('')
      setDetail('')
      setQuantity('1')
      setValue('')
      setMsg('')
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'No se pudo registrar el egreso.')
    } finally {
      setSaving(false)
    }
  }

  const fieldStyle: React.CSSProperties = {
    height: 42,
    padding: '0 12px',
    border: '1.5px solid var(--border-subtle)',
    borderRadius: 'var(--radius-md)',
    font: '500 14px var(--font-body)',
    outline: 'none',
    background: 'var(--surface-card)',
    color: 'var(--text-primary)',
    boxSizing: 'border-box',
    width: '100%',
  }

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <SummaryBar label={`${expenses.length} ${expenses.length === 1 ? 'egreso' : 'egresos'}`} value={formatMoney(total)} />

      {canAdd ? (
        <div style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-sm)', padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ font: '700 14px var(--font-display)' }}>Registrar un egreso</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10 }}>
            <input value={concept} onChange={(e) => setConcept(e.target.value)} placeholder="Concepto (arriendo, nómina…)" style={fieldStyle} />
            <input value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="Detalle (opcional)" style={fieldStyle} />
            <input value={quantity} onChange={(e) => setQuantity(e.target.value.replace(/\D/g, ''))} inputMode="numeric" placeholder="Cantidad" style={fieldStyle} />
            <input value={formatMoneyInput(value)} onChange={(e) => setValue(e.target.value.replace(/\D/g, ''))} inputMode="numeric" placeholder="$ Valor" style={fieldStyle} />
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={fieldStyle} />
          </div>
          {msg ? <span style={{ fontSize: 12.5, color: 'var(--color-danger)', fontWeight: 700 }}>{msg}</span> : null}
          <button
            onClick={() => void submit()}
            disabled={!canSubmit}
            className="iw-press"
            style={{ alignSelf: 'flex-start', height: 42, padding: '0 20px', border: 'none', borderRadius: 'var(--radius-md)', font: '700 14px var(--font-body)', background: canSubmit ? 'var(--iw-plum)' : 'var(--surface-muted)', color: canSubmit ? '#fff' : 'var(--text-muted)', cursor: canSubmit ? 'pointer' : 'not-allowed' }}
          >
            {saving ? 'Registrando…' : 'Registrar egreso'}
          </button>
        </div>
      ) : (
        <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '4px 2px' }}>Solo un administrador puede registrar egresos.</div>
      )}

      <TableCard headers={['Concepto', 'Detalle', 'Cant.', 'Valor', 'Fecha', 'Registró']}>
        {expenses.length === 0 ? (
          <EmptyRow cols={6} text="Todavía no hay egresos registrados." />
        ) : (
          expenses.map((e) => (
            <tr key={e.id} style={{ borderTop: '1px solid var(--border-subtle)' }}>
              <Td><b>{e.concept}</b></Td>
              <Td>{e.detail || '—'}</Td>
              <Td>{e.quantity || '—'}</Td>
              <Td strong>{formatMoney(e.value)}</Td>
              <Td>{formatShortDate(e.occurredAt)}</Td>
              <Td>{e.userName}</Td>
            </tr>
          ))
        )}
      </TableCard>
    </section>
  )
}

function SummaryBar({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--surface-sunken)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: '10px 15px' }}>
      <span style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 700 }}>{label}</span>
      <span style={{ font: '700 18px var(--font-display)' }}>{value}</span>
    </div>
  )
}

function TableCard({ headers, children }: { headers: string[]; children: React.ReactNode }) {
  return (
    <div style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-sm)', overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
        <thead>
          <tr>
            {headers.map((h) => (
              <th key={h} style={{ textAlign: 'left', padding: '11px 14px', font: '700 11.5px var(--font-body)', letterSpacing: '.03em', color: 'var(--text-muted)', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

function Td({ children, strong }: { children: React.ReactNode; strong?: boolean }) {
  return <td style={{ padding: '11px 14px', fontSize: 13, fontWeight: strong ? 700 : 500, color: strong ? 'var(--text-primary)' : 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{children}</td>
}

function EmptyRow({ cols, text }: { cols: number; text: string }) {
  return (
    <tr>
      <td colSpan={cols} style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 }}>{text}</td>
    </tr>
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
