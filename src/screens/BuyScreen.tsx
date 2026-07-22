/**
 * Registrar compra (entrada de stock). El costo unitario viene precargado del
 * producto y es editable. Al confirmar se escribe un movimiento `purchase`
 * atómico que sube el stock de la variante.
 */

import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useSession } from '@/app/session'
import { useScanFlow } from '@/app/scanFlow'
import { movementRepository } from '@/data/repositories/movementRepository'
import { money } from '@/domain/models'
import { errorMessage } from '@/domain/rules'
import { formatMoney, parseMoneyInput } from '@/lib/format'
import { BackLink, FlowColumn, QuantityStepper, ScannedSummary } from './_shared'
import { Button } from '@/ui/Button'

export function BuyScreen() {
  const { scanned } = useScanFlow()
  const { setScanned, setLastRecorded } = useScanFlow()
  const { actor, can } = useSession()
  const seeCosts = can('seeCosts')
  const navigate = useNavigate()

  const [qty, setQty] = useState(1)
  const [costStr, setCostStr] = useState(() =>
    scanned ? String(scanned.product.cost) : '',
  )
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  if (!scanned || !actor) return <Navigate to="/scan" replace />
  const { product, variant } = scanned

  const unitCost = parseMoneyInput(costStr)
  const newStock = variant.stock + qty

  const confirm = async () => {
    setSaving(true)
    setError('')
    try {
      const { movement } = await movementRepository.record(
        {
          type: 'purchase',
          variantId: variant.id,
          quantity: qty,
          // Un empleado no toca el costo: se usa el costo vigente de la
          // referencia (lo fijó un socio). Solo el socio puede sobreescribirlo.
          ...(seeCosts ? { unitCostOverride: money(unitCost) } : {}),
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
            background: 'var(--iw-plum)',
            color: '#fff',
            font: '700 12px var(--font-display)',
            padding: '5px 14px',
            borderRadius: 'var(--radius-pill)',
          }}
        >
          COMPRA
        </span>
        <h1 style={{ margin: 0, font: '700 22px var(--font-display)' }}>Registrar compra</h1>
      </div>

      <ScannedSummary scanned={scanned} />

      <QuantityStepper value={qty} onDec={() => setQty((q) => Math.max(1, q - 1))} onInc={() => setQty((q) => q + 1)} />

      {seeCosts ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label style={{ font: '700 13px var(--font-body)', color: 'var(--text-secondary)' }}>Costo unitario</label>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              background: 'var(--surface-card)',
              border: '1.5px solid var(--border-subtle)',
              borderRadius: 'var(--radius-md)',
              padding: '14px 16px',
            }}
          >
            <span style={{ font: '700 18px var(--font-display)', color: 'var(--text-muted)' }}>$</span>
            <input
              value={new Intl.NumberFormat('es-CO').format(unitCost)}
              onChange={(e) => setCostStr(e.target.value)}
              inputMode="numeric"
              style={{
                flex: 1,
                border: 'none',
                outline: 'none',
                background: 'transparent',
                font: '700 18px var(--font-display)',
                color: 'var(--text-primary)',
                width: '100%',
              }}
            />
          </div>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Precargado del costo actual · editable</span>
        </div>
      ) : null}

      <div
        style={{
          background: 'var(--iw-off-white)',
          borderRadius: 'var(--radius-md)',
          padding: '14px 16px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <span style={{ fontWeight: 700, color: 'var(--text-secondary)' }}>Nuevo stock talla {variant.size}</span>
        <span style={{ font: '700 20px var(--font-display)', color: 'var(--color-success)' }}>{newStock} pares</span>
      </div>

      {error ? <ErrorBanner text={error} /> : null}

      <Button variant="primary" size="lg" fullWidth onClick={confirm} disabled={saving}>
        {saving ? 'Guardando…' : seeCosts ? `Confirmar compra · ${formatMoney(unitCost * qty)}` : 'Confirmar compra'}
      </Button>

      {seeCosts ? (
        <span style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>
          {product.brand} · Precio de venta {formatMoney(product.price)}
        </span>
      ) : null}
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
