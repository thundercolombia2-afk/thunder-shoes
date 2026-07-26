/**
 * Configuración. SOLO la dueña la ve (los invitados no, para no filtrar la
 * contraseña). Tres pestañas:
 *   · Claves         → contraseña de ingreso + generar códigos de invitación con
 *                      el rol y la asignación (local o bodega) YA fijados.
 *   · Autorizaciones → crear bodegas y asignar quién puede operarlas.
 *   · Roles          → ver el equipo (correo, rol, local) y editar rol/local.
 */

import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useSession } from '@/app/session'
import { useStores } from '@/app/hooks'
import { teamRepository } from '@/data/repositories/teamRepository'
import { bodegaRepository } from '@/data/repositories/bodegaRepository'
import { configRepository } from '@/data/repositories/configRepository'
import { ROLE_LABEL, ROLES, isStoreRole, type Invite, type Role, type UserProfile } from '@/domain/users'
import type { Bodega, Store } from '@/domain/models'
import { formatShortDate } from '@/lib/format'
import { Button } from '@/ui/Button'
import { Field } from '@/ui/Field'
import { Icon } from '@/ui/Icon'

type Tab = 'claves' | 'autorizaciones' | 'roles'

const TABS: { key: Tab; label: string }[] = [
  { key: 'claves', label: 'Claves' },
  { key: 'autorizaciones', label: 'Autorizaciones' },
  { key: 'roles', label: 'Roles' },
]

const selectStyle: React.CSSProperties = {
  height: 40,
  padding: '0 10px',
  borderRadius: 'var(--radius-md)',
  border: '1.5px solid var(--border-subtle)',
  background: 'var(--surface-card)',
  color: 'var(--text-primary)',
  font: '700 13px var(--font-body)',
  cursor: 'pointer',
}

export function SettingsScreen() {
  const { user } = useSession()
  const { data: stores } = useStores()
  const [tab, setTab] = useState<Tab>('claves')
  const [invites, setInvites] = useState<Invite[]>([])
  const [team, setTeam] = useState<UserProfile[]>([])
  const [bodegas, setBodegas] = useState<Bodega[]>([])

  const reloadTeam = () => {
    teamRepository.listInvites().then(setInvites).catch(() => undefined)
    teamRepository.listTeam().then(setTeam).catch(() => undefined)
  }
  useEffect(reloadTeam, [])
  useEffect(() => bodegaRepository.subscribe(setBodegas), [])

  // Configuración es SOLO de la dueña.
  if (!user || !user.owner) return <Navigate to="/scan" replace />

  return (
    <div style={{ padding: '18px 20px 28px', display: 'flex', flexDirection: 'column', gap: 20, width: '100%', boxSizing: 'border-box' }} className="iw-fade">
      <h1 style={{ margin: 0, font: '700 24px var(--font-display)' }}>Configuración</h1>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {TABS.map((t) => {
          const on = t.key === tab
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className="iw-press"
              style={{ padding: '11px 18px', borderRadius: 'var(--radius-lg)', font: '700 14px var(--font-body)', cursor: 'pointer', border: `1px solid ${on ? 'var(--iw-plum)' : 'var(--border-subtle)'}`, background: on ? 'var(--iw-plum)' : 'var(--surface-card)', color: on ? '#fff' : 'var(--text-secondary)', whiteSpace: 'nowrap' }}
            >
              {t.label}
            </button>
          )
        })}
      </div>

      {tab === 'claves' ? <ClavesTab userId={user.id} userName={user.name} invites={invites} stores={stores} bodegas={bodegas} onCreated={reloadTeam} /> : null}
      {tab === 'autorizaciones' ? <AutorizacionesTab bodegas={bodegas} team={team} onChange={reloadTeam} /> : null}
      {tab === 'roles' ? <RolesTab team={team} meId={user.id} stores={stores} onChange={reloadTeam} /> : null}
    </div>
  )
}

// ── Claves ────────────────────────────────────────────────────────────────────

function ClavesTab({
  userId,
  userName,
  invites,
  stores,
  bodegas,
  onCreated,
}: {
  userId: UserProfile['id']
  userName: string
  invites: Invite[]
  stores: Store[]
  bodegas: Bodega[]
  onCreated: () => void
}) {
  const [role, setRole] = useState<Role>('empleado')
  const [storeId, setStoreId] = useState('')
  const [bodegaId, setBodegaId] = useState('')
  const [creating, setCreating] = useState(false)
  const [copied, setCopied] = useState('')
  const [error, setError] = useState('')

  const needsStore = isStoreRole(role)
  const needsBodega = role === 'bodeguero'
  const ready = needsStore ? !!storeId : !!bodegaId

  const create = async () => {
    setError('')
    if (!ready) {
      setError(needsStore ? 'Elige el local al que va esta persona.' : 'Elige la bodega que podrá operar.')
      return
    }
    setCreating(true)
    try {
      await teamRepository.createInvite(
        { role, ...(needsStore ? { storeId } : {}), ...(needsBodega ? { bodegaId } : {}) },
        { id: userId, name: userName },
      )
      onCreated()
    } finally {
      setCreating(false)
    }
  }

  const copy = async (code: string) => {
    await navigator.clipboard.writeText(code).catch(() => undefined)
    setCopied(code)
    setTimeout(() => setCopied(''), 1500)
  }

  const assignLabel = (inv: Invite) =>
    inv.storeId ? `Local ${stores.find((s) => s.id === inv.storeId)?.code ?? inv.storeId}` : inv.bodegaId ? `Bodega ${bodegas.find((b) => b.id === inv.bodegaId)?.code ?? ''}` : '—'

  const activeInvites = invites.filter((i) => i.active)

  return (
    <>
      <EntryPasswordCard />

      <div style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', padding: 18, boxShadow: 'var(--shadow-sm)', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <div style={{ font: '700 15px var(--font-display)' }}>Generar una clave de acceso</div>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
            Tú fijas el rol y el local o la bodega. Quien se registre con el código no elige nada:
            hereda lo que pongas aquí.
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ font: '700 12.5px var(--font-body)', color: 'var(--text-secondary)' }}>Rol</span>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {ROLES.map((r) => {
              const on = role === r
              return (
                <button key={r} onClick={() => setRole(r)} className="iw-press" style={{ cursor: 'pointer', background: on ? 'var(--iw-plum)' : 'var(--surface-card)', color: on ? '#fff' : 'var(--text-secondary)', border: `1.5px solid ${on ? 'var(--iw-plum)' : 'var(--border-subtle)'}`, borderRadius: 'var(--radius-pill)', padding: '9px 16px', font: '700 13px var(--font-body)' }}>
                  {ROLE_LABEL[r]}
                </button>
              )
            })}
          </div>
        </div>

        {needsStore ? (
          <Assign label="Local al que se asigna" empty="No hay locales. Corre npm run seed:scaffold." options={stores.map((s) => ({ id: s.id, label: `Local ${s.code}` }))} value={storeId} onPick={setStoreId} />
        ) : (
          <Assign label="Bodega que podrá operar" empty="No hay bodegas. Crea una en Autorizaciones." options={bodegas.filter((b) => b.active).map((b) => ({ id: b.id, label: b.code }))} value={bodegaId} onPick={setBodegaId} />
        )}

        {error ? <span style={{ fontSize: 12.5, color: 'var(--color-danger)', fontWeight: 700 }}>{error}</span> : null}

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button variant="primary" onClick={create} disabled={creating || !ready}>
            <Icon name="plus" size={16} strokeWidth={2.4} /> {creating ? 'Generando…' : 'Generar clave'}
          </Button>
        </div>
      </div>

      {activeInvites.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span style={{ font: '700 13px var(--font-body)', color: 'var(--text-secondary)' }}>Claves sin usar</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {activeInvites.map((inv) => (
              <div key={inv.code} style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: '12px 14px' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ font: '700 16px var(--font-mono)', letterSpacing: '.05em' }}>{inv.code}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {ROLE_LABEL[inv.role]} · {assignLabel(inv)} · creada {formatShortDate(inv.createdAt)}
                  </div>
                </div>
                <button onClick={() => copy(inv.code)} className="iw-press" style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, background: 'var(--iw-plum)', color: '#fff', border: 'none', borderRadius: 'var(--radius-pill)', padding: '8px 14px', font: '700 12px var(--font-body)' }}>
                  <Icon name={copied === inv.code ? 'check' : 'list'} size={14} strokeWidth={2.2} />
                  {copied === inv.code ? 'Copiado' : 'Copiar'}
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </>
  )
}

function Assign({ label, empty, options, value, onPick }: { label: string; empty: string; options: { id: string; label: string }[]; value: string; onPick: (id: string) => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ font: '700 12.5px var(--font-body)', color: 'var(--text-secondary)' }}>{label}</span>
      {options.length === 0 ? (
        <span style={{ fontSize: 12.5, color: 'var(--color-danger)', fontWeight: 700 }}>{empty}</span>
      ) : (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {options.map((o) => {
            const on = value === o.id
            return (
              <button key={o.id} onClick={() => onPick(o.id)} className="iw-press" style={{ cursor: 'pointer', background: on ? 'var(--iw-plum)' : 'var(--surface-card)', color: on ? '#fff' : 'var(--text-secondary)', border: `1.5px solid ${on ? 'var(--iw-plum)' : 'var(--border-subtle)'}`, borderRadius: 'var(--radius-pill)', padding: '9px 15px', font: '700 13px var(--font-body)' }}>
                {o.label}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function EntryPasswordCard() {
  const [value, setValue] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    configRepository.getEntryPassword().then(setValue).catch(() => undefined).finally(() => setLoaded(true))
  }, [])

  const save = async () => {
    setSaving(true)
    setSaved(false)
    try {
      await configRepository.setEntryPassword(value.trim())
      setSaved(true)
      setTimeout(() => setSaved(false), 1800)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', padding: 18, boxShadow: 'var(--shadow-sm)', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <div style={{ font: '700 15px var(--font-display)' }}>Contraseña para ingresar mercancía</div>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
          Cualquiera que la sepa puede registrar entradas a una bodega. Es un PIN compartido.
        </p>
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 200px', minWidth: 0 }}>
          <Field label="Contraseña de ingreso" placeholder={loaded ? 'Sin contraseña (entrada bloqueada)' : 'Cargando…'} value={value} onChange={(e) => setValue(e.target.value)} />
        </div>
        <Button variant="primary" onClick={save} disabled={saving || !loaded}>
          {saving ? 'Guardando…' : saved ? 'Guardada ✓' : 'Guardar'}
        </Button>
      </div>
    </div>
  )
}

// ── Autorizaciones: crear bodegas y asignar operadores ───────────────────────

function AutorizacionesTab({ bodegas, team, onChange }: { bodegas: Bodega[]; team: UserProfile[]; onChange: () => void }) {
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)

  // Cualquier miembro del equipo puede recibir acceso a una bodega, incluidos los
  // empleados. La dueña no aparece: opera todas las bodegas por defecto.
  const operators = team.filter((u) => !u.owner)

  const create = async () => {
    if (!code.trim()) return
    setCreating(true)
    try {
      await bodegaRepository.create({ code: code.trim(), name: name.trim() })
      setCode('')
      setName('')
    } finally {
      setCreating(false)
    }
  }

  const toggle = async (u: UserProfile, bodegaId: string, allowed: boolean) => {
    const current = u.bodegaIds ?? []
    const next = allowed ? [...new Set([...current, bodegaId])] : current.filter((x) => x !== bodegaId)
    await teamRepository.setUserBodegas(u.id, next).catch(() => undefined)
    onChange()
  }

  return (
    <>
      <div style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', padding: 18, boxShadow: 'var(--shadow-sm)', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <div style={{ font: '700 15px var(--font-display)' }}>Crear una bodega</div>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>Almacenes independientes. La mercancía entra a una bodega y de ahí sale a los locales.</p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ width: 140 }}>
            <Field label="Código" placeholder="Bodega 4" value={code} onChange={(e) => setCode(e.target.value)} />
          </div>
          <div style={{ flex: '1 1 200px', minWidth: 0 }}>
            <Field label="Nombre" placeholder="Bodega norte" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <Button variant="primary" onClick={create} disabled={creating || !code.trim()}>
            <Icon name="plus" size={16} strokeWidth={2.4} /> {creating ? 'Creando…' : 'Crear'}
          </Button>
        </div>
      </div>

      {bodegas.length === 0 ? (
        <div style={{ padding: '18px 20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13.5, background: 'var(--surface-card)', border: '1px dashed var(--border-subtle)', borderRadius: 'var(--radius-md)' }}>
          No hay bodegas todavía. Crea una arriba.
        </div>
      ) : (
        bodegas.map((b) => (
          <div key={b.id} style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-sm)', overflow: 'hidden' }}>
            <div style={{ padding: '13px 16px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'baseline', gap: 10 }}>
              <span style={{ font: '700 15px var(--font-display)' }}>{b.code}</span>
              <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{b.name}</span>
            </div>
            <div style={{ padding: '6px 8px' }}>
              {operators.length === 0 ? (
                <div style={{ padding: 14, fontSize: 13, color: 'var(--text-muted)' }}>Aún no hay a quién dar acceso. Registra empleados, socios o bodegueros con una clave de invitación.</div>
              ) : (
                <>
                  <div style={{ padding: '8px 12px 4px', fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.4 }}>
                    Marca a quién le das acceso a esta bodega: podrá registrar entradas de mercancía y hacer salidas hacia los locales.
                  </div>
                  {operators.map((u) => {
                  const on = (u.bodegaIds ?? []).includes(b.id)
                  return (
                    <label key={u.id} className="iw-row" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 'var(--radius-md)', cursor: 'pointer' }}>
                      <input type="checkbox" checked={on} onChange={(e) => void toggle(u, b.id, e.target.checked)} style={{ width: 18, height: 18, accentColor: 'var(--iw-plum)', cursor: 'pointer' }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ font: '700 13.5px var(--font-body)' }}>{u.name}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{ROLE_LABEL[u.role]} · {u.email}</div>
                      </div>
                    </label>
                  )
                  })}
                </>
              )}
            </div>
          </div>
        ))
      )}
    </>
  )
}

// ── Roles: ver el equipo y editar rol / local ─────────────────────────────────

function RolesTab({ team, meId, stores, onChange }: { team: UserProfile[]; meId: UserProfile['id']; stores: Store[]; onChange: () => void }) {
  const changeRole = async (u: UserProfile, role: Role) => {
    await teamRepository.setUserRole(u.id, role).catch(() => undefined)
    onChange()
  }
  const changeStore = async (u: UserProfile, storeId: string) => {
    await teamRepository.setUserStore(u.id, storeId).catch(() => undefined)
    onChange()
  }
  const changeActive = async (u: UserProfile, active: boolean) => {
    await teamRepository.setUserActive(u.id, active).catch(() => undefined)
    onChange()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <span style={{ font: '700 13px var(--font-body)', color: 'var(--text-secondary)' }}>
        Personas registradas ({team.length}) · edita el rol y el local, o desactiva a quien ya no trabaja
      </span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {team.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 14, background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)' }}>Cargando…</div>
        ) : (
          team.map((m) => {
            const inactive = m.active === false
            // No puedes desactivarte a ti misma ni a la dueña: evitaría dejar el
            // negocio sin quién administre.
            const canToggle = m.id !== meId && !m.owner
            return (
              <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-sm)', padding: '13px 16px', opacity: inactive ? 0.55 : 1 }}>
                <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                  <div style={{ font: '700 14px var(--font-body)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {m.name}
                    {m.id === meId ? <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}> · tú</span> : null}
                    {m.owner ? <span style={{ marginLeft: 6, color: 'var(--iw-plum)', font: '700 10px var(--font-body)' }}>DUEÑA</span> : null}
                    {inactive ? <span style={{ marginLeft: 6, color: 'var(--color-danger)', font: '700 10px var(--font-body)' }}>DESACTIVADA</span> : null}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{m.email}</div>
                </div>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span style={{ fontSize: 10.5, color: 'var(--text-muted)', fontWeight: 700 }}>ROL</span>
                  <select value={m.role} onChange={(e) => void changeRole(m, e.target.value as Role)} style={selectStyle}>
                    {ROLES.map((r) => (
                      <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                    ))}
                  </select>
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 3, opacity: isStoreRole(m.role) ? 1 : 0.4 }}>
                  <span style={{ fontSize: 10.5, color: 'var(--text-muted)', fontWeight: 700 }}>LOCAL</span>
                  <select value={m.storeId ?? ''} disabled={!isStoreRole(m.role)} onChange={(e) => void changeStore(m, e.target.value)} style={selectStyle}>
                    <option value="">— sin local —</option>
                    {stores.map((s) => (
                      <option key={s.id} value={s.id}>Local {s.code}</option>
                    ))}
                  </select>
                </label>
                {canToggle ? (
                  <button
                    onClick={() => void changeActive(m, inactive)}
                    className="iw-press"
                    style={{
                      cursor: 'pointer',
                      alignSelf: 'flex-end',
                      background: inactive ? 'var(--color-success)' : 'transparent',
                      color: inactive ? '#fff' : 'var(--color-danger)',
                      border: `1.5px solid ${inactive ? 'var(--color-success)' : 'rgba(224,52,29,.4)'}`,
                      borderRadius: 'var(--radius-pill)',
                      padding: '8px 14px',
                      font: '700 12.5px var(--font-body)',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {inactive ? 'Activar' : 'Desactivar'}
                  </button>
                ) : null}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
