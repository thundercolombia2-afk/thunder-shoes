/**
 * Armazón de la app una vez con sesión y local elegido. Dos layouts según el
 * ancho (nav inferior en móvil, lateral en escritorio). Muestra a la persona
 * real y su rol, permite cambiar de local o salir, y añade la pestaña "Equipo"
 * solo para socios.
 */

import { useState } from 'react'
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
  { to: '/history', label: 'Historial', icon: 'list', match: ['/history'], roles: ['socio', 'empleado', 'bodeguero'] },
  { to: '/dashboard', label: 'Ingresos y egresos', icon: 'chart', match: ['/dashboard'], roles: ['socio'] },
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
  const [menuOpen, setMenuOpen] = useState(false)
  const activeLabel = items.find((n) => n.to === activeKey)?.label ?? ''

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
        position: 'relative',
      }}
    >
      {/* Franja de marca: separa el contenido de las barras del celular (barra de
          estado, notch, barra de direcciones) para que la hamburguesa quede
          siempre alcanzable. */}
      <div
        style={{
          flex: 'none',
          paddingTop: 'env(safe-area-inset-top, 0px)',
          background: 'var(--iw-plum-darkest)',
        }}
      >
        <div style={{ height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}>
          <Icon name="bolt" size={14} color="var(--iw-yellow)" />
          <span style={{ font: '800 12px var(--font-display)', color: '#fff', letterSpacing: '.16em' }}>THUNDER</span>
        </div>
      </div>

      <header
        style={{
          flex: 'none',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '10px 14px 11px',
          background: 'var(--iw-plum-darkest)',
          borderBottom: '1px solid rgba(255,255,255,.08)',
        }}
      >
        <button
          onClick={() => setMenuOpen(true)}
          aria-label="Abrir menú"
          className="iw-press"
          style={{ width: 38, height: 38, flex: 'none', borderRadius: 10, background: 'rgba(255,255,255,.1)', border: 'none', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <Icon name="menu" size={22} />
        </button>
        <span style={{ font: '700 16px var(--font-display)', color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1, minWidth: 0 }}>
          {activeLabel}
        </span>
        <button
          onClick={onOpenProfile}
          aria-label="Ver perfil"
          className="iw-press"
          style={{ width: 34, height: 34, flex: 'none', borderRadius: '50%', background: 'var(--iw-yellow)', border: 'none', color: 'var(--iw-plum)', cursor: 'pointer', font: '700 13px var(--font-display)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          {initials(userName) || <Icon name="user" size={18} />}
        </button>
      </header>

      <main className="iw-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }}>
        <Outlet />
      </main>

      {/* Menú lateral (hamburguesa) */}
      {menuOpen ? (
        <div
          onClick={() => setMenuOpen(false)}
          style={{ position: 'absolute', inset: 0, background: 'rgba(12,12,13,.5)', zIndex: 80, display: 'flex' }}
        >
          <nav
            onClick={(e) => e.stopPropagation()}
            className="iw-scroll"
            style={{ width: 268, maxWidth: '82%', height: '100%', background: 'var(--iw-plum-darkest)', display: 'flex', flexDirection: 'column', padding: 'calc(16px + env(safe-area-inset-top, 0px)) 12px 16px', gap: 4, overflowY: 'auto' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 8px 14px' }}>
              <div style={{ width: 32, height: 32, borderRadius: 9, background: 'var(--iw-yellow)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="bolt" size={17} color="var(--iw-plum)" />
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ font: '700 14px var(--font-display)', color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{userName}</div>
                <div style={{ fontSize: 11, color: 'var(--iw-cream)', opacity: 0.6, fontWeight: 600 }}>{storeCode ? `Local ${storeCode}` : 'Bodeguero'}</div>
              </div>
            </div>

            {items.map((n) => {
              const on = n.to === activeKey
              return (
                <NavLink
                  key={n.to}
                  to={n.to}
                  onClick={() => setMenuOpen(false)}
                  style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 12, padding: '12px 12px', borderRadius: 'var(--radius-md)', background: on ? 'rgba(255,255,255,.12)' : 'transparent', color: on ? '#fff' : 'var(--iw-cream)' }}
                >
                  <Icon name={n.icon} size={20} color={on ? 'var(--iw-yellow)' : 'currentColor'} />
                  <span style={{ font: '700 14.5px var(--font-body)' }}>{n.label}</span>
                </NavLink>
              )
            })}

            <div style={{ marginTop: 'auto', borderTop: '1px solid rgba(255,255,255,.1)', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <MenuAction icon="user" label="Mi perfil" onClick={() => { setMenuOpen(false); onOpenProfile() }} />
              {canChangeStore ? <MenuAction icon="refresh" label="Cambiar de local" onClick={() => { setMenuOpen(false); onChangeStore() }} /> : null}
              <MenuAction icon="return" label="Cerrar sesión" onClick={() => { setMenuOpen(false); onLogout() }} />
            </div>
          </nav>
        </div>
      ) : null}
    </div>
  )
}

function MenuAction({ icon, label, onClick }: { icon: IconName; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="iw-press"
      style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 12px', borderRadius: 'var(--radius-md)', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--iw-cream)', font: '700 14px var(--font-body)', textAlign: 'left', width: '100%' }}
    >
      <Icon name={icon} size={18} /> {label}
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
