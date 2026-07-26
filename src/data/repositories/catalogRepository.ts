/**
 * Lectura y escritura del catálogo: referencias, tallas y códigos de barras.
 */

import {
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  where,
  Timestamp,
  type Unsubscribe,
} from 'firebase/firestore'
import { db } from '../firebase'
import {
  allVariantsRef,
  barcodeRef,
  productRef,
  productsRef,
  variantRef,
  variantsRef,
} from '../paths'
import {
  makeVariantId,
  productFromDoc,
  productToDoc,
  splitVariantId,
  variantFromDoc,
  variantToDoc,
} from '../converters'
import {
  type LowStockAlert,
  type Money,
  type Product,
  type ProductId,
  type Size,
  type Variant,
  type VariantId,
  type VariantWithProduct,
} from '@/domain/models'
import { DomainError, buildBarcode } from '@/domain/rules'
import { DEMO } from '@/config'
import { demoBackend } from '../demoBackend'

/** Una referencia con todas sus tallas, que es como la pinta el inventario. */
export interface ProductWithVariants {
  product: Product
  variants: Variant[]
  totalStock: number
}

export interface NewProductInput {
  brand: string
  name: string
  sku: string
  price: Money
  cost: Money
  minStock: number
  sizes: Size[]
}

export const catalogRepository = {
  /**
   * Suscripción en vivo al catálogo. El POS necesita que si el local 163 vende
   * el último par, la pantalla del 173 lo refleje sin recargar.
   *
   * Trae productos y variantes en dos escuchas y las une en memoria: son
   * decenas de referencias, no miles, y evita N+1 suscripciones.
   */
  subscribeToCatalog(
    onChange: (catalog: ProductWithVariants[]) => void,
    onError?: (error: unknown) => void,
  ): Unsubscribe {
    if (DEMO) return demoBackend.subscribeCatalog(onChange)
    let products: Product[] = []
    let variantsByProduct = new Map<string, Variant[]>()
    let hasProducts = false
    let hasVariants = false

    const emit = () => {
      if (!hasProducts || !hasVariants) return
      onChange(
        products.map((product) => {
          const variants = (variantsByProduct.get(product.id) ?? []).sort(
            (a, b) => a.size - b.size,
          )
          return {
            product,
            variants,
            totalStock: variants.reduce((sum, v) => sum + v.stock, 0),
          }
        }),
      )
    }

    // Se filtra por `active` y se ORDENA en memoria a propósito: `where + orderBy`
    // sobre campos distintos exige un índice compuesto, y si no está desplegado la
    // suscripción falla en silencio y el inventario se queda "Cargando…". Con un
    // solo `where` no hace falta índice y funciona incluso desde el caché offline.
    const stopProducts = onSnapshot(
      query(productsRef(), where('active', '==', true)),
      (snap) => {
        products = snap.docs.map(productFromDoc).sort((a, b) => a.name.localeCompare(b.name))
        hasProducts = true
        emit()
      },
      (error) => onError?.(error),
    )

    const stopVariants = onSnapshot(
      allVariantsRef(),
      (snap) => {
        const next = new Map<string, Variant[]>()
        for (const docSnap of snap.docs) {
          const variant = variantFromDoc(docSnap)
          const bucket = next.get(variant.productId)
          if (bucket) bucket.push(variant)
          else next.set(variant.productId, [variant])
        }
        variantsByProduct = next
        hasVariants = true
        emit()
      },
      (error) => onError?.(error),
    )

    return () => {
      stopProducts()
      stopVariants()
    }
  },

  /**
   * Resuelve un código de barras escaneado.
   * Dos lecturas por id (índice → variante) más el producto. Sin consultas,
   * sin índices compuestos, y funciona desde el caché offline.
   */
  async findByBarcode(barcode: string): Promise<VariantWithProduct> {
    if (DEMO) return demoBackend.findByBarcode(barcode)
    const indexSnap = await getDoc(barcodeRef(barcode))
    if (!indexSnap.exists()) {
      throw new DomainError('BARCODE_NOT_FOUND', 'Código no encontrado', { barcode })
    }
    const { productId, size } = indexSnap.data() as { productId: ProductId; size: Size }

    const [productSnap, variantSnap] = await Promise.all([
      getDoc(productRef(productId)),
      getDoc(variantRef(productId, size)),
    ])
    if (!productSnap.exists() || !variantSnap.exists()) {
      throw new DomainError('BARCODE_NOT_FOUND', 'Referencia incompleta', { barcode })
    }

    const product = productFromDoc(productSnap as never)
    if (!product.active) {
      throw new DomainError('PRODUCT_INACTIVE', 'Referencia desactivada', { barcode })
    }
    return { product, variant: variantFromDoc(variantSnap as never) }
  },

  async getVariant(variantId: VariantId): Promise<VariantWithProduct> {
    if (DEMO) return demoBackend.getVariant(variantId)
    const { productId, size } = splitVariantId(variantId)
    const [productSnap, variantSnap] = await Promise.all([
      getDoc(productRef(productId)),
      getDoc(variantRef(productId, size)),
    ])
    if (!productSnap.exists() || !variantSnap.exists()) {
      throw new DomainError('BARCODE_NOT_FOUND', 'Variante no encontrada')
    }
    return {
      product: productFromDoc(productSnap as never),
      variant: variantFromDoc(variantSnap as never),
    }
  },

  /**
   * Alertas de stock bajo en una sola consulta indexada sobre el
   * `collectionGroup` de variantes, sin traer el catálogo completo.
   *
   * Firestore no compara dos campos entre sí (`stock <= minStock`), así que
   * filtramos por el umbral máximo del negocio y afinamos en memoria sobre
   * un conjunto ya pequeño.
   */
  async listLowStock(maxThreshold = 10): Promise<LowStockAlert[]> {
    if (DEMO) return demoBackend.listLowStock()
    const snap = await getDocs(
      query(
        allVariantsRef(),
        where('stock', '<=', maxThreshold),
        orderBy('stock'),
        limit(100),
      ),
    )
    const variants = snap.docs.map(variantFromDoc).filter((v) => v.active && v.stock <= v.minStock)

    const productIds = [...new Set(variants.map((v) => v.productId))]
    const products = await Promise.all(productIds.map((id) => getDoc(productRef(id))))
    const nameById = new Map(
      products.filter((p) => p.exists()).map((p) => [p.id, String(p.data()?.name ?? '')]),
    )

    return variants.map((v) => ({
      productId: v.productId,
      productName: nameById.get(v.productId) ?? '',
      size: v.size,
      stock: v.stock,
      minStock: v.minStock,
    }))
  },

  /** Códigos de ejemplo para la pantalla de escaneo (atajo sin cámara). */
  async listSampleBarcodes(count = 6): Promise<VariantWithProduct[]> {
    if (DEMO) return demoBackend.listSampleBarcodes(count)
    const productsSnap = await getDocs(
      query(productsRef(), where('active', '==', true), orderBy('name'), limit(count)),
    )
    const results = await Promise.all(
      productsSnap.docs.map(async (productDoc) => {
        const product = productFromDoc(productDoc)
        const variantsSnap = await getDocs(
          query(variantsRef(product.id), where('stock', '>', 0), limit(1)),
        )
        const first = variantsSnap.docs[0]
        return first ? { product, variant: variantFromDoc(first) } : null
      }),
    )
    return results.filter((r): r is VariantWithProduct => r !== null)
  },

  /**
   * Crea una referencia con todas sus tallas y sus códigos de barras.
   *
   * Todo en UNA transacción: si dos códigos chocan, no queda una referencia
   * a medias con la mitad de las etiquetas registradas.
   */
  async createProduct(input: NewProductInput): Promise<ProductId> {
    if (DEMO) return demoBackend.createProduct(input)
    const newProductRef = doc(productsRef())
    const productId = newProductRef.id as ProductId
    const now = new Date()

    await runTransaction(db, async (tx) => {
      // Todas las lecturas van antes que las escrituras: Firestore lo exige.
      const barcodes = input.sizes.map((size) => ({
        size,
        code: buildBarcode(input.sku, size),
      }))
      const existing = await Promise.all(barcodes.map((b) => tx.get(barcodeRef(b.code))))
      const collision = existing.findIndex((snap) => snap.exists())
      if (collision >= 0) {
        throw new DomainError('DUPLICATE_BARCODE', 'Código duplicado', {
          barcode: barcodes[collision]?.code,
        })
      }

      tx.set(
        newProductRef,
        productToDoc({
          sku: input.sku.toUpperCase(),
          brand: input.brand,
          name: input.name,
          price: input.price,
          cost: input.cost,
          minStock: input.minStock,
          active: true,
          createdAt: now,
          updatedAt: now,
        }),
      )

      for (const { size, code } of barcodes) {
        tx.set(
          variantRef(productId, size),
          variantToDoc({
            productId,
            size,
            barcode: code,
            stock: 0,
            stockByLocation: {},
            minStock: input.minStock,
            active: true,
          }),
        )
        tx.set(barcodeRef(code), {
          productId,
          variantId: makeVariantId(productId, size),
          size,
          createdAt: Timestamp.fromDate(now),
        })
      }
    })

    return productId
  },

  /**
   * Quita una TALLA de una referencia (por ejemplo, una que no se maneja y quedó
   * creada por error). Solo se permite si esa talla está en CERO en todo el
   * sistema: borrar una talla con stock descuadraría el inventario. Se borra la
   * variante y su código de barras en una transacción.
   */
  async removeVariant(productId: ProductId, size: Size): Promise<void> {
    if (DEMO) return demoBackend.removeVariant(productId, size)
    await runTransaction(db, async (tx) => {
      const vRef = variantRef(productId, size)
      const snap = await tx.get(vRef)
      if (!snap.exists()) return
      const data = snap.data()
      if (Number(data.stock ?? 0) !== 0) {
        throw new DomainError('HAS_STOCK', 'No se puede quitar una talla con stock. Primero sácala del inventario.')
      }
      tx.delete(vRef)
      const barcode = String(data.barcode ?? '')
      if (barcode) tx.delete(barcodeRef(barcode))
    })
  },
}
