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
  type Size,
  type Variant,
  money,
  mulMoney,
  subMoney,
} from './models'
import { stockAt } from './locations'

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
  | 'HAS_STOCK'

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
    }
  }
  return 'Ocurrió un error. Intenta de nuevo.'
}

// ─────────────────────────────────────────────────────────────────────────────
// Dirección del stock
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Signo del movimiento sobre el stock TOTAL del sistema.
 * Venta saca; compra y devolución meten; los traslados (salida/retorno) no
 * cambian el total, solo mueven stock entre ubicaciones.
 */
export const stockDirection = (type: MovementType): 1 | -1 => (type === 'sale' ? -1 : 1)

/** Delta sobre el stock TOTAL del sistema (0 en traslados). */
export const stockDeltaFor = (type: MovementType, quantity: number): number => {
  switch (type) {
    case 'sale':
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
  const unitPrice = product.price
  const unitCost = draft.unitCostOverride ?? product.cost
  const unitMargin = subMoney(unitPrice, unitCost)
  const stockDelta = stockDeltaFor(draft.type, draft.quantity)

  // Las entradas y los traslados se valoran al COSTO (no hay venta); las ventas
  // y devoluciones, al precio.
  const total =
    draft.type === 'purchase' || draft.type === 'salida' || draft.type === 'retorno'
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

// ─────────────────────────────────────────────────────────────────────────────
// Etiquetas de presentación
// ─────────────────────────────────────────────────────────────────────────────

export const MOVEMENT_LABEL: Record<MovementType, string> = {
  sale: 'Venta',
  purchase: 'Entrada',
  return: 'Devolución',
  salida: 'Salida a local',
  retorno: 'Retorno a bodega',
}

/** Prefijo con signo para el historial: "+3", "−2". */
export const signedQuantity = (movement: Pick<Movement, 'type' | 'quantity'>): string =>
  `${stockDirection(movement.type) > 0 ? '+' : '−'}${movement.quantity}`
