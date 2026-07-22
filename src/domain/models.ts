/**
 * Modelo de dominio. Tipos puros: NO importan React, NO importan Firebase.
 * Esta capa describe el negocio; `src/data` la traduce a documentos de Firestore.
 */

/** Identificadores nominales: evitan pasar un productId donde va un variantId. */
export type Brand<T, K extends string> = T & { readonly __brand: K }

export type StoreId = Brand<string, 'StoreId'>
export type ProductId = Brand<string, 'ProductId'>
export type VariantId = Brand<string, 'VariantId'>
export type MovementId = Brand<string, 'MovementId'>
export type UserId = Brand<string, 'UserId'>

/**
 * Dinero en unidades MENORES enteras (centavos). El peso colombiano no usa
 * decimales en caja, pero guardamos enteros igual: un `number` con decimales
 * acumula error de coma flotante al sumar miles de movimientos.
 */
export type Money = Brand<number, 'Money'>

export const money = (minorUnits: number): Money => Math.round(minorUnits) as Money
export const addMoney = (a: Money, b: Money): Money => money(a + b)
export const mulMoney = (a: Money, qty: number): Money => money(a * qty)
export const subMoney = (a: Money, b: Money): Money => money(a - b)

/** Tallas soportadas. Fuente única de verdad para toda la app. */
export const SIZES = [36, 37, 38, 39, 40, 41, 42, 43, 44, 45] as const
export type Size = (typeof SIZES)[number]
export const isSize = (n: number): n is Size => (SIZES as readonly number[]).includes(n)

// ─────────────────────────────────────────────────────────────────────────────
// Local / tienda
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Un local es un PUNTO DE VENTA, no una bodega. El stock es central y
 * compartido; el local solo atribuye quién hizo el movimiento.
 */
export interface Store {
  id: StoreId
  /** Código visible al usuario: "163", "173". */
  code: string
  name: string
  active: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Producto y variante
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Producto = referencia (modelo). NO guarda stock.
 * El stock vive en la variante para que dos cajeros vendiendo tallas distintas
 * de la misma referencia no compitan por el mismo documento.
 */
export interface Product {
  id: ProductId
  sku: string
  brand: string
  name: string
  /** Precio de venta al público. */
  price: Money
  /** Costo de reposición: dato sensible, solo visible en modo admin. */
  cost: Money
  /** Umbral de alerta por talla. */
  minStock: number
  active: boolean
  /** Tokens en minúsculas para búsqueda por prefijo desde Firestore. */
  searchTokens: string[]
  createdAt: Date
  updatedAt: Date
}

/**
 * Variante = producto + talla. Es la unidad real de inventario y la única
 * entidad cuyo `stock` se escribe.
 */
export interface Variant {
  id: VariantId
  productId: ProductId
  size: Size
  /** Código de barras impreso en la etiqueta. Único en todo el sistema. */
  barcode: string
  stock: number
  /** Copiado del producto para poder consultar bajo-stock sin joins. */
  minStock: number
  active: boolean
  updatedAt: Date
}

/** Variante junto a su producto, listo para pintar en pantalla. */
export interface VariantWithProduct {
  variant: Variant
  product: Product
}

// ─────────────────────────────────────────────────────────────────────────────
// Movimientos (libro mayor)
// ─────────────────────────────────────────────────────────────────────────────

export const MOVEMENT_TYPES = ['sale', 'purchase', 'return'] as const
export type MovementType = (typeof MOVEMENT_TYPES)[number]

export const RETURN_REASONS = [
  'Talla incorrecta',
  'No se envió a domicilio',
  'No la recogió el cliente',
] as const
export type ReturnReason = (typeof RETURN_REASONS)[number]

/**
 * Un movimiento es un asiento INMUTABLE. Nunca se edita ni se borra:
 * un error se corrige con un movimiento compensatorio. Es la única fuente
 * de verdad histórica; `Variant.stock` es una proyección materializada de esto.
 */
export interface Movement {
  id: MovementId
  type: MovementType
  productId: ProductId
  variantId: VariantId

  /**
   * Copia congelada de los datos del producto EN EL INSTANTE del movimiento.
   * Si mañana sube el precio, el historial de ayer sigue siendo correcto,
   * y el historial se pinta sin leer N productos.
   */
  snapshot: {
    productName: string
    brand: string
    sku: string
    barcode: string
    size: Size
    unitPrice: Money
    unitCost: Money
  }

  /** Siempre positiva. La dirección la determina `type`. */
  quantity: number
  /** Efecto real sobre el stock: negativo en venta, positivo en compra/devolución. */
  stockDelta: number
  /** Stock de la variante después de aplicar este movimiento (para auditar). */
  stockAfter: number

  /** quantity × unitPrice (o × unitCost en una compra). */
  total: Money
  /** Utilidad bruta. Cero en compras, negativa en devoluciones. */
  margin: Money

  storeId: StoreId
  userId: UserId
  userName: string

  returnReason?: ReturnReason

  occurredAt: Date
  /** "2026-07-15" en horario de Colombia. Clave de agrupación para reportes. */
  dayKey: string
}

/** Lo que la UI envía para pedir un movimiento; el resto lo deriva el dominio. */
export interface MovementDraft {
  type: MovementType
  variantId: VariantId
  quantity: number
  /** Solo en compras: costo unitario, editable por el usuario. */
  unitCostOverride?: Money
  returnReason?: ReturnReason
}

// ─────────────────────────────────────────────────────────────────────────────
// Reportes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Agregado diario precalculado. El dashboard lee ~7 documentos en vez de
 * escanear miles de movimientos, y el costo no crece con el histórico.
 */
export interface DailyStats {
  /** dayKey, "2026-07-15". */
  id: string
  dayKey: string
  salesTotal: Money
  purchasesTotal: Money
  returnsTotal: Money
  margin: Money
  salesCount: number
  purchasesCount: number
  unitsSold: number
  /** Ventas por local: { [storeId]: Money }. */
  salesByStore: Record<string, number>
  /** Unidades por producto, para el Top 5: { [productId]: unidades }. */
  unitsByProduct: Record<string, number>
  updatedAt: Date
}

export interface LowStockAlert {
  productId: ProductId
  productName: string
  size: Size
  stock: number
  minStock: number
}
