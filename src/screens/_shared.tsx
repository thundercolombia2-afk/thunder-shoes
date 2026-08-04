/** Piezas compartidas entre las pantallas del flujo de escaneo e inventario. */

import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSession } from '@/app/session'
import { Icon } from '@/ui/Icon'
import type { Bodega, Movement, SaleStatus, Store, VariantWithProduct } from '@/domain/models'
import { ROLE_LABEL, type Role } from '@/domain/users'
import {
  movementBodegaId,
  movementStoreId,
  SALE_STATUS_LABEL,
  variantStatus,
  type StockStatus,
} from '@/domain/rules'

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
export function RoleBadge({ role }: { role: Role }) {
  // Socio y bodeguero ven costos; el empleado no.
  const seesCosts = role !== 'empleado'
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        background: seesCosts ? 'rgba(21,119,79,.12)' : 'var(--surface-sunken)',
        color: seesCosts ? 'var(--color-success)' : 'var(--text-secondary)',
        border: `1.5px solid ${seesCosts ? 'rgba(21,119,79,.4)' : 'var(--border-subtle)'}`,
        borderRadius: 'var(--radius-pill)',
        padding: '7px 13px',
        font: '700 12px var(--font-body)',
      }}
    >
      <Icon name={seesCosts ? 'unlock' : 'lock'} size={15} strokeWidth={2.2} />
      {ROLE_LABEL[role]}
      {seesCosts ? ' · ve costos' : ''}
    </span>
  )
}

/**
 * Pestañas de la sección Inventario. Son enlaces de verdad (cambian la ruta),
 * no estado local: así "Agregar referencia" se puede compartir y el botón de
 * atrás del navegador hace lo que uno espera.
 */
export function InventoryTabs({ active }: { active: 'list' | 'add' | 'new' }) {
  const navigate = useNavigate()
  const tab = (on: boolean): React.CSSProperties => ({
    padding: '11px 18px',
    borderRadius: 'var(--radius-lg)',
    font: '700 14px var(--font-body)',
    cursor: 'pointer',
    border: `1px solid ${on ? 'var(--iw-plum)' : 'var(--border-subtle)'}`,
    background: on ? 'var(--iw-plum)' : 'var(--surface-card)',
    color: on ? '#fff' : 'var(--text-secondary)',
    whiteSpace: 'nowrap',
  })

  return (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
      <button onClick={() => navigate('/inventory/new')} style={tab(active === 'new')} className="iw-press">
        Crear referencia
      </button>
      <button onClick={() => navigate('/inventory/add')} style={tab(active === 'add')} className="iw-press">
        Agregar producto
      </button>
      <button onClick={() => navigate('/inventory')} style={tab(active === 'list')} className="iw-press">
        Productos
      </button>
    </div>
  )
}

/**
 * Marco común de las tres vistas de Inventario (Productos, Agregar producto y
 * Crear referencia). Todas comparten el MISMO encabezado —título "Inventario",
 * distintivo de rol y las pestañas— y el mismo contenedor, para que cambiar de
 * pestaña no cambie el formato de la página. `action` es un botón opcional a la
 * derecha del título (p. ej. "Nueva" en la lista).
 */
export function InventoryLayout({
  active,
  action,
  children,
}: {
  active: 'list' | 'add' | 'new'
  action?: ReactNode
  children: ReactNode
}) {
  const { user } = useSession()
  return (
    <div
      className="iw-fade"
      style={{ padding: '18px 20px 28px', display: 'flex', flexDirection: 'column', gap: 16, width: '100%', boxSizing: 'border-box' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, font: '700 24px var(--font-display)', flex: 1 }}>Inventario</h1>
        {user ? <RoleBadge role={user.role} /> : null}
        {action}
      </div>
      <InventoryTabs active={active} />
      {children}
    </div>
  )
}

// ── Dónde y con quién ocurrió un movimiento ──────────────────────────────────

/**
 * Ubicaciones y persona de un movimiento, ya resueltas a nombres legibles.
 * Vive aquí y no en una pantalla porque lo consultan tres: el historial, los
 * locales y la hoja de ingresos.
 */
export interface MovementPlace {
  /** Local involucrado: "163". Vacío si el movimiento no toca ningún local. */
  store: string
  /** Bodega involucrada: "Bodega 1". Vacía si no toca ninguna. */
  bodega: string
  /** Persona que recibió (salida) o de la que volvió (retorno) el par. */
  person: string
}

/** Código visible de un local ("163") a partir de su id. */
export const storeCodeOf = (stores: Store[], storeId: string): string =>
  stores.find((s) => s.id === storeId)?.code ?? storeId

export function movementPlace(m: Movement, stores: Store[], bodegas: Bodega[]): MovementPlace {
  const storeId = movementStoreId(m)
  const bodegaId = movementBodegaId(m)
  return {
    store: storeId ? storeCodeOf(stores, storeId) : '',
    bodega: bodegaId ? (bodegas.find((b) => b.id === bodegaId)?.code ?? 'Bodega') : '',
    person: m.targetUserName ?? '',
  }
}

// ── Piezas de diálogo y selección ────────────────────────────────────────────

/** Encabezado de un modal: título a la izquierda y la ✕ de cerrar a la derecha. */
export function ModalHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
      <h2 style={{ margin: 0, font: '700 21px var(--font-display)' }}>{title}</h2>
      <button
        onClick={onClose}
        aria-label="Cerrar"
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 22, lineHeight: 1 }}
      >
        ✕
      </button>
    </div>
  )
}

/**
 * Fila de botones-pastilla para elegir UNO de varios (una bodega, un local).
 * Es el patrón que se repetía en cada pantalla que ofrece ubicaciones.
 */
export function ChipPicker<T extends { id: string }>({
  items,
  selectedId,
  onSelect,
  label,
  size = 'md',
}: {
  items: T[]
  selectedId: string
  onSelect: (id: string) => void
  label: (item: T) => string
  size?: 'md' | 'lg'
}) {
  return (
    <div style={{ display: 'flex', gap: size === 'lg' ? 10 : 8, flexWrap: 'wrap' }}>
      {items.map((item) => {
        const on = item.id === selectedId
        return (
          <button
            key={item.id}
            onClick={() => onSelect(item.id)}
            className="iw-press"
            style={{
              padding: size === 'lg' ? '11px 18px' : '9px 15px',
              borderRadius: 'var(--radius-lg)',
              border: `1.5px solid ${on ? 'var(--iw-plum)' : 'var(--border-subtle)'}`,
              background: on ? 'var(--iw-plum)' : 'var(--surface-card)',
              color: on ? '#fff' : 'var(--text-secondary)',
              font: `700 ${size === 'lg' ? 14 : 13.5}px var(--font-body)`,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {label(item)}
          </button>
        )
      })}
    </div>
  )
}

// ── Estado de cobro ──────────────────────────────────────────────────────────

/** Colores del estado de cobro. Una sola fuente para todas las pantallas. */
export const SALE_STATUS_TONE: Record<SaleStatus, { border: string; text: string; chip: string }> = {
  cobrado: { border: 'rgba(21,119,79,.3)', text: 'var(--color-success)', chip: 'rgba(21,119,79,.12)' },
  pendiente: { border: 'rgba(255,209,0,.55)', text: '#8a6d00', chip: 'rgba(255,209,0,.22)' },
  devuelto: { border: 'rgba(224,52,29,.3)', text: 'var(--color-danger)', chip: 'rgba(224,52,29,.1)' },
}

/** Distintivo "Cobrado / Pendiente / Devuelto" de una línea de venta. */
export function SaleStatusChip({ status, size = 'md' }: { status: SaleStatus; size?: 'sm' | 'md' }) {
  const tone = SALE_STATUS_TONE[status]
  return (
    <span
      style={{
        display: 'inline-block',
        font: `700 ${size === 'sm' ? 10 : 10.5}px var(--font-body)`,
        padding: size === 'sm' ? '2px 7px' : '3px 9px',
        borderRadius: 'var(--radius-pill)',
        background: tone.chip,
        color: tone.text,
        whiteSpace: 'nowrap',
      }}
    >
      {SALE_STATUS_LABEL[status]}
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
