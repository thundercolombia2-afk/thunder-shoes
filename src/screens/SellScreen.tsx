/**
 * Registrar venta o devolución. Una sola pantalla con dos modos, como el
 * diseño: venta saca stock, devolución lo devuelve y exige una razón.
 * El modo llega por el estado de navegación desde el resultado del escaneo.
 */

import { useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useSession } from '@/app/session'
import { useScanFlow } from '@/app/scanFlow'
import { movementRepository } from '@/data/repositories/movementRepository'
import { RETURN_REASONS, type ReturnReason } from '@/domain/models'
import { errorMessage } from '@/domain/rules'
import { formatMoney } from '@/lib/format'
import { BackLink, FlowColumn, QuantityStepper, ScannedSummary } from './_shared'
import { Icon } from '@/ui/Icon'

type Mode = 'sale' | 'return'

export function SellScreen() {
  const { scanned, setScanned, setLastRecorded } = useScanFlow()
  const { actor } = useSession()
  const navigate = useNavigate()
  const location = useLocation()
  const mode: Mode = (location.state as { mode?: Mode } | null)?.mode === 'return' ? 'return' : 'sale'

  const [qty, setQty] = useState(1)
  const [reason, setReason] = useState<ReturnReason>(RETURN_REASONS[0])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  if (!scanned || !actor) return <Navigate to="/scan" replace />
  const { product, variant } = scanned

  const isReturn = mode === 'return'
  const total = product.price * qty
  const newStock = isReturn ? variant.stock + qty : Math.max(0, variant.stock - qty)
  const overStock = !isReturn && qty > variant.stock

  const tag = isReturn ? { bg: 'var(--iw-plum)', text: '#fff', label: 'DEVOLUCIÓN' } : { bg: 'var(--iw-yellow)', text: '#17171a', label: 'VENTA' }
  const stockColor = isReturn
    ? 'var(--color-success)'
    : newStock <= variant.minStock
      ? 'var(--iw-amber)'
      : 'var(--text-primary)'

  const confirm = async () => {
    setSaving(true)
    setError('')
    try {
      const { movement } = await movementRepository.record(
        {
          type: isReturn ? 'return' : 'sale',
          variantId: variant.id,
          quantity: qty,
          ...(isReturn ? { returnReason: reason } : {}),
        },
        actor,
      )
      setLastRecorded(movement)
      setScanned(null)
      navigate('/scan/confirm')
    } catch (e) {
      setError(errorMessage(e))
      setSaving(false)
    }
  }

  return (
    <FlowColumn>
      <BackLink label="Volver" onClick={() => navigate('/scan/result')} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span
          style={{
            background: tag.bg,
            color: tag.text,
            font: '700 12px var(--font-display)',
            padding: '5px 14px',
            borderRadius: 'var(--radius-pill)',
          }}
        >
          {tag.label}
        </span>
        <h1 style={{ margin: 0, font: '700 22px var(--font-display)' }}>
          {isReturn ? 'Registrar devolución' : 'Registrar venta'}
        </h1>
      </div>

      <ScannedSummary scanned={scanned} extra={`${formatMoney(product.price)} · Stock ${variant.stock}`} />

      <QuantityStepper
        value={qty}
        onDec={() => setQty((q) => Math.max(1, q - 1))}
        onInc={() => setQty((q) => q + 1)}
        plusColor={isReturn ? 'var(--iw-plum)' : 'var(--iw-orange)'}
      />

      {isReturn ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label style={{ font: '700 13px var(--font-body)', color: 'var(--text-secondary)' }}>
            Razón de la devolución
          </label>
          <div style={{ position: 'relative' }}>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value as ReturnReason)}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                appearance: 'none',
                WebkitAppearance: 'none',
                cursor: 'pointer',
                background: 'var(--surface-card)',
                border: '1.5px solid var(--iw-plum)',
                borderRadius: 'var(--radius-md)',
                padding: '14px 44px 14px 16px',
                font: '600 15px var(--font-body)',
                color: 'var(--text-primary)',
                outline: 'none',
              }}
            >
              {RETURN_REASONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <span style={{ position: 'absolute', right: 16, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
              <Icon name="chevron-down" size={18} color="var(--iw-plum)" strokeWidth={2.4} />
            </span>
          </div>
        </div>
      ) : null}

      <div
        style={{
          background: 'var(--iw-off-white)',
          borderRadius: 'var(--radius-md)',
          padding: '14px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontWeight: 700, color: 'var(--text-secondary)' }}>Total</span>
          <span style={{ font: '700 20px var(--font-display)', color: 'var(--text-primary)' }}>{formatMoney(total)}</span>
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            borderTop: '1px solid var(--border-subtle)',
            paddingTop: 8,
          }}
        >
          <span style={{ fontWeight: 700, color: 'var(--text-secondary)' }}>Nuevo stock talla {variant.size}</span>
          <span style={{ font: '700 20px var(--font-display)', color: stockColor }}>{newStock} pares</span>
        </div>
      </div>

      {overStock ? <ErrorBanner text={`Stock insuficiente: quedan ${variant.stock} pares.`} /> : null}
      {error ? <ErrorBanner text={error} /> : null}

      <button
        onClick={confirm}
        disabled={saving || overStock}
        className="iw-press"
        style={{
          cursor: saving || overStock ? 'not-allowed' : 'pointer',
          textAlign: 'center',
          background: tag.bg,
          color: tag.text,
          border: 'none',
          font: '600 17px var(--font-display)',
          padding: 16,
          borderRadius: 'var(--radius-pill)',
          boxShadow: 'var(--shadow-md)',
          opacity: saving || overStock ? 0.55 : 1,
        }}
      >
        {saving ? 'Guardando…' : isReturn ? 'Confirmar devolución' : 'Confirmar venta'}
      </button>
    </FlowColumn>
  )
}

function ErrorBanner({ text }: { text: string }) {
  return (
    <div
      style={{
        background: 'rgba(224,52,29,.1)',
        border: '1px solid rgba(224,52,29,.3)',
        borderRadius: 'var(--radius-md)',
        padding: '11px 15px',
        color: 'var(--color-danger)',
        fontSize: 13,
        fontWeight: 700,
      }}
    >
      {text}
    </div>
  )
}
