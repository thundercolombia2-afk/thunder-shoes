/**
 * Backend en memoria para el MODO DEMO (ver el front sin Firebase).
 *
 * Reproduce lo que hacen los repositorios, pero contra estructuras en memoria:
 * catálogo, movimientos, stats, equipo. Los cambios (vender, comprar, crear
 * referencia) mutan estos datos y se ven en vivo, pero NO se guardan: al
 * recargar, todo vuelve al estado inicial. Solo se usa cuando `DEMO` es true.
 */

import {
  money,
  SIZES,
  type DailyStats,
  type LowStockAlert,
  type Movement,
  type MovementDraft,
  type MovementType,
  type Product,
  type ProductId,
  type Size,
  type Store,
  type StoreId,
  type UserId,
  type Variant,
  type VariantId,
  type VariantWithProduct,
} from '@/domain/models'
import {
  DomainError,
  assertMovementIsValid,
  buildBarcode,
  buildSearchTokens,
  calculateMovement,
} from '@/domain/rules'
import type { Invite, Role, UserProfile } from '@/domain/users'
import { recentDayKeys, toDayKey } from '@/lib/format'
import type { NewProductInput, ProductWithVariants } from './repositories/catalogRepository'
import type { MovementActor, RecordedMovement } from './repositories/movementRepository'

// ── PRNG determinista (datos estables entre recargas) ────────────────────────
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rnd = mulberry32(20260722)
const ri = (a: number, b: number) => Math.floor(rnd() * (b - a + 1)) + a

// ── Datos base ───────────────────────────────────────────────────────────────
const STORE_DEFS = [
  { code: '163', name: 'Sede principal' },
  { code: '173', name: 'Sede norte' },
]

const PRODUCT_DEFS: [string, string, string, number][] = [
  ['Nike', 'Air Force 1 Low', 'AF1-WHT', 459900],
  ['Nike', 'Air Max 90', 'AM90-BLK', 589900],
  ['Nike', 'Dunk Low Panda', 'DNK-PND', 529900],
  ['Adidas', 'Superstar', 'SUP-WHT', 419900],
  ['Adidas', 'Forum Low', 'FRM-BLU', 479900],
  ['Adidas', 'Samba OG', 'SMB-BGE', 499900],
  ['Puma', 'Suede Classic', 'SUE-RED', 299900],
  ['Puma', 'RS-X', 'RSX-MLT', 389900],
  ['New Balance', '550 White', 'NB550-WHT', 649900],
  ['New Balance', '574 Grey', 'NB574-GRY', 429900],
  ['Converse', 'Chuck 70 Hi', 'CK70-BLK', 369900],
  ['Vans', 'Old Skool', 'OS-BLK', 339900],
  ['Reebok', 'Club C 85', 'CC85-WHT', 329900],
  ['Asics', 'Gel-Lyte III', 'GL3-CRM', 459900],
  ['Jordan', '1 Mid Chicago', 'J1M-CHI', 799900],
  ['Nike', 'Cortez', 'CTZ-WHT', 379900],
  ['Adidas', 'Gazelle', 'GZL-GRN', 449900],
  ['Fila', 'Disruptor II', 'DIS-WHT', 289900],
  ['Skechers', 'D’Lites', 'DLT-PNK', 319900],
  ['Under Armour', 'Curry Flow', 'CRY-BLK', 689900],
]

const now = new Date()

// Estado mutable en memoria
const stores: Store[] = STORE_DEFS.map((s) => ({ id: s.code as StoreId, code: s.code, name: s.name, active: true }))

const products: Product[] = []
const variants: Variant[] = []

PRODUCT_DEFS.forEach(([brand, name, sku, price], i) => {
  const id = `demo-p${i}` as ProductId
  const minStock = ri(2, 4)
  const cost = money(Math.round((price * (0.52 + rnd() * 0.14)) / 100) * 100)
  products.push({
    id,
    sku,
    brand,
    name,
    price: money(price),
    cost,
    minStock,
    active: true,
    searchTokens: buildSearchTokens(name, brand, sku),
    createdAt: now,
    updatedAt: now,
  })
  for (const size of SIZES as readonly Size[]) {
    const edge = size <= 37 || size >= 44
    variants.push({
      id: `${id}:${size}` as VariantId,
      productId: id,
      size,
      barcode: buildBarcode(sku, size),
      stock: edge ? ri(0, 5) : ri(2, 14),
      minStock,
      active: true,
      updatedAt: now,
    })
  }
})

const movements: Movement[] = []
const statsByDay = new Map<string, DailyStats>()

function emptyStats(dayKey: string): DailyStats {
  return {
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
    updatedAt: now,
  }
}

function applyToStats(m: Movement) {
  const s = statsByDay.get(m.dayKey) ?? emptyStats(m.dayKey)
  s.margin = money(s.margin + m.margin)
  if (m.type === 'sale') {
    s.salesTotal = money(s.salesTotal + m.total)
    s.salesCount += 1
    s.unitsSold += m.quantity
    s.salesByStore[m.storeId] = (s.salesByStore[m.storeId] ?? 0) + m.total
    s.unitsByProduct[m.productId] = (s.unitsByProduct[m.productId] ?? 0) + m.quantity
  } else if (m.type === 'purchase') {
    s.purchasesTotal = money(s.purchasesTotal + m.total)
    s.purchasesCount += 1
  } else {
    s.returnsTotal = money(s.returnsTotal + m.total)
    s.unitsSold -= m.quantity
    s.salesByStore[m.storeId] = (s.salesByStore[m.storeId] ?? 0) - m.total
    s.unitsByProduct[m.productId] = (s.unitsByProduct[m.productId] ?? 0) - m.quantity
  }
  statsByDay.set(m.dayKey, s)
}

// Movimientos iniciales para poblar historial y dashboard
const DEMO_NAMES = ['María G.', 'Andrés P.', 'Camila R.', 'Julián M.', 'Valeria S.']
const days7 = recentDayKeys(7)
for (let k = 0; k < 22; k++) {
  const variant = variants[ri(0, variants.length - 1)]!
  const product = products.find((p) => p.id === variant.productId)!
  const store = stores[ri(0, stores.length - 1)]!
  const roll = rnd()
  const type: MovementType = roll < 0.62 ? 'sale' : roll < 0.85 ? 'purchase' : 'return'
  const qty = type === 'purchase' ? ri(4, 10) : ri(1, 3)
  const unitMargin = product.price - product.cost
  const total = type === 'purchase' ? money(product.cost * qty) : money(product.price * qty)
  const margin =
    type === 'purchase' ? money(0) : type === 'sale' ? money(unitMargin * qty) : money(-(unitMargin * qty))
  const dayKey = days7[Math.min(days7.length - 1, Math.floor(k / 3.4))]!
  const m: Movement = {
    id: `demo-m${k}` as Movement['id'],
    type,
    productId: product.id,
    variantId: variant.id,
    snapshot: {
      productName: product.name,
      brand: product.brand,
      sku: product.sku,
      barcode: variant.barcode,
      size: variant.size,
      unitPrice: product.price,
      unitCost: product.cost,
    },
    quantity: qty,
    stockDelta: type === 'sale' ? -qty : qty,
    stockAfter: variant.stock,
    total,
    margin,
    storeId: store.id,
    userId: `demo-u${ri(0, 4)}` as UserId,
    userName: DEMO_NAMES[ri(0, DEMO_NAMES.length - 1)]!,
    occurredAt: now,
    dayKey,
  }
  movements.push(m)
  applyToStats(m)
}
movements.reverse() // más recientes primero para el historial

// Equipo demo
const demoUser: UserProfile = {
  id: 'demo-uid' as UserId,
  name: 'Dueño Demo',
  email: 'demo@thunder.pos',
  role: 'socio', // cámbialo a 'empleado' para previsualizar la vista de empleado
  active: true,
  createdAt: now,
}
const team: UserProfile[] = [
  demoUser,
  { id: 'demo-u1' as UserId, name: 'María G.', email: 'maria@thunder.pos', role: 'empleado', active: true, createdAt: now },
  { id: 'demo-u2' as UserId, name: 'Andrés P.', email: 'andres@thunder.pos', role: 'empleado', active: true, createdAt: now },
]
const invites: Invite[] = []

// ── Pub/sub del catálogo ─────────────────────────────────────────────────────
type CatalogListener = (catalog: ProductWithVariants[]) => void
const listeners = new Set<CatalogListener>()

function buildCatalog(): ProductWithVariants[] {
  return products
    .filter((p) => p.active)
    .map((product) => {
      const vs = variants.filter((v) => v.productId === product.id).sort((a, b) => a.size - b.size)
      return { product, variants: vs, totalStock: vs.reduce((sum, v) => sum + v.stock, 0) }
    })
    .sort((a, b) => a.product.name.localeCompare(b.product.name))
}
function notify() {
  const snapshot = buildCatalog()
  for (const l of listeners) l(snapshot)
}

// ── API que consumen los repositorios en modo demo ───────────────────────────
export const demoBackend = {
  demoUser,

  listStores(): Promise<Store[]> {
    return Promise.resolve(stores)
  },

  subscribeCatalog(onChange: CatalogListener): () => void {
    listeners.add(onChange)
    onChange(buildCatalog())
    return () => listeners.delete(onChange)
  },

  findByBarcode(barcode: string): Promise<VariantWithProduct> {
    const code = barcode.trim().toUpperCase()
    const variant = variants.find((v) => v.barcode.toUpperCase() === code)
    const product = variant && products.find((p) => p.id === variant.productId)
    if (!variant || !product) {
      return Promise.reject(new DomainError('BARCODE_NOT_FOUND', 'Código no encontrado', { barcode }))
    }
    return Promise.resolve({ product, variant })
  },

  getVariant(variantId: VariantId): Promise<VariantWithProduct> {
    const variant = variants.find((v) => v.id === variantId)
    const product = variant && products.find((p) => p.id === variant.productId)
    if (!variant || !product) return Promise.reject(new DomainError('BARCODE_NOT_FOUND', 'Variante no encontrada'))
    return Promise.resolve({ product, variant })
  },

  listLowStock(): Promise<LowStockAlert[]> {
    const alerts = variants
      .filter((v) => v.active && v.stock <= v.minStock)
      .map((v) => ({
        productId: v.productId,
        productName: products.find((p) => p.id === v.productId)?.name ?? '',
        size: v.size,
        stock: v.stock,
        minStock: v.minStock,
      }))
    return Promise.resolve(alerts)
  },

  listSampleBarcodes(count: number): Promise<VariantWithProduct[]> {
    const out: VariantWithProduct[] = []
    for (const product of products.slice(0, count)) {
      const variant = variants.find((v) => v.productId === product.id && v.stock > 0)
      if (variant) out.push({ product, variant })
    }
    return Promise.resolve(out)
  },

  createProduct(input: NewProductInput): Promise<ProductId> {
    const id = `demo-p${products.length}` as ProductId
    products.push({
      id,
      sku: input.sku.toUpperCase(),
      brand: input.brand,
      name: input.name,
      price: input.price,
      cost: input.cost,
      minStock: input.minStock,
      active: true,
      searchTokens: buildSearchTokens(input.name, input.brand, input.sku),
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    for (const size of input.sizes) {
      variants.push({
        id: `${id}:${size}` as VariantId,
        productId: id,
        size,
        barcode: buildBarcode(input.sku, size),
        stock: 0,
        minStock: input.minStock,
        active: true,
        updatedAt: new Date(),
      })
    }
    notify()
    return Promise.resolve(id)
  },

  record(draft: MovementDraft, actor: MovementActor): Promise<RecordedMovement> {
    const variant = variants.find((v) => v.id === draft.variantId)
    const product = variant && products.find((p) => p.id === variant.productId)
    if (!variant || !product) return Promise.reject(new DomainError('BARCODE_NOT_FOUND', 'La referencia ya no existe'))

    assertMovementIsValid(draft, variant)
    const totals = calculateMovement(draft, product, variant)
    variant.stock = totals.stockAfter
    variant.updatedAt = new Date()

    const occurredAt = new Date()
    const movement: Movement = {
      id: `demo-m${movements.length + 1000}` as Movement['id'],
      type: draft.type,
      productId: product.id,
      variantId: draft.variantId,
      snapshot: {
        productName: product.name,
        brand: product.brand,
        sku: product.sku,
        barcode: variant.barcode,
        size: variant.size,
        unitPrice: totals.unitPrice,
        unitCost: totals.unitCost,
      },
      quantity: draft.quantity,
      stockDelta: totals.stockDelta,
      stockAfter: totals.stockAfter,
      total: totals.total,
      margin: totals.margin,
      storeId: actor.storeId,
      userId: actor.userId,
      userName: actor.userName,
      occurredAt,
      dayKey: toDayKey(occurredAt),
    }
    if (draft.returnReason) movement.returnReason = draft.returnReason
    movements.unshift(movement)
    applyToStats(movement)
    notify()
    return Promise.resolve({ movement, stockAfter: totals.stockAfter })
  },

  listPage(options: { type?: MovementType } = {}): Promise<{
    movements: Movement[]
    cursor: undefined
    hasMore: boolean
  }> {
    const list = options.type ? movements.filter((m) => m.type === options.type) : movements
    return Promise.resolve({ movements: list.slice(0, 60), cursor: undefined, hasMore: false })
  },

  listForExport(fromDayKey: string, toDayKey_: string): Promise<Movement[]> {
    return Promise.resolve(movements.filter((m) => m.dayKey >= fromDayKey && m.dayKey <= toDayKey_))
  },

  getById(id: string): Promise<Movement | null> {
    return Promise.resolve(movements.find((m) => m.id === id) ?? null)
  },

  listRecentDays(days: number): Promise<DailyStats[]> {
    const keys = recentDayKeys(days)
    return Promise.resolve(keys.map((k) => statsByDay.get(k) ?? emptyStats(k)))
  },

  // Equipo
  listTeam(): Promise<UserProfile[]> {
    return Promise.resolve([...team])
  },
  listInvites(): Promise<Invite[]> {
    return Promise.resolve([...invites])
  },
  createInvite(role: Role, creator: { id: UserId; name: string }): Promise<Invite> {
    const invite: Invite = {
      code: `THR-DEMO${invites.length + 1}`,
      role,
      createdBy: creator.id,
      createdByName: creator.name,
      active: true,
      createdAt: new Date(),
    }
    invites.unshift(invite)
    return Promise.resolve(invite)
  },

  // Perfil
  updateName(name: string): Promise<void> {
    demoUser.name = name.trim()
    return Promise.resolve()
  },
  loadProfile(): Promise<UserProfile> {
    return Promise.resolve({ ...demoUser })
  },
}
