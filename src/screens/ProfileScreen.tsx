/**
 * Mi perfil: editar el nombre, ver correo y rol, y cambiar la contraseña.
 * El rol y el correo son de solo lectura aquí (el rol, por seguridad; el correo
 * porque cambiarlo requiere verificación aparte).
 */

import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useSession } from '@/app/session'
import { useBodegas, useStores } from '@/app/hooks'
import { authService } from '@/data/authService'
import { ROLE_LABEL } from '@/domain/users'
import { RoleBadge } from './_shared'
import { Field } from '@/ui/Field'
import { Button } from '@/ui/Button'

export function ProfileScreen() {
  const { user, refreshProfile } = useSession()
  const { data: stores } = useStores()
  const bodegas = useBodegas()

  const [name, setName] = useState(user?.name ?? '')
  const [savingName, setSavingName] = useState(false)
  const [nameMsg, setNameMsg] = useState<Note>(null)

  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [savingPass, setSavingPass] = useState(false)
  const [passMsg, setPassMsg] = useState<Note>(null)

  const [resetMsg, setResetMsg] = useState<Note>(null)

  if (!user) return <Navigate to="/" replace />

  const saveName = async () => {
    setNameMsg(null)
    setSavingName(true)
    try {
      await authService.updateName(name)
      await refreshProfile()
      setNameMsg({ ok: true, text: 'Nombre actualizado.' })
    } catch (e) {
      setNameMsg({ ok: false, text: e instanceof Error ? e.message : 'No se pudo guardar.' })
    } finally {
      setSavingName(false)
    }
  }

  const changePassword = async () => {
    setPassMsg(null)
    if (next !== confirm) {
      setPassMsg({ ok: false, text: 'La nueva contraseña y su confirmación no coinciden.' })
      return
    }
    setSavingPass(true)
    try {
      await authService.changePassword(current, next)
      setCurrent('')
      setNext('')
      setConfirm('')
      setPassMsg({ ok: true, text: 'Contraseña actualizada.' })
    } catch (e) {
      setPassMsg({ ok: false, text: e instanceof Error ? e.message : 'No se pudo cambiar.' })
    } finally {
      setSavingPass(false)
    }
  }

  const sendReset = async () => {
    setResetMsg(null)
    try {
      await authService.sendReset(user.email)
      setResetMsg({ ok: true, text: `Te enviamos un enlace a ${user.email}.` })
    } catch (e) {
      setResetMsg({ ok: false, text: e instanceof Error ? e.message : 'No se pudo enviar.' })
    }
  }

  // Local y bodega(s) a los que está asociado, para que la persona sepa dónde
  // está operando (solo lectura; la asignación la cambia la dueña en Roles).
  const storeCode = user.storeId ? stores.find((s) => s.id === user.storeId)?.code : undefined
  const myBodegaCodes = (user.bodegaIds ?? [])
    .map((id) => bodegas.find((b) => b.id === id)?.code)
    .filter((c): c is string => Boolean(c))

  return (
    <div style={{ padding: '18px 20px 32px', display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 620, margin: '0 auto', width: '100%' }} className="iw-fade">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, font: '700 24px var(--font-display)', flex: 1 }}>Mi perfil</h1>
        <RoleBadge role={user.role} />
      </div>

      {/* Datos */}
      <Card title="Datos">
        <Field label="Nombre" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
        <ReadOnly label="Correo" value={user.email} />
        <ReadOnly label="Rol" value={ROLE_LABEL[user.role]} />
        {storeCode ? <ReadOnly label="Local" value={`Local ${storeCode}`} /> : null}
        {myBodegaCodes.length > 0 ? (
          <ReadOnly label={myBodegaCodes.length > 1 ? 'Bodegas' : 'Bodega'} value={myBodegaCodes.join(' · ')} />
        ) : null}
        {!storeCode && myBodegaCodes.length === 0 ? (
          <ReadOnly label="Asignación" value={user.owner ? 'Dueña · sin local fijo' : 'Sin asignación'} />
        ) : null}
        {nameMsg ? <Msg note={nameMsg} /> : null}
        <Button variant="primary" onClick={saveName} disabled={savingName || name.trim() === user.name || !name.trim()} style={{ alignSelf: 'flex-start' }}>
          {savingName ? 'Guardando…' : 'Guardar nombre'}
        </Button>
      </Card>

      {/* Contraseña */}
      <Card title="Contraseña">
        <Field label="Contraseña actual" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
        <Field label="Nueva contraseña" type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" hint="Mínimo 6 caracteres." />
        <Field label="Confirmar nueva contraseña" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
        {passMsg ? <Msg note={passMsg} /> : null}
        <Button variant="primary" onClick={changePassword} disabled={savingPass || !current || !next || !confirm} style={{ alignSelf: 'flex-start' }}>
          {savingPass ? 'Cambiando…' : 'Cambiar contraseña'}
        </Button>

        <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            ¿Prefieres recuperarla por correo? Te enviamos un enlace para restablecerla.
          </span>
          {resetMsg ? <Msg note={resetMsg} /> : null}
          <Button variant="outline" onClick={sendReset} style={{ alignSelf: 'flex-start' }}>
            Enviar enlace de recuperación
          </Button>
        </div>
      </Card>
    </div>
  )
}

type Note = { ok: boolean; text: string } | null

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', padding: 18, boxShadow: 'var(--shadow-sm)', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ font: '700 15px var(--font-display)' }}>{title}</div>
      {children}
    </div>
  )
}

function ReadOnly({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ font: '700 13px var(--font-body)', color: 'var(--text-secondary)' }}>{label}</span>
      <div style={{ background: 'var(--surface-sunken)', border: '1.5px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: '13px 15px', font: '600 15px var(--font-body)', color: 'var(--text-secondary)' }}>
        {value}
      </div>
    </div>
  )
}

function Msg({ note }: { note: { ok: boolean; text: string } }) {
  return (
    <div
      style={{
        background: note.ok ? 'rgba(21,119,79,.1)' : 'rgba(224,52,29,.1)',
        border: `1px solid ${note.ok ? 'rgba(21,119,79,.3)' : 'rgba(224,52,29,.3)'}`,
        borderRadius: 'var(--radius-md)',
        padding: '10px 13px',
        color: note.ok ? 'var(--color-success)' : 'var(--color-danger)',
        fontSize: 13,
        fontWeight: 700,
      }}
    >
      {note.text}
    </div>
  )
}
