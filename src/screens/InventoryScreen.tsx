/**
 * Inventario en vivo. Se suscribe al catálogo (productos + variantes) y lo
 * refresca en tiempo real. El semáforo por talla, el buscador y el modo admin
 * (costos) replican el diseño.
 */

import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCatalog, useStores } from '@/app/hooks'
import { useSession } from '@/app/session'
import { type Bodega, type ProductId, type Size } from '@/domain/models'
import { productStatus, variantStatus } from '@/domain/rules'
import { parseLocationKey, stockAt, storeKey } from '@/domain/locations'
import { bodegaRepository } from '@/data/repositories/bodegaRepository'
import { catalogRepository } from '@/data/repositories/catalogRepository'
import { formatMoney } from '@/lib/format'
import { InventoryLayout, cellColor, statusStyles } from './_shared'
import { Icon } from '@/ui/Icon'
import type { ProductWithVariants } from '@/data/repositories/catalogRepository'

export function InventoryScreen() {
  const { data: catalog, loading, error } = useCatalog()
  const { data: stores } = useStores()
  const { can, store } = useSession()
  const seeCosts = can('seeCosts')
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [bodegas, setBodegas] = useState<Bodega[]>([])
  useEffect(() => bodegaRepository.subscribe(setBodegas), [])

  // Referencia abierta en el modal de detalle (por id). null = ninguna.
  const [openId, setOpenId] = useState<string | null>(null)
  // Quitar de una referencia una talla que no se maneja (solo admin, y solo si
  // está en cero). Lanza el error para que el modal lo muestre.
  const removeSize = (productId: ProductId, size: Size) => catalogRepository.removeVariant(productId, size)

  // Vista del VENDEDOR: quien no ve costos (empleado) y está parado en un local
  // ve el inventario centrado en SU local: lo que puede vender ya. El total y las
  // demás ubicaciones pasan a ser contexto. La dueña/bodeguero (ven costos) ven
  // el total del sistema, que es lo que necesitan para reponer y trasladar.
  const localFirst = !seeCosts && store !== null
  const scopeKey = localFirst && store ? storeKey(store.id) : null

  // Stock relevante de una referencia según el alcance activo (local vs sistema).
  const scopeStockOf = (r: ProductWithVariants): number =>
    scopeKey
      ? r.variants.reduce((sum, v) => sum + stockAt(v.stockByLocation, scopeKey), 0)
      : r.totalStock

  // Traduce una clave de ubicación ("s:163" / "b:abc") a un nombre legible.
  const locName = useMemo(
    () =>
      (key: string): string => {
        const ref = parseLocationKey(key)
        if (!ref) return key
        if (ref.kind === 'store') {
          const s = stores.find((x) => x.id === ref.id)
          return s ? `Local ${s.code}` : `Local ${ref.id}`
        }
        const b = bodegas.find((x) => x.id === ref.id)
        return b ? b.code : 'Bodega'
      },
    [stores, bodegas],
  )

  const term = search.trim().toLowerCase()
  const rows = useMemo(() => {
    const filtered = catalog.filter(
      (r) =>
        !term ||
        r.product.name.toLowerCase().includes(term) ||
        r.product.sku.toLowerCase().includes(term) ||
        r.product.brand.toLowerCase().includes(term),
    )
    // Orden por DISPONIBILIDAD: primero lo que se puede vender aquí, luego lo que
    // hay en otra ubicación (vendible con un traslado) y al fondo lo agotado en
    // todo el sistema. Dentro de cada grupo, alfabético para encontrarlo rápido.
    const rank = (r: ProductWithVariants): number => {
      const here = scopeStockOf(r)
      if (here > 0) return 0
      if (r.totalStock > 0) return 1
      return 2
    }
    return filtered
      .slice()
      .sort((a, b) => rank(a) - rank(b) || a.product.name.localeCompare(b.product.name))
    // scopeStockOf depende de scopeKey; se recalcula al cambiar de local.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog, term, scopeKey])

  // "Stock" que se muestra arriba: el del local activo si es vista de vendedor.
  const scopeStock = useMemo(
    () => catalog.reduce((sum, r) => sum + scopeStockOf(r), 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [catalog, scopeKey],
  )
  const alertCount = useMemo(
    () =>
      catalog.reduce(
        (sum, r) =>
          sum +
          r.variants.filter(
            (v) => (scopeKey ? stockAt(v.stockByLocation, scopeKey) : v.stock) <= v.minStock,
          ).length,
        0,
      ),
    [catalog, scopeKey],
  )

  return (
    <InventoryLayout
      active="list"
      action={
        <button
          onClick={() => navigate('/inventory/new')}
          className="iw-press"
          style={{
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            background: 'var(--iw-plum)',
            color: '#fff',
            border: 'none',
            borderRadius: 'var(--radius-pill)',
            padding: '9px 16px',
            font: '700 13px var(--font-display)',
            boxShadow: 'var(--shadow-accent)',
          }}
        >
          <Icon name="plus" size={16} strokeWidth={2.6} /> Nueva
        </button>
      }
    >
      <SearchBox value={search} onChange={setSearch} placeholder="Buscar referencia o código…" />

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <StatCard label={localFirst ? 'En tu local' : 'Stock total'} value={scopeStock} />
        <StatCard label="Referencias" value={catalog.length} />
        <StatCard label="Stock bajo" value={alertCount} danger />
      </div>

      <div
        style={{
          background: 'var(--surface-card)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-sm)',
          overflow: 'hidden',
        }}
      >
        {error ? (
          <Empty text={`No se pudo cargar el inventario: ${error instanceof Error ? error.message : String(error)}`} />
        ) : loading ? (
          <Empty text="Cargando inventario…" />
        ) : rows.length === 0 ? (
          <Empty text={term ? 'Sin resultados para tu búsqueda.' : 'No hay referencias todavía. Crea una con "Nueva".'} />
        ) : (
          rows.map((r) => (
            <ListRow
              key={r.product.id}
              row={r}
              scopeStock={scopeStockOf(r)}
              onOpen={() => setOpenId(r.product.id)}
            />
          ))
        )}
      </div>

      {openId ? (
        (() => {
          const openRow = catalog.find((r) => r.product.id === openId)
          if (!openRow) return null
          return (
            <ProductModal
              row={openRow}
              admin={seeCosts}
              locName={locName}
              onRemoveSize={removeSize}
              onClose={() => setOpenId(null)}
            />
          )
        })()
      ) : null}
    </InventoryLayout>
  )
}

/** Fila del inventario: solo el nombre (con una pista de estado) y clickable. */
function ListRow({ row, scopeStock, onOpen }: { row: ProductWithVariants; scopeStock: number; onOpen: () => void }) {
  const st = productStatus(scopeStock, row.product.minStock)
  const dot = st === 'out' ? 'var(--color-danger)' : st === 'low' ? 'var(--iw-amber)' : 'var(--color-success)'
  return (
    <button
      onClick={onOpen}
      className="iw-row"
      style={{
        width: '100%',
        textAlign: 'left',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '15px 16px',
        borderBottom: '1px solid var(--border-subtle)',
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
      }}
    >
      <span style={{ width: 9, height: 9, borderRadius: '50%', background: dot, flex: 'none' }} aria-hidden />
      <span style={{ flex: 1, minWidth: 0, font: '700 15px var(--font-display)', color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {row.product.name}
      </span>
      <span aria-hidden style={{ color: 'var(--text-muted)', font: '700 18px var(--font-display)', lineHeight: 1 }}>›</span>
    </button>
  )
}

/** Modal de detalle de una referencia: tallas, ubicaciones (bodegas/locales),
 *  fechas y (para admin) edición de tallas. */
function ProductModal({
  row,
  admin,
  locName,
  onRemoveSize,
  onClose,
}: {
  row: ProductWithVariants
  admin: boolean
  locName: (key: string) => string
  onRemoveSize: (productId: ProductId, size: Size) => Promise<void>
  onClose: () => void
}) {
  const { product, variants, totalStock } = row
  const [editing, setEditing] = useState(false)
  const [notice, setNotice] = useState('')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const remove = async (size: Size) => {
    setNotice('')
    try {
      await onRemoveSize(product.id, size)
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'No se pudo quitar la talla.')
    }
  }

  const status = statusStyles(productStatus(totalStock, product.minStock))

  // Existencias por ubicación (todas: bodegas y locales), de mayor a menor.
  const byLocation = new Map<string, number>()
  for (const v of variants) {
    for (const [key, qty] of Object.entries(v.stockByLocation)) {
      if (qty) byLocation.set(key, (byLocation.get(key) ?? 0) + qty)
    }
  }
  const locEntries = [...byLocation.entries()].filter(([, q]) => q > 0).sort((a, b) => b[1] - a[1])

  const fmtDate = (d: Date) =>
    d.getFullYear() > 1970 ? d.toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(12,12,13,.55)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, padding: 20, overflowY: 'auto' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: 520, maxWidth: '100%', maxHeight: '90vh', overflowY: 'auto', background: 'var(--surface-card)', borderRadius: 'var(--radius-2xl)', boxShadow: 'var(--shadow-lg)', padding: '22px 24px 24px', boxSizing: 'border-box' }}
      >
        {/* Encabezado */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ font: '700 20px var(--font-display)' }}>{product.name}</div>
            <div style={{ font: '600 12px ui-monospace,monospace', color: 'var(--text-muted)', marginTop: 3 }}>
              {product.sku} · {formatMoney(product.price)}
              {admin ? <span style={{ color: 'var(--iw-orange)' }}> · costo {formatMoney(product.cost)}</span> : null}
            </div>
          </div>
          <button onClick={onClose} aria-label="Cerrar" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 22, lineHeight: 1 }}>
            ✕
          </button>
        </div>

        {/* Estado + stock total */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 14 }}>
          <span style={{ background: status.bg, color: status.color, font: '700 11px var(--font-body)', padding: '4px 11px', borderRadius: 'var(--radius-pill)' }}>
            {status.label}
          </span>
          <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
            <div style={{ font: '700 22px var(--font-display)', color: totalStock === 0 ? 'var(--color-danger)' : 'var(--text-primary)' }}>{totalStock}</div>
            <div style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>en total · mín {product.minStock}</div>
          </div>
        </div>

        {/* Existencias por ubicación */}
        <div style={{ marginTop: 18, font: '700 13px var(--font-body)', color: 'var(--text-secondary)' }}>Existencias por ubicación</div>
        {locEntries.length === 0 ? (
          <div style={{ marginTop: 8, fontSize: 13, color: 'var(--text-muted)' }}>Sin existencias en ninguna ubicación.</div>
        ) : (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
            {locEntries.map(([key, qty]) => {
              const isBodega = key.startsWith('b:')
              return (
                <span key={key} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 'var(--radius-pill)', fontSize: 12, fontWeight: 700, background: isBodega ? 'rgba(90,42,90,.1)' : 'var(--surface-sunken)', color: isBodega ? 'var(--iw-plum)' : 'var(--text-secondary)', border: '1px solid var(--border-subtle)' }}>
                  {locName(key)} <span style={{ font: '700 12px var(--font-display)' }}>{qty}</span>
                </span>
              )
            })}
          </div>
        )}

        {/* Tallas */}
        <div style={{ marginTop: 18, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ font: '700 13px var(--font-body)', color: 'var(--text-secondary)', flex: 1 }}>Tallas y existencias</span>
          {admin ? (
            <button
              onClick={() => { setNotice(''); setEditing((v) => !v) }}
              className="iw-press"
              style={{ cursor: 'pointer', background: editing ? 'var(--iw-plum)' : 'transparent', color: editing ? '#fff' : 'var(--text-muted)', border: `1px solid ${editing ? 'var(--iw-plum)' : 'var(--border-subtle)'}`, borderRadius: 'var(--radius-pill)', padding: '4px 11px', font: '700 11px var(--font-body)' }}
            >
              {editing ? 'Listo' : 'Editar tallas'}
            </button>
          ) : null}
        </div>
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 8 }}>
          {variants.length === 0 ? (
            <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>Esta referencia no tiene tallas.</span>
          ) : (
            variants.map((variant) => {
              const st = variantStatus(variant.stock, variant.minStock)
              const bg = st === 'out' ? 'rgba(224,52,29,.08)' : st === 'low' ? 'rgba(199,146,0,.12)' : 'var(--iw-off-white)'
              const border = st === 'low' || st === 'out' ? 'rgba(199,146,0,.4)' : 'var(--border-subtle)'
              const removable = editing && variant.stock === 0
              return (
                <div key={variant.size} style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 38, background: bg, border: `1px solid ${removable ? 'rgba(224,52,29,.5)' : border}`, borderRadius: 8, padding: '4px 8px' }}>
                  <span style={{ fontSize: 10.5, color: 'var(--text-muted)', fontWeight: 700 }}>{variant.size}</span>
                  <span style={{ font: '700 14px var(--font-display)', color: cellColor(variant.stock, variant.minStock) }}>{variant.stock}</span>
                  {removable ? (
                    <button
                      onClick={() => void remove(variant.size)}
                      aria-label={`Quitar talla ${variant.size}`}
                      title={`Quitar talla ${variant.size}`}
                      style={{ position: 'absolute', top: -7, right: -7, width: 18, height: 18, borderRadius: '50%', border: 'none', background: 'var(--color-danger)', color: '#fff', cursor: 'pointer', font: '700 11px var(--font-body)', lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    >
                      ✕
                    </button>
                  ) : null}
                </div>
              )
            })
          )}
        </div>
        {editing ? (
          <span style={{ display: 'block', marginTop: 8, fontSize: 12, color: 'var(--text-muted)' }}>
            Quita con la ✕ las tallas que no manejas. Solo las que están en cero; si una tiene stock, primero sácala del inventario.
          </span>
        ) : null}
        {notice ? (
          <div style={{ marginTop: 10, background: 'rgba(224,52,29,.1)', border: '1px solid rgba(224,52,29,.3)', borderRadius: 'var(--radius-md)', padding: '9px 12px', color: 'var(--color-danger)', fontSize: 12.5, fontWeight: 700 }}>
            {notice}
          </div>
        ) : null}

        {/* Detalles */}
        <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--border-subtle)', display: 'flex', flexWrap: 'wrap', gap: '6px 24px', fontSize: 12.5, color: 'var(--text-muted)' }}>
          <span>Marca: <b style={{ color: 'var(--text-secondary)' }}>{product.brand || '—'}</b></span>
          <span>Creada: <b style={{ color: 'var(--text-secondary)' }}>{fmtDate(product.createdAt)}</b></span>
          <span>Actualizada: <b style={{ color: 'var(--text-secondary)' }}>{fmtDate(product.updatedAt)}</b></span>
        </div>
      </div>
    </div>
  )
}

export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        background: 'var(--surface-card)',
        border: '1.5px solid var(--border-subtle)',
        borderRadius: 'var(--radius-md)',
        padding: '11px 15px',
      }}
    >
      <Icon name="search" size={18} color="var(--text-muted)" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', font: '500 15px var(--font-body)', color: 'var(--text-primary)' }}
      />
    </div>
  )
}

function StatCard({ label, value, danger }: { label: string; value: number; danger?: boolean }) {
  return (
    <div
      style={{
        flex: 1,
        minWidth: 120,
        background: danger ? 'rgba(224,52,29,.06)' : 'var(--surface-card)',
        border: `1px solid ${danger ? 'rgba(224,52,29,.18)' : 'var(--border-subtle)'}`,
        borderRadius: 'var(--radius-md)',
        padding: '12px 14px',
      }}
    >
      <div style={{ fontSize: 11, color: danger ? 'var(--color-danger)' : 'var(--text-muted)', fontWeight: 700 }}>{label}</div>
      <div style={{ font: '700 22px var(--font-display)', color: danger ? 'var(--color-danger)' : 'var(--text-primary)' }}>{value}</div>
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return <div style={{ padding: 28, textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 }}>{text}</div>
}
