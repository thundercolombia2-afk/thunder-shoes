/**
 * Alta de una referencia nueva. Genera los códigos de barras (SKU-TALLA) en
 * vivo mientras se eligen tallas y, al guardar, crea el producto, sus
 * variantes y su índice de códigos en una sola transacción.
 */

import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSession } from '@/app/session'
import { catalogRepository } from '@/data/repositories/catalogRepository'
import { money, SIZES, type Size } from '@/domain/models'
import { buildBarcode, errorMessage } from '@/domain/rules'
import { parseMoneyInput } from '@/lib/format'
import { BackLink } from './_shared'
import { Field } from '@/ui/Field'
import { Button } from '@/ui/Button'

export function NewReferenceScreen() {
  const navigate = useNavigate()
  const { can } = useSession()
  const seeCosts = can('seeCosts')
  const [name, setName] = useState('')
  const [sku, setSku] = useState('')
  const [minStock, setMinStock] = useState('3')
  const [price, setPrice] = useState('')
  const [cost, setCost] = useState('')
  const [sizes, setSizes] = useState<Set<Size>>(() => new Set([38, 39, 40, 41, 42] as Size[]))
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const selectedSizes = useMemo(() => SIZES.filter((s) => sizes.has(s)), [sizes])
  const skuUpper = sku.toUpperCase().replace(/\s+/g, '')
  const barcodeRows = useMemo(
    () => selectedSizes.map((size) => ({ size, code: skuUpper ? buildBarcode(skuUpper, size) : `—-${size}` })),
    [selectedSizes, skuUpper],
  )

  const toggleSize = (size: Size) =>
    setSizes((prev) => {
      const next = new Set(prev)
      if (next.has(size)) next.delete(size)
      else next.add(size)
      return next
    })

  const canSave =
    name.trim().length > 0 &&
    skuUpper.length > 0 &&
    parseMoneyInput(price) > 0 &&
    selectedSizes.length > 0 &&
    !saving

  const save = async () => {
    setError('')
    if (!canSave) {
      setError('Completa nombre, código, precio y al menos una talla.')
      return
    }
    setSaving(true)
    try {
      await catalogRepository.createProduct({
        name: name.trim(),
        brand: name.trim().split(' ')[0] ?? name.trim(),
        sku: skuUpper,
        price: money(parseMoneyInput(price)),
        cost: money(parseMoneyInput(cost)),
        minStock: Math.max(0, Number(minStock) || 0),
        sizes: selectedSizes,
      })
      navigate('/inventory')
    } catch (e) {
      setError(errorMessage(e))
      setSaving(false)
    }
  }

  return (
    <div
      className="iw-fade"
      style={{ padding: '18px 20px 32px', display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 760, margin: '0 auto', width: '100%', boxSizing: 'border-box' }}
    >
      <BackLink label="Inventario" onClick={() => navigate('/inventory')} />
      <h1 style={{ margin: 0, font: '700 24px var(--font-display)' }}>Nueva referencia</h1>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
        <div style={{ flex: '1 1 100%', minWidth: 0 }}>
          <Field label="Nombre de la referencia" placeholder="Ej. Nike Air Max 90" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div style={{ flex: '1 1 200px', minWidth: 0 }}>
          <Field label="Código interno (SKU)" placeholder="AM90-BLK" value={sku} onChange={(e) => setSku(e.target.value)} />
        </div>
        <div style={{ flex: '1 1 200px', minWidth: 0 }}>
          <Field label="Stock mínimo" placeholder="3" inputMode="numeric" value={minStock} onChange={(e) => setMinStock(e.target.value.replace(/\D/g, ''))} />
        </div>
        <div style={{ flex: '1 1 200px', minWidth: 0 }}>
          <Field label="Precio de venta" prefix="$" placeholder="459.900" inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} />
        </div>
        {seeCosts ? (
          <div style={{ flex: '1 1 200px', minWidth: 0 }}>
            <Field label="Costo de compra" prefix="$" placeholder="268.000" inputMode="numeric" value={cost} onChange={(e) => setCost(e.target.value)} hint="Solo lo ve un socio." />
          </div>
        ) : null}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <label style={{ font: '700 13px var(--font-body)', color: 'var(--text-secondary)' }}>Tallas disponibles</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {SIZES.map((size) => {
            const on = sizes.has(size)
            return (
              <button
                key={size}
                onClick={() => toggleSize(size)}
                className="iw-press"
                style={{
                  cursor: 'pointer',
                  width: 52,
                  height: 52,
                  borderRadius: 'var(--radius-md)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  font: '700 17px var(--font-display)',
                  background: on ? 'var(--iw-plum)' : 'var(--surface-card)',
                  color: on ? '#fff' : 'var(--text-secondary)',
                  border: `1.5px solid ${on ? 'var(--iw-plum)' : 'var(--border-subtle)'}`,
                }}
              >
                {size}
              </button>
            )
          })}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <label style={{ font: '700 13px var(--font-body)', color: 'var(--text-secondary)' }}>Códigos de barras a imprimir</label>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{selectedSizes.length} tallas</span>
        </div>
        <div
          style={{
            background: 'var(--surface-card)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-lg)',
            overflow: 'hidden',
            boxShadow: 'var(--shadow-sm)',
          }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 2.4fr',
              background: 'var(--iw-plum)',
              color: 'var(--iw-cream)',
              font: '700 12px var(--font-body)',
              padding: '11px 18px',
              letterSpacing: '.03em',
            }}
          >
            <span>Talla</span>
            <span>Código de barras</span>
          </div>
          {barcodeRows.length === 0 ? (
            <div style={{ padding: 28, textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 }}>
              Selecciona al menos una talla para generar los códigos.
            </div>
          ) : (
            barcodeRows.map((b) => (
              <div key={b.size} style={{ display: 'grid', gridTemplateColumns: '1fr 2.4fr', alignItems: 'center', padding: '12px 18px', borderBottom: '1px solid var(--border-subtle)' }}>
                <span style={{ font: '700 18px var(--font-display)', color: 'var(--iw-plum)' }}>{b.size}</span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <div className="iw-barcode" style={{ height: 44, width: '100%', maxWidth: 230, borderRadius: 4, opacity: 0.9 }} />
                  <span style={{ font: '600 12px ui-monospace,monospace', color: 'var(--text-muted)', letterSpacing: '.06em' }}>{b.code}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {error ? (
        <div style={{ background: 'rgba(224,52,29,.1)', border: '1px solid rgba(224,52,29,.3)', borderRadius: 'var(--radius-md)', padding: '11px 15px', color: 'var(--color-danger)', fontSize: 13, fontWeight: 700 }}>
          {error}
        </div>
      ) : null}

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Button variant="primary" size="lg" onClick={save} disabled={!canSave} style={{ minWidth: 180 }}>
          {saving ? 'Guardando…' : 'Guardar referencia'}
        </Button>
        <Button variant="outline" size="lg" onClick={() => window.print()} style={{ minWidth: 160 }}>
          Imprimir códigos
        </Button>
      </div>
      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
        El stock inicial de cada talla queda en 0; se llena registrando compras al escanear.
      </span>
    </div>
  )
}
