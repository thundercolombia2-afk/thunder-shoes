/**
 * Selección de local. Puerta de entrada: sin local elegido no se opera.
 * Reproduce la pantalla "¿En qué local estás?" del diseño.
 *
 * Dos formatos según el ancho: en celular, una columna centrada; en web, un
 * layout partido (panel de marca a la izquierda, contenido a la derecha) que
 * aprovecha la pantalla en vez de dejar una tira angosta en el centro.
 */

import { useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useSession } from '@/app/session'
import { useStores } from '@/app/hooks'
import { useIsMobile } from '@/app/useMediaQuery'
import { authService } from '@/data/authService'
import { Icon } from '@/ui/Icon'
import type { Store } from '@/domain/models'

/** Paleta de las tarjetas, alternando como en el diseño (163 oscuro, 173 amarillo). */
const CARD_THEMES = [
  { c1: '#1f1f24', c2: '#0c0c0e', numColor: '#fff' },
  { c1: '#ffd100', c2: '#e6b800', numColor: '#17171a' },
] as const

export function StoreSelectScreen() {
  const { data: stores, loading, error } = useStores()
  const { selectStore, user, logout, refreshProfile } = useSession()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const wantsChange = params.has('cambiar')
  const isMobile = useIsMobile()

  // El bodeguero no opera en un local: entra directo. Y quien ya está amarrado a
  // un local se salta la selección — salvo que venga a CAMBIAR de local
  // (?cambiar=1), en cuyo caso mostramos el selector.
  useEffect(() => {
    if (!user) return
    if (user.role === 'bodeguero') {
      navigate('/scan')
      return
    }
    if (wantsChange) return
    if (user.storeId && stores.length) {
      const mine = stores.find((s) => s.id === user.storeId)
      if (mine) {
        selectStore(mine)
        navigate('/scan')
      }
    }
  }, [user, stores, selectStore, navigate, wantsChange])

  const enter = async (store: Store) => {
    // Solo la dueña fija/cambia su local aquí (los demás lo heredan de su clave
    // y no lo eligen). Se persiste en su perfil.
    if (user?.owner) {
      await authService.bindStore(store.id).catch(() => undefined)
      await refreshProfile().catch(() => undefined)
    }
    selectStore(store)
    navigate('/scan')
  }

  const greeting = (
    <div style={{ textAlign: isMobile ? 'center' : 'left', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <h1 style={{ margin: 0, font: `700 ${isMobile ? 32 : 38}px var(--font-display)`, color: '#fff', letterSpacing: '-.01em' }}>
        {user ? `Hola, ${user.name.split(' ')[0]}` : '¿En qué local estás?'}
      </h1>
      <p style={{ margin: 0, color: 'var(--iw-cream)', opacity: 0.7, fontSize: 15.5 }}>
        Toca tu local para empezar a escanear.
      </p>
    </div>
  )

  const storesBlock = loading ? (
    <p style={{ color: 'var(--iw-cream)', opacity: 0.7 }}>Cargando locales…</p>
  ) : error ? (
    <ErrorNote error={error} />
  ) : stores.length === 0 ? (
    <EmptyStoresNote />
  ) : (
    <div
      style={{
        display: 'flex',
        gap: 20,
        flexWrap: 'wrap',
        justifyContent: isMobile ? 'center' : 'flex-start',
        width: '100%',
      }}
    >
      {stores.map((store, i) => {
        const theme = CARD_THEMES[i % CARD_THEMES.length]!
        return (
          <button
            key={store.id}
            onClick={() => void enter(store)}
            className="iw-press"
            style={{
              cursor: 'pointer',
              width: isMobile ? 260 : 240,
              boxSizing: 'border-box',
              background: 'var(--surface-card)',
              border: 'none',
              borderRadius: 'var(--radius-2xl)',
              padding: '34px 28px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 16,
              boxShadow: 'var(--shadow-lg)',
            }}
          >
            <div
              style={{
                width: 88,
                height: 88,
                borderRadius: 'var(--radius-xl)',
                background: `linear-gradient(135deg,${theme.c1},${theme.c2})`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: theme.numColor,
                font: '700 34px var(--font-display)',
                boxShadow: 'var(--shadow-md)',
              }}
            >
              {store.code}
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ font: '700 22px var(--font-display)', color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
                Local {store.code}
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{store.name}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--iw-orange)', font: '700 13px var(--font-body)' }}>
              Entrar <Icon name="arrow-right" size={16} strokeWidth={2.4} />
            </div>
          </button>
        )
      })}
    </div>
  )

  const logoutButton = user ? (
    <button
      onClick={() => void logout()}
      className="iw-press"
      style={{ cursor: 'pointer', background: 'transparent', border: 'none', display: 'flex', alignItems: 'center', gap: 5, color: 'var(--iw-cream)', opacity: 0.75, font: '700 12px var(--font-body)' }}
    >
      <Icon name="return" size={14} /> Salir
    </button>
  ) : null

  const bodegaNote = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--iw-cream)', opacity: 0.5, fontSize: 12 }}>
      <Icon name="lock" size={14} />
      Bodega central única · stock compartido entre los locales
    </div>
  )

  // ── Celular: una columna centrada ──────────────────────────────────────────
  if (isMobile) {
    return (
      <div style={{ minHeight: '100%', background: 'var(--iw-plum-dark)', display: 'flex', overflowY: 'auto' }}>
        <div
          className="iw-fade"
          style={{ maxWidth: 760, width: '100%', margin: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 28, padding: '40px 20px' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', maxWidth: 560 }}>
            <Icon name="bolt" size={26} color="var(--iw-yellow)" />
            <span style={{ font: '700 22px var(--font-display)', letterSpacing: '.14em', color: '#fff' }}>THUNDER</span>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--iw-cream)', opacity: 0.5 }}>· POS Zapatillas</span>
            {logoutButton ? <div style={{ marginLeft: 'auto' }}>{logoutButton}</div> : null}
          </div>
          {greeting}
          {storesBlock}
          {bodegaNote}
        </div>
      </div>
    )
  }

  // ── Web: layout partido (marca a la izquierda, contenido a la derecha) ──────
  return (
    <div style={{ height: '100%', display: 'flex', overflow: 'hidden', background: 'var(--iw-plum-dark)' }}>
      <aside
        className="iw-fade"
        style={{
          flex: '0 0 42%',
          maxWidth: 520,
          background: 'linear-gradient(160deg,var(--iw-plum),var(--iw-plum-darkest))',
          padding: '56px 52px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, position: 'relative', zIndex: 1 }}>
          <div style={{ width: 44, height: 44, borderRadius: 13, background: 'var(--iw-yellow)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="bolt" size={26} color="var(--iw-plum)" />
          </div>
          <div>
            <div style={{ font: '700 22px var(--font-display)', letterSpacing: '.14em', color: '#fff' }}>THUNDER</div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--iw-cream)', opacity: 0.55 }}>POS Zapatillas</div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, position: 'relative', zIndex: 1 }}>
          <h2 style={{ margin: 0, font: '700 34px var(--font-display)', color: '#fff', lineHeight: 1.15, letterSpacing: '-.01em' }}>
            Tu punto de venta, siempre a la mano.
          </h2>
          <p style={{ margin: 0, color: 'var(--iw-cream)', opacity: 0.72, fontSize: 15.5, lineHeight: 1.5, maxWidth: 340 }}>
            Escanea, cobra, controla el inventario, mueve mercancía de bodega y cuadra el día desde cualquier equipo.
          </p>
        </div>

        <div style={{ position: 'relative', zIndex: 1 }}>{bodegaNote}</div>

        {/* Rayo de marca al fondo, decorativo. */}
        <div style={{ position: 'absolute', right: -60, bottom: -50, opacity: 0.06, pointerEvents: 'none' }}>
          <Icon name="bolt" size={360} color="var(--iw-yellow)" />
        </div>
      </aside>

      <main style={{ flex: 1, minWidth: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
        {logoutButton ? (
          <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '22px 32px 0' }}>{logoutButton}</div>
        ) : null}
        <div
          className="iw-fade"
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            gap: 32,
            padding: '32px clamp(36px,6vw,96px) 56px',
            maxWidth: 860,
            width: '100%',
          }}
        >
          {greeting}
          {storesBlock}
        </div>
      </main>
    </div>
  )
}

/**
 * Muestra el motivo REAL del fallo además de la pista. Sin esto, un error de
 * permisos y uno de índice se ven igual y hay que adivinar.
 */
function ErrorNote({ error }: { error: unknown }) {
  const raw = error instanceof Error ? error.message : String(error)
  const code = (error as { code?: string })?.code ?? ''

  let hint = 'Revisa que .env tenga las credenciales del proyecto y vuelve a compilar.'
  if (code === 'permission-denied' || /insufficient permissions/i.test(raw)) {
    hint = 'Faltan las reglas de seguridad: corre "firebase deploy --only firestore:rules".'
  } else if (/requires an index/i.test(raw)) {
    hint = 'Falta un índice: corre "firebase deploy --only firestore:indexes" y espera unos minutos.'
  } else if (code === 'unavailable' || /offline|network/i.test(raw)) {
    hint = 'Sin conexión con Firestore. Revisa tu internet.'
  }

  return (
    <div
      style={{
        background: 'rgba(224,52,29,.14)',
        border: '1px solid rgba(224,52,29,.4)',
        borderRadius: 'var(--radius-lg)',
        padding: '16px 20px',
        color: 'var(--iw-cream)',
        maxWidth: 520,
        fontSize: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <b>No se pudo leer los locales.</b>
      <span style={{ opacity: 0.85 }}>{hint}</span>
      <code style={{ fontSize: 11.5, opacity: 0.6, wordBreak: 'break-word' }}>{raw}</code>
    </div>
  )
}

function EmptyStoresNote() {
  return (
    <div
      style={{
        background: 'rgba(255,255,255,.06)',
        border: '1px solid rgba(255,255,255,.14)',
        borderRadius: 'var(--radius-lg)',
        padding: '18px 22px',
        color: 'var(--iw-cream)',
        maxWidth: 460,
        textAlign: 'center',
        fontSize: 14,
        lineHeight: 1.5,
      }}
    >
      Todavía no hay locales. Ejecuta <b>npm run seed</b> para crear los locales y el catálogo
      inicial en tu Firestore.
    </div>
  )
}
