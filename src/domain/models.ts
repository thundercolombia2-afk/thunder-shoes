/**
 * Modelo de dominio. Tipos puros: NO importan React, NO importan Firebase.
 * Esta capa describe el negocio; `src/data` la traduce a documentos de Firestore.
 */

/** Identificadores nominales: evitan pasar un productId donde va un variantId. */
export type Brand<T, K extends string> = T & { readonly __brand: K }

export type StoreId = Brand<string, 'StoreId'>
export type BodegaId = Brand<string, 'BodegaId'>
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
 * Un local es un PUNTO DE VENTA. Cada local lleva su propio stock (ver
 * `Variant.stockByLocation`). Los usuarios de venta quedan amarrados a un local.
 */
export interface Store {
  id: StoreId
  /** Código visible al usuario: "163", "173". */
  code: string
  name: string
  active: boolean
}

/**
 * Una bodega es un ALMACÉN, no un punto de venta. Puede haber varias,
 * independientes, y se crean desde Configuración. Cada bodega lleva su propio
 * stock por talla (ver `Variant.stockByLocation`). Quién puede operarla se
 * decide en el PERFIL de cada usuario (`UserProfile.bodegaIds`), que la dueña
 * asigna al invitar o desde Configuración.
 */
export interface Bodega {
  id: BodegaId
  /** Código/nombre corto visible: "Bodega 4". */
  code: string
  name: string
  active: boolean
  createdAt: Date
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
  /**
   * Stock TOTAL del sistema (suma de todas las ubicaciones). Se mantiene como
   * proyección para la lista de inventario y las alertas de bajo stock sin leer
   * el mapa. Invariante: `stock === Σ stockByLocation`.
   */
  stock: number
  /**
   * Stock por ubicación: `{ [claveDeUbicacion]: cantidad }`, con la clave de
   * `domain/locations.ts` ("s:163" para un local, "b:abc" para una bodega).
   */
  stockByLocation: Record<string, number>
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

/**
 * Tipos de asiento:
 *  · sale     — venta: saca stock del local del vendedor.
 *  · purchase — entrada de mercancía: mete stock a una bodega.
 *  · return   — devolución de un cliente: regresa stock al local.
 *  · salida   — traslado bodega → local (se destina a un usuario/su local).
 *  · retorno  — traslado local → bodega.
 * `salida` y `retorno` son TRASLADOS: mueven stock entre dos ubicaciones sin
 * cambiar el total del sistema.
 */
export const MOVEMENT_TYPES = ['sale', 'purchase', 'return', 'salida', 'retorno'] as const
export type MovementType = (typeof MOVEMENT_TYPES)[number]

/** Traslados: afectan dos ubicaciones (from −, to +). */
export const TRANSFER_TYPES = ['salida', 'retorno'] as const
export const isTransfer = (type: MovementType): boolean =>
  (TRANSFER_TYPES as readonly string[]).includes(type)

export const RETURN_REASONS = [
  'Talla incorrecta',
  'No se envió a domicilio',
  'No la recogió el cliente',
  'Defecto de fábrica',
  'Cambio de modelo',
  'No le gustó',
  'Error en la venta',
  'Otro',
] as const
export type ReturnReason = (typeof RETURN_REASONS)[number]

/**
 * Formas de pago que se aceptan en caja. Se guardan en el movimiento para
 * poder cuadrar la caja al cierre: cuánto entró en efectivo, cuánto por
 * transferencia y cuánto por cada medio.
 */
export const PAYMENT_METHODS = [
  'Efectivo',
  'Transferencia',
  'Nequi',
  'Daviplata',
  'Nu Bank',
  'Tarjeta',
  'Otro',
] as const
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]

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

  /**
   * Ubicaciones afectadas (claves de `domain/locations.ts`). La de origen pierde
   * stock y la de destino lo gana:
   *  · sale     → `fromLocation` (el local; sin destino).
   *  · purchase → `toLocation` (la bodega; sin origen).
   *  · return   → `toLocation` (el local; regresa).
   *  · salida   → `fromLocation` (bodega) y `toLocation` (local).
   *  · retorno  → `fromLocation` (local) y `toLocation` (bodega).
   */
  fromLocation?: string
  toLocation?: string

  returnReason?: ReturnReason

  /**
   * Agrupa las líneas de una misma venta. Un carrito de 3 pares genera 3
   * asientos (uno por variante, para que el stock cuadre talla por talla) que
   * comparten este id: así el historial puede reconstruir el tiquete completo.
   */
  saleId?: string
  /** Forma de pago (Efectivo, Transferencia, …). Solo en ventas. */
  payment?: string
  /** Nombre del cliente. Opcional en venta rápida. */
  customerName?: string
  /** Teléfono del cliente: sirve para avisar de un cambio o una talla que llegó. */
  customerPhone?: string

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
  /** Ubicación de origen (traslados y ventas). Clave de `domain/locations.ts`. */
  fromLocation?: string
  /** Ubicación de destino (entradas, devoluciones y traslados). */
  toLocation?: string
}

/** Datos comunes a todas las líneas de una misma venta (el "tiquete"). */
export interface SaleMeta {
  payment: string
  customerName?: string
  customerPhone?: string
  /**
   * Id de una venta EXISTENTE. Lo usa la devolución para quedar amarrada a la
   * venta original, y así saber cuánto de cada talla ya se devolvió.
   */
  saleId?: string
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

/**
 * Egreso: un gasto que se registra A MANO (arriendo, nómina, servicios, etc.).
 * No sale de un movimiento de inventario; lo carga el administrador desde la
 * vista de Ingresos y egresos. `value` es el monto total que salió de la caja.
 */
export interface Expense {
  id: string
  concept: string
  detail: string
  quantity: number
  value: Money
  occurredAt: Date
  dayKey: string
  userId: UserId
  userName: string
  createdAt: Date
}

export interface ExpenseDraft {
  concept: string
  detail: string
  quantity: number
  value: Money
  occurredAt: Date
}
