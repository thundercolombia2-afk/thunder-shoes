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
  type Bodega,
  type BodegaId,
  type DailyStats,
  type Expense,
  type ExpenseDraft,
  type LowStockAlert,
  type Movement,
  type MovementDraft,
  type MovementType,
  type Product,
  type ProductId,
  type SaleMeta,
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
  calculateMovement,
  locationDeltas,
} from '@/domain/rules'
import type { Invite, Role, UserProfile } from '@/domain/users'
import { bodegaKey, storeKey } from '@/domain/locations'
import { recentDayKeys, toDayKey } from '@/lib/format'
import type { EditProductInput, NewProductInput, ProductWithVariants } from './repositories/catalogRepository'
import { groupSales, matchesCustomer, type Sale } from '@/domain/sales'
import type { MovementActor } from './repositories/movementRepository'

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

const DEMO_BODEGA_ID = 'demo-bodega-1' as BodegaId

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
    createdAt: now,
    updatedAt: now,
  })
  for (const size of SIZES as readonly Size[]) {
    const edge = size <= 37 || size >= 44
    const stock = edge ? ri(0, 5) : ri(2, 14)
    // Se reparte entre la bodega demo y los dos locales, para poder probar de
    // una tanto vender (hay stock en los locales) como sacar de bodega.
    const inBodega = Math.round(stock * 0.4)
    const rest = stock - inBodega
    const in163 = Math.round(rest / 2)
    const in173 = rest - in163
    const stockByLocation: Record<string, number> = {}
    if (inBodega) stockByLocation[bodegaKey(DEMO_BODEGA_ID)] = inBodega
    if (in163) stockByLocation[storeKey('163')] = in163
    if (in173) stockByLocation[storeKey('173')] = in173
    variants.push({
      id: `${id}:${size}` as VariantId,
      productId: id,
      size,
      barcode: buildBarcode(sku, size),
      stock,
      stockByLocation,
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
  } else if (m.type === 'return') {
    s.returnsTotal = money(s.returnsTotal + m.total)
    s.unitsSold -= m.quantity
    s.salesByStore[m.storeId] = (s.salesByStore[m.storeId] ?? 0) - m.total
    s.unitsByProduct[m.productId] = (s.unitsByProduct[m.productId] ?? 0) - m.quantity
  }
  statsByDay.set(m.dayKey, s)
}

// Movimientos iniciales para poblar historial y dashboard
const DEMO_NAMES = ['María G.', 'Andrés P.', 'Camila R.', 'Julián M.', 'Valeria S.']
/** Clientes de mentira para poder probar la búsqueda de la devolución. */
const DEMO_CUSTOMERS: [string, string, string][] = [
  ['Juan Ávila', '3001234567', 'Efectivo'],
  ['Laura Restrepo', '3109876543', 'Nequi'],
  ['Carlos Mejía', '3205551122', 'Transferencia'],
  ['Sofía Lozano', '3014447788', 'Daviplata'],
  ['Diego Pardo', '3123334455', 'Tarjeta'],
]
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
  if (type === 'sale') {
    const [customerName, customerPhone, payment] = DEMO_CUSTOMERS[k % DEMO_CUSTOMERS.length]!
    m.saleId = `demo-s${k}`
    m.customerName = customerName
    m.customerPhone = customerPhone
    m.payment = payment
  }
  movements.push(m)
  applyToStats(m)
}
movements.reverse() // más recientes primero para el historial

// Equipo demo. Los roles de venta van amarrados a un local; el bodeguero no.
const demoUser: UserProfile = {
  id: 'demo-uid' as UserId,
  name: 'Dueña Demo',
  email: 'demo@thunder.pos',
  role: 'socio', // cámbialo a 'empleado' o 'bodeguero' para previsualizar otras vistas
  storeId: '163' as StoreId,
  bodegaIds: [DEMO_BODEGA_ID],
  owner: true,
  active: true,
  createdAt: now,
}
const team: UserProfile[] = [
  demoUser,
  { id: 'demo-u1' as UserId, name: 'María G.', email: 'maria@thunder.pos', role: 'empleado', storeId: '163' as StoreId, active: true, createdAt: now },
  { id: 'demo-u2' as UserId, name: 'Andrés P.', email: 'andres@thunder.pos', role: 'empleado', storeId: '173' as StoreId, active: true, createdAt: now },
  { id: 'demo-u3' as UserId, name: 'Bruno Bodega', email: 'bruno@thunder.pos', role: 'bodeguero', bodegaIds: [DEMO_BODEGA_ID], active: true, createdAt: now },
]
const invites: Invite[] = []

// Bodegas demo.
const bodegas: Bodega[] = [
  { id: DEMO_BODEGA_ID, code: 'Bodega 1', name: 'Bodega principal', active: true, createdAt: now },
]
const bodegaListeners = new Set<(b: Bodega[]) => void>()
const notifyBodegas = () => bodegaListeners.forEach((l) => l([...bodegas]))

// Egresos demo (cargados a mano).
const expenses: Expense[] = []
const expenseListeners = new Set<(e: Expense[]) => void>()
const notifyExpenses = () => expenseListeners.forEach((l) => l([...expenses]))

// Configuración demo: contraseña compartida para ingresar mercancía.
const config = { entryPassword: '1234' }

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
        stockByLocation: {},
        minStock: input.minStock,
        active: true,
        updatedAt: new Date(),
      })
    }
    notify()
    return Promise.resolve(id)
  },

  removeVariant(productId: ProductId, size: Size): Promise<void> {
    const i = variants.findIndex((v) => v.productId === productId && v.size === size)
    if (i < 0) return Promise.resolve()
    if (variants[i]!.stock !== 0) {
      throw new DomainError('HAS_STOCK', 'No se puede quitar una talla con stock. Primero sácala del inventario.')
    }
    variants.splice(i, 1)
    notify()
    return Promise.resolve()
  },

  updateProduct(id: ProductId, fields: EditProductInput): Promise<void> {
    const p = products.find((x) => x.id === id)
    if (p) {
      p.name = fields.name
      p.brand = fields.brand
      p.price = fields.price
      p.cost = fields.cost
      p.minStock = fields.minStock
      p.updatedAt = new Date()
      notify()
    }
    return Promise.resolve()
  },
  deleteProduct(id: ProductId): Promise<void> {
    const owned = variants.filter((v) => v.productId === id)
    if (owned.some((v) => v.stock !== 0)) {
      throw new DomainError('HAS_STOCK', 'No se puede eliminar una referencia con stock. Primero sácala del inventario.')
    }
    for (let i = variants.length - 1; i >= 0; i--) {
      if (variants[i]!.productId === id) variants.splice(i, 1)
    }
    const pi = products.findIndex((x) => x.id === id)
    if (pi >= 0) products.splice(pi, 1)
    notify()
    return Promise.resolve()
  },

  recordMany(drafts: MovementDraft[], actor: MovementActor, meta?: SaleMeta): Promise<Movement[]> {
    const occurredAt = new Date()
    const saleId = `demo-s${movements.length + 1000}`
    const created: Movement[] = []

    // Se valida TODO antes de tocar el stock: igual que la transacción real,
    // el carrito entra completo o no entra.
    const prepared = drafts.map((draft) => {
      const variant = variants.find((v) => v.id === draft.variantId)
      const product = variant && products.find((p) => p.id === variant.productId)
      if (!variant || !product) throw new DomainError('BARCODE_NOT_FOUND', 'La referencia ya no existe')
      const eff: MovementDraft = { ...draft }
      if (draft.type === 'sale' && !eff.fromLocation) eff.fromLocation = storeKey(actor.storeId)
      if (draft.type === 'return' && !eff.toLocation) eff.toLocation = storeKey(actor.storeId)
      assertMovementIsValid(eff, variant)
      return { draft, eff, variant, product, totals: calculateMovement(eff, product, variant) }
    })

    for (const [i, { draft, eff, variant, product, totals }] of prepared.entries()) {
      variant.stock = totals.stockAfter
      for (const { key, delta } of locationDeltas(eff)) {
        const next = (variant.stockByLocation[key] ?? 0) + delta
        if (next === 0) delete variant.stockByLocation[key]
        else variant.stockByLocation[key] = next
      }
      variant.updatedAt = occurredAt

      const movement: Movement = {
        id: `demo-m${movements.length + 1000 + i}` as Movement['id'],
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
      if (eff.fromLocation) movement.fromLocation = eff.fromLocation
      if (eff.toLocation) movement.toLocation = eff.toLocation
      if (drafts.length > 1) movement.saleId = saleId
      if (meta?.payment) movement.payment = meta.payment
      if (meta?.customerName) movement.customerName = meta.customerName
      if (meta?.customerPhone) movement.customerPhone = meta.customerPhone

      movements.unshift(movement)
      applyToStats(movement)
      created.push(movement)
    }

    notify()
    return Promise.resolve(created)
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

  searchSales(needle: string, max: number): Promise<Sale[]> {
    const ids: string[] = []
    for (const m of movements) {
      if (m.type !== 'sale') continue
      const id = m.saleId ?? m.id
      if (ids.includes(id)) continue
      if (matchesCustomer(m, needle)) ids.push(id)
      if (ids.length >= max) break
    }
    const related = movements.filter((m) => ids.includes(m.saleId ?? m.id))
    return Promise.resolve(
      groupSales(related).sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime()),
    )
  },

  searchSalesByVariant(variantId: string, max: number): Promise<Sale[]> {
    const ids: string[] = []
    for (const m of movements) {
      if (m.type !== 'sale') continue
      if (String(m.variantId) !== String(variantId)) continue
      const id = m.saleId ?? m.id
      if (ids.includes(id)) continue
      ids.push(id)
      if (ids.length >= max) break
    }
    const related = movements.filter((m) => ids.includes(m.saleId ?? m.id))
    return Promise.resolve(
      groupSales(related).sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime()),
    )
  },

  listBySaleIds(saleIds: string[]): Promise<Movement[]> {
    return Promise.resolve(movements.filter((m) => saleIds.includes(m.saleId ?? m.id)))
  },

  getById(id: string): Promise<Movement | null> {
    return Promise.resolve(movements.find((m) => m.id === id) ?? null)
  },

  listRecent(max: number): Promise<Movement[]> {
    return Promise.resolve(movements.slice(0, max))
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
  createInvite(
    input: { role: Role; storeId?: string; bodegaId?: string },
    creator: { id: UserId; name: string },
  ): Promise<Invite> {
    const invite: Invite = {
      code: `THR-DEMO${invites.length + 1}`,
      role: input.role,
      createdBy: creator.id,
      createdByName: creator.name,
      active: true,
      createdAt: new Date(),
    }
    if (input.storeId) invite.storeId = input.storeId
    if (input.bodegaId) invite.bodegaId = input.bodegaId
    invites.unshift(invite)
    return Promise.resolve(invite)
  },
  setUserRole(uid: string, role: Role): Promise<void> {
    const u = team.find((x) => x.id === uid)
    if (u) u.role = role
    return Promise.resolve()
  },
  setUserStore(uid: string, storeId: string): Promise<void> {
    const u = team.find((x) => x.id === uid)
    if (u) {
      if (storeId) u.storeId = storeId as StoreId
      else delete u.storeId
    }
    return Promise.resolve()
  },
  setUserBodegas(uid: string, bodegaIds: string[]): Promise<void> {
    const u = team.find((x) => x.id === uid)
    if (u) u.bodegaIds = bodegaIds
    return Promise.resolve()
  },
  setUserActive(uid: string, active: boolean): Promise<void> {
    const u = team.find((x) => x.id === uid)
    if (u) u.active = active
    return Promise.resolve()
  },

  // Egresos
  subscribeExpenses(onChange: (e: Expense[]) => void): () => void {
    expenseListeners.add(onChange)
    onChange([...expenses])
    return () => expenseListeners.delete(onChange)
  },
  createExpense(draft: ExpenseDraft, actor: { userId: string; userName: string }): Promise<void> {
    expenses.unshift({
      id: `demo-e${expenses.length + 1}`,
      concept: draft.concept,
      detail: draft.detail,
      quantity: draft.quantity,
      value: draft.value,
      occurredAt: draft.occurredAt,
      dayKey: toDayKey(draft.occurredAt),
      userId: actor.userId as UserId,
      userName: actor.userName,
      createdAt: new Date(),
    })
    notifyExpenses()
    return Promise.resolve()
  },
  updateExpense(id: string, draft: ExpenseDraft): Promise<void> {
    const e = expenses.find((x) => x.id === id)
    if (e) {
      e.concept = draft.concept
      e.detail = draft.detail
      e.quantity = draft.quantity
      e.value = draft.value
      e.occurredAt = draft.occurredAt
      e.dayKey = toDayKey(draft.occurredAt)
      notifyExpenses()
    }
    return Promise.resolve()
  },
  deleteExpense(id: string): Promise<void> {
    const i = expenses.findIndex((x) => x.id === id)
    if (i >= 0) {
      expenses.splice(i, 1)
      notifyExpenses()
    }
    return Promise.resolve()
  },

  // Bodegas
  listBodegas(): Promise<Bodega[]> {
    return Promise.resolve([...bodegas])
  },
  subscribeBodegas(onChange: (b: Bodega[]) => void): () => void {
    bodegaListeners.add(onChange)
    onChange([...bodegas])
    return () => bodegaListeners.delete(onChange)
  },
  createBodega(input: { code: string; name: string }): Promise<BodegaId> {
    const id = `demo-bodega-${bodegas.length + 1}` as BodegaId
    bodegas.push({
      id,
      code: input.code.trim(),
      name: input.name.trim() || input.code.trim(),
      active: true,
      createdAt: new Date(),
    })
    notifyBodegas()
    return Promise.resolve(id)
  },

  // Configuración
  getEntryPassword(): Promise<string> {
    return Promise.resolve(config.entryPassword)
  },
  setEntryPassword(password: string): Promise<void> {
    config.entryPassword = password
    return Promise.resolve()
  },

  // Perfil
  updateName(name: string): Promise<void> {
    demoUser.name = name.trim()
    return Promise.resolve()
  },
  bindStore(storeId: string): Promise<void> {
    demoUser.storeId = storeId as StoreId
    return Promise.resolve()
  },
  loadProfile(): Promise<UserProfile> {
    return Promise.resolve({ ...demoUser })
  },
}
