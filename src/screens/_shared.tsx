/** Piezas compartidas entre las pantallas del flujo de escaneo e inventario. */

import type { ReactNode } from 'react'
import { Icon } from '@/ui/Icon'
import type { VariantWithProduct } from '@/domain/models'
import { variantStatus, type StockStatus } from '@/domain/rules'

/** Enlace de "volver" con chevron, como en el diseño. */
export function BackLink({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        cursor: 'pointer',
        background: 'transparent',
        border: 'none',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        color: 'var(--text-muted)',
        fontSize: 14,
        fontWeight: 600,
        padding: 0,
        alignSelf: 'flex-start',
      }}
    >
      <Icon name="chevron-left" size={18} strokeWidth={2.2} /> {label}
    </button>
  )
}

/** Contenedor centrado de las pantallas de formulario del flujo. */
export function FlowColumn({ children, maxWidth = 520 }: { children: ReactNode; maxWidth?: number }) {
  return (
    <div
      className="iw-fade"
      style={{
        padding: '18px 20px 26px',
        display: 'flex',
        flexDirection: 'column',
        gap: 18,
        maxWidth,
        margin: '0 auto',
        width: '100%',
        boxSizing: 'border-box',
      }}
    >
      {children}
    </div>
  )
}

/** Resumen compacto del producto escaneado (encabezado de compra/venta). */
export function ScannedSummary({ scanned, extra }: { scanned: VariantWithProduct; extra?: string }) {
  const { product, variant } = scanned
  return (
    <div
      style={{
        background: 'var(--surface-card)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-lg)',
        padding: '14px 16px',
        display: 'flex',
        gap: 12,
        alignItems: 'center',
        boxShadow: 'var(--shadow-sm)',
      }}
    >
      <div style={{ flex: 1 }}>
        <div style={{ font: '700 15px var(--font-display)' }}>{product.name}</div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          Talla {variant.size} · {extra ?? `Stock actual ${variant.stock}`}
        </div>
      </div>
      <span style={{ font: '600 12px ui-monospace,monospace', color: 'var(--text-muted)' }}>{variant.barcode}</span>
    </div>
  )
}

/** Selector de cantidad (– N +). El color del "+" lo define quien lo usa. */
export function QuantityStepper({
  value,
  onDec,
  onInc,
  plusColor = 'var(--iw-plum)',
}: {
  value: number
  onDec: () => void
  onInc: () => void
  plusColor?: string
}) {
  const box: React.CSSProperties = {
    cursor: 'pointer',
    width: 52,
    height: 52,
    borderRadius: 'var(--radius-md)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    font: '700 24px var(--font-display)',
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <label style={{ font: '700 13px var(--font-body)', color: 'var(--text-secondary)' }}>Cantidad</label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <button
          onClick={onDec}
          className="iw-press"
          style={{ ...box, background: 'var(--surface-card)', border: '1.5px solid var(--border-subtle)', color: 'var(--iw-plum)' }}
        >
          –
        </button>
        <div style={{ flex: 1, textAlign: 'center', font: '700 34px var(--font-display)', color: 'var(--text-primary)' }}>
          {value}
        </div>
        <button
          onClick={onInc}
          className="iw-press"
          style={{ ...box, background: plusColor, border: 'none', color: '#fff' }}
        >
          +
        </button>
      </div>
    </div>
  )
}

/**
 * Distintivo del rol. Reemplaza el antiguo botón de PIN: los costos ya no se
 * "desbloquean", se ven (o no) según el rol de quien inició sesión.
 */
export function RoleBadge({ role }: { role: 'socio' | 'empleado' }) {
  const socio = role === 'socio'
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        background: socio ? 'rgba(21,119,79,.12)' : 'var(--surface-sunken)',
        color: socio ? 'var(--color-success)' : 'var(--text-secondary)',
        border: `1.5px solid ${socio ? 'rgba(21,119,79,.4)' : 'var(--border-subtle)'}`,
        borderRadius: 'var(--radius-pill)',
        padding: '7px 13px',
        font: '700 12px var(--font-body)',
      }}
    >
      <Icon name={socio ? 'unlock' : 'lock'} size={15} strokeWidth={2.2} />
      {socio ? 'Socio · ve costos' : 'Empleado'}
    </span>
  )
}

/** Colores del semáforo de stock, alineados con el diseño. */
export function statusStyles(status: StockStatus): { label: string; bg: string; color: string } {
  switch (status) {
    case 'out':
      return { label: 'Agotado', bg: 'rgba(224,52,29,.12)', color: 'var(--color-danger)' }
    case 'low':
      return { label: 'Stock bajo', bg: 'rgba(199,146,0,.15)', color: 'var(--iw-amber)' }
    case 'ok':
      return { label: 'Disponible', bg: 'rgba(21,119,79,.12)', color: 'var(--color-success)' }
  }
}

export function cellColor(stock: number, minStock: number): string {
  const s = variantStatus(stock, minStock)
  return s === 'out' ? 'var(--color-danger)' : s === 'low' ? 'var(--iw-amber)' : 'var(--text-primary)'
}
