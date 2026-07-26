/**
 * Pantalla de venta (home). En una caja real el lector de código de barras USB
 * se comporta como un teclado: escribe el código en el campo enfocado y envía
 * Enter. Por eso el "visor" es un input autoenfocado; también funciona
 * escribiendo a mano el código o buscando por nombre en la lista de sugerencias.
 *
 * Todo lo escaneado se va acumulando en un CARRITO y se cobra de una sola vez:
 * es una venta, no un movimiento suelto por par.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSession } from '@/app/session'
import { useCart, type CartLine } from '@/app/cart'
import { useCatalog } from '@/app/hooks'
import { useIsMobile } from '@/app/useMediaQuery'
import { useScanWithOverlay } from '@/app/scanFlow'
import { CameraScanner, cameraScanSupported } from '@/app/CameraScanner'
import { catalogRepository } from '@/data/repositories/catalogRepository'
import { movementRepository } from '@/data/repositories/movementRepository'
import { bodegaRepository } from '@/data/repositories/bodegaRepository'
import {
  money,
  type ReturnReason,
  type VariantId,
  type VariantWithProduct,
} from '@/domain/models'
import type { Sale } from '@/domain/sales'
import type { Bodega } from '@/domain/models'
import { errorMessage, variantStatus } from '@/domain/rules'
import { bodegaKey, stockAt, storeKey } from '@/domain/locations'
import { formatMoney } from '@/lib/format'
import { Icon } from '@/ui/Icon'
import { CobroModal, DevolucionModal } from './SellModals'
import { BodegaModal } from './BodegaModal'

type Dialog = 'none' | 'cobro' | 'devolucion' | 'bodega'

export function ScanScreen() {
  const { store, actor, user, can } = useSession()
  const { data: catalog } = useCatalog()
  const cart = useCart()
  const scanWithOverlay = useScanWithOverlay()
  const isMobile = useIsMobile()
  const navigate = useNavigate()

  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [dialog, setDialog] = useState<Dialog>('none')
  const [busy, setBusy] = useState(false)
  const [dialogError, setDialogError] = useState('')
  const [camera, setCamera] = useState(false)
  const [bodegas, setBodegas] = useState<Bodega[]>([])
  useEffect(() => bodegaRepository.subscribe(setBodegas), [])
  const inputRef = useRef<HTMLInputElement>(null)
  const canUseCamera = useMemo(cameraScanSupported, [])

  // Bodegas activas que el usuario puede operar: la dueña las opera todas; los
  // demás, solo las que se les autorizaron en Configuración → Autorizaciones.
  const activeAuthorizedBodegaIds = useMemo(
    () =>
      bodegas
        .filter((b) => b.active && (user?.owner || (user?.bodegaIds ?? []).includes(b.id)))
        .map((b) => b.id),
    [bodegas, user],
  )
  const hasBodegaAccess = activeAuthorizedBodegaIds.length > 0

  useEffect(() => {
    // En móvil NO se autoenfoca: abriría el teclado y taparía media pantalla.
    // El lector USB solo existe en el mostrador, y ahí la pantalla es ancha.
    if (!isMobile) inputRef.current?.focus()
  }, [isMobile])

  /** Índice plano del catálogo en vivo: resuelve un escaneo sin ir a la red. */
  const index = useMemo(
    () =>
      catalog.flatMap(({ product, variants }) =>
        variants
          .filter((variant) => variant.active)
          .map((variant) => ({ product, variant, key: `${variant.barcode} ${product.name} ${product.sku}`.toUpperCase() })),
      ),
    [catalog],
  )

  const term = query.trim().toUpperCase()
  const suggestions = useMemo(
    () => (term ? index.filter((e) => e.key.includes(term)).slice(0, 8) : []),
    [index, term],
  )

  /** Stock de una variante en una ubicación concreta (para la vista de bodega). */
  const stockAtLoc = (variantId: string, key: string) =>
    index.find((e) => e.variant.id === variantId)?.variant.stockByLocation[key] ?? 0

  // Stock que se puede VENDER aquí: el del local actual. Sin local (bodeguero),
  // no hay venta como tal; se usa el total para no falsear el tope.
  const localKey = store ? storeKey(store.id) : null
  const saleStockOf = (v: VariantWithProduct['variant']): number =>
    localKey ? stockAt(v.stockByLocation, localKey) : v.stock
  // Quien opera bodega (por rol o por autorización) necesita mover cantidades
  // mayores que un local (traslados), así que su tope es el total; el vendedor
  // puro queda topado a su local.
  const canOperateBodega = can('operateBodega') || hasBodegaAccess
  const capOf = (v: VariantWithProduct['variant']): number =>
    canOperateBodega ? v.stock : saleStockOf(v)

  const addToCart = (found: VariantWithProduct) => {
    if (found.variant.stock <= 0) {
      setError(`${found.product.name} talla ${found.variant.size} está agotado.`)
      return
    }
    setError('')
    setNotice('')
    cart.add(found, capOf(found.variant), saleStockOf(found.variant))
    setQuery('')
    if (!isMobile) inputRef.current?.focus()
  }

  // Venta bloqueada si alguna talla supera lo disponible en el local (aplica sobre
  // todo a quien opera bodega, cuyo tope de carrito es el total del sistema).
  const saleExceeds = cart.lines.some((l) => l.quantity > l.saleStock)

  const resolve = async (raw: string) => {
    const code = raw.trim()
    if (!code) return
    // El catálogo ya está en memoria y en vivo: primero se busca ahí.
    const local = index.find((e) => e.variant.barcode.toUpperCase() === code.toUpperCase())
    if (local) {
      addToCart({ product: local.product, variant: local.variant })
      return
    }
    setError('')
    const found = await scanWithOverlay(() => catalogRepository.findByBarcode(code)).catch((e) => {
      setError(errorMessage(e))
      return null
    })
    if (found) addToCart(found)
    else inputRef.current?.focus()
  }

  const submit = () => {
    // Enter con sugerencias abiertas toma la primera, como en el diseño.
    const first = suggestions[0]
    if (first) addToCart({ product: first.product, variant: first.variant })
    else void resolve(query)
  }

  // ── Registro de la venta ───────────────────────────────────────────────────

  const registerSale = async (payment: string, customerName: string, customerPhone = '') => {
    if (!actor || cart.lines.length === 0) return
    // Red de seguridad: nunca vender más de lo disponible en el local (el tope del
    // carrito ya lo impide para el vendedor, pero quien opera bodega tiene tope
    // total). La transacción revalida igual en el servidor.
    const over = cart.lines.find((l) => l.quantity > l.saleStock)
    if (over) {
      setDialogError(`Solo hay ${over.saleStock} de ${over.name} T${over.size} en tu local. Ajusta la cantidad.`)
      return
    }
    setBusy(true)
    setDialogError('')
    try {
      await movementRepository.recordMany(
        cart.lines.map((l) => ({ type: 'sale' as const, variantId: l.variantId, quantity: l.quantity })),
        actor,
        {
          payment,
          ...(customerName ? { customerName } : {}),
          ...(customerPhone ? { customerPhone } : {}),
        },
      )
      const who = customerName ? ` · ${customerName}` : ''
      setNotice(`Venta registrada · ${payment}${who} · ${formatMoney(cart.total)}`)
      cart.clear()
      setDialog('none')
      inputRef.current?.focus()
    } catch (e) {
      setDialogError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  /**
   * Devolución contra la venta original: se hereda cliente, teléfono y forma de
   * pago de esa venta, y los asientos quedan colgados de su mismo `saleId`.
   */
  const registerReturn = async (
    sale: Sale | null,
    items: { variantId: VariantId; quantity: number }[],
    reason: ReturnReason,
  ) => {
    if (!actor || items.length === 0) return
    setBusy(true)
    setDialogError('')
    try {
      const recorded = await movementRepository.recordMany(
        items.map((i) => ({ type: 'return' as const, ...i, returnReason: reason })),
        actor,
        sale
          ? {
              payment: sale.payment,
              saleId: sale.saleId,
              ...(sale.customerName ? { customerName: sale.customerName } : {}),
              ...(sale.customerPhone ? { customerPhone: sale.customerPhone } : {}),
            }
          : { payment: '' },
      )
      const units = recorded.reduce((sum, m) => sum + m.quantity, 0)
      const who = sale?.customerName ? ` · ${sale.customerName}` : ''
      setNotice(`Devolución registrada · ${units} ${units === 1 ? 'par' : 'pares'}${who} · ${reason}`)
      setDialog('none')
    } catch (e) {
      setDialogError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  /**
   * Salida o retorno de bodega. Mueve el carrito escaneado entre una bodega y el
   * local de un usuario, sin cambiar el total del sistema (es un traslado).
   */
  const registerBodega = async (action: 'salida' | 'retorno', bodega: Bodega, targetStoreId: string) => {
    if (!actor || cart.lines.length === 0) return
    setBusy(true)
    setDialogError('')
    try {
      const from = action === 'salida' ? bodegaKey(bodega.id) : storeKey(targetStoreId)
      const to = action === 'salida' ? storeKey(targetStoreId) : bodegaKey(bodega.id)
      const drafts = cart.lines.map((l) => ({
        type: action,
        variantId: l.variantId,
        quantity: l.quantity,
        fromLocation: from,
        toLocation: to,
      }))
      const recorded = await movementRepository.recordMany(drafts, actor)
      const units = recorded.reduce((sum, m) => sum + m.quantity, 0)
      const verb = action === 'salida' ? 'Salida' : 'Retorno'
      setNotice(`${verb} · ${bodega.code} · ${units} ${units === 1 ? 'par' : 'pares'}`)
      cart.clear()
      setDialog('none')
      if (!isMobile) inputRef.current?.focus()
    } catch (e) {
      setDialogError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  /** Salida de emergencia si la venta no quedó a nombre de nadie. */
  const returnFallback = cart.lastScanned ?? cart.lines[0] ?? null

  const openDialog = (next: Dialog) => {
    setDialogError('')
    setDialog(next)
  }

  return (
    <div
      className="iw-fade"
      style={{ padding: isMobile ? '18px 16px 28px' : '30px 36px 48px', display: 'flex', flexDirection: 'column', gap: 16 }}
    >
      <div>
        <div style={{ font: '700 12px var(--font-body)', letterSpacing: '.14em', color: 'var(--text-muted)' }}>
          LOCAL {store?.code}
        </div>
        <h1 style={{ margin: '6px 0 6px', font: `700 ${isMobile ? 26 : 32}px var(--font-display)`, letterSpacing: '-.01em' }}>
          Escanea producto
        </h1>
        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 15 }}>
          Escanea un código de barras para registrar una venta, dar crédito, devolver o cambiar un producto.
        </p>
      </div>

      {/* Visor de escaneo */}
      <form
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
        style={{
          position: 'relative',
          background: 'linear-gradient(160deg,#26261f 0%,#101010 55%,#0b0b0b 100%)',
          border: '1px solid #2a2a24',
          borderRadius: 'var(--radius-2xl)',
          padding: 18,
          boxShadow: 'var(--shadow-md)',
        }}
      >
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 13,
            background: '#1b1b18',
            border: '1px solid #33332b',
            borderRadius: 'var(--radius-lg)',
            padding: '0 16px',
            height: 54,
          }}
        >
          <Icon name="barcode" size={22} color="var(--iw-yellow)" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Esperando código…"
            autoComplete="off"
            spellCheck={false}
            style={{
              flex: 1,
              minWidth: 0,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: '#f4f4f4',
              fontSize: 18,
              fontFamily: 'var(--font-mono)',
              letterSpacing: '.02em',
            }}
          />
          <span
            style={{
              width: 12,
              height: 12,
              borderRadius: '50%',
              background: 'var(--iw-yellow)',
              boxShadow: '0 0 0 4px rgba(255,209,0,.18)',
              animation: 'iwscan 1.4s ease-in-out infinite',
            }}
          />
        </label>

        <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
          <button
            type="submit"
            className="iw-press"
            style={{
              flex: 1,
              height: 56,
              background: 'var(--iw-yellow)',
              color: '#0c0c0d',
              border: 'none',
              borderRadius: 'var(--radius-lg)',
              font: '700 17px var(--font-display)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 11,
            }}
          >
            <Icon name="plus" size={22} strokeWidth={2.6} />
            Agregar producto
          </button>

          {canUseCamera ? (
            <button
              type="button"
              onClick={() => setCamera(true)}
              className="iw-press"
              title="Escanear con la cámara"
              style={{
                flex: 'none',
                width: isMobile ? 64 : 150,
                height: 56,
                background: 'rgba(255,255,255,.1)',
                border: '1px solid #33332b',
                color: 'var(--iw-cream)',
                borderRadius: 'var(--radius-lg)',
                font: '700 14px var(--font-display)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
              }}
            >
              <Icon name="camera" size={22} />
              {isMobile ? '' : 'Cámara'}
            </button>
          ) : null}
        </div>

        {suggestions.length > 0 ? (
          <div
            style={{
              position: 'absolute',
              left: 18,
              right: 18,
              top: 72,
              zIndex: 40,
              background: 'var(--surface-card)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-lg)',
              boxShadow: 'var(--shadow-lg)',
              overflow: 'hidden',
              maxHeight: 280,
              overflowY: 'auto',
            }}
          >
            {suggestions.map((s) => (
              <button
                key={s.variant.id}
                type="button"
                onClick={() => addToCart({ product: s.product, variant: s.variant })}
                className="iw-row"
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  padding: '12px 16px',
                  background: 'var(--surface-card)',
                  border: 'none',
                  borderBottom: '1px solid var(--border-subtle)',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <span style={{ font: '700 13.5px var(--font-mono)', color: 'var(--text-primary)' }}>
                  {s.variant.barcode}
                </span>
                <span style={{ fontSize: 13.5, color: 'var(--text-muted)' }}>
                  {s.product.name} · stock {s.variant.stock}
                </span>
              </button>
            ))}
          </div>
        ) : null}
      </form>

      {/* Último código escaneado */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          flexWrap: 'wrap',
          background: 'var(--surface-card)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-lg)',
          padding: '13px 17px',
        }}
      >
        <span style={{ font: '700 12px var(--font-body)', letterSpacing: '.12em', color: 'var(--text-muted)' }}>
          CÓDIGO ESCANEADO
        </span>
        <span
          style={{
            font: '700 16px var(--font-mono)',
            letterSpacing: '.02em',
            color: cart.lastScanned ? 'var(--text-primary)' : 'var(--border-subtle)',
          }}
        >
          {cart.lastScanned?.barcode ?? '—'}
        </span>
        <span style={{ color: 'var(--text-muted)', fontSize: 14, marginLeft: 'auto' }}>
          {cart.lastScanned?.name ?? 'Sin escaneos aún'}
        </span>
      </div>

      {error ? <Banner tone="danger" text={error} /> : null}
      {notice ? <Banner tone="success" text={notice} /> : null}

      {/* Carrito + resumen */}
      <div
        style={{
          marginTop: 6,
          display: 'grid',
          gridTemplateColumns: isMobile ? '1fr' : '1fr 320px',
          gap: 20,
          alignItems: 'start',
        }}
      >
        <CartTable compact={isMobile} />
        <SummaryPanel
          items={cart.items}
          units={cart.units}
          total={formatMoney(cart.total)}
          hasItems={cart.lines.length > 0}
          saleBlocked={saleExceeds}
          bodegaBlocked={!hasBodegaAccess}
          sticky={!isMobile}
          onCobrar={() => openDialog('cobro')}
          onDevolucion={() => openDialog('devolucion')}
          onCancel={cart.clear}
          onBodega={() => openDialog('bodega')}
        />
      </div>

      <button
        onClick={() => navigate('/inventory/add')}
        style={{
          alignSelf: 'flex-start',
          background: 'none',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          color: 'var(--text-muted)',
          font: '700 13px var(--font-body)',
          display: 'flex',
          alignItems: 'center',
          gap: 7,
        }}
      >
        <Icon name="box" size={16} /> ¿Llegó mercancía? Agregar producto al inventario
      </button>

      {camera ? (
        <CameraScanner
          onClose={() => setCamera(false)}
          onDetected={(code) => {
            setCamera(false)
            void resolve(code)
          }}
        />
      ) : null}

      {dialog === 'cobro' ? (
        <CobroModal
          total={cart.total}
          fromStore={store ? `Local ${store.code}` : ''}
          busy={busy}
          error={dialogError}
          onClose={() => setDialog('none')}
          onConfirm={(payment: string, customer: string, phone: string) =>
            void registerSale(payment, customer, phone)
          }
        />
      ) : null}

      {dialog === 'devolucion' ? (
        <DevolucionModal
          fallback={returnFallback}
          busy={busy}
          error={dialogError}
          onClose={() => setDialog('none')}
          onConfirm={(sale, items, reason) => void registerReturn(sale, items, reason)}
        />
      ) : null}

      {dialog === 'bodega' ? (
        <BodegaModal
          lines={cart.lines}
          authorizedBodegaIds={activeAuthorizedBodegaIds}
          stockAtLoc={stockAtLoc}
          busy={busy}
          error={dialogError}
          onClose={() => setDialog('none')}
          onConfirm={(action, bodega, targetStoreId) => void registerBodega(action, bodega, targetStoreId)}
        />
      ) : null}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

const CART_COLS = '1.6fr .7fr 1fr 1fr .7fr 34px'

/**
 * El carrito se pinta como tabla en escritorio y como tarjetas en celular:
 * una tabla de 6 columnas en 360px de ancho obliga a hacer scroll lateral
 * justo cuando hay un cliente esperando.
 */
function CartTable({ compact }: { compact: boolean }) {
  const cart = useCart()

  const empty = (
    <div style={{ padding: '48px 20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 15, fontStyle: 'italic' }}>
      Carrito vacío. Escanea un producto para empezar.
    </div>
  )

  if (compact) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {cart.lines.length === 0 ? (
          <div style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-xl)' }}>
            {empty}
          </div>
        ) : (
          cart.lines.map((line) => <CartCard key={line.variantId} line={line} />)
        )}
      </div>
    )
  }

  return (
    <div
      style={{
        background: 'var(--surface-card)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-xl)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: CART_COLS,
          gap: 12,
          padding: '15px 20px',
          borderBottom: '1px solid var(--border-subtle)',
          font: '700 11.5px var(--font-body)',
          letterSpacing: '.08em',
          color: 'var(--text-muted)',
        }}
      >
        <span>PRODUCTO</span>
        <span style={{ textAlign: 'center' }}>CANT.</span>
        <span style={{ textAlign: 'right' }}>PRECIO</span>
        <span style={{ textAlign: 'right' }}>SUBTOTAL</span>
        <span style={{ textAlign: 'right' }}>STOCK</span>
        <span />
      </div>

      {cart.lines.length === 0 ? empty : cart.lines.map((line) => <CartRow key={line.variantId} line={line} />)}
    </div>
  )
}

/** Misma línea del carrito, apilada para pantallas angostas. */
function CartCard({ line }: { line: CartLine }) {
  const cart = useCart()
  const stepper: React.CSSProperties = {
    width: 36,
    height: 36,
    borderRadius: 10,
    border: '1px solid var(--border-subtle)',
    background: 'var(--surface-muted)',
    cursor: 'pointer',
    font: '700 18px var(--font-body)',
    color: 'var(--text-secondary)',
    lineHeight: 1,
  }

  return (
    <div
      style={{
        background: 'var(--surface-card)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-xl)',
        padding: '14px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ font: '700 15px var(--font-display)' }}>
            {line.name} · T{line.size}
          </div>
          <div style={{ font: '500 11.5px var(--font-mono)', color: 'var(--text-muted)', marginTop: 3 }}>
            {line.barcode} · stock {line.stock}
          </div>
        </div>
        <button
          onClick={() => cart.remove(line.variantId)}
          aria-label="Quitar producto"
          style={{
            width: 30,
            height: 30,
            borderRadius: 9,
            border: '1px solid rgba(224,52,29,.25)',
            background: 'rgba(224,52,29,.08)',
            color: 'var(--color-danger)',
            cursor: 'pointer',
            font: '700 14px var(--font-body)',
            lineHeight: 1,
          }}
        >
          ✕
        </button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={() => cart.setQuantity(line.variantId, -1)} style={stepper} aria-label="Quitar uno">
          −
        </button>
        <QtyInput line={line} big />
        <button onClick={() => cart.setQuantity(line.variantId, 1)} style={stepper} aria-label="Agregar uno">
          +
        </button>
        <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{formatMoney(line.unitPrice)} c/u</div>
          <div style={{ font: '700 17px var(--font-display)' }}>{formatMoney(money(line.unitPrice * line.quantity))}</div>
        </div>
      </div>
    </div>
  )
}

/**
 * Cantidad editable como texto, además de los botones +/−. Para venta mayorista:
 * escribir "100" en vez de pulsar la flecha cien veces. Guarda dígitos crudos
 * mientras se escribe y, al salir del campo, muestra la cantidad real (ya topada
 * al stock por el carrito).
 */
function QtyInput({ line, big }: { line: CartLine; big?: boolean }) {
  const cart = useCart()
  const [text, setText] = useState(String(line.quantity))
  // Se resincroniza cuando la cantidad cambia por los botones o al reescanear.
  useEffect(() => setText(String(line.quantity)), [line.quantity])

  const commit = (raw: string) => {
    const digits = raw.replace(/\D/g, '')
    setText(digits)
    if (digits) cart.setQuantityTo(line.variantId, Number(digits))
  }

  // Aviso cuando lo escrito supera lo que se puede vender en el local.
  const typed = Number(text || '0')
  const over = typed > line.saleStock
  const border = over ? 'var(--color-danger)' : 'var(--border-subtle)'

  return (
    <div style={{ position: 'relative', display: 'inline-flex' }}>
      <input
        value={text}
        onChange={(e) => commit(e.target.value)}
        onFocus={(e) => e.target.select()}
        onBlur={() => setText(String(line.quantity))}
        inputMode="numeric"
        aria-label="Cantidad"
        style={{
          width: big ? 56 : 46,
          height: big ? 34 : 28,
          textAlign: 'center',
          border: `1px solid ${border}`,
          borderRadius: 8,
          background: 'var(--surface-card)',
          color: over ? 'var(--color-danger)' : 'var(--text-primary)',
          font: `700 ${big ? 17 : 14.5}px var(--font-display)`,
          outline: 'none',
        }}
      />
      {over ? (
        <span
          style={{
            position: 'absolute',
            top: '100%',
            left: '50%',
            transform: 'translateX(-50%)',
            marginTop: 4,
            whiteSpace: 'nowrap',
            background: 'var(--color-danger)',
            color: '#fff',
            font: '700 10.5px var(--font-body)',
            padding: '2px 7px',
            borderRadius: 6,
            zIndex: 2,
          }}
        >
          Solo hay {line.saleStock} en tu local
        </span>
      ) : null}
    </div>
  )
}

function CartRow({ line }: { line: CartLine }) {
  const cart = useCart()
  const status = variantStatus(line.stock, 3)
  const stockColor =
    status === 'out' ? 'var(--color-danger)' : status === 'low' ? 'var(--iw-amber)' : 'var(--text-secondary)'

  const stepper: React.CSSProperties = {
    width: 26,
    height: 26,
    borderRadius: 8,
    border: '1px solid var(--border-subtle)',
    background: 'var(--surface-muted)',
    cursor: 'pointer',
    font: '700 14px var(--font-body)',
    color: 'var(--text-secondary)',
    lineHeight: 1,
  }

  return (
    <div
      className="iw-row"
      style={{
        display: 'grid',
        gridTemplateColumns: CART_COLS,
        gap: 12,
        padding: '14px 20px',
        borderBottom: '1px solid var(--border-subtle)',
        alignItems: 'center',
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ font: '700 14.5px var(--font-display)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {line.name} · T{line.size}
        </div>
        <div style={{ font: '500 11.5px var(--font-mono)', color: 'var(--text-muted)', marginTop: 2 }}>{line.barcode}</div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
        <button onClick={() => cart.setQuantity(line.variantId, -1)} style={stepper} aria-label="Quitar uno">
          −
        </button>
        <QtyInput line={line} />
        <button onClick={() => cart.setQuantity(line.variantId, 1)} style={stepper} aria-label="Agregar uno">
          +
        </button>
      </div>

      <div style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: 14, color: 'var(--text-secondary)' }}>
        {formatMoney(line.unitPrice)}
      </div>
      <div style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', font: '700 14.5px var(--font-display)' }}>
        {formatMoney(money(line.unitPrice * line.quantity))}
      </div>
      <div style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', font: `700 19px var(--font-display)`, color: stockColor }}>
        {line.stock}
      </div>

      <button
        onClick={() => cart.remove(line.variantId)}
        title="Quitar producto"
        style={{
          width: 28,
          height: 28,
          borderRadius: 8,
          border: '1px solid rgba(224,52,29,.25)',
          background: 'rgba(224,52,29,.08)',
          color: 'var(--color-danger)',
          cursor: 'pointer',
          font: '700 14px var(--font-body)',
          lineHeight: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        ✕
      </button>
    </div>
  )
}

function SummaryPanel({
  items,
  units,
  total,
  hasItems,
  saleBlocked,
  bodegaBlocked,
  sticky,
  onCobrar,
  onDevolucion,
  onCancel,
  onBodega,
}: {
  items: number
  units: number
  total: string
  hasItems: boolean
  saleBlocked: boolean
  bodegaBlocked: boolean
  sticky: boolean
  onCobrar: () => void
  onDevolucion: () => void
  onCancel: () => void
  onBodega: () => void
}) {
  const canCobrar = hasItems && !saleBlocked
  const canBodega = hasItems && !bodegaBlocked
  return (
    <div
      style={{
        background: 'var(--surface-card)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-xl)',
        padding: 20,
        ...(sticky ? { position: 'sticky' as const, top: 20 } : {}),
      }}
    >
      <Line label="Ítems" value={String(items)} />
      <Line label="Unidades" value={String(units)} border />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '16px 0 18px' }}>
        <span style={{ color: 'var(--text-secondary)', fontSize: 16, fontWeight: 700 }}>Total</span>
        <span style={{ font: '700 29px var(--font-display)', letterSpacing: '-.02em' }}>{total}</span>
      </div>

      {saleBlocked ? (
        <div style={{ marginBottom: 10, background: 'rgba(224,52,29,.1)', border: '1px solid rgba(224,52,29,.3)', borderRadius: 'var(--radius-md)', padding: '9px 12px', color: 'var(--color-danger)', fontSize: 12.5, fontWeight: 700, lineHeight: 1.4 }}>
          Hay tallas que superan el stock disponible en tu local. Ajusta las cantidades para poder cobrar.
        </div>
      ) : null}

      {/* Los cuatro botones se habilitan al escanear. La devolución también:
          arranca del par escaneado (así se buscan sus ventas), no de un buscador
          de clientes. Sin nada escaneado, no hay de qué partir. */}
      <button
        onClick={onCobrar}
        disabled={!canCobrar}
        className="iw-press"
        style={{
          width: '100%',
          height: 54,
          background: canCobrar ? 'var(--iw-yellow)' : 'rgba(255,209,0,.35)',
          color: canCobrar ? '#0c0c0d' : 'var(--text-muted)',
          border: 'none',
          borderRadius: 'var(--radius-lg)',
          font: '700 17px var(--font-display)',
          cursor: canCobrar ? 'pointer' : 'not-allowed',
          boxShadow: canCobrar ? 'var(--shadow-accent)' : 'none',
        }}
      >
        Cobrar
      </button>

      <button
        onClick={onDevolucion}
        disabled={!hasItems}
        title={hasItems ? undefined : 'Escanea el par que vas a devolver'}
        className="iw-press"
        style={{
          width: '100%',
          marginTop: 10,
          height: 48,
          background: 'var(--surface-card)',
          color: hasItems ? 'var(--text-primary)' : 'var(--text-muted)',
          border: '1.5px solid var(--border-subtle)',
          borderRadius: 'var(--radius-lg)',
          font: '700 15px var(--font-body)',
          cursor: hasItems ? 'pointer' : 'not-allowed',
          opacity: hasItems ? 1 : 0.6,
        }}
      >
        Devolución
      </button>

      <button
        onClick={onBodega}
        disabled={!canBodega}
        title={bodegaBlocked ? 'No tienes bodegas autorizadas' : hasItems ? undefined : 'Escanea uno o más productos'}
        className="iw-press"
        style={{
          width: '100%',
          marginTop: 10,
          height: 54,
          background: canBodega ? 'var(--iw-plum)' : 'var(--surface-muted)',
          color: canBodega ? '#fafafa' : 'var(--text-muted)',
          border: 'none',
          borderRadius: 'var(--radius-lg)',
          font: '700 17px var(--font-display)',
          cursor: canBodega ? 'pointer' : 'not-allowed',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
        }}
      >
        <Icon name="box" size={20} /> Bodega
      </button>

      <button
        onClick={onCancel}
        disabled={!hasItems}
        className="iw-press"
        style={{
          width: '100%',
          marginTop: 10,
          height: 44,
          background: 'transparent',
          color: hasItems ? 'var(--color-danger)' : 'var(--text-muted)',
          border: '1.5px solid var(--border-subtle)',
          borderRadius: 'var(--radius-lg)',
          font: '700 14px var(--font-body)',
          cursor: hasItems ? 'pointer' : 'not-allowed',
        }}
      >
        Cancelar venta
      </button>
    </div>
  )
}

function Line({ label, value, border }: { label: string; value: string; border?: boolean }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '6px 0',
        ...(border ? { borderBottom: '1px solid var(--border-subtle)' } : {}),
      }}
    >
      <span style={{ color: 'var(--text-secondary)', fontSize: 15 }}>{label}</span>
      <span style={{ font: '700 17px var(--font-display)' }}>{value}</span>
    </div>
  )
}

function Banner({ tone, text }: { tone: 'danger' | 'success'; text: string }) {
  const danger = tone === 'danger'
  return (
    <div
      style={{
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
