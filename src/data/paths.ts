/**
 * Mapa de la base de datos. Cada ruta de Firestore se construye AQUÍ y en
 * ningún otro sitio: si mañana cambia la estructura, se cambia este archivo.
 *
 * ┌────────────────────────────────────────────────────────────────────────┐
 * │ stores/{storeId}                        Locales (163, 173)             │
 * │ products/{productId}                    Referencia. Sin stock.         │
 * │ products/{productId}/variants/{size}    Talla. Aquí vive el stock.     │
 * │ barcodes/{barcode}                      Índice inverso código → talla  │
 * │ movements/{movementId}                  Libro mayor inmutable          │
 * │ dailyStats/{dayKey}                     Agregado diario del dashboard  │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * Por qué las variantes son subcolección y no un mapa `sizes` dentro del
 * producto (como en el prototipo):
 *
 *  1. Contención de escritura. Con un mapa, vender una talla 40 y una talla 42
 *     de la misma referencia al mismo tiempo son dos escrituras al MISMO
 *     documento: Firestore serializa y una reintenta. Con subcolección son
 *     dos documentos distintos y no se tocan.
 *  2. Consultas. `collectionGroup('variants').where('stock','<=',...)` da las
 *     alertas de stock bajo en UNA consulta indexada. Con un mapa habría que
 *     leer el catálogo completo al cliente y filtrar en memoria.
 *  3. Límite de 1 MiB por documento: un producto con historial embebido lo
 *     alcanza; una variante nunca.
 */

import {
  collection,
  collectionGroup,
  doc,
  type CollectionReference,
  type DocumentReference,
} from 'firebase/firestore'
import { db } from './firebase'
import type { ProductId, Size, StoreId } from '@/domain/models'

export const COLLECTIONS = {
  stores: 'stores',
  products: 'products',
  variants: 'variants',
  barcodes: 'barcodes',
  movements: 'movements',
  dailyStats: 'dailyStats',
  users: 'users',
  invites: 'invites',
} as const

export const storesRef = (): CollectionReference => collection(db, COLLECTIONS.stores)
export const storeRef = (id: StoreId): DocumentReference => doc(db, COLLECTIONS.stores, id)

export const productsRef = (): CollectionReference => collection(db, COLLECTIONS.products)
export const productRef = (id: ProductId): DocumentReference =>
  doc(db, COLLECTIONS.products, id)

export const variantsRef = (productId: ProductId): CollectionReference =>
  collection(db, COLLECTIONS.products, productId, COLLECTIONS.variants)

/**
 * El id del documento de variante ES la talla ("40"). Así la ruta de cualquier
 * variante es deducible sin consultar, y una talla no puede duplicarse.
 */
export const variantRef = (productId: ProductId, size: Size): DocumentReference =>
  doc(db, COLLECTIONS.products, productId, COLLECTIONS.variants, String(size))

/** Consulta transversal a todas las variantes de todos los productos. */
export const allVariantsRef = () => collectionGroup(db, COLLECTIONS.variants)

/**
 * Índice inverso: el id del documento es el código de barras. Resolver un
 * escaneo es una lectura directa por id — sin consulta, sin índice, ~1 lectura.
 */
export const barcodeRef = (barcode: string): DocumentReference =>
  doc(db, COLLECTIONS.barcodes, barcode.trim().toUpperCase())

export const movementsRef = (): CollectionReference => collection(db, COLLECTIONS.movements)
export const movementRef = (id: string): DocumentReference =>
  doc(db, COLLECTIONS.movements, id)

/** El id del documento es el dayKey: "2026-07-15". */
export const dailyStatsRef = (dayKey: string): DocumentReference =>
  doc(db, COLLECTIONS.dailyStats, dayKey)

// ── Personas y accesos ───────────────────────────────────────────────────────

/** El id del documento de usuario ES el uid de Firebase Auth. */
export const usersRef = (): CollectionReference => collection(db, COLLECTIONS.users)
export const userRef = (uid: string): DocumentReference => doc(db, COLLECTIONS.users, uid)

/** El id del documento de invitación ES su código. */
export const invitesRef = (): CollectionReference => collection(db, COLLECTIONS.invites)
export const inviteRef = (code: string): DocumentReference =>
  doc(db, COLLECTIONS.invites, code.trim().toUpperCase())

/**
 * Centinela de arranque: existe una sola vez, cuando se crea el primer socio.
 * Su presencia le dice a las reglas "ya hay dueño, de aquí en más solo por
 * invitación".
 */
export const systemStateRef = (): DocumentReference => doc(db, 'system', 'state')
