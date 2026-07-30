/**
 * Alta de una referencia nueva. Genera los códigos de barras (SKU-TALLA) en
 * vivo mientras se eligen tallas y, al guardar, crea el producto, sus
 * variantes y su índice de códigos en una sola transacción.
 */

import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSession } from '@/app/session'
import { useCatalog } from '@/app/hooks'
import { catalogRepository, type ProductWithVariants } from '@/data/repositories/catalogRepository'
import { money, SIZES, type Size } from '@/domain/models'
import { normalize } from '@/domain/sales'
import { buildBarcode, errorMessage } from '@/domain/rules'
import { formatMoneyInput, parseMoneyInput } from '@/lib/format'
import { barcodeBars, barcodeSvgString } from '@/lib/barcode'
import { useIsMobile } from '@/app/useMediaQuery'
import { InventoryLayout } from './_shared'
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
  // Sin tallas por defecto: solo se crean (y luego se alertan) las que la persona
  // elige a conciencia. Así no quedan tallas "fantasma" que nunca se surten.
  const [sizes, setSizes] = useState<Set<Size>>(() => new Set<Size>())
  const [copies, setCopies] = useState('1')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  // Se marca al intentar guardar/imprimir con el formulario incompleto: a partir
  // de ahí los campos que falten se pintan de rojo hasta que se llenen.
  const [attempted, setAttempted] = useState(false)
  const isMobile = useIsMobile()
  // Catálogo en vivo: sirve para sugerir referencias YA creadas mientras se
  // escribe el nombre, y así no terminar con la misma referencia dos veces.
  const { data: catalog } = useCatalog()
  // Referencia existente elegida de la lista: mientras esté marcada, la pantalla
  // deja de ser "crear" y pasa a mostrar lo que ya hay (incluidos sus códigos).
  const [existing, setExisting] = useState<ProductWithVariants | null>(null)

  const selectedSizes = useMemo(() => SIZES.filter((s) => sizes.has(s)), [sizes])
  const skuUpper = sku.toUpperCase().replace(/\s+/g, '')

  const term = normalize(name)
  const suggestions = useMemo(() => {
    if (existing || term.length === 0) return []
    return catalog
      .filter((r) => normalize(r.product.name).includes(term) || normalize(r.product.sku).includes(term))
      .slice(0, 8)
  }, [catalog, term, existing])

  // Aviso aunque no se elija de la lista: si el SKU tecleado ya está en uso, la
  // transacción de guardado fallaría por códigos duplicados. Mejor decirlo antes.
  const skuTaken = useMemo(
    () => (existing || !skuUpper ? null : (catalog.find((r) => r.product.sku.toUpperCase() === skuUpper) ?? null)),
    [catalog, skuUpper, existing],
  )

  // Validez por campo (para el resaltado en rojo).
  const nameInvalid = name.trim().length === 0
  const skuInvalid = skuUpper.length === 0
  const priceInvalid = parseMoneyInput(price) <= 0
  const sizesInvalid = selectedSizes.length === 0
  const formValid = !nameInvalid && !skuInvalid && !priceInvalid && !sizesInvalid
  const barcodeRows = useMemo(() => {
    // De una referencia existente se muestran los códigos REALES guardados (los
    // que ya están impresos), no los que se reconstruirían del SKU.
    const saved = new Map(existing?.variants.map((v) => [v.size, v.barcode]) ?? [])
    return selectedSizes.map((size) => ({
      size,
      code: saved.get(size) ?? (skuUpper ? buildBarcode(skuUpper, size) : `—-${size}`),
    }))
  }, [selectedSizes, skuUpper, existing])

  /** Carga en el formulario todos los datos de una referencia que ya existe. */
  const pickExisting = (r: ProductWithVariants) => {
    setExisting(r)
    setName(r.product.name)
    setSku(r.product.sku)
    setPrice(String(r.product.price))
    setCost(String(r.product.cost))
    setMinStock(String(r.product.minStock))
    setSizes(new Set(r.variants.filter((v) => v.active).map((v) => v.size)))
    setAttempted(false)
    setError('')
  }

  /** Vuelve al formulario en blanco para crear una referencia de verdad. */
  const clearExisting = () => {
    setExisting(null)
    setName('')
    setSku('')
    setPrice('')
    setCost('')
    setMinStock('3')
    setSizes(new Set<Size>())
    setError('')
  }

  /** Tallas que la referencia existente maneja (las únicas con código impreso). */
  const availableSizes = existing
    ? new Set(existing.variants.filter((v) => v.active).map((v) => v.size))
    : null

  const toggleSize = (size: Size) => {
    // Sobre una referencia existente solo se eligen tallas que ya tiene: una
    // talla nueva no tiene código registrado y la etiqueta no escanearía.
    if (availableSizes && !availableSizes.has(size)) return
    setSizes((prev) => {
      const next = new Set(prev)
      if (next.has(size)) next.delete(size)
      else next.add(size)
      return next
    })
  }

  /**
   * Abre una hoja de etiquetas lista para imprimir en stickers.
   *
   * Se dibuja en milímetros y no en píxeles: una etiqueta de 50×25 mm sale de
   * 50×25 mm en cualquier impresora, sea térmica o láser sobre hoja A4 de
   * adhesivos. `page-break-inside: avoid` evita que una etiqueta quede partida
   * entre dos hojas.
   */
  const printLabels = (mode: 'sheet' | 'roll') => {
    // No se imprime con el formulario a medias: sin nombre/código las etiquetas
    // saldrían en blanco. Se marca lo que falta en rojo.
    if (!formValid) {
      setAttempted(true)
      setError('Completa los campos marcados en rojo antes de imprimir.')
      return
    }
    const perSize = Math.min(50, Math.max(1, Number(copies) || 1))
    const title = name.trim() || 'Nueva referencia'
    const labels = barcodeRows
      .flatMap((row) => Array.from({ length: perSize }, () => row))
      .map(
        (row) => `
          <div class="label">
            <div class="name">${escapeHtml(title)}</div>
            <div class="size">T${row.size}</div>
            ${barcodeSvgString(row.code)}
            <div class="code">${escapeHtml(row.code)}</div>
          </div>`,
      )
      .join('')

    // Dos modos:
    //  · 'sheet' → hoja normal (carta/A4) con TODAS las etiquetas acomodadas en
    //    una cuadrícula (no desperdicia páginas); ideal para hojas de stickers.
    //  · 'roll'  → cada etiqueta es una página de 50×25 mm; para impresora
    //    térmica de rollo o para un PDF del tamaño exacto del sticker.
    const pageCss =
      mode === 'roll'
        ? `@page { size: 50mm 25mm; margin: 0; }
           body { margin: 0; padding: 0; }
           .label { page-break-after: always; }
           .label:last-child { page-break-after: auto; }`
        : `@page { margin: 8mm; }
           body { margin: 0; padding: 4mm; display: flex; flex-wrap: wrap; gap: 3mm; align-content: flex-start; }
           .label { border: 0.2mm dashed #bbb; border-radius: 1mm; page-break-inside: avoid; }
           @media print { .label { border-color: transparent; } }`

    const html = `<!doctype html><html lang="es"><head><meta charset="utf-8">
      <title>Etiquetas · ${escapeHtml(title)}</title>
      <style>
        html, body { font-family: system-ui, sans-serif; }
        ${pageCss}
        .label {
          width: 50mm; height: 25mm; box-sizing: border-box; padding: 1.5mm 2mm;
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          overflow: hidden;
        }
        /* 46 mm es todo el ancho útil de la etiqueta (50 mm menos el padding).
           Cuanto más ancho, más gordo el módulo y más fácil de leer. */
        .label svg { width: 46mm; height: 9mm; }
        .name { font-size: 2.4mm; font-weight: 700; max-width: 46mm; overflow: hidden;
                white-space: nowrap; text-overflow: ellipsis; }
        .size { font-size: 3.4mm; font-weight: 800; margin: 0.3mm 0; }
        .code { font-family: ui-monospace, monospace; font-size: 2.6mm; letter-spacing: .04em; }
      </style></head><body>${labels}</body></html>`

    // Se imprime desde un IFRAME oculto en vez de una ventana emergente: las
    // ventanas emergentes las bloquea el navegador (por eso "no servía"); un
    // iframe no. El SVG va embebido, sin recursos externos, así que basta un
    // respiro corto antes de imprimir.
    const iframe = document.createElement('iframe')
    iframe.setAttribute('aria-hidden', 'true')
    Object.assign(iframe.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' })
    document.body.appendChild(iframe)
    const idoc = iframe.contentWindow?.document
    if (!idoc) {
      iframe.remove()
      setError('No se pudo preparar la impresión. Intenta de nuevo.')
      return
    }
    idoc.open()
    idoc.write(html)
    idoc.close()
    window.setTimeout(() => {
      iframe.contentWindow?.focus()
      iframe.contentWindow?.print()
      window.setTimeout(() => iframe.remove(), 1000)
    }, 300)
  }

  const canSave =
    !existing &&
    !skuTaken &&
    name.trim().length > 0 &&
    skuUpper.length > 0 &&
    parseMoneyInput(price) > 0 &&
    selectedSizes.length > 0 &&
    !saving

  const save = async () => {
    setError('')
    if (existing) {
      setError('Esa referencia ya existe. Agrégale stock en vez de crearla de nuevo.')
      return
    }
    if (skuTaken) {
      setError(`El código ${skuUpper} ya lo usa "${skuTaken.product.name}".`)
      return
    }
    if (!canSave) {
      setAttempted(true)
      setError('Completa los campos marcados en rojo.')
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
    <InventoryLayout active="new">
      <h2 style={{ margin: '4px 0 0', font: `700 ${isMobile ? 21 : 24}px var(--font-display)` }}>Nueva referencia</h2>

      {existing ? (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 10,
            background: 'rgba(224,168,29,.12)',
            border: '1px solid rgba(224,168,29,.4)',
            borderRadius: 'var(--radius-md)',
            padding: '11px 15px',
            fontSize: 13,
          }}
        >
          <b style={{ color: 'var(--text-primary)' }}>
            Esta referencia ya existe: {existing.product.name} ({existing.product.sku})
          </b>
          <span style={{ color: 'var(--text-muted)' }}>
            No se creará de nuevo. Abajo están sus códigos de barras, listos para reimprimir.
          </span>
          <div style={{ display: 'flex', gap: 8, marginLeft: 'auto', flexWrap: 'wrap' }}>
            <Button variant="outline" onClick={() => navigate('/inventory/add')}>
              Agregar stock
            </Button>
            <Button variant="outline" onClick={clearExisting}>
              Crear una nueva
            </Button>
          </div>
        </div>
      ) : null}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
        <div style={{ flex: '1 1 100%', minWidth: 0, position: 'relative' }}>
          <Field
            label="Nombre de la referencia"
            placeholder="Ej. Nike Air Max 90"
            value={name}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => {
              setName(e.target.value)
              // Al reescribir el nombre se suelta la referencia existente: lo que
              // quedó en pantalla pasa a ser un borrador editable otra vez.
              if (existing) setExisting(null)
            }}
            {...(existing ? {} : { hint: 'Escribe y elige de la lista si ya existe.' })}
            error={attempted && nameInvalid ? 'Falta el nombre.' : undefined}
          />
          {suggestions.length > 0 ? (
            <div
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                top: 74,
                zIndex: 40,
                background: 'var(--surface-card)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-lg)',
                boxShadow: 'var(--shadow-lg)',
                overflow: 'hidden',
                maxHeight: 300,
                overflowY: 'auto',
              }}
            >
              {suggestions.map((r) => (
                <button
                  key={r.product.id}
                  // `onMouseDown` y no `onClick`: el input está dentro de un
                  // <label>, y el blur del click llegaba antes de elegir.
                  onMouseDown={(e) => {
                    e.preventDefault()
                    pickExisting(r)
                  }}
                  className="iw-row"
                  style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 16px', background: 'var(--surface-card)', border: 'none', borderBottom: '1px solid var(--border-subtle)', cursor: 'pointer', textAlign: 'left' }}
                >
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', font: '700 14px var(--font-display)', color: 'var(--text-primary)' }}>{r.product.name}</span>
                    <span style={{ font: '600 12px var(--font-mono)', color: 'var(--text-muted)' }}>{r.product.sku}</span>
                  </span>
                  <span style={{ fontSize: 12.5, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                    {r.variants.length} {r.variants.length === 1 ? 'talla' : 'tallas'} · {r.totalStock} pares
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <div style={{ flex: '1 1 200px', minWidth: 0 }}>
          <Field
            label="Código interno (SKU)"
            placeholder="AM90-BLK"
            value={sku}
            onChange={(e) => setSku(e.target.value)}
            error={
              skuTaken
                ? `Ese código ya lo usa "${skuTaken.product.name}".`
                : attempted && skuInvalid
                  ? 'Falta el código.'
                  : undefined
            }
          />
        </div>
        <div style={{ flex: '1 1 200px', minWidth: 0 }}>
          <Field label="Stock mínimo" placeholder="3" inputMode="numeric" value={minStock} onChange={(e) => setMinStock(e.target.value.replace(/\D/g, ''))} />
        </div>
        <div style={{ flex: '1 1 200px', minWidth: 0 }}>
          <Field label="Precio de venta" prefix="$" placeholder="459.900" inputMode="numeric" value={formatMoneyInput(price)} onChange={(e) => setPrice(e.target.value.replace(/\D/g, ''))} error={attempted && priceInvalid ? 'Falta el precio.' : undefined} />
        </div>
        {seeCosts ? (
          <div style={{ flex: '1 1 200px', minWidth: 0 }}>
            <Field label="Costo de compra" prefix="$" placeholder="268.000" inputMode="numeric" value={formatMoneyInput(cost)} onChange={(e) => setCost(e.target.value.replace(/\D/g, ''))} hint="Solo lo ve un socio." />
          </div>
        ) : null}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <label style={{ font: '700 13px var(--font-body)', color: attempted && sizesInvalid ? 'var(--color-danger)' : 'var(--text-secondary)' }}>
          Tallas disponibles
        </label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {SIZES.map((size) => {
            const on = sizes.has(size)
            const markMissing = attempted && sizesInvalid
            const blocked = !!availableSizes && !availableSizes.has(size)
            return (
              <button
                key={size}
                onClick={() => toggleSize(size)}
                disabled={blocked}
                title={blocked ? 'Esta referencia no maneja esta talla.' : undefined}
                className="iw-press"
                style={{
                  cursor: blocked ? 'not-allowed' : 'pointer',
                  opacity: blocked ? 0.35 : 1,
                  width: 52,
                  height: 52,
                  borderRadius: 'var(--radius-md)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  font: '700 17px var(--font-display)',
                  background: on ? 'var(--iw-plum)' : 'var(--surface-card)',
                  color: on ? '#fff' : 'var(--text-secondary)',
                  border: `1.5px solid ${on ? 'var(--iw-plum)' : markMissing ? 'var(--color-danger)' : 'var(--border-subtle)'}`,
                }}
              >
                {size}
              </button>
            )
          })}
        </div>
        {attempted && sizesInvalid ? (
          <span style={{ fontSize: 12, color: 'var(--color-danger)', fontWeight: 700 }}>Elige al menos una talla.</span>
        ) : null}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <label style={{ font: '700 13px var(--font-body)', color: 'var(--text-secondary)' }}>Códigos de barras a imprimir</label>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {selectedSizes.length} {selectedSizes.length === 1 ? 'talla' : 'tallas'}
          </span>
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
                <span style={{ font: '700 22px var(--font-display)', color: 'var(--iw-plum)' }}>{b.size}</span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <BarcodePreview code={b.code} />
                  <span style={{ font: '600 12px var(--font-mono)', color: 'var(--text-muted)', letterSpacing: '.06em' }}>{b.code}</span>
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

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ width: 150 }}>
          <Field
            label="Stickers por talla"
            inputMode="numeric"
            value={copies}
            onChange={(e) => setCopies(e.target.value.replace(/\D/g, ''))}
            hint="Uno por par que vas a etiquetar."
          />
        </div>
        {existing ? (
          <Button variant="primary" size="lg" onClick={() => navigate('/inventory')} style={{ minWidth: 180 }}>
            Ver en inventario
          </Button>
        ) : (
          <Button variant="primary" size="lg" onClick={save} disabled={!canSave} style={{ minWidth: 180 }}>
            {saving ? 'Guardando…' : 'Guardar referencia'}
          </Button>
        )}
        <Button variant="outline" size="lg" onClick={() => printLabels('sheet')} style={{ minWidth: 160 }}>
          Imprimir en hoja
        </Button>
        <Button variant="outline" size="lg" onClick={() => printLabels('roll')} style={{ minWidth: 160 }}>
          Imprimir rollo (50×25)
        </Button>
      </div>
      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
        <b>En hoja</b>: todas las etiquetas acomodadas en una hoja carta/A4 (para hojas de stickers).{' '}
        <b>Rollo (50×25)</b>: una etiqueta por página de 50×25 mm (para impresora térmica de rollo o PDF del tamaño del sticker).
      </span>
    </InventoryLayout>
  )
}

/** Vista previa de la etiqueta, con las mismas barras que saldrán impresas. */
function BarcodePreview({ code }: { code: string }) {
  // El ancho del `viewBox` sale del código: uno largo produce módulos más
  // finos en vez de barras cortadas (que serían ilegibles para el lector).
  const { bars, width } = barcodeBars(code)
  return (
    <svg
      viewBox={`0 0 ${width} 64`}
      preserveAspectRatio="none"
      style={{ width: '100%', maxWidth: 240, height: 52 }}
      role="img"
      aria-label={`Código ${code}`}
    >
      <rect width={width} height="64" fill="#fff" />
      {bars.map((bar) => (
        <rect key={bar.x} x={bar.x} y={0} width={bar.width} height={64} fill="#000" />
      ))}
    </svg>
  )
}

/** El nombre de la referencia lo escribe una persona: nunca va crudo al HTML. */
function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch,
  )
}
