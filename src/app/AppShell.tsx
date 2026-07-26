/**
 * Armazón de la app una vez con sesión y local elegido. Dos layouts según el
 * ancho (nav inferior en móvil, lateral en escritorio). Muestra a la persona
 * real y su rol, permite cambiar de local o salir, y añade la pestaña "Equipo"
 * solo para socios.
 */

import { Navigate, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useSession } from './session'
import { useIsMobile } from './useMediaQuery'
import { ScanningOverlay } from './ScanningOverlay'
import { Icon, type IconName } from '@/ui/Icon'
import { isStoreRole, ROLE_LABEL, type Role } from '@/domain/users'

interface NavEntry {
  to: string
  label: string
  icon: IconName
  match: string[]
  /** Si se define, solo estos roles ven la entrada. */
  roles?: Role[]
  /** Solo la dueña la ve (para no filtrar la contraseña de Configuración). */
  ownerOnly?: boolean
}

const NAV: NavEntry[] = [
  { to: '/scan', label: 'Escanear', icon: 'scan', match: ['/scan'] },
  { to: '/inventory', label: 'Inventario', icon: 'box', match: ['/inventory'] },
  { to: '/locales', label: 'Locales', icon: 'store', match: ['/locales'], roles: ['socio', 'empleado'] },
  { to: '/history', label: 'Historial', icon: 'list', match: ['/history'], roles: ['socio', 'empleado'] },
  { to: '/dashboard', label: 'Ingresos y egresos', icon: 'chart', match: ['/dashboard'], roles: ['socio', 'empleado'] },
  { to: '/settings', label: 'Configuración', icon: 'settings', match: ['/settings'], ownerOnly: true },
]

function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')
}

export function AppShell() {
  const { store, user, clearStore, logout } = useSession()
  const isMobile = useIsMobile()
  const location = useLocation()
  const navigate = useNavigate()

  if (!user) return <Navigate to="/" replace />
  // Los roles de venta necesitan un local; el bodeguero entra sin él.
  if (isStoreRole(user.role) && !store) return <Navigate to="/" replace />

  const items = NAV.filter((n) => (!n.roles || n.roles.includes(user.role)) && (!n.ownerOnly || user.owner))
  const activeKey = items.find((n) => n.match.some((m) => location.pathname.startsWith(m)))?.to

  // Solo la dueña cambia de local desde aquí; el ?cambiar=1 le dice al selector
  // que muestre las opciones en vez de reentrar al local ya amarrado.
  const canChangeStore = user.owner === true
  const changeStore = () => {
    clearStore()
    navigate('/?cambiar=1')
  }
  const onLogout = () => {
    void logout()
    navigate('/')
  }
  const openProfile = () => navigate('/profile')

  return (
    <div style={{ height: '100vh', overflow: 'hidden', background: 'var(--iw-plum-dark)', display: 'flex' }}>
      {isMobile ? (
        <MobileShell
          storeCode={store?.code ?? ''}
          userName={user.name}
          items={items}
          activeKey={activeKey}
          canChangeStore={canChangeStore}
          onChangeStore={changeStore}
          onLogout={onLogout}
          onOpenProfile={openProfile}
        />
      ) : (
        <DesktopShell
          storeCode={store?.code ?? ''}
          userName={user.name}
          roleLabel={ROLE_LABEL[user.role]}
          items={items}
          activeKey={activeKey}
          canChangeStore={canChangeStore}
          onChangeStore={changeStore}
          onLogout={onLogout}
          onOpenProfile={openProfile}
        />
      )}
      <ScanningOverlay />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

function MobileShell({
  storeCode,
  userName,
  items,
  activeKey,
  canChangeStore,
  onChangeStore,
  onLogout,
  onOpenProfile,
}: {
  storeCode: string
  userName: string
  items: NavEntry[]
  activeKey: string | undefined
  canChangeStore: boolean
  onChangeStore: () => void
  onLogout: () => void
  onOpenProfile: () => void
}) {
  return (
    <div
      style={{
        width: '100%',
        maxWidth: 600,
        margin: '0 auto',
        background: 'var(--surface-base)',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
      }}
    >
      <header
        style={{
          flex: 'none',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '12px 16px 10px',
          background: 'var(--iw-plum-darkest)',
          borderBottom: '1px solid rgba(255,255,255,.08)',
        }}
      >
        <div style={{ width: 30, height: 30, borderRadius: 9, background: 'var(--iw-yellow)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="bolt" size={16} color="var(--iw-plum)" />
        </div>
        <button
          onClick={onOpenProfile}
          className="iw-press"
          style={{ display: 'flex', flexDirection: 'column', minWidth: 0, background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', padding: 0 }}
        >
          <span style={{ font: '700 13px var(--font-display)', color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {userName}
          </span>
          <span style={{ fontSize: 10, color: 'var(--iw-cream)', opacity: 0.55, fontWeight: 600 }}>
            {storeCode ? `Local ${storeCode}` : 'Bodeguero'} · ver perfil
          </span>
        </button>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 12 }}>
          {canChangeStore ? <HeaderAction icon="refresh" label="Local" onClick={onChangeStore} /> : null}
          <HeaderAction icon="return" label="Salir" onClick={onLogout} />
        </div>
      </header>

      <main className="iw-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }}>
        <Outlet />
      </main>

      <nav style={{ flex: 'none', display: 'flex', background: 'var(--surface-card)', borderTop: '1px solid var(--border-subtle)', padding: '8px 4px 14px' }}>
        {items.map((n) => {
          const on = n.to === activeKey
          return (
            <NavLink
              key={n.to}
              to={n.to}
              style={{ textDecoration: 'none', flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: 4, color: on ? 'var(--iw-plum)' : 'var(--text-muted)' }}
            >
              <div style={{ width: '100%', display: 'flex', justifyContent: 'center', position: 'relative' }}>
                <div style={{ width: 26, height: 3, borderRadius: 2, background: on ? 'var(--iw-yellow)' : 'transparent', position: 'absolute', top: -8 }} />
                <Icon name={n.icon} size={22} />
              </div>
              <span style={{ font: '700 10.5px var(--font-body)' }}>{n.label}</span>
            </NavLink>
          )
        })}
      </nav>
    </div>
  )
}

function HeaderAction({ icon, label, onClick }: { icon: IconName; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="iw-press"
      style={{ cursor: 'pointer', background: 'transparent', border: 'none', display: 'flex', alignItems: 'center', gap: 5, font: '700 11px var(--font-body)', color: 'var(--iw-cream)', opacity: 0.75 }}
    >
      <Icon name={icon} size={14} /> {label}
    </button>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

function DesktopShell({
  storeCode,
  userName,
  roleLabel,
  items,
  activeKey,
  canChangeStore,
  onChangeStore,
  onLogout,
  onOpenProfile,
}: {
  storeCode: string
  userName: string
  roleLabel: string
  items: NavEntry[]
  activeKey: string | undefined
  canChangeStore: boolean
  onChangeStore: () => void
  onLogout: () => void
  onOpenProfile: () => void
}) {
  return (
    <div style={{ width: '100%', background: 'var(--surface-base)', overflow: 'hidden', display: 'flex', height: '100%' }}>
      <aside style={{ flex: 'none', width: 236, background: 'var(--iw-plum)', display: 'flex', flexDirection: 'column', padding: '22px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 8px 22px' }}>
          <div style={{ width: 38, height: 38, borderRadius: 11, background: 'var(--iw-yellow)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="bolt" size={22} color="var(--iw-plum)" />
          </div>
          <div>
            <div style={{ font: '700 16px var(--font-display)', color: '#fff', letterSpacing: '.1em' }}>THUNDER</div>
            <div style={{ fontSize: 11, color: 'var(--iw-cream)', opacity: 0.6 }}>{storeCode ? `Local ${storeCode}` : 'Bodeguero'}</div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {items.map((n) => {
            const on = n.to === activeKey
            return (
              <NavLink
                key={n.to}
                to={n.to}
                className="iw-nav"
                style={{
                  textDecoration: 'none',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '12px 14px',
                  borderRadius: 'var(--radius-md)',
                  color: on ? 'var(--iw-plum)' : 'var(--iw-cream)',
                  background: on ? 'var(--iw-yellow)' : 'transparent',
                  font: '700 14px var(--font-body)',
                  transition: 'all var(--dur-fast) var(--ease-out)',
                }}
              >
                <Icon name={n.icon} size={22} /> {n.label}
              </NavLink>
            )
          })}
        </div>

        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button
            onClick={onOpenProfile}
            className="iw-press"
            title="Ver mi perfil"
            style={{ background: 'rgba(255,255,255,.08)', border: 'none', cursor: 'pointer', textAlign: 'left', borderRadius: 'var(--radius-md)', padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10 }}
          >
            <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'var(--iw-yellow)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#17171a', font: '700 13px var(--font-display)' }}>
              {initials(userName)}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ font: '700 13px var(--font-body)', color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{userName}</div>
              <div style={{ fontSize: 11, color: 'var(--iw-cream)', opacity: 0.6 }}>{roleLabel} · ver perfil</div>
            </div>
          </button>
          <div style={{ display: 'flex', gap: 8 }}>
            {canChangeStore ? <SidebarButton icon="refresh" label="Local" onClick={onChangeStore} /> : null}
            <SidebarButton icon="return" label="Salir" onClick={onLogout} />
          </div>
        </div>
      </aside>

      <main className="iw-scroll" style={{ flex: 1, minWidth: 0, overflowY: 'auto', height: '100%' }}>
        <Outlet />
      </main>
    </div>
  )
}

function SidebarButton({ icon, label, onClick }: { icon: IconName; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="iw-press"
      style={{
        flex: 1,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        background: 'rgba(255,255,255,.06)',
        border: 'none',
        borderRadius: 'var(--radius-md)',
        padding: '9px',
        color: 'var(--iw-cream)',
        font: '700 12px var(--font-body)',
      }}
    >
      <Icon name={icon} size={14} /> {label}
    </button>
  )
}
