/**
 * Frontera de autenticación. Según el estado de la sesión decide qué se ve:
 *   loading             → splash mientras resuelve
 *   signedOut/noProfile → pantalla de ingreso / registro
 *   ready               → la app (children)
 */

import { type ReactNode } from 'react'
import { useSession } from './session'
import { AuthScreen } from '@/screens/AuthScreen'
import { Icon } from '@/ui/Icon'

export function AuthGate({ children }: { children: ReactNode }) {
  const { status } = useSession()

  if (status === 'ready') return <>{children}</>
  if (status === 'loading') return <Splash />
  // signedOut | noProfile
  return <AuthScreen incompleteAccount={status === 'noProfile'} />
}

function Splash() {
  return (
    <div
      style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
        background: 'var(--iw-plum-dark)',
        color: 'var(--iw-cream)',
      }}
    >
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: 12,
          background: 'var(--iw-yellow)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name="bolt" size={24} color="var(--iw-plum)" />
      </div>
      <span style={{ opacity: 0.7, fontSize: 14 }}>Conectando…</span>
    </div>
  )
}
