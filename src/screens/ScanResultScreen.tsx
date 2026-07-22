/**
 * Resultado del escaneo. Muestra la referencia reconocida y ofrece las
 * acciones. El diseño destaca Venta y Devolución; añadimos Compra
 * (reabastecer) para que el circuito de inventario quede completo, ya que un
 * POS real necesita registrar entradas de stock.
 */

import { Navigate, useNavigate } from 'react-router-dom'
import { useScanFlow } from '@/app/scanFlow'
import { BackLink, FlowColumn } from './_shared'
import { Icon } from '@/ui/Icon'
import { formatMoney } from '@/lib/format'
import { variantStatus } from '@/domain/rules'

export function ScanResultScreen() {
  const { scanned } = useScanFlow()
  const navigate = useNavigate()

  if (!scanned) return <Navigate to="/scan" replace />
  const { product, variant } = scanned

  const status = variantStatus(variant.stock, variant.minStock)
  const stockColor =
    status === 'out' ? 'var(--color-danger)' : status === 'low' ? 'var(--color-warning)' : 'var(--text-primary)'

  const goSell = (mode: 'sale' | 'return') => navigate('/scan/sell', { state: { mode } })

  return (
    <FlowColumn>
      <BackLink label="Escanear otro" onClick={() => navigate('/scan')} />

      <div
        style={{
          background: 'var(--surface-card)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-xl)',
          boxShadow: 'var(--shadow-md)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'flex',
            gap: 6,
            alignItems: 'center',
            background: 'var(--iw-off-white)',
            padding: '10px 18px',
            borderBottom: '1px solid var(--border-subtle)',
          }}
        >
          <Icon name="check" size={16} color="var(--color-success)" strokeWidth={2.4} />
          <span style={{ font: '700 12px var(--font-body)', color: 'var(--color-success)', letterSpacing: '.03em' }}>
            Producto reconocido
          </span>
          <span style={{ marginLeft: 'auto', font: '600 12px ui-monospace,monospace', color: 'var(--text-muted)' }}>
            {variant.barcode}
          </span>
        </div>

        <div style={{ padding: '22px 20px', display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
            <div
              style={{
                width: 74,
                height: 74,
                flex: 'none',
                borderRadius: 'var(--radius-lg)',
                background: 'linear-gradient(135deg,var(--iw-cream),var(--iw-sand))',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon name="shoe" size={38} color="var(--iw-plum)" strokeWidth={1.6} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <span
                style={{
                  font: '600 11px var(--font-body)',
                  color: 'var(--iw-orange)',
                  textTransform: 'uppercase',
                  letterSpacing: '.06em',
                }}
              >
                {product.brand}
              </span>
              <span style={{ font: '700 19px/1.15 var(--font-display)', color: 'var(--text-primary)' }}>
                {product.name}
              </span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span
                  style={{
                    background: 'var(--iw-plum)',
                    color: '#fff',
                    font: '700 13px var(--font-display)',
                    padding: '3px 12px',
                    borderRadius: 'var(--radius-pill)',
                  }}
                >
                  Talla {variant.size}
                </span>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 12 }}>
            <Stat label="Precio" value={formatMoney(product.price)} />
            <Stat label={`Stock talla ${variant.size}`} value={`${variant.stock} pares`} color={stockColor} />
          </div>
        </div>
      </div>

      {/* Acciones principales (como el diseño) */}
      <div style={{ display: 'flex', gap: 12 }}>
        <ActionCard
          onClick={() => goSell('return')}
          bg="var(--iw-plum)"
          color="#fff"
          shadow="var(--shadow-md)"
          icon="return"
          title="Devolución"
          subtitle="Entra stock"
        />
        <ActionCard
          onClick={() => goSell('sale')}
          bg="var(--iw-yellow)"
          color="#17171a"
          shadow="var(--shadow-accent)"
          icon="arrow-up"
          title="Venta"
          subtitle="Sale stock"
        />
      </div>

      {/* Compra / reabastecer */}
      <button
        onClick={() => navigate('/scan/buy')}
        className="iw-press"
        style={{
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          background: 'var(--surface-card)',
          border: '1.5px solid var(--border-strong)',
          borderRadius: 'var(--radius-lg)',
          padding: '14px',
          font: '700 14px var(--font-display)',
          color: 'var(--iw-plum)',
        }}
      >
        <Icon name="box" size={18} /> Registrar compra (reabastecer)
      </button>
    </FlowColumn>
  )
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ flex: 1, background: 'var(--iw-off-white)', borderRadius: 'var(--radius-md)', padding: '12px 14px' }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>{label}</div>
      <div style={{ font: '700 20px var(--font-display)', color: color ?? 'var(--text-primary)' }}>{value}</div>
    </div>
  )
}

function ActionCard({
  onClick,
  bg,
  color,
  shadow,
  icon,
  title,
  subtitle,
}: {
  onClick: () => void
  bg: string
  color: string
  shadow: string
  icon: 'return' | 'arrow-up'
  title: string
  subtitle: string
}) {
  return (
    <button
      onClick={onClick}
      className="iw-press"
      style={{
        cursor: 'pointer',
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 8,
        background: bg,
        color,
        border: 'none',
        padding: 20,
        borderRadius: 'var(--radius-lg)',
        boxShadow: shadow,
      }}
    >
      <Icon name={icon} size={30} />
      <span style={{ font: '700 18px var(--font-display)' }}>{title}</span>
      <span style={{ fontSize: 12, opacity: 0.8 }}>{subtitle}</span>
    </button>
  )
}
