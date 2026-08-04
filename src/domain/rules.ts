/**
 * Reglas de negocio puras. Sin efectos secundarios, sin red, sin React.
 * Todo lo que decide "qué debe pasar" vive aquí; `src/data` solo lo persiste.
 */

import {
  type Money,
  type Movement,
  type MovementDraft,
  type MovementType,
  type Product,
  type SaleStatus,
  type Size,
  type Variant,
  DEFERRED_PAYMENTS,
  money,
  mulMoney,
  subMoney,
} from './models'
import { parseLocationKey, stockAt } from './locations'

// ─────────────────────────────────────────────────────────────────────────────
// Errores de dominio
// ─────────────────────────────────────────────────────────────────────────────

export type DomainErrorCode =
  | 'INSUFFICIENT_STOCK'
  | 'INVALID_QUANTITY'
  | 'BARCODE_NOT_FOUND'
  | 'PRODUCT_INACTIVE'
  | 'DUPLICATE_BARCODE'
  | 'MISSING_RETURN_REASON'
  | 'MISSING_BAJA_REASON'
  | 'HAS_STOCK'
  | 'ALREADY_RETURNED'

export class DomainError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'DomainError'
  }
}

/** Mensajes en español listos para mostrar. La UI no arma texto de error. */
export const errorMessage = (error: unknown): string => {
  if (error instanceof DomainError) {
    switch (error.code) {
      case 'INSUFFICIENT_STOCK':
        return `Stock insuficiente: quedan ${error.details?.available ?? 0} pares.`
      case 'INVALID_QUANTITY':
        return 'La cantidad debe ser al menos 1.'
      case 'BARCODE_NOT_FOUND':
        return 'Ese código de barras no existe en el inventario.'
      case 'PRODUCT_INACTIVE':
        return 'Esta referencia está desactivada.'
      case 'DUPLICATE_BARCODE':
        return 'Ya existe una referencia con ese código de barras.'
      case 'MISSING_RETURN_REASON':
        return 'Selecciona la razón de la devolución.'
      case 'MISSING_BAJA_REASON':
        return 'Selecciona el motivo de la baja.'
      case 'HAS_STOCK':
        return 'No se puede eliminar una referencia con stock. Primero dala de baja.'
      case 'ALREADY_RETURNED':
        return 'Este par ya se había devuelto de esa venta. Revisa la pestaña Devuelto.'
    }
  }
  return 'Ocurrió un error. Intenta de nuevo.'
}

// ─────────────────────────────────────────────────────────────────────────────
// Dirección del stock
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Signo del movimiento sobre el stock TOTAL del sistema.
 * Venta y baja sacan; compra y devolución meten; los traslados (salida/retorno)
 * no cambian el total, solo mueven stock entre ubicaciones.
 */
export const stockDirection = (type: MovementType): 1 | -1 =>
  type === 'sale' || type === 'baja' ? -1 : 1

/** Delta sobre el stock TOTAL del sistema (0 en traslados). */
export const stockDeltaFor = (type: MovementType, quantity: number): number => {
  switch (type) {
    case 'sale':
    case 'baja':
      return -quantity
    case 'purchase':
    case 'return':
      return quantity
    case 'salida':
    case 'retorno':
      return 0
  }
}

/** Efecto por ubicación de un movimiento: la de origen resta, la de destino suma. */
export function locationDeltas(
  draft: Pick<MovementDraft, 'type' | 'quantity' | 'fromLocation' | 'toLocation'>,
): { key: string; delta: number }[] {
  const q = draft.quantity
  const out: { key: string; delta: number }[] = []
  switch (draft.type) {
    case 'sale':
    case 'baja':
      // La baja saca stock de la ubicación donde estaba (bodega o local).
      if (draft.fromLocation) out.push({ key: draft.fromLocation, delta: -q })
      break
    case 'purchase':
    case 'return':
      if (draft.toLocation) out.push({ key: draft.toLocation, delta: q })
      break
    case 'salida':
    case 'retorno':
      if (draft.fromLocation) out.push({ key: draft.fromLocation, delta: -q })
      if (draft.toLocation) out.push({ key: draft.toLocation, delta: q })
      break
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────────────
// Validación
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Valida un movimiento contra el estado actual de la variante.
 * Se ejecuta DOS veces: en la UI para dar feedback inmediato, y otra vez
 * dentro de la transacción de Firestore sobre el stock recién leído. La
 * segunda es la que manda — la primera solo evita un viaje al servidor.
 */
export function assertMovementIsValid(
  draft: MovementDraft,
  variant: Pick<Variant, 'stock' | 'stockByLocation'>,
): void {
  if (!Number.isInteger(draft.quantity) || draft.quantity < 1) {
    throw new DomainError('INVALID_QUANTITY', 'Cantidad inválida')
  }
  if (draft.type === 'return' && !draft.returnReason) {
    throw new DomainError('MISSING_RETURN_REASON', 'Falta la razón de la devolución')
  }
  if (draft.type === 'baja' && !draft.bajaReason) {
    throw new DomainError('MISSING_BAJA_REASON', 'Falta el motivo de la baja')
  }
  // Cada ubicación de la que SALE stock debe tener con qué cubrirlo. Así, vender
  // en un local o sacar de una bodega vacía se rechaza en la ubicación concreta,
  // no contra el total del sistema.
  for (const { key, delta } of locationDeltas(draft)) {
    if (delta >= 0) continue
    const available = stockAt(variant.stockByLocation, key)
    if (available + delta < 0) {
      throw new DomainError('INSUFFICIENT_STOCK', 'Stock insuficiente', {
        available,
        requested: draft.quantity,
      })
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Cálculo del asiento
// ─────────────────────────────────────────────────────────────────────────────

export interface MovementTotals {
  total: Money
  margin: Money
  stockDelta: number
  stockAfter: number
  unitPrice: Money
  unitCost: Money
}

/**
 * Calcula importes y efecto en stock. Función pura: mismos argumentos,
 * mismo resultado. Es el corazón contable de la app.
 *
 * - Venta:      total = precio × cantidad,  utilidad = (precio − costo) × cantidad
 * - Compra:     total = costo  × cantidad,  utilidad = 0 (todavía no se vende nada)
 * - Devolución: total = precio × cantidad,  utilidad = −(precio − costo) × cantidad
 */
export function calculateMovement(
  draft: MovementDraft,
  product: Pick<Product, 'price' | 'cost'>,
  variant: Pick<Variant, 'stock'>,
): MovementTotals {
  // Los overrides existen para que una devolución revierta EXACTAMENTE los
  // importes de su venta, aunque el precio o el costo hayan cambiado después.
  const unitPrice = draft.unitPriceOverride ?? product.price
  const unitCost = draft.unitCostOverride ?? product.cost
  const unitMargin = subMoney(unitPrice, unitCost)
  const stockDelta = stockDeltaFor(draft.type, draft.quantity)

  // Las entradas, los traslados y las bajas se valoran al COSTO (no hay venta);
  // las ventas y devoluciones, al precio.
  const total =
    draft.type === 'purchase' ||
    draft.type === 'salida' ||
    draft.type === 'retorno' ||
    draft.type === 'baja'
      ? mulMoney(unitCost, draft.quantity)
      : mulMoney(unitPrice, draft.quantity)

  const margin: Money =
    draft.type === 'sale'
      ? mulMoney(unitMargin, draft.quantity)
      : draft.type === 'return'
        ? money(-mulMoney(unitMargin, draft.quantity))
        : money(0) // compras y traslados no generan utilidad

  return {
    total,
    margin,
    stockDelta,
    stockAfter: variant.stock + stockDelta,
    unitPrice,
    unitCost,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Estado de inventario
// ─────────────────────────────────────────────────────────────────────────────

export type StockStatus = 'out' | 'low' | 'ok'

export const variantStatus = (stock: number, minStock: number): StockStatus =>
  stock === 0 ? 'out' : stock <= minStock ? 'low' : 'ok'

/**
 * Estado de la referencia completa. Una referencia está "baja" si le queda
 * poco en total, aunque alguna talla suelta esté bien surtida.
 */
export const productStatus = (totalStock: number, minStock: number): StockStatus =>
  totalStock === 0 ? 'out' : totalStock <= minStock * 3 ? 'low' : 'ok'

export const STATUS_LABEL: Record<StockStatus, string> = {
  out: 'Agotado',
  low: 'Stock bajo',
  ok: 'Disponible',
}

// ─────────────────────────────────────────────────────────────────────────────
// Códigos de barras
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Código de barras determinista: SKU-TALLA. Legible por humanos, imprimible
 * como Code128 y reconstruible sin consultar la base.
 */
export const buildBarcode = (sku: string, size: Size): string =>
  `${sku.toUpperCase().replace(/\s+/g, '')}-${size}`

/** Rompe un código en sus partes. `null` si no tiene el formato esperado. */
export function parseBarcode(barcode: string): { sku: string; size: number } | null {
  const match = /^(.+)-(\d{2})$/.exec(barcode.trim().toUpperCase())
  if (!match?.[1] || !match[2]) return null
  return { sku: match[1], size: Number(match[2]) }
}

/**
 * Forma canónica de un código para comparar y buscar, tolerante a lectores mal
 * configurados.
 *
 * Un lector "keyboard wedge" teclea el código como pulsaciones, y su
 * distribución de teclado debe coincidir con la del sistema. Cuando no coincide
 * (lector en inglés US, Windows en español, lo más común), la tecla del GUION
 * `-` se escribe como un carácter parecido —típicamente el apóstrofo `'`, y a
 * veces la tilde `´`, el acento grave `` ` `` o el punto medio `·`—. El código
 * guardado usa guiones (`SKU-TALLA`), así que sin esto el escaneo de
 * `12345678A'39` nunca encontraría a `12345678A-39`.
 *
 * Ninguno de esos caracteres aparece en un SKU real (letras, dígitos y
 * guiones), así que revertirlos al guion es seguro. Se aplica en AMBOS lados de
 * cada comparación: normalizar lo guardado (que ya trae guiones) no lo cambia.
 */
export const normalizeBarcode = (raw: string): string =>
  raw
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/[’‘'´`·]/g, '-')

// ─────────────────────────────────────────────────────────────────────────────
// Etiquetas de presentación
// ─────────────────────────────────────────────────────────────────────────────

export const MOVEMENT_LABEL: Record<MovementType, string> = {
  sale: 'Venta',
  purchase: 'Entrada',
  return: 'Devolución',
  salida: 'Salida a local',
  retorno: 'Retorno a bodega',
  baja: 'Baja',
}

/** Prefijo con signo para el historial: "+3", "−2". */
export const signedQuantity = (movement: Pick<Movement, 'type' | 'quantity'>): string =>
  `${stockDirection(movement.type) > 0 ? '+' : '−'}${movement.quantity}`

/**
 * Valor del movimiento AL PRECIO DE VENTA, siempre.
 *
 * `Movement.total` se valora al costo en entradas, traslados y bajas: eso es lo
 * correcto para la contabilidad (una entrada vale lo que se le pagó al
 * proveedor) pero es lo que NO se quiere ver en el historial — la pregunta que
 * responde esa pantalla es "¿en cuánto se vende ese zapato?", y además el costo
 * es dato sensible que no debe asomarse a quien vende. Por eso el historial
 * pinta esto y no `total`.
 */
export const saleValue = (movement: Pick<Movement, 'snapshot' | 'quantity'>): Money =>
  mulMoney(movement.snapshot.unitPrice, movement.quantity)

// ─────────────────────────────────────────────────────────────────────────────
// Ubicación y personas de un movimiento
// ─────────────────────────────────────────────────────────────────────────────

/**
 * El LOCAL por el que pasó el zapato, mirando las ubicaciones reales y no
 * `storeId` — que es el local de QUIEN REGISTRÓ el movimiento, y por eso miente
 * dos veces: viene vacío cuando lo registra un bodeguero (no tiene local), y
 * apunta al local equivocado cuando alguien del 163 registra una baja del 173.
 *
 * Se mira el extremo donde el zapato ESTUVO en manos del local:
 *  · sale, baja        → el origen (de dónde salió).
 *  · purchase, return  → el destino (a dónde entró).
 *  · salida            → el destino (a qué local se le entregó).
 *  · retorno           → el origen (de qué local volvió).
 *
 * Devuelve `null` si ese extremo es una bodega (una entrada de mercancía no
 * pasa por ningún local) o si no hay local que atribuir. Los movimientos
 * viejos, anteriores al stock por ubicación, caen a `storeId`.
 */
export function movementStoreId(
  m: Pick<Movement, 'type' | 'storeId' | 'fromLocation' | 'toLocation'>,
): string | null {
  const key =
    m.type === 'sale' || m.type === 'baja' || m.type === 'retorno' ? m.fromLocation : m.toLocation
  if (key) {
    const ref = parseLocationKey(key)
    return ref?.kind === 'store' ? ref.id : null
  }
  return String(m.storeId) || null
}

/**
 * El local al que se ATRIBUYE el movimiento para contarlo y filtrarlo. Es
 * `movementStoreId` con el respaldo de `storeId` cuando el movimiento no toca
 * ningún local: la devolución que entra directo a bodega no pasa por el local,
 * pero sigue siendo plata que sale de las ventas del local que la vendió, y es
 * ahí donde tiene que verse. Todo lo que filtre o sume por local usa ESTA,
 * para que la columna y el filtro nunca digan cosas distintas.
 */
export const movementLocalId = (
  m: Pick<Movement, 'type' | 'storeId' | 'fromLocation' | 'toLocation'>,
): string => movementStoreId(m) ?? String(m.storeId)

/** La BODEGA que toca el movimiento (entrada, salida o retorno), si la hay. */
export function movementBodegaId(
  m: Pick<Movement, 'type' | 'fromLocation' | 'toLocation'>,
): string | null {
  for (const key of [m.fromLocation, m.toLocation]) {
    if (!key) continue
    const ref = parseLocationKey(key)
    if (ref?.kind === 'bodega') return ref.id
  }
  return null
}

// ─────────────────────────────────────────────────────────────────────────────
// Estado de cobro de una venta
// ─────────────────────────────────────────────────────────────────────────────

/** Estado de una línea de venta. Las ventas viejas (sin campo) son `cobrado`. */
export const saleStatusOf = (m: Pick<Movement, 'saleStatus'>): SaleStatus =>
  m.saleStatus ?? 'cobrado'

/** Una venta por transportadora nace pendiente: la plata entra días después. */
export const defaultSaleStatus = (payment: string | undefined): SaleStatus =>
  // El medio de pago viaja como texto libre (con "Otro" la cajera escribe el
  // suyo), así que se compara contra la lista en vez de tiparlo.
  payment && (DEFERRED_PAYMENTS as readonly string[]).includes(payment) ? 'pendiente' : 'cobrado'

export const SALE_STATUS_LABEL: Record<SaleStatus, string> = {
  cobrado: 'Cobrado',
  pendiente: 'Pendiente',
  devuelto: 'Devuelto',
}
