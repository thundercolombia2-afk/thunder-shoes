/**
 * Selección de local. Puerta de entrada: sin local elegido no se opera.
 * Reproduce la pantalla "¿En qué local estás?" del diseño, pero las tarjetas
 * salen de los locales reales de Firestore (colección `stores`).
 */

import { useNavigate } from 'react-router-dom'
import { useSession } from '@/app/session'
import { useStores } from '@/app/hooks'
import { Icon } from '@/ui/Icon'
import type { Store } from '@/domain/models'

/** Paleta de las tarjetas, alternando como en el diseño (163 oscuro, 173 amarillo). */
const CARD_THEMES = [
  { c1: '#1f1f24', c2: '#0c0c0e', numColor: '#fff' },
  { c1: '#ffd100', c2: '#e6b800', numColor: '#17171a' },
] as const

export function StoreSelectScreen() {
  const { data: stores, loading, error } = useStores()
  const { selectStore, user, logout } = useSession()
  const navigate = useNavigate()

  const enter = (store: Store) => {
    selectStore(store)
    navigate('/scan')
  }

  return (
    <div
      style={{
        minHeight: '100%',
        background: 'var(--iw-plum-dark)',
        display: 'flex',
        overflowY: 'auto',
      }}
    >
      <div
        className="iw-fade"
        style={{
          maxWidth: 760,
          width: '100%',
          margin: 'auto',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 28,
          padding: '40px 20px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', maxWidth: 560 }}>
          <Icon name="bolt" size={26} color="var(--iw-yellow)" />
          <span style={{ font: '700 22px var(--font-display)', letterSpacing: '.14em', color: '#fff' }}>
            THUNDER
          </span>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--iw-cream)', opacity: 0.5 }}>
            · POS Zapatillas
          </span>
          {user ? (
            <button
              onClick={() => void logout()}
              className="iw-press"
              style={{ marginLeft: 'auto', cursor: 'pointer', background: 'transparent', border: 'none', display: 'flex', alignItems: 'center', gap: 5, color: 'var(--iw-cream)', opacity: 0.75, font: '700 12px var(--font-body)' }}
            >
              <Icon name="return" size={14} /> Salir
            </button>
          ) : null}
        </div>

        <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <h1 style={{ margin: 0, font: '700 32px var(--font-display)', color: '#fff' }}>
            {user ? `Hola, ${user.name.split(' ')[0]}` : '¿En qué local estás?'}
          </h1>
          <p style={{ margin: 0, color: 'var(--iw-cream)', opacity: 0.7, fontSize: 15 }}>
            Toca tu local para empezar a escanear.
          </p>
        </div>

        {loading ? (
          <p style={{ color: 'var(--iw-cream)', opacity: 0.7 }}>Cargando locales…</p>
        ) : error ? (
          <ErrorNote />
        ) : stores.length === 0 ? (
          <EmptyStoresNote />
        ) : (
          <div
            style={{
              display: 'flex',
              gap: 20,
              flexWrap: 'wrap',
              justifyContent: 'center',
              width: '100%',
              maxWidth: 560,
            }}
          >
            {stores.map((store, i) => {
              const theme = CARD_THEMES[i % CARD_THEMES.length]!
              return (
                <button
                  key={store.id}
                  onClick={() => enter(store)}
                  className="iw-press"
                  style={{
                    cursor: 'pointer',
                    width: 260,
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
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      color: 'var(--iw-orange)',
                      font: '700 13px var(--font-body)',
                    }}
                  >
                    Entrar <Icon name="arrow-right" size={16} strokeWidth={2.4} />
                  </div>
                </button>
              )
            })}
          </div>
        )}

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            color: 'var(--iw-cream)',
            opacity: 0.5,
            fontSize: 12,
          }}
        >
          <Icon name="lock" size={14} />
          Bodega central única · stock compartido entre los locales
        </div>
      </div>
    </div>
  )
}

function ErrorNote() {
  return (
    <div
      style={{
        background: 'rgba(224,52,29,.14)',
        border: '1px solid rgba(224,52,29,.4)',
        borderRadius: 'var(--radius-lg)',
        padding: '16px 20px',
        color: 'var(--iw-cream)',
        maxWidth: 460,
        textAlign: 'center',
        fontSize: 14,
      }}
    >
      No se pudo conectar con Firestore. Revisa que <b>.env</b> tenga las credenciales del proyecto.
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
