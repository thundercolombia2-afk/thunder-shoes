/**
 * Agregar producto al inventario: sumar unidades a una referencia que YA existe.
 *
 * Todo el formulario está siempre a la vista (como "Crear referencia"): se busca
 * la REFERENCIA, se agregan una o varias filas de talla + cantidad (con el botón
 * +), se elige la bodega y se pone la contraseña de ingreso. Queda como ENTRADA
 * en el libro mayor.
 */

import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCatalog } from '@/app/hooks'
import { useSession } from '@/app/session'
import { movementRepository } from '@/data/repositories/movementRepository'
import { bodegaRepository } from '@/data/repositories/bodegaRepository'
import { configRepository } from '@/data/repositories/configRepository'
import { errorMessage } from '@/domain/rules'
import { bodegaKey, stockAt } from '@/domain/locations'
import { normalize } from '@/domain/sales'
import { InventoryLayout } from './_shared'
import { Icon } from '@/ui/Icon'
import type { Bodega } from '@/domain/models'
import type { ProductWithVariants } from '@/data/repositories/catalogRepository'

interface Row {
  size: number | ''
  qty: string
}

const fieldStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  height: 48,
  padding: '0 14px',
  border: '1.5px solid var(--border-subtle)',
  borderRadius: 'var(--radius-lg)',
  fontSize: 15,
  fontFamily: 'var(--font-body)',
  outline: 'none',
  background: 'var(--surface-card)',
  color: 'var(--text-primary)',
}
const labelStyle: React.CSSProperties = {
  display: 'block',
  font: '700 13px var(--font-body)',
  color: 'var(--text-secondary)',
  marginBottom: 7,
}

export function AddStockScreen() {
  const { data: catalog, loading } = useCatalog()
  const { actor } = useSession()
  const navigate = useNavigate()

  const [query, setQuery] = useState('')
  const [product, setProduct] = useState<ProductWithVariants | null>(null)
  const [rows, setRows] = useState<Row[]>([{ size: '', qty: '1' }])
  const [bodegaId, setBodegaId] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState(false)

  const [bodegas, setBodegas] = useState<Bodega[]>([])
  const [entryPassword, setEntryPassword] = useState<string | null>(null) // null mientras carga

  useEffect(() => bodegaRepository.subscribe(setBodegas), [])
  useEffect(() => {
    configRepository
      .getEntryPassword()
      .then(setEntryPassword)
      .catch(() => setEntryPassword(''))
  }, [])

  const activeBodegas = bodegas.filter((b) => b.active)
  const bodega = activeBodegas.find((b) => b.id === bodegaId) ?? activeBodegas[0]
  const passwordConfigured = entryPassword !== null && entryPassword !== ''

  // Búsqueda a nivel de REFERENCIA.
  const term = normalize(query)
  const suggestions = useMemo(() => {
    if (!term || product) return []
    return catalog
      .filter(
        (r) =>
          normalize(r.product.name).includes(term) ||
          normalize(r.product.sku).includes(term) ||
          r.variants.some((v) => normalize(v.barcode).includes(term)),
      )
      .slice(0, 10)
  }, [catalog, term, product])

  // Catálogo en vivo por si otro movimiento cambia el stock.
  const current = product ? (catalog.find((r) => r.product.id === product.product.id) ?? product) : null
  const sizes = current ? current.variants.filter((v) => v.active).map((v) => v.size).sort((a, b) => a - b) : []

  const variantFor = (size: number | '') =>
    current && size !== '' ? current.variants.find((v) => v.size === size) : undefined
  const stockOf = (size: number | '') =>
    bodega ? stockAt(variantFor(size)?.stockByLocation, bodegaKey(bodega.id)) : 0

  const pick = (r: ProductWithVariants) => {
    setProduct(r)
    setQuery(r.product.name)
    setRows([{ size: '', qty: '1' }])
    setError('')
    setNotice('')
  }
  const clearRef = () => {
    setProduct(null)
    setQuery('')
    setRows([{ size: '', qty: '1' }])
  }

  const setRow = (i: number, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  const addRow = () => setRows((prev) => [...prev, { size: '', qty: '1' }])
  const removeRow = (i: number) => setRows((prev) => prev.filter((_, idx) => idx !== i))

  const validRows = rows
    .map((r) => ({ variant: variantFor(r.size), qty: Math.floor(Number(r.qty) || 0) }))
    .filter((x) => x.variant && x.qty >= 1)
  const totalUnits = validRows.reduce((sum, x) => sum + x.qty, 0)

  const canSubmit =
    !!actor && !!current && !!bodega && validRows.length > 0 && passwordConfigured && password.trim().length > 0 && !saving

  const submit = async () => {
    if (!actor || !current || !bodega) return
    if (!passwordConfigured) {
      setError('Primero configura la contraseña de ingreso en Configuración → Claves.')
      return
    }
    if (password.trim() !== entryPassword) {
      setError('Contraseña de ingreso incorrecta.')
      return
    }
    if (validRows.length === 0) {
      setError('Agrega al menos una talla con su cantidad.')
      return
    }
    setSaving(true)
    setError('')
    try {
      await movementRepository.recordMany(
        validRows.map((x) => ({
          type: 'purchase' as const,
          variantId: x.variant!.id,
          quantity: x.qty,
          toLocation: bodegaKey(bodega.id),
        })),
        actor,
      )
      setNotice(`Ingreso a ${bodega.code} · ${current.product.name} · ${totalUnits} pares en ${validRows.length} tallas`)
      setRows([{ size: '', qty: '1' }])
      setPassword('')
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <InventoryLayout active="add">
      <div>
        <h2 style={{ margin: '4px 0 6px', font: '700 22px var(--font-display)' }}>ENTRADA: ingresar productos al inventario</h2>
        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 14.5 }}>
          Busca la referencia, agrega las tallas y cantidades que entraron, y a qué bodega.
        </p>
      </div>

      {entryPassword !== null && !passwordConfigured ? <PasswordWarning onGo={() => navigate('/settings')} /> : null}
      {notice ? <Note tone="success" text={notice} /> : null}
      {error ? <Note tone="danger" text={error} /> : null}

      <div style={{ maxWidth: 640, display: 'flex', flexDirection: 'column', gap: 18 }}>
        {/* Referencia */}
        <div style={{ position: 'relative' }}>
          <label style={labelStyle}>Referencia o nombre</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, ...fieldStyle, height: 52 }}>
            <Icon name="search" size={18} color="var(--text-muted)" />
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                if (product) setProduct(null)
              }}
              placeholder="Ej. Air Max 90 · AM90-BLK"
              autoComplete="off"
              spellCheck={false}
              style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent', fontSize: 15.5, fontFamily: 'var(--font-body)', color: 'var(--text-primary)' }}
            />
            {query ? (
              <button onClick={clearRef} aria-label="Limpiar" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 18, lineHeight: 1 }}>
                ✕
              </button>
            ) : null}
          </div>

          {suggestions.length > 0 ? (
            <div style={{ position: 'absolute', left: 0, right: 0, top: 82, zIndex: 40, background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-lg)', overflow: 'hidden', maxHeight: 300, overflowY: 'auto' }}>
              {suggestions.map((r) => (
                <button
                  key={r.product.id}
                  onClick={() => pick(r)}
                  className="iw-row"
                  style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 16px', background: 'var(--surface-card)', border: 'none', borderBottom: '1px solid var(--border-subtle)', cursor: 'pointer', textAlign: 'left' }}
                >
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', font: '700 14px var(--font-display)', color: 'var(--text-primary)' }}>{r.product.name}</span>
                    <span style={{ font: '600 12px var(--font-mono)', color: 'var(--text-muted)' }}>{r.product.sku}</span>
                  </span>
                  <span style={{ fontSize: 12.5, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{r.variants.length} tallas</span>
                </button>
              ))}
            </div>
          ) : null}
          {product ? (
            <p style={{ margin: '7px 2px 0', fontSize: 12.5, color: 'var(--color-success)', fontWeight: 700 }}>
              {current?.product.name} · {sizes.length} tallas disponibles
            </p>
          ) : (
            <p style={{ margin: '7px 2px 0', fontSize: 12.5, color: 'var(--text-muted)' }}>
              {loading ? 'Cargando inventario…' : 'Escribe y elige una referencia de la lista.'}
            </p>
          )}
        </div>

        {/* Tallas + cantidades (con botón + para agregar más) */}
        <div>
          <label style={labelStyle}>Tallas y cantidades</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {rows.map((row, i) => {
              const isLast = i === rows.length - 1
              const stock = stockOf(row.size)
              return (
                <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <select
                    value={row.size}
                    onChange={(e) => setRow(i, { size: e.target.value ? Number(e.target.value) : '' })}
                    disabled={!current}
                    style={{ ...fieldStyle, flex: '1 1 120px', minWidth: 0, cursor: current ? 'pointer' : 'not-allowed', opacity: current ? 1 : 0.6 }}
                  >
                    <option value="">Talla…</option>
                    {sizes.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                  <input
                    value={row.qty}
                    onChange={(e) => setRow(i, { qty: e.target.value.replace(/\D/g, '') })}
                    inputMode="numeric"
                    placeholder="Cantidad"
                    style={{ ...fieldStyle, flex: '1 1 120px', minWidth: 0 }}
                  />
                  {row.size !== '' && bodega ? (
                    <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                      en {bodega.code}: {stock}
                    </span>
                  ) : null}
                  <button
                    onClick={() => (isLast ? addRow() : removeRow(i))}
                    aria-label={isLast ? 'Agregar otra talla' : 'Quitar talla'}
                    className="iw-press"
                    style={{
                      flex: 'none',
                      width: 48,
                      height: 48,
                      borderRadius: 'var(--radius-lg)',
                      border: isLast ? 'none' : '1.5px solid var(--border-subtle)',
                      background: isLast ? 'var(--iw-plum)' : 'var(--surface-card)',
                      color: isLast ? '#fff' : 'var(--text-secondary)',
                      cursor: 'pointer',
                      font: '700 22px var(--font-display)',
                      lineHeight: 1,
                    }}
                  >
                    {isLast ? '+' : '−'}
                  </button>
                </div>
              )
            })}
          </div>
        </div>

        {/* Bodega */}
        <div>
          <label style={labelStyle}>Bodega a la que entra</label>
          {activeBodegas.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--color-danger)', fontWeight: 700 }}>
              No hay bodegas. Crea una en Configuración → Autorizaciones.
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {activeBodegas.map((b) => {
                const on = b.id === (bodega?.id ?? '')
                return (
                  <button
                    key={b.id}
                    onClick={() => setBodegaId(b.id)}
                    className="iw-press"
                    style={{ padding: '10px 15px', borderRadius: 'var(--radius-lg)', border: `1.5px solid ${on ? 'var(--iw-plum)' : 'var(--border-subtle)'}`, background: on ? 'var(--iw-plum)' : 'var(--surface-card)', color: on ? '#fff' : 'var(--text-secondary)', font: '700 13.5px var(--font-body)', cursor: 'pointer' }}
                  >
                    {b.code}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Contraseña */}
        <div>
          <label style={labelStyle}>Contraseña de ingreso</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={passwordConfigured ? '••••' : 'Configúrala primero en Configuración'}
            disabled={!passwordConfigured}
            style={{ ...fieldStyle, opacity: passwordConfigured ? 1 : 0.6 }}
          />
        </div>

        <button
          onClick={() => void submit()}
          disabled={!canSubmit}
          className="iw-press"
          style={{
            height: 54,
            background: canSubmit ? 'var(--iw-yellow)' : 'var(--surface-muted)',
            color: canSubmit ? '#0c0c0d' : 'var(--text-muted)',
            border: 'none',
            borderRadius: 'var(--radius-xl)',
            font: '700 16px var(--font-display)',
            cursor: canSubmit ? 'pointer' : 'not-allowed',
            boxShadow: canSubmit ? 'var(--shadow-accent)' : 'none',
          }}
        >
          {saving
            ? 'Registrando…'
            : totalUnits > 0 && bodega
              ? `Ingresar ${totalUnits} pares a ${bodega.code}`
              : 'Ingresar'}
        </button>
      </div>
    </InventoryLayout>
  )
}

function PasswordWarning({ onGo }: { onGo: () => void }) {
  const { user } = useSession()
  const isOwner = user?.owner === true
  return (
    <div style={{ maxWidth: 640, background: 'rgba(224,52,29,.08)', border: '1px solid rgba(224,52,29,.3)', borderRadius: 'var(--radius-lg)', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ font: '700 14px var(--font-body)', color: 'var(--color-danger)' }}>Falta configurar la contraseña de ingreso</div>
      <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
        No se puede ingresar mercancía sin una contraseña de ingreso.{' '}
        {isOwner ? 'Configúrala en Configuración → Claves.' : 'Pídele a la dueña que la configure.'}
      </p>
      {isOwner ? (
        <button
          onClick={onGo}
          className="iw-press"
          style={{ alignSelf: 'flex-start', cursor: 'pointer', background: 'var(--iw-plum)', color: '#fff', border: 'none', borderRadius: 'var(--radius-pill)', padding: '9px 16px', font: '700 13px var(--font-body)' }}
        >
          Ir a Configuración
        </button>
      ) : null}
    </div>
  )
}

function Note({ tone, text }: { tone: 'danger' | 'success'; text: string }) {
  const danger = tone === 'danger'
  return (
    <div
      style={{
        maxWidth: 640,
        background: danger ? 'rgba(224,52,29,.1)' : 'rgba(21,119,79,.1)',
        border: `1px solid ${danger ? 'rgba(224,52,29,.3)' : 'rgba(21,119,79,.3)'}`,
        borderRadius: 'var(--radius-md)',
        padding: '11px 15px',
        color: danger ? 'var(--color-danger)' : 'var(--color-success)',
        fontSize: 13.5,
        fontWeight: 700,
      }}
    >
      {text}
    </div>
  )
}
