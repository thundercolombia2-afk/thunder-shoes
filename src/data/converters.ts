/**
 * Traductores entre documentos de Firestore y modelos de dominio.
 *
 * Esta es la ÚNICA frontera donde existen `Timestamp`, `DocumentSnapshot` y
 * campos sueltos sin tipar. De aquí para arriba todo son objetos de dominio
 * con `Date` y tipos marcados. Si un día se cambia de Firestore a otra base,
 * se reescribe este archivo y nada más.
 */

import { Timestamp, type DocumentData, type QueryDocumentSnapshot } from 'firebase/firestore'
import {
  type Bodega,
  type BodegaId,
  type DailyStats,
  type Expense,
  type Movement,
  type MovementId,
  type Product,
  type ProductId,
  type Size,
  type Store,
  type StoreId,
  type UserId,
  type Variant,
  type VariantId,
  isSize,
  money,
} from '@/domain/models'
import { type Invite, type Role, type UserProfile, isRole } from '@/domain/users'

/** Mapa `{ ubicacion: cantidad }` saneado desde un campo suelto de Firestore. */
const toStockByLocation = (value: unknown): Record<string, number> => {
  if (!value || typeof value !== 'object') return {}
  const out: Record<string, number> = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const n = Number(raw)
    if (Number.isFinite(n) && n !== 0) out[key] = n
  }
  return out
}

/** Firestore puede devolver `Timestamp`, `Date` o nada según el estado del caché. */
const toDate = (value: unknown): Date => {
  if (value instanceof Timestamp) return value.toDate()
  if (value instanceof Date) return value
  return new Date(0)
}

const toSize = (value: unknown): Size => {
  const n = Number(value)
  if (!isSize(n)) throw new Error(`Talla inválida en Firestore: ${String(value)}`)
  return n
}

// ─────────────────────────────────────────────────────────────────────────────

export const storeFromDoc = (snap: QueryDocumentSnapshot<DocumentData>): Store => {
  const d = snap.data()
  return {
    id: snap.id as StoreId,
    code: String(d.code ?? snap.id),
    name: String(d.name ?? ''),
    active: d.active !== false,
  }
}

// ─────────────────────────────────────────────────────────────────────────────

export const productFromDoc = (snap: QueryDocumentSnapshot<DocumentData>): Product => {
  const d = snap.data()
  return {
    id: snap.id as ProductId,
    sku: String(d.sku ?? ''),
    brand: String(d.brand ?? ''),
    name: String(d.name ?? ''),
    price: money(Number(d.price ?? 0)),
    cost: money(Number(d.cost ?? 0)),
    minStock: Number(d.minStock ?? 0),
    active: d.active !== false,
    createdAt: toDate(d.createdAt),
    updatedAt: toDate(d.updatedAt),
  }
}

export const productToDoc = (product: Omit<Product, 'id'>): DocumentData => ({
  sku: product.sku,
  brand: product.brand,
  name: product.name,
  price: product.price,
  cost: product.cost,
  minStock: product.minStock,
  active: product.active,
  createdAt: Timestamp.fromDate(product.createdAt),
  updatedAt: Timestamp.fromDate(product.updatedAt),
})

// ─────────────────────────────────────────────────────────────────────────────

export const variantFromDoc = (snap: QueryDocumentSnapshot<DocumentData>): Variant => {
  const d = snap.data()
  return {
    // El id del documento es la talla; el id de dominio es "productId:talla"
    // para que sea único a través de todas las referencias.
    id: `${String(d.productId)}:${snap.id}` as VariantId,
    productId: String(d.productId) as ProductId,
    size: toSize(d.size ?? snap.id),
    barcode: String(d.barcode ?? ''),
    stock: Number(d.stock ?? 0),
    stockByLocation: toStockByLocation(d.stockByLocation),
    minStock: Number(d.minStock ?? 0),
    active: d.active !== false,
    updatedAt: toDate(d.updatedAt),
  }
}

export const variantToDoc = (variant: Omit<Variant, 'id' | 'updatedAt'>): DocumentData => ({
  productId: variant.productId,
  size: variant.size,
  barcode: variant.barcode,
  stock: variant.stock,
  stockByLocation: variant.stockByLocation,
  minStock: variant.minStock,
  active: variant.active,
  updatedAt: Timestamp.now(),
})

/** Descompone el id de dominio de una variante en su ruta de Firestore. */
export function splitVariantId(id: VariantId): { productId: ProductId; size: Size } {
  const [productId, rawSize] = String(id).split(':')
  if (!productId || !rawSize) throw new Error(`VariantId inválido: ${String(id)}`)
  return { productId: productId as ProductId, size: toSize(rawSize) }
}

export const makeVariantId = (productId: ProductId, size: Size): VariantId =>
  `${productId}:${size}` as VariantId

// ─────────────────────────────────────────────────────────────────────────────

export const movementFromDoc = (snap: QueryDocumentSnapshot<DocumentData>): Movement => {
  const d = snap.data()
  const s = (d.snapshot ?? {}) as DocumentData
  const movement: Movement = {
    id: snap.id as MovementId,
    type: d.type,
    productId: String(d.productId) as ProductId,
    variantId: String(d.variantId) as VariantId,
    snapshot: {
      productName: String(s.productName ?? ''),
      brand: String(s.brand ?? ''),
      sku: String(s.sku ?? ''),
      barcode: String(s.barcode ?? ''),
      size: toSize(s.size),
      unitPrice: money(Number(s.unitPrice ?? 0)),
      unitCost: money(Number(s.unitCost ?? 0)),
    },
    quantity: Number(d.quantity ?? 0),
    stockDelta: Number(d.stockDelta ?? 0),
    stockAfter: Number(d.stockAfter ?? 0),
    total: money(Number(d.total ?? 0)),
    margin: money(Number(d.margin ?? 0)),
    storeId: String(d.storeId) as StoreId,
    userId: String(d.userId) as UserId,
    userName: String(d.userName ?? ''),
    occurredAt: toDate(d.occurredAt),
    dayKey: String(d.dayKey ?? ''),
  }
  // `exactOptionalPropertyTypes` no permite asignar `undefined` explícito.
  if (d.returnReason) movement.returnReason = d.returnReason
  if (d.bajaReason) movement.bajaReason = d.bajaReason
  if (d.fromLocation) movement.fromLocation = String(d.fromLocation)
  if (d.toLocation) movement.toLocation = String(d.toLocation)
  if (d.saleId) movement.saleId = String(d.saleId)
  if (d.payment) movement.payment = String(d.payment)
  if (d.customerName) movement.customerName = String(d.customerName)
  if (d.customerPhone) movement.customerPhone = String(d.customerPhone)
  return movement
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reconstruye un mapa `{ clave: número }` desde el documento, sumando DOS
 * fuentes: el mapa anidado correcto (`campo: { clave: n }`) y las claves
 * heredadas con punto en el nombre (`"campo.clave": n`). Estas últimas las dejó
 * un bug viejo (una clave con punto en `set(merge)` crea un campo literal en la
 * raíz en vez de anidar). Así el dashboard muestra bien tanto los datos nuevos
 * como los ya guardados con el formato roto.
 */
const mergeDotted = (d: DocumentData, field: string): Record<string, number> => {
  const out: Record<string, number> = {}
  const nested = (d[field] ?? {}) as Record<string, unknown>
  for (const [k, v] of Object.entries(nested)) out[k] = (out[k] ?? 0) + Number(v)
  const prefix = `${field}.`
  for (const [k, v] of Object.entries(d)) {
    if (k.startsWith(prefix)) {
      const key = k.slice(prefix.length)
      out[key] = (out[key] ?? 0) + Number(v)
    }
  }
  return out
}

export const dailyStatsFromDoc = (snap: QueryDocumentSnapshot<DocumentData>): DailyStats => {
  const d = snap.data()
  return {
    id: snap.id,
    dayKey: String(d.dayKey ?? snap.id),
    salesTotal: money(Number(d.salesTotal ?? 0)),
    purchasesTotal: money(Number(d.purchasesTotal ?? 0)),
    returnsTotal: money(Number(d.returnsTotal ?? 0)),
    margin: money(Number(d.margin ?? 0)),
    salesCount: Number(d.salesCount ?? 0),
    purchasesCount: Number(d.purchasesCount ?? 0),
    unitsSold: Number(d.unitsSold ?? 0),
    salesByStore: mergeDotted(d, 'salesByStore'),
    unitsByProduct: mergeDotted(d, 'unitsByProduct'),
    updatedAt: toDate(d.updatedAt),
  }
}

// ─────────────────────────────────────────────────────────────────────────────

export const expenseFromDoc = (snap: QueryDocumentSnapshot<DocumentData>): Expense => {
  const d = snap.data()
  return {
    id: snap.id,
    concept: String(d.concept ?? ''),
    detail: String(d.detail ?? ''),
    quantity: Number(d.quantity ?? 0),
    value: money(Number(d.value ?? 0)),
    occurredAt: toDate(d.occurredAt),
    dayKey: String(d.dayKey ?? ''),
    userId: String(d.userId ?? '') as UserId,
    userName: String(d.userName ?? ''),
    createdAt: toDate(d.createdAt),
  }
}

// ─────────────────────────────────────────────────────────────────────────────

const toRole = (value: unknown): Role => (isRole(value) ? value : 'empleado')

export const userFromDoc = (snap: QueryDocumentSnapshot<DocumentData>): UserProfile => {
  const d = snap.data()
  const profile: UserProfile = {
    id: snap.id as UserId,
    name: String(d.name ?? ''),
    email: String(d.email ?? ''),
    role: toRole(d.role),
    active: d.active !== false,
    createdAt: toDate(d.createdAt),
  }
  if (d.storeId) profile.storeId = String(d.storeId) as StoreId
  if (Array.isArray(d.bodegaIds)) profile.bodegaIds = (d.bodegaIds as unknown[]).map(String)
  if (d.owner === true) profile.owner = true
  return profile
}

// ─────────────────────────────────────────────────────────────────────────────

export const bodegaFromDoc = (snap: QueryDocumentSnapshot<DocumentData>): Bodega => {
  const d = snap.data()
  return {
    id: snap.id as BodegaId,
    code: String(d.code ?? snap.id),
    name: String(d.name ?? ''),
    active: d.active !== false,
    createdAt: toDate(d.createdAt),
  }
}

export const bodegaToDoc = (bodega: Omit<Bodega, 'id'>): DocumentData => ({
  code: bodega.code,
  name: bodega.name,
  active: bodega.active,
  createdAt: Timestamp.fromDate(bodega.createdAt),
})

export const inviteFromDoc = (snap: QueryDocumentSnapshot<DocumentData>): Invite => {
  const d = snap.data()
  const invite: Invite = {
    code: snap.id,
    role: toRole(d.role),
    createdBy: String(d.createdBy ?? '') as UserId,
    createdByName: String(d.createdByName ?? ''),
    active: d.active !== false,
    createdAt: toDate(d.createdAt),
  }
  if (d.storeId) invite.storeId = String(d.storeId)
  if (d.bodegaId) invite.bodegaId = String(d.bodegaId)
  if (d.usedBy) invite.usedBy = String(d.usedBy) as UserId
  return invite
}

// ─────────────────────────────────────────────────────────────────────────────

/** Día vacío: evita `null` en el dashboard cuando todavía no hubo movimientos. */
export const emptyDailyStats = (dayKey: string): DailyStats => ({
  id: dayKey,
  dayKey,
  salesTotal: money(0),
  purchasesTotal: money(0),
  returnsTotal: money(0),
  margin: money(0),
  salesCount: 0,
  purchasesCount: 0,
  unitsSold: 0,
  salesByStore: {},
  unitsByProduct: {},
  updatedAt: new Date(0),
})
