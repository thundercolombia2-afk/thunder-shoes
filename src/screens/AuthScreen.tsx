/**
 * Ingreso y registro. El registro se adapta solo:
 *   · Plataforma vacía → el que se registra será el SOCIO DUEÑO (sin código).
 *   · Ya hay dueño      → se exige un código de invitación (el rol lo hereda).
 * Nadie elige su rol aquí: o es el arranque, o lo define la invitación.
 */

import { useEffect, useState } from 'react'
import { authService } from '@/data/authService'
import { Button } from '@/ui/Button'
import { Field } from '@/ui/Field'
import { Icon } from '@/ui/Icon'

type Mode = 'login' | 'register'

export function AuthScreen({ incompleteAccount = false, disabledAccount = false }: { incompleteAccount?: boolean; disabledAccount?: boolean }) {
  const [mode, setMode] = useState<Mode>('login')
  const [bootstrap, setBootstrap] = useState<boolean | null>(null)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [invite, setInvite] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [resetMsg, setResetMsg] = useState('')

  useEffect(() => {
    authService
      .isBootstrap()
      .then(setBootstrap)
      .catch(() => setBootstrap(false))
  }, [])

  const submit = async () => {
    setError('')
    setBusy(true)
    try {
      if (mode === 'login') {
        await authService.login(email, password)
      } else {
        await authService.register({
          name,
          email,
          password,
          ...(bootstrap ? {} : { inviteCode: invite }),
        })
      }
      // El observador de sesión toma el control desde aquí.
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo continuar.')
      setBusy(false)
    }
  }

  const forgotPassword = async () => {
    setError('')
    setResetMsg('')
    if (!email.trim()) {
      setError('Escribe tu correo arriba y toca de nuevo "¿Olvidaste tu contraseña?".')
      return
    }
    try {
      await authService.sendReset(email)
      setResetMsg(`Te enviamos un enlace a ${email.trim()} para restablecerla.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo enviar el enlace.')
    }
  }

  if (incompleteAccount) {
    return (
      <Shell>
        <Card>
          <h1 style={{ margin: 0, font: '700 22px var(--font-display)' }}>Cuenta incompleta</h1>
          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 14, lineHeight: 1.5 }}>
            Tu correo tiene credencial pero no un perfil asignado. Pide a un socio que te envíe una
            invitación, o inicia sesión con otra cuenta.
          </p>
          <Button variant="primary" fullWidth onClick={() => void authService.logout()}>
            Salir
          </Button>
        </Card>
      </Shell>
    )
  }

  if (disabledAccount) {
    return (
      <Shell>
        <Card>
          <h1 style={{ margin: 0, font: '700 22px var(--font-display)' }}>Cuenta desactivada</h1>
          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 14, lineHeight: 1.5 }}>
            Tu cuenta fue desactivada y no puedes ingresar. Si crees que es un error, comunícate con
            la dueña del negocio.
          </p>
          <Button variant="primary" fullWidth onClick={() => void authService.logout()}>
            Salir
          </Button>
        </Card>
      </Shell>
    )
  }

  const canSubmit =
    email.trim() &&
    password &&
    (mode === 'login' || (name.trim() && (bootstrap || invite.trim())))

  return (
    <Shell>
      <Card>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, textAlign: 'center' }}>
          <div style={{ width: 46, height: 46, borderRadius: 12, background: 'var(--iw-yellow)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="bolt" size={26} color="var(--iw-plum)" />
          </div>
          <h1 style={{ margin: 0, font: '700 22px var(--font-display)' }}>
            {mode === 'login' ? 'Ingresar' : 'Crear cuenta'}
          </h1>
          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 13 }}>Thunder POS · Zapatillas</p>
        </div>

        {mode === 'register' && bootstrap ? (
          <div style={{ background: 'rgba(255,209,0,.16)', border: '1px solid rgba(199,146,0,.35)', borderRadius: 'var(--radius-md)', padding: '10px 13px', fontSize: 12.5, color: 'var(--text-secondary)' }}>
            Eres la primera cuenta: quedarás como <b>socio dueño</b>, con todos los permisos.
          </div>
        ) : null}

        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (canSubmit && !busy) void submit()
          }}
          style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
        >
          {mode === 'register' ? (
            <Field label="Nombre" placeholder="Tu nombre" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          ) : null}
          <Field label="Correo" type="email" placeholder="tucorreo@ejemplo.com" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          <Field label="Contraseña" type="password" placeholder="••••••" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
          {mode === 'register' && bootstrap === false ? (
            <Field label="Código de invitación" placeholder="THR-XXXX" value={invite} onChange={(e) => setInvite(e.target.value.toUpperCase())} hint="Te lo envía la dueña. Ya trae tu rol y tu local o bodega." />
          ) : null}

          {error ? (
            <div style={{ background: 'rgba(224,52,29,.1)', border: '1px solid rgba(224,52,29,.3)', borderRadius: 'var(--radius-md)', padding: '10px 13px', color: 'var(--color-danger)', fontSize: 13, fontWeight: 700 }}>
              {error}
            </div>
          ) : null}
          {resetMsg ? (
            <div style={{ background: 'rgba(21,119,79,.1)', border: '1px solid rgba(21,119,79,.3)', borderRadius: 'var(--radius-md)', padding: '10px 13px', color: 'var(--color-success)', fontSize: 13, fontWeight: 700 }}>
              {resetMsg}
            </div>
          ) : null}

          <Button type="submit" variant="primary" size="lg" fullWidth disabled={!canSubmit || busy}>
            {busy ? 'Un momento…' : mode === 'login' ? 'Ingresar' : 'Crear cuenta'}
          </Button>

          {mode === 'login' ? (
            <button
              type="button"
              onClick={forgotPassword}
              style={{ cursor: 'pointer', background: 'transparent', border: 'none', color: 'var(--text-muted)', fontSize: 12.5, fontWeight: 600, alignSelf: 'center' }}
            >
              ¿Olvidaste tu contraseña?
            </button>
          ) : null}
        </form>

        <button
          onClick={() => {
            setMode((m) => (m === 'login' ? 'register' : 'login'))
            setError('')
          }}
          style={{ cursor: 'pointer', background: 'transparent', border: 'none', color: 'var(--text-secondary)', fontSize: 13, fontWeight: 600 }}
        >
          {mode === 'login' ? '¿No tienes cuenta? Crear una' : '¿Ya tienes cuenta? Ingresar'}
        </button>
      </Card>
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--iw-plum-dark)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, overflowY: 'auto' }}>
      {children}
    </div>
  )
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="iw-fade" style={{ width: 380, maxWidth: '100%', background: 'var(--surface-card)', borderRadius: 'var(--radius-xl)', padding: '28px 26px', boxShadow: 'var(--shadow-lg)', display: 'flex', flexDirection: 'column', gap: 18 }}>
      {children}
    </div>
  )
}
