/**
 * Equipo (solo socios). Aquí un socio genera invitaciones con el rol ya fijado
 * y ve quién está en el equipo. El empleado nunca llega a esta pantalla: la
 * pestaña no aparece y, por si acaso, se redirige.
 */

import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useSession } from '@/app/session'
import { teamRepository } from '@/data/repositories/teamRepository'
import { ROLE_LABEL, type Invite, type Role, type UserProfile } from '@/domain/users'
import { formatShortDate } from '@/lib/format'
import { Button } from '@/ui/Button'
import { Icon } from '@/ui/Icon'

export function TeamScreen() {
  const { user, can } = useSession()
  const [role, setRole] = useState<Role>('empleado')
  const [invites, setInvites] = useState<Invite[]>([])
  const [team, setTeam] = useState<UserProfile[]>([])
  const [creating, setCreating] = useState(false)
  const [copied, setCopied] = useState('')

  const reload = () => {
    teamRepository.listInvites().then(setInvites).catch(() => undefined)
    teamRepository.listTeam().then(setTeam).catch(() => undefined)
  }

  useEffect(reload, [])

  if (!user || !can('manageTeam')) return <Navigate to="/scan" replace />

  const create = async () => {
    setCreating(true)
    try {
      await teamRepository.createInvite(role, { id: user.id, name: user.name })
      reload()
    } finally {
      setCreating(false)
    }
  }

  const copy = async (code: string) => {
    await navigator.clipboard.writeText(code).catch(() => undefined)
    setCopied(code)
    setTimeout(() => setCopied(''), 1500)
  }

  const activeInvites = invites.filter((i) => i.active)

  return (
    <div style={{ padding: '18px 20px 32px', display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 760, margin: '0 auto', width: '100%' }} className="iw-fade">
      <h1 style={{ margin: 0, font: '700 24px var(--font-display)' }}>Equipo</h1>

      {/* Generar invitación */}
      <div style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', padding: 18, boxShadow: 'var(--shadow-sm)', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <div style={{ font: '700 15px var(--font-display)' }}>Invitar a alguien</div>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
            Genera un código y compártelo. Quien se registre con él entra con el rol que elijas —
            no puede cambiarlo.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {(['empleado', 'socio'] as Role[]).map((r) => {
            const on = role === r
            return (
              <button
                key={r}
                onClick={() => setRole(r)}
                className="iw-press"
                style={{
                  cursor: 'pointer',
                  background: on ? 'var(--iw-plum)' : 'var(--surface-card)',
                  color: on ? '#fff' : 'var(--text-secondary)',
                  border: `1.5px solid ${on ? 'var(--iw-plum)' : 'var(--border-subtle)'}`,
                  borderRadius: 'var(--radius-pill)',
                  padding: '9px 16px',
                  font: '700 13px var(--font-body)',
                }}
              >
                {ROLE_LABEL[r]}
              </button>
            )
          })}
          <div style={{ flex: 1 }} />
          <Button variant="primary" onClick={create} disabled={creating}>
            <Icon name="plus" size={16} strokeWidth={2.4} /> {creating ? 'Generando…' : 'Generar código'}
          </Button>
        </div>
        {role === 'socio' ? (
          <div style={{ background: 'rgba(255,209,0,.14)', border: '1px solid rgba(199,146,0,.3)', borderRadius: 'var(--radius-sm)', padding: '8px 12px', fontSize: 12.5, color: 'var(--text-secondary)' }}>
            Ojo: un <b>socio</b> ve costos y utilidad y puede invitar a más gente. Dáselo solo a quien
            confíes de verdad.
          </div>
        ) : null}
      </div>

      {/* Invitaciones activas */}
      {activeInvites.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span style={{ font: '700 13px var(--font-body)', color: 'var(--text-secondary)' }}>Invitaciones sin usar</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {activeInvites.map((inv) => (
              <div key={inv.code} style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: '12px 14px' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ font: '700 16px ui-monospace,monospace', letterSpacing: '.05em' }}>{inv.code}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    Rol {ROLE_LABEL[inv.role]} · creada {formatShortDate(inv.createdAt)}
                  </div>
                </div>
                <button
                  onClick={() => copy(inv.code)}
                  className="iw-press"
                  style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, background: 'var(--iw-plum)', color: '#fff', border: 'none', borderRadius: 'var(--radius-pill)', padding: '8px 14px', font: '700 12px var(--font-body)' }}
                >
                  <Icon name={copied === inv.code ? 'check' : 'list'} size={14} strokeWidth={2.2} />
                  {copied === inv.code ? 'Copiado' : 'Copiar'}
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* Equipo */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <span style={{ font: '700 13px var(--font-body)', color: 'var(--text-secondary)' }}>Personas en el equipo ({team.length})</span>
        <div style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-sm)', overflow: 'hidden' }}>
          {team.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 }}>Cargando…</div>
          ) : (
            team.map((m) => (
              <div key={m.id} className="iw-row" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px', borderBottom: '1px solid var(--border-subtle)' }}>
                <div style={{ width: 34, height: 34, borderRadius: '50%', background: m.role === 'socio' ? 'var(--iw-yellow)' : 'var(--surface-sunken)', color: 'var(--iw-plum)', display: 'flex', alignItems: 'center', justifyContent: 'center', font: '700 13px var(--font-display)' }}>
                  {m.name.slice(0, 1).toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ font: '700 14px var(--font-body)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {m.name}
                    {m.id === user.id ? <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}> · tú</span> : null}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{m.email}</div>
                </div>
                <span style={{ background: m.role === 'socio' ? 'rgba(21,119,79,.12)' : 'var(--surface-sunken)', color: m.role === 'socio' ? 'var(--color-success)' : 'var(--text-secondary)', font: '700 11px var(--font-body)', padding: '4px 11px', borderRadius: 'var(--radius-pill)' }}>
                  {ROLE_LABEL[m.role]}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
