/**
 * Confirmación del movimiento registrado. Vuelve sola al escaneo tras unos
 * segundos, como el diseño, para que la caja quede lista para el siguiente.
 */

import { useEffect } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useScanFlow } from '@/app/scanFlow'
import { MOVEMENT_LABEL } from '@/domain/rules'
import { Icon } from '@/ui/Icon'

export function ConfirmScreen() {
  const { lastRecorded } = useScanFlow()
  const navigate = useNavigate()

  useEffect(() => {
    const t = setTimeout(() => navigate('/scan'), 2300)
    return () => clearTimeout(t)
  }, [navigate])

  if (!lastRecorded) return <Navigate to="/scan" replace />
  const m = lastRecorded

  const isReturn = m.type === 'return'
  const accent = isReturn ? 'var(--iw-plum)' : 'var(--color-success)'
  const title =
    m.type === 'sale' ? '¡Venta registrada!' : m.type === 'purchase' ? '¡Compra registrada!' : '¡Devolución registrada!'

  return (
    <div
      style={{
        padding: '40px 24px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 20,
        textAlign: 'center',
        maxWidth: 460,
        margin: '0 auto',
      }}
    >
      <div
        style={{
          width: 96,
          height: 96,
          borderRadius: '50%',
          background: accent,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: 'var(--shadow-md)',
          animation: 'iwpop .4s var(--ease-spring)',
        }}
      >
        <Icon name="check" size={52} color="#fff" strokeWidth={2.6} />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <h1 style={{ margin: 0, font: '700 26px var(--font-display)', color: 'var(--text-primary)' }}>{title}</h1>
        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 15 }}>
          {m.quantity} × {m.snapshot.productName} · {MOVEMENT_LABEL[m.type]} en {m.userName}
        </p>
      </div>

      <div
        style={{
          width: '100%',
          background: 'var(--surface-card)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-sm)',
          overflow: 'hidden',
        }}
      >
        <Row label="Producto" value={m.snapshot.productName} />
        <Row label="Talla · Cantidad" value={`${m.snapshot.size} · ${m.quantity}`} />
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            padding: '16px 18px',
            background: 'var(--iw-off-white)',
          }}
        >
          <span style={{ color: 'var(--text-secondary)', fontWeight: 700 }}>Nuevo stock</span>
          <span style={{ font: '700 22px var(--font-display)', color: accent }}>{m.stockAfter} pares</span>
        </div>
      </div>

      <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Volviendo al escaneo…</span>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        padding: '14px 18px',
        borderBottom: '1px solid var(--border-subtle)',
      }}
    >
      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ fontWeight: 700 }}>{value}</span>
    </div>
  )
}
