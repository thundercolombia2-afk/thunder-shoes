/**
 * Inventario en vivo. Se suscribe al catálogo (productos + variantes) y lo
 * refresca en tiempo real. El semáforo por talla, el buscador y el modo admin
 * (costos) replican el diseño.
 */

import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCatalog } from '@/app/hooks'
import { useSession } from '@/app/session'
import { SIZES } from '@/domain/models'
import { productStatus, variantStatus } from '@/domain/rules'
import { formatMoney } from '@/lib/format'
import { RoleBadge, cellColor, statusStyles } from './_shared'
import { Icon } from '@/ui/Icon'
import type { ProductWithVariants } from '@/data/repositories/catalogRepository'

export function InventoryScreen() {
  const { data: catalog, loading } = useCatalog()
  const { user, can } = useSession()
  const seeCosts = can('seeCosts')
  const navigate = useNavigate()
  const [search, setSearch] = useState('')

  const term = search.trim().toLowerCase()
  const rows = useMemo(
    () =>
      catalog.filter(
        (r) =>
          !term ||
          r.product.name.toLowerCase().includes(term) ||
          r.product.sku.toLowerCase().includes(term) ||
          r.product.brand.toLowerCase().includes(term),
      ),
    [catalog, term],
  )

  const totalStock = useMemo(() => catalog.reduce((sum, r) => sum + r.totalStock, 0), [catalog])
  const alertCount = useMemo(
    () =>
      catalog.reduce(
        (sum, r) => sum + r.variants.filter((v) => v.stock <= v.minStock).length,
        0,
      ),
    [catalog],
  )

  return (
    <div style={{ padding: '18px 20px 28px', display: 'flex', flexDirection: 'column', gap: 16 }} className="iw-fade">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, font: '700 24px var(--font-display)', flex: 1 }}>Inventario</h1>
        {user ? <RoleBadge role={user.role} /> : null}
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
      </div>

      <SearchBox value={search} onChange={setSearch} placeholder="Buscar referencia o código…" />

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <StatCard label="Stock total" value={totalStock} />
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
        {loading ? (
          <Empty text="Cargando inventario…" />
        ) : rows.length === 0 ? (
          <Empty text={term ? 'Sin resultados para tu búsqueda.' : 'No hay referencias todavía. Crea una con "Nueva".'} />
        ) : (
          rows.map((r) => <InventoryRow key={r.product.id} row={r} admin={seeCosts} />)
        )}
      </div>
    </div>
  )
}

function InventoryRow({ row, admin }: { row: ProductWithVariants; admin: boolean }) {
  const { product, variants, totalStock } = row
  const status = statusStyles(productStatus(totalStock, product.minStock))
  const totalColor = totalStock === 0 ? 'var(--color-danger)' : totalStock <= product.minStock * 3 ? 'var(--iw-amber)' : 'var(--text-primary)'
  const stockBySize = new Map(variants.map((v) => [v.size, v]))

  return (
    <div className="iw-row" style={{ padding: '14px 16px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ font: '700 15px var(--font-display)', color: 'var(--text-primary)' }}>{product.name}</div>
          <div style={{ font: '600 11px ui-monospace,monospace', color: 'var(--text-muted)' }}>
            {product.sku} · {formatMoney(product.price)}
            {admin ? <span style={{ color: 'var(--iw-orange)' }}> · costo {formatMoney(product.cost)}</span> : null}
          </div>
        </div>
        <span
          style={{
            background: status.bg,
            color: status.color,
            font: '700 11px var(--font-body)',
            padding: '4px 11px',
            borderRadius: 'var(--radius-pill)',
            whiteSpace: 'nowrap',
          }}
        >
          {status.label}
        </span>
        <div style={{ textAlign: 'right', minWidth: 52 }}>
          <div style={{ font: '700 18px var(--font-display)', color: totalColor }}>{totalStock}</div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>mín {product.minStock}</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
        {SIZES.map((size) => {
          const variant = stockBySize.get(size)
          const stock = variant?.stock ?? 0
          const st = variantStatus(stock, variant?.minStock ?? product.minStock)
          const bg = st === 'out' ? 'rgba(224,52,29,.08)' : st === 'low' ? 'rgba(199,146,0,.12)' : 'var(--iw-off-white)'
          const border = st === 'low' || st === 'out' ? 'rgba(199,146,0,.4)' : 'var(--border-subtle)'
          return (
            <div
              key={size}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                minWidth: 34,
                background: bg,
                border: `1px solid ${border}`,
                borderRadius: 8,
                padding: '3px 6px',
              }}
            >
              <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700 }}>{size}</span>
              <span style={{ font: '700 13px var(--font-display)', color: cellColor(stock, variant?.minStock ?? product.minStock) }}>
                {stock}
              </span>
            </div>
          )
        })}
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
