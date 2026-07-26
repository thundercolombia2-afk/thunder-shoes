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
  busy,
  error,
  onClose,
  onConfirm,
}: {
  total: Money
  busy: boolean
  error: string
  onClose: () => void
  onConfirm: (payment: PaymentMethod, customerName: string, customerPhone: string) => void
}) {
  const [payment, setPayment] = useState<PaymentMethod>('Efectivo')
  const [customer, setCustomer] = useState('')
  const [phone, setPhone] = useState('')
  const [received, setReceived] = useState('')

  const receivedValue = parseMoneyInput(received)
  const change = receivedValue - total
  const cashShort = payment === 'Efectivo' && receivedValue < total

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
          disabled={busy || cashShort}
          onClick={() => onConfirm(payment, customer.trim(), phone.trim())}
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
  busy,
  error,
  onClose,
  onConfirm,
}: {
  fallback: CartLine | null
  busy: boolean
  error: string
  onClose: () => void
  onConfirm: (
    sale: Sale | null,
    items: { variantId: VariantId; quantity: number }[],
    reason: ReturnReason,
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
            <button
              onClick={() =>
                onConfirm(
                  sale,
                  selectedLines
                    .map((l) => ({ variantId: l.variantId, quantity: quantities[String(l.variantId)] ?? 0 }))
                    .filter((i) => i.quantity > 0),
                  reason,
                )
              }
              disabled={busy || units === 0}
              className="iw-press"
              style={{
                flex: 1.2,
                height: 48,
                background: 'var(--iw-plum)',
                color: '#fff',
                border: 'none',
                borderRadius: 'var(--radius-lg)',
                font: '700 15px var(--font-body)',
                cursor: busy || units === 0 ? 'not-allowed' : 'pointer',
                opacity: busy || units === 0 ? 0.5 : 1,
              }}
            >
              {busy ? 'Registrando…' : 'Confirmar devolución'}
            </button>
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
