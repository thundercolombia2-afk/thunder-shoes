/**
 * Diálogos del flujo de venta: cobro y devolución.
 *
 * Son modales y no pantallas porque el carrito no se pierde de vista: la
 * cajera confirma con el cliente enfrente y vuelve al mismo estado si cancela.
 */

import { useEffect, useState, type ReactNode } from 'react'
import {
  PAYMENT_METHODS,
  RETURN_REASONS,
  money,
  type Money,
  type PaymentMethod,
  type ReturnReason,
  type VariantId,
} from '@/domain/models'
import type { Sale } from '@/domain/sales'
import { movementRepository } from '@/data/repositories/movementRepository'
import type { ProductWithVariants } from '@/data/repositories/catalogRepository'
import { formatMoney, formatMoneyInput, formatShortDate, formatTime, parseMoneyInput } from '@/lib/format'
import type { CartLine } from '@/app/cart'

// ── Piezas comunes ───────────────────────────────────────────────────────────

function Overlay({ onClose, children, width = 440 }: { onClose: () => void; children: ReactNode; width?: number }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(12,12,13,.55)',
        backdropFilter: 'blur(2px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 60,
        padding: 20,
        overflowY: 'auto',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width,
          maxWidth: '100%',
          background: 'var(--surface-card)',
          borderRadius: 'var(--radius-2xl)',
          boxShadow: 'var(--shadow-lg)',
          padding: '22px 24px 24px',
          boxSizing: 'border-box',
        }}
      >
        {children}
      </div>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  marginTop: 7,
  height: 48,
  padding: '0 15px',
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
  font: '700 13.5px var(--font-body)',
  color: 'var(--text-secondary)',
}

function TotalBanner({ label, value }: { label: string; value: Money }) {
  return (
    <div
      style={{
        marginTop: 16,
        background: 'rgba(255,209,0,.16)',
        border: '1px solid rgba(255,209,0,.5)',
        borderRadius: 'var(--radius-lg)',
        padding: '15px 18px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        flexWrap: 'wrap',
      }}
    >
      <span style={{ fontSize: 15, color: 'var(--text-secondary)', fontWeight: 600 }}>{label}</span>
      <span style={{ font: '700 25px var(--font-display)', letterSpacing: '-.02em' }}>{formatMoney(value)}</span>
    </div>
  )
}

function Actions({ children }: { children: ReactNode }) {
  return <div style={{ display: 'flex', gap: 10, marginTop: 20, justifyContent: 'flex-end' }}>{children}</div>
}

function GhostButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="iw-press"
      style={{
        padding: '0 20px',
        height: 48,
        background: 'var(--surface-card)',
        color: 'var(--text-primary)',
        border: '1.5px solid var(--border-subtle)',
        borderRadius: 'var(--radius-lg)',
        font: '700 15px var(--font-body)',
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  )
}

function AccentButton({
  label,
  onClick,
  disabled,
  grow,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  grow?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="iw-press"
      style={{
        flex: grow ? 1.4 : undefined,
        padding: '0 22px',
        height: 48,
        border: 'none',
        borderRadius: 'var(--radius-lg)',
        font: '700 15px var(--font-body)',
        background: disabled ? 'rgba(255,209,0,.35)' : 'var(--iw-yellow)',
        color: disabled ? 'var(--text-muted)' : '#0c0c0d',
        cursor: disabled ? 'not-allowed' : 'pointer',
        boxShadow: disabled ? 'none' : 'var(--shadow-accent)',
      }}
    >
      {label}
    </button>
  )
}

function ErrorNote({ text }: { text: string }) {
  if (!text) return null
  return (
    <div
      style={{
        marginTop: 14,
        background: 'rgba(224,52,29,.1)',
        border: '1px solid rgba(224,52,29,.3)',
        borderRadius: 'var(--radius-md)',
        padding: '10px 14px',
        color: 'var(--color-danger)',
        fontSize: 13,
        fontWeight: 700,
      }}
    >
      {text}
    </div>
  )
}

// ── Cobro ────────────────────────────────────────────────────────────────────

export function CobroModal({
  total,
  fromStore,
  busy,
  error,
  onClose,
  onConfirm,
}: {
  total: Money
  /** Local del que se descuenta el stock vendido (para que el cajero lo verifique). */
  fromStore: string
  busy: boolean
  error: string
  onClose: () => void
  onConfirm: (payment: string, customerName: string, customerPhone: string) => void
}) {
  const [payment, setPayment] = useState<PaymentMethod>('Efectivo')
  const [otherName, setOtherName] = useState('')
  const [customer, setCustomer] = useState('')
  const [phone, setPhone] = useState('')
  const [received, setReceived] = useState('')

  const receivedValue = parseMoneyInput(received)
  const change = receivedValue - total
  const cashShort = payment === 'Efectivo' && receivedValue < total
  // Con "Otro" hay que escribir el nombre del medio; se guarda ese texto como
  // método de pago (no el literal "Otro") para que el historial lo explique.
  const otherMissing = payment === 'Otro' && otherName.trim().length === 0
  const effectivePayment = payment === 'Otro' && otherName.trim() ? otherName.trim() : payment

  return (
    <Overlay onClose={onClose} width={430}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0, font: '700 22px var(--font-display)' }}>Cobro</h2>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 22, lineHeight: 1 }}
          aria-label="Cerrar"
        >
          ✕
        </button>
      </div>

      <TotalBanner label="Total a pagar" value={total} />

      {fromStore ? (
        <div
          style={{
            marginTop: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: 'var(--surface-muted)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-md)',
            padding: '10px 13px',
            fontSize: 13,
            color: 'var(--text-secondary)',
            fontWeight: 700,
          }}
        >
          <span aria-hidden>📍</span>
          Se descuenta del stock de <span style={{ color: 'var(--iw-plum)' }}>{fromStore}</span>. Verifica que sea el
          local correcto.
        </div>
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 12, marginTop: 15 }}>
        <div style={{ minWidth: 0 }}>
          <label style={labelStyle}>Nombre del cliente (opcional)</label>
          <input
            value={customer}
            onChange={(e) => setCustomer(e.target.value)}
            placeholder="Venta rápida"
            style={inputStyle}
          />
        </div>
        <div style={{ minWidth: 0 }}>
          <label style={labelStyle}>Teléfono (opcional)</label>
          <input
            value={phone}
            // Se guarda solo lo marcable: dígitos, espacios y el "+" del indicativo.
            onChange={(e) => setPhone(e.target.value.replace(/[^\d+ ]/g, ''))}
            inputMode="tel"
            autoComplete="tel"
            placeholder="300 000 0000"
            style={inputStyle}
          />
        </div>
      </div>
      <p style={{ margin: '7px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
        Con el teléfono puedes avisarle de un cambio o una talla que llegó.
      </p>

      <div style={{ marginTop: 14 }}>
        <label style={{ ...labelStyle, fontSize: 11.5, letterSpacing: '.1em', color: 'var(--text-muted)' }}>
          MÉTODO DE PAGO
        </label>
        <select
          value={payment}
          onChange={(e) => setPayment(e.target.value as PaymentMethod)}
          style={{ ...inputStyle, cursor: 'pointer' }}
        >
          {PAYMENT_METHODS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>

      {payment === 'Otro' ? (
        <div style={{ marginTop: 14 }}>
          <label style={labelStyle}>¿Qué medio de pago fue?</label>
          <input
            value={otherName}
            onChange={(e) => setOtherName(e.target.value)}
            placeholder="Ej: Bono, crédito de tienda, dólares…"
            autoFocus
            style={inputStyle}
          />
        </div>
      ) : null}

      {payment === 'Efectivo' ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 14 }}>
          <div>
            <label style={labelStyle}>Monto recibido</label>
            <input
              value={formatMoneyInput(received)}
              onChange={(e) => setReceived(e.target.value.replace(/\D/g, ''))}
              inputMode="numeric"
              placeholder="$0"
              style={{ ...inputStyle, fontWeight: 700, fontSize: 16 }}
            />
          </div>
          <div>
            <label style={labelStyle}>Vueltas</label>
            <div
              style={{
                marginTop: 7,
                height: 48,
                display: 'flex',
                alignItems: 'center',
                padding: '0 14px',
                borderRadius: 'var(--radius-lg)',
                background: change >= 0 ? 'rgba(21,119,79,.1)' : 'rgba(224,52,29,.1)',
                font: '700 17px var(--font-display)',
                color: change >= 0 ? 'var(--color-success)' : 'var(--color-danger)',
              }}
            >
              {change >= 0 ? formatMoney(money(change)) : `Faltan ${formatMoney(money(-change))}`}
            </div>
          </div>
        </div>
      ) : null}

      <ErrorNote text={error} />

      <Actions>
        <GhostButton label="Cancelar" onClick={onClose} />
        <AccentButton
          grow
          label={busy ? 'Registrando…' : 'Confirmar venta'}
          disabled={busy || cashShort || otherMissing}
          onClick={() => onConfirm(effectivePayment, customer.trim(), phone.trim())}
        />
      </Actions>
    </Overlay>
  )
}

// ── Devolución ───────────────────────────────────────────────────────────────

/**
 * Devolución a partir del PRODUCTO escaneado.
 *
 * La venta rara vez queda a nombre de alguien (en temporada no hay tiempo de
 * pedir nombre ni celular), pero el cliente siempre trae el zapato. Por eso el
 * flujo arranca del par escaneado:
 *   Paso 1: se listan automáticamente las ventas que incluyeron ese producto,
 *           de la más reciente a la más antigua, para elegir la correcta.
 *   Paso 2: se eligen tallas y cantidades a devolver, con tope en lo que queda
 *           por devolver de esa venta (lo vendido menos lo ya devuelto).
 *
 * Salida de emergencia para "no aparece la venta": devolver el par suelto, sin
 * venta asociada.
 */
export function DevolucionModal({
  fallback,
  catalog,
  localStockOf,
  busy,
  error,
  onClose,
  onConfirm,
  onExchange,
}: {
  fallback: CartLine | null
  /** Catálogo en vivo, para elegir el par de cambio. */
  catalog: ProductWithVariants[]
  /** Stock de una variante en el local actual (tope del par de cambio). */
  localStockOf: (variantId: string) => number
  busy: boolean
  error: string
  onClose: () => void
  onConfirm: (
    sale: Sale | null,
    items: { variantId: VariantId; quantity: number }[],
    reason: ReturnReason,
  ) => void
  onExchange: (
    sale: Sale | null,
    returnItems: { variantId: VariantId; quantity: number }[],
    reason: ReturnReason,
    replacement: { variantId: VariantId; quantity: number; payment: string },
  ) => void
}) {
  const [results, setResults] = useState<Sale[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [sale, setSale] = useState<Sale | null>(null)
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [reason, setReason] = useState<ReturnReason>('Talla incorrecta')
  /** `true` cuando se devuelve el par escaneado, sin venta asociada. */
  const [loose, setLoose] = useState(false)

  // ── Cambio: entregar otro par a cambio (mismo precio o mayor) ──────────────
  const [exchange, setExchange] = useState(false)
  const [replTerm, setReplTerm] = useState('')
  const [replVariantId, setReplVariantId] = useState<VariantId | null>(null)
  const [replQty, setReplQty] = useState(1)
  const [diffPayment, setDiffPayment] = useState<PaymentMethod>('Efectivo')
  const [diffOther, setDiffOther] = useState('')

  // Al abrir, se buscan solas las ventas que incluyeron el par escaneado.
  useEffect(() => {
    if (!fallback) return
    let cancelled = false
    setSearching(true)
    setSearchError('')
    movementRepository
      .searchSalesByVariant(String(fallback.variantId))
      .then((found) => {
        if (cancelled) return
        setResults(found)
        if (found.length === 0) {
          setSearchError('No hay ventas registradas de este producto. Puedes devolverlo sin venta asociada.')
        }
      })
      .catch(() => {
        if (!cancelled) setSearchError('No se pudo consultar el historial. Revisa tu conexión.')
      })
      .finally(() => {
        if (!cancelled) setSearching(false)
      })
    return () => {
      cancelled = true
    }
  }, [fallback])

  const pick = (chosen: Sale) => {
    setSale(chosen)
    setLoose(false)
    // Preselecciona el par ESCANEADO (el que trae el cliente) si esa venta lo
    // tiene pendiente; si no, la primera talla con saldo por devolver.
    const target =
      chosen.lines.find((l) => String(l.variantId) === String(fallback?.variantId) && l.remaining > 0) ??
      chosen.lines.find((l) => l.remaining > 0)
    setQuantities(target ? { [String(target.variantId)]: 1 } : {})
  }

  const pickLoose = () => {
    if (!fallback) return
    setLoose(true)
    setSale(null)
    setQuantities({ [String(fallback.variantId)]: 1 })
  }

  const bump = (variantId: VariantId, delta: number, max: number) =>
    setQuantities((prev) => {
      const key = String(variantId)
      const next = Math.min(max, Math.max(0, (prev[key] ?? 0) + delta))
      return { ...prev, [key]: next }
    })

  const selectedLines = loose && fallback
    ? [{ variantId: fallback.variantId, productName: fallback.name, size: fallback.size, barcode: fallback.barcode, unitPrice: fallback.unitPrice, sold: 0, returned: 0, remaining: 99 }]
    : (sale?.lines ?? [])

  const total = money(
    selectedLines.reduce((sum, l) => sum + l.unitPrice * (quantities[String(l.variantId)] ?? 0), 0),
  )
  const units = selectedLines.reduce((sum, l) => sum + (quantities[String(l.variantId)] ?? 0), 0)
  const chosen = sale !== null || loose

  // Candidatos para el par de cambio: variantes con stock en el local actual.
  const replCandidates = (() => {
    const t = replTerm.trim().toLowerCase()
    const out: { variantId: VariantId; name: string; sku: string; size: number; price: number; stock: number }[] = []
    for (const r of catalog) {
      if (t && !r.product.name.toLowerCase().includes(t) && !r.product.sku.toLowerCase().includes(t)) continue
      for (const v of r.variants) {
        const stock = localStockOf(String(v.id))
        if (stock > 0) out.push({ variantId: v.id, name: r.product.name, sku: r.product.sku, size: v.size, price: r.product.price, stock })
      }
    }
    return out.slice(0, 8)
  })()
  const repl = (() => {
    for (const r of catalog) {
      const v = r.variants.find((x) => x.id === replVariantId)
      if (v) return { variantId: v.id, name: r.product.name, size: v.size, price: r.product.price, stock: localStockOf(String(v.id)) }
    }
    return null
  })()
  const replValue = repl ? repl.price * replQty : 0
  const difference = replValue - total // ≥ 0 exigido: el cambio nunca devuelve plata
  const replCheaper = exchange && repl !== null && replValue < total
  const diffOtherMissing = difference > 0 && diffPayment === 'Otro' && diffOther.trim().length === 0
  const diffPaymentValue = diffPayment === 'Otro' && diffOther.trim() ? diffOther.trim() : diffPayment
  const exchangeReady =
    exchange && repl !== null && replQty >= 1 && replQty <= repl.stock && !replCheaper && !diffOtherMissing

  return (
    <Overlay onClose={onClose} width={520}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span
          style={{
            background: 'var(--iw-plum)',
            color: '#fff',
            font: '700 11px var(--font-body)',
            letterSpacing: '.1em',
            padding: '6px 12px',
            borderRadius: 'var(--radius-pill)',
          }}
        >
          DEVOLUCIÓN
        </span>
        <h2 style={{ margin: 0, font: '700 22px var(--font-display)' }}>Registrar devolución</h2>
      </div>

      {!chosen ? (
        <>
          {fallback ? (
            <div style={{ marginTop: 12, background: 'var(--surface-muted)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', padding: '12px 15px' }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '.08em' }}>PAR ESCANEADO</div>
              <div style={{ font: '700 15px var(--font-display)', marginTop: 3 }}>
                {fallback.name} · T{fallback.size}
              </div>
              <div style={{ font: '600 12px var(--font-mono)', color: 'var(--text-muted)', marginTop: 2 }}>{fallback.barcode}</div>
            </div>
          ) : (
            <p style={{ margin: '12px 0 0', color: 'var(--text-muted)', fontSize: 14.5, lineHeight: 1.5 }}>
              Escanea primero el par que vas a devolver. Con eso busco las ventas de ese producto y amarras la
              devolución a la correcta.
            </p>
          )}

          {fallback ? (
            <p style={{ margin: '12px 0 0', color: 'var(--text-muted)', fontSize: 14, lineHeight: 1.5 }}>
              {searching
                ? 'Buscando las ventas de este producto…'
                : 'Elige la venta que corresponde. La devolución queda amarrada a esa venta y no se puede devolver dos veces el mismo par.'}
            </p>
          ) : null}

          <ErrorNote text={searchError} />

          {results && results.length > 0 ? (
            <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 260, overflowY: 'auto' }}>
              {results.map((s) => (
                <button
                  key={s.saleId}
                  onClick={() => pick(s)}
                  className="iw-row"
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    background: 'var(--surface-card)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-lg)',
                    padding: '12px 14px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ font: '700 15px var(--font-display)' }}>
                      {s.customerName || 'Venta rápida'}
                    </div>
                    <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 2 }}>
                      {[
                        formatShortDate(s.occurredAt),
                        formatTime(s.occurredAt),
                        s.customerPhone,
                        s.payment,
                        `Local ${s.storeId}`,
                        s.userName,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                    <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 3 }}>
                      {s.lines.map((l) => `${l.productName} T${l.size} ×${l.remaining}/${l.sold}`).join('  ·  ')}
                    </div>
                  </div>
                  <span style={{ font: '700 16px var(--font-display)', whiteSpace: 'nowrap' }}>{formatMoney(s.total)}</span>
                </button>
              ))}
            </div>
          ) : null}

          {fallback ? (
            <button
              onClick={pickLoose}
              style={{
                marginTop: 16,
                background: 'none',
                border: 'none',
                padding: 0,
                cursor: 'pointer',
                color: 'var(--text-muted)',
                font: '700 13px var(--font-body)',
                textAlign: 'left',
              }}
            >
              ¿No aparece la venta? Devolver este par sin venta asociada
            </button>
          ) : null}

          <Actions>
            <GhostButton label="Cerrar" onClick={onClose} />
          </Actions>
        </>
      ) : (
        <>
          <div
            style={{
              marginTop: 16,
              background: 'var(--surface-muted)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-lg)',
              padding: '13px 16px',
            }}
          >
            {sale ? (
              <>
                <div style={{ font: '700 16px var(--font-display)' }}>{sale.customerName || 'Venta rápida'}</div>
                <div style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 3 }}>
                  {[sale.customerPhone, formatShortDate(sale.occurredAt), formatTime(sale.occurredAt), sale.payment]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
              </>
            ) : (
              <div style={{ font: '700 15px var(--font-display)' }}>
                Devolución suelta · sin venta asociada
              </div>
            )}
          </div>

          <div style={{ marginTop: 16, ...labelStyle }}>¿Qué se devuelve?</div>
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {selectedLines.map((l) => {
              const key = String(l.variantId)
              const value = quantities[key] ?? 0
              const disabled = l.remaining === 0
              return (
                <div
                  key={key}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-lg)',
                    padding: '10px 14px',
                    opacity: disabled ? 0.5 : 1,
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ font: '700 14.5px var(--font-display)' }}>
                      {l.productName} · T{l.size}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                      {formatMoney(l.unitPrice)}
                      {sale ? ` · quedan ${l.remaining} de ${l.sold}` : ''}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                    <button
                      onClick={() => bump(l.variantId, -1, l.remaining)}
                      disabled={disabled}
                      style={stepStyle}
                      aria-label="Quitar uno"
                    >
                      −
                    </button>
                    <span style={{ minWidth: 20, textAlign: 'center', font: '700 17px var(--font-display)' }}>{value}</span>
                    <button
                      onClick={() => bump(l.variantId, 1, l.remaining)}
                      disabled={disabled}
                      style={stepStyle}
                      aria-label="Agregar uno"
                    >
                      +
                    </button>
                  </div>
                </div>
              )
            })}
          </div>

          <div style={{ marginTop: 16, ...labelStyle }}>Razón de la devolución</div>
          <select
            value={reason}
            onChange={(e) => setReason(e.target.value as ReturnReason)}
            style={{ ...inputStyle, cursor: 'pointer' }}
          >
            {RETURN_REASONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>

          <div
            style={{
              marginTop: 16,
              background: 'var(--surface-muted)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-lg)',
              padding: '14px 16px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span style={{ color: 'var(--text-secondary)', fontSize: 15 }}>
              {units} {units === 1 ? 'par' : 'pares'} · vuelve al inventario
            </span>
            <span style={{ font: '700 20px var(--font-display)' }}>{formatMoney(total)}</span>
          </div>

          {/* ── Cambio: entregar otro par ─────────────────────────────────── */}
          <label style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={exchange}
              onChange={(e) => setExchange(e.target.checked)}
              style={{ width: 18, height: 18, accentColor: 'var(--iw-plum)', cursor: 'pointer' }}
            />
            <span style={{ font: '700 14px var(--font-body)', color: 'var(--text-primary)' }}>
              Entregar otro par a cambio <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>(mismo precio o mayor)</span>
            </span>
          </label>

          {exchange ? (
            <div style={{ marginTop: 12, border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {!repl ? (
                <>
                  <input
                    value={replTerm}
                    onChange={(e) => setReplTerm(e.target.value)}
                    placeholder="Busca el par que le vas a dar…"
                    autoFocus
                    style={inputStyle}
                  />
                  {replCandidates.length === 0 ? (
                    <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                      {replTerm.trim() ? 'Sin resultados con stock en tu local.' : 'Escribe el nombre o código del par de cambio.'}
                    </span>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 200, overflowY: 'auto' }}>
                      {replCandidates.map((c) => (
                        <button
                          key={c.variantId}
                          onClick={() => {
                            setReplVariantId(c.variantId)
                            setReplQty(1)
                          }}
                          className="iw-row"
                          style={{ display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: '9px 12px', cursor: 'pointer' }}
                        >
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ font: '700 13.5px var(--font-display)' }}>{c.name} · T{c.size}</div>
                            <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{c.sku} · {c.stock} en tu local</div>
                          </div>
                          <span style={{ font: '700 13px var(--font-display)', whiteSpace: 'nowrap' }}>{formatMoney(money(c.price))}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '.06em' }}>PAR DE CAMBIO</div>
                      <div style={{ font: '700 14.5px var(--font-display)', marginTop: 2 }}>{repl.name} · T{repl.size}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{formatMoney(money(repl.price))} · {repl.stock} en tu local</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                      <button onClick={() => setReplQty((q) => Math.max(1, q - 1))} style={stepStyle} aria-label="Quitar uno">−</button>
                      <span style={{ minWidth: 20, textAlign: 'center', font: '700 17px var(--font-display)' }}>{replQty}</span>
                      <button onClick={() => setReplQty((q) => Math.min(repl.stock, q + 1))} style={stepStyle} aria-label="Agregar uno">+</button>
                    </div>
                    <button
                      onClick={() => { setReplVariantId(null); setReplTerm('') }}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', font: '700 12px var(--font-body)' }}
                    >
                      Cambiar
                    </button>
                  </div>

                  {replCheaper ? (
                    <div style={{ background: 'rgba(224,52,29,.1)', border: '1px solid rgba(224,52,29,.3)', borderRadius: 'var(--radius-md)', padding: '9px 12px', color: 'var(--color-danger)', fontSize: 12.5, fontWeight: 700 }}>
                      El par de cambio debe valer igual o más que el devuelto ({formatMoney(total)}). No se devuelve dinero.
                    </div>
                  ) : difference > 0 ? (
                    <>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,209,0,.16)', border: '1px solid rgba(255,209,0,.5)', borderRadius: 'var(--radius-md)', padding: '10px 13px' }}>
                        <span style={{ fontSize: 14, color: 'var(--text-secondary)', fontWeight: 700 }}>Diferencia a cobrar</span>
                        <span style={{ font: '700 20px var(--font-display)' }}>{formatMoney(money(difference))}</span>
                      </div>
                      <div>
                        <label style={{ ...labelStyle, fontSize: 11.5, letterSpacing: '.1em', color: 'var(--text-muted)' }}>MÉTODO DE PAGO DE LA DIFERENCIA</label>
                        <select value={diffPayment} onChange={(e) => setDiffPayment(e.target.value as PaymentMethod)} style={{ ...inputStyle, cursor: 'pointer' }}>
                          {PAYMENT_METHODS.map((m) => (<option key={m} value={m}>{m}</option>))}
                        </select>
                      </div>
                      {diffPayment === 'Otro' ? (
                        <input value={diffOther} onChange={(e) => setDiffOther(e.target.value)} placeholder="¿Qué medio de pago fue?" style={inputStyle} />
                      ) : null}
                    </>
                  ) : (
                    <div style={{ fontSize: 13, color: 'var(--color-success)', fontWeight: 700 }}>Mismo valor · sin diferencia a cobrar.</div>
                  )}
                </>
              )}
            </div>
          ) : null}

          <ErrorNote text={error} />

          <Actions>
            <GhostButton
              label="Volver"
              onClick={() => {
                setSale(null)
                setLoose(false)
                setQuantities({})
              }}
            />
            {(() => {
              const returnItems = selectedLines
                .map((l) => ({ variantId: l.variantId, quantity: quantities[String(l.variantId)] ?? 0 }))
                .filter((i) => i.quantity > 0)
              const disabled = busy || units === 0 || (exchange && !exchangeReady)
              const submit = () => {
                if (exchange && repl) {
                  onExchange(sale, returnItems, reason, { variantId: repl.variantId, quantity: replQty, payment: diffPaymentValue })
                } else {
                  onConfirm(sale, returnItems, reason)
                }
              }
              return (
                <button
                  onClick={submit}
                  disabled={disabled}
                  className="iw-press"
                  style={{
                    flex: 1.2,
                    height: 48,
                    background: 'var(--iw-plum)',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 'var(--radius-lg)',
                    font: '700 15px var(--font-body)',
                    cursor: disabled ? 'not-allowed' : 'pointer',
                    opacity: disabled ? 0.5 : 1,
                  }}
                >
                  {busy ? 'Registrando…' : exchange ? 'Registrar cambio' : 'Confirmar devolución'}
                </button>
              )
            })()}
          </Actions>
        </>
      )}
    </Overlay>
  )
}

const stepStyle: React.CSSProperties = {
  width: 34,
  height: 34,
  borderRadius: 10,
  border: '1px solid var(--border-subtle)',
  background: 'var(--surface-muted)',
  cursor: 'pointer',
  font: '700 17px var(--font-body)',
  color: 'var(--text-secondary)',
  lineHeight: 1,
}
