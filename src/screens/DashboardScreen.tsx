/**
 * Dashboard. Lee los agregados de `dailyStats` (constante en lecturas, no
 * escala con el histórico) y el catálogo en vivo para nombres y alertas.
 * La utilidad se difumina salvo en modo admin, igual que el diseño.
 */

import { useEffect, useMemo, useState } from 'react'
import { useCatalog, useStats, useStores } from '@/app/hooks'
import { useSession } from '@/app/session'
import { movementRepository } from '@/data/repositories/movementRepository'
import { expenseRepository } from '@/data/repositories/expenseRepository'
import { formatLongDate, formatMoney, formatMoneyInput, formatShortDate, parseMoneyInput } from '@/lib/format'
import { RoleBadge } from './_shared'
import { Icon } from '@/ui/Icon'
import { Money } from '@/ui/Money'
import { money, type DailyStats, type Expense, type ExpenseDraft, type Movement, type Store } from '@/domain/models'

export function DashboardScreen() {
  const { data: days } = useStats(7)
  const { data: catalog } = useCatalog()
  const { data: stores } = useStores()
  const { user, can } = useSession()
  const adminUnlocked = can('seeCosts')

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
          <div style={{ font: '700 var(--font-display)', fontSize: 'clamp(20px, 6vw, 26px)' }}>
            <Money value={today?.salesTotal ?? 0} />
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 11.5, opacity: 0.85, marginTop: 4 }}>
            {stores.map((s) => (
              <span key={s.id}>{s.code} · <Money value={today?.salesByStore[s.id] ?? 0} /></span>
            ))}
          </div>
        </div>

        <PlainCard label="Stock total" value={String(totalStock)} foot={`${catalog.length} referencias`} />
        <PlainCard label="Entradas de hoy" value={<Money value={today?.purchasesTotal ?? 0} />} foot={`${today?.purchasesCount ?? 0} ingresos de stock`} />

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
          <div style={{ font: '700 var(--font-display)', fontSize: 'clamp(20px, 6vw, 26px)', filter: adminUnlocked ? 'none' : 'blur(7px)' }}>
            {adminUnlocked ? <Money value={today?.margin ?? 0} /> : '••••'}
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
      <SummaryBar label={`${incomes.length} ${incomes.length === 1 ? 'venta' : 'ventas'} · ${units} pares`} value={<Money value={total} />} />
      <TableCard headers={['Concepto', 'Detalle', 'Cant.', 'Valor', 'Fecha', 'Local', 'Vendedor']}>
        {incomes.length === 0 ? (
          <EmptyRow cols={7} text="Todavía no hay ventas registradas." />
        ) : (
          incomes.map((m) => (
            <tr key={m.id} style={{ borderTop: '1px solid var(--border-subtle)' }}>
              <Td><b>Venta</b></Td>
              <Td>{m.snapshot.productName} · T{m.snapshot.size}{m.payment ? ` · ${m.payment}` : ''}</Td>
              <Td>{m.quantity}</Td>
              <Td strong><Money value={m.total} /></Td>
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

/** Tabla de EGRESOS (gastos a mano). El formulario NO queda visible: se abre en
 *  un modal con el botón "Nuevo egreso". Cada fila se puede editar o eliminar. */
function ExpenseTab({
  expenses,
  canAdd,
  actor,
}: {
  expenses: Expense[]
  canAdd: boolean
  actor: { userId: string; userName: string } | null
}) {
  const [form, setForm] = useState<{ mode: 'new' } | { mode: 'edit'; expense: Expense } | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const total = expenses.reduce((s, e) => s + e.value, 0)

  const del = async (e: Expense) => {
    if (!window.confirm(`¿Eliminar el egreso "${e.concept}" por ${formatMoney(e.value)}?`)) return
    setBusyId(e.id)
    try {
      await expenseRepository.remove(e.id)
    } catch {
      /* la lista se refresca sola vía suscripción */
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 180 }}>
          <SummaryBar label={`${expenses.length} ${expenses.length === 1 ? 'egreso' : 'egresos'}`} value={<Money value={total} />} />
        </div>
        {canAdd ? (
          <button
            onClick={() => setForm({ mode: 'new' })}
            className="iw-press"
            style={{ display: 'flex', alignItems: 'center', gap: 6, height: 42, padding: '0 16px', border: 'none', borderRadius: 'var(--radius-md)', font: '700 14px var(--font-body)', background: 'var(--iw-plum)', color: '#fff', cursor: 'pointer', boxShadow: 'var(--shadow-accent)' }}
          >
            <Icon name="plus" size={16} strokeWidth={2.6} /> Nuevo egreso
          </button>
        ) : null}
      </div>

      {!canAdd ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '2px 2px' }}>Solo un administrador puede registrar egresos.</div>
      ) : null}

      <TableCard headers={canAdd ? ['Concepto', 'Detalle', 'Cant.', 'Valor', 'Fecha', 'Registró', ''] : ['Concepto', 'Detalle', 'Cant.', 'Valor', 'Fecha', 'Registró']}>
        {expenses.length === 0 ? (
          <EmptyRow cols={canAdd ? 7 : 6} text="Todavía no hay egresos registrados." />
        ) : (
          expenses.map((e) => (
            <tr key={e.id} style={{ borderTop: '1px solid var(--border-subtle)', opacity: busyId === e.id ? 0.5 : 1 }}>
              <Td><b>{e.concept}</b></Td>
              <Td>{e.detail || '—'}</Td>
              <Td>{e.quantity || '—'}</Td>
              <Td strong><Money value={e.value} /></Td>
              <Td>{formatShortDate(e.occurredAt)}</Td>
              <Td>{e.userName}</Td>
              {canAdd ? (
                <td style={{ padding: '8px 14px', whiteSpace: 'nowrap' }}>
                  <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                    <button onClick={() => setForm({ mode: 'edit', expense: e })} title="Editar" aria-label="Editar" className="iw-press" style={iconBtn}>
                      <Icon name="edit" size={15} />
                    </button>
                    <button onClick={() => void del(e)} title="Eliminar" aria-label="Eliminar" className="iw-press" style={{ ...iconBtn, color: 'var(--color-danger)', borderColor: 'rgba(224,52,29,.3)' }}>
                      <Icon name="trash" size={15} />
                    </button>
                  </div>
                </td>
              ) : null}
            </tr>
          ))
        )}
      </TableCard>

      {form && actor ? (
        <ExpenseFormModal
          initial={form.mode === 'edit' ? form.expense : null}
          actor={actor}
          onClose={() => setForm(null)}
        />
      ) : null}
    </section>
  )
}

const iconBtn: React.CSSProperties = {
  width: 32,
  height: 32,
  borderRadius: 8,
  border: '1px solid var(--border-subtle)',
  background: 'var(--surface-card)',
  color: 'var(--text-secondary)',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
}

/** Modal para crear o editar un egreso. */
function ExpenseFormModal({
  initial,
  actor,
  onClose,
}: {
  initial: Expense | null
  actor: { userId: string; userName: string }
  onClose: () => void
}) {
  const [concept, setConcept] = useState(initial?.concept ?? '')
  const [detail, setDetail] = useState(initial?.detail ?? '')
  const [quantity, setQuantity] = useState(String(initial?.quantity ?? 1))
  const [value, setValue] = useState(initial ? String(initial.value) : '')
  const [date, setDate] = useState(() => (initial ? initial.occurredAt : new Date()).toISOString().slice(0, 10))
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const canSubmit = concept.trim().length > 0 && parseMoneyInput(value) > 0 && !saving

  const submit = async () => {
    setMsg('')
    if (!concept.trim()) return setMsg('Escribe el concepto del egreso.')
    if (parseMoneyInput(value) <= 0) return setMsg('El valor debe ser mayor a cero.')
    setSaving(true)
    try {
      // La fecha se interpreta al mediodía local para no cruzar el cambio de día.
      const draft: ExpenseDraft = {
        concept: concept.trim(),
        detail: detail.trim(),
        quantity: Math.max(0, Math.floor(Number(quantity) || 0)),
        value: money(parseMoneyInput(value)),
        occurredAt: new Date(`${date}T12:00:00`),
      }
      if (initial) await expenseRepository.update(initial.id, draft)
      else await expenseRepository.create(draft, actor)
      onClose()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'No se pudo guardar el egreso.')
    } finally {
      setSaving(false)
    }
  }

  const fieldStyle: React.CSSProperties = {
    height: 44,
    padding: '0 13px',
    border: '1.5px solid var(--border-subtle)',
    borderRadius: 'var(--radius-md)',
    font: '500 15px var(--font-body)',
    outline: 'none',
    background: 'var(--surface-card)',
    color: 'var(--text-primary)',
    boxSizing: 'border-box',
    width: '100%',
  }
  const label: React.CSSProperties = { display: 'block', font: '700 12.5px var(--font-body)', color: 'var(--text-secondary)', marginBottom: 5 }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(12,12,13,.55)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, padding: 20, overflowY: 'auto' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 440, maxWidth: '100%', background: 'var(--surface-card)', borderRadius: 'var(--radius-2xl)', boxShadow: 'var(--shadow-lg)', padding: '22px 24px 24px', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <h2 style={{ margin: 0, font: '700 20px var(--font-display)' }}>{initial ? 'Editar egreso' : 'Nuevo egreso'}</h2>
          <button onClick={onClose} aria-label="Cerrar" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 22, lineHeight: 1 }}>✕</button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={label}>Concepto</label>
            <input value={concept} onChange={(e) => setConcept(e.target.value)} placeholder="Arriendo, nómina, servicios…" autoFocus style={fieldStyle} />
          </div>
          <div>
            <label style={label}>Detalle (opcional)</label>
            <input value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="A quién / de qué" style={fieldStyle} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={label}>Cantidad</label>
              <input value={quantity} onChange={(e) => setQuantity(e.target.value.replace(/\D/g, ''))} inputMode="numeric" style={fieldStyle} />
            </div>
            <div>
              <label style={label}>Valor</label>
              <input value={formatMoneyInput(value)} onChange={(e) => setValue(e.target.value.replace(/\D/g, ''))} inputMode="numeric" placeholder="$0" style={{ ...fieldStyle, fontWeight: 700 }} />
            </div>
          </div>
          <div>
            <label style={label}>Fecha</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={fieldStyle} />
          </div>
          {msg ? <span style={{ fontSize: 12.5, color: 'var(--color-danger)', fontWeight: 700 }}>{msg}</span> : null}
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 18, justifyContent: 'flex-end' }}>
          <button onClick={onClose} className="iw-press" style={{ height: 44, padding: '0 18px', background: 'var(--surface-card)', color: 'var(--text-primary)', border: '1.5px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', font: '700 14px var(--font-body)', cursor: 'pointer' }}>Cancelar</button>
          <button onClick={() => void submit()} disabled={!canSubmit} className="iw-press" style={{ height: 44, padding: '0 22px', border: 'none', borderRadius: 'var(--radius-md)', font: '700 14px var(--font-body)', background: canSubmit ? 'var(--iw-plum)' : 'var(--surface-muted)', color: canSubmit ? '#fff' : 'var(--text-muted)', cursor: canSubmit ? 'pointer' : 'not-allowed' }}>
            {saving ? 'Guardando…' : initial ? 'Guardar cambios' : 'Registrar egreso'}
          </button>
        </div>
      </div>
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

function PlainCard({ label, value, foot, footColor }: { label: string; value: React.ReactNode; foot?: string; footColor?: string }) {
  return (
    <div style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', padding: '16px 18px', boxShadow: 'var(--shadow-sm)' }}>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 700 }}>{label}</div>
      <div style={{ font: '700 var(--font-display)', fontSize: 'clamp(20px, 6vw, 26px)', overflowWrap: 'anywhere' }}>{value}</div>
      {foot ? <div style={{ fontSize: 12, color: footColor ?? 'var(--text-muted)', marginTop: 4, fontWeight: footColor ? 700 : 400 }}>{foot}</div> : null}
    </div>
  )
}

