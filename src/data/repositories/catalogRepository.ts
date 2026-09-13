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
  updateDoc,
  where,
  writeBatch,
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

/** Una referencia con todas sus tallas. Para el DETALLE de una referencia. */
export interface ProductWithVariants {
  product: Product
  variants: Variant[]
  totalStock: number
}

/**
 * Una referencia con su RESUMEN de stock, sin las tallas. Es como se pinta la
 * LISTA: traer las ~1.750 variantes del catálogo costaba otras tantas lecturas
 * por carga en frío, y la lista solo necesita totales.
 *
 * Los dos campos salen de la proyección que mantiene `recordMany`
 * (`Product.stock` / `Product.stockByLocation`), no de sumar tallas.
 */
export interface ProductRow {
  product: Product
  /** Stock total del sistema, todas las tallas sumadas. */
  totalStock: number
  /** Stock por ubicación, todas las tallas sumadas. */
  stockByLocation: Record<string, number>
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

/** Campos editables de una referencia (el SKU no se toca). */
export interface EditProductInput {
  brand: string
  name: string
  price: Money
  cost: Money
  minStock: number
}

export const catalogRepository = {
  /**
   * Suscripción en vivo a la LISTA del catálogo. El POS necesita que si el local
   * 163 vende el último par, la pantalla del 173 lo refleje sin recargar.
   *
   * Solo trae los documentos de PRODUCTO (194), no las tallas (~1.750): los
   * totales salen del resumen que mantiene `recordMany` en el propio producto.
   * Quien necesite las tallas de una referencia usa `subscribeToProductVariants`;
   * quien necesite las tallas con stock de todo el catálogo,
   * `subscribeToVariantsWithStock`.
   */
  subscribeToCatalog(
    onChange: (catalog: ProductRow[]) => void,
    onError?: (error: unknown) => void,
  ): Unsubscribe {
    if (DEMO) return demoBackend.subscribeCatalog(onChange)
    // Se filtra por `active` y se ORDENA en memoria a propósito: `where + orderBy`
    // sobre campos distintos exige un índice compuesto, y si no está desplegado la
    // suscripción falla en silencio y el inventario se queda "Cargando…". Con un
    // solo `where` no hace falta índice y funciona incluso desde el caché offline.
    return onSnapshot(
      query(productsRef(), where('active', '==', true)),
      (snap) => {
        onChange(
          snap.docs
            .map(productFromDoc)
            .sort((a, b) => a.name.localeCompare(b.name))
            // `?? 0` solo aplica a una referencia sin rellenar. El relleno
            // (`npm run backfill:stock`) corre antes de desplegar justamente para
            // que esa rama no se dé: si se diera, la fila mostraría 0 pares.
            .map((product) => ({
              product,
              totalStock: product.stock ?? 0,
              stockByLocation: product.stockByLocation ?? {},
            })),
        )
      },
      // Sin esto, un error de permisos o de índice dejaba el inventario colgado
      // en "Cargando…" para siempre.
      (error) => onError?.(error),
    )
  },

  /**
   * Tallas de UNA referencia, en vivo. Son ~9 documentos: es la consulta que
   * paga el detalle de una referencia en vez de tener el catálogo entero en
   * memoria. Trae también las tallas AGOTADAS, que es justo lo que el detalle
   * necesita para poder reponerlas y para mostrar su código impreso.
   */
  subscribeToProductVariants(
    productId: ProductId,
    onChange: (variants: Variant[]) => void,
    onError?: (error: unknown) => void,
  ): Unsubscribe {
    if (DEMO) return demoBackend.subscribeProductVariants(productId, onChange)
    return onSnapshot(
      variantsRef(productId),
      (snap) => onChange(snap.docs.map(variantFromDoc).sort((a, b) => a.size - b.size)),
      (error) => onError?.(error),
    )
  },

  /**
   * Tallas CON STOCK de todo el catálogo, en vivo. La usan las pantallas que
   * preguntan "qué hay en mi local" atravesando el catálogo (el stock del local
   * y el par de cambio): una talla con stock en una ubicación tiene por
   * definición `stock > 0`, así que el filtro no les esconde nada.
   *
   * Se filtra por `stock` y NO por `stockByLocation.<clave>`: lo segundo exige un
   * índice COLLECTION_GROUP_ASC por CADA ubicación, así que cada bodega nueva
   * pediría un índice nuevo. Por `stock` funciona con el índice automático, igual
   * que `listLowStock`.
   */
  subscribeToVariantsWithStock(
    onChange: (variants: Variant[]) => void,
    onError?: (error: unknown) => void,
  ): Unsubscribe {
    if (DEMO) return demoBackend.subscribeVariantsWithStock(onChange)
    return onSnapshot(
      query(allVariantsRef(), where('stock', '>', 0)),
      (snap) => onChange(snap.docs.map(variantFromDoc)),
      (error) => onError?.(error),
    )
  },

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

  /**
   * Edita los datos de una referencia (nombre, marca, precio, costo, mínimo).
   * El SKU no se edita: es la base de los códigos de barras ya impresos.
   */
  async updateProduct(id: ProductId, fields: EditProductInput): Promise<void> {
    if (DEMO) return demoBackend.updateProduct(id, fields)
    await updateDoc(productRef(id), {
      name: fields.name,
      brand: fields.brand,
      price: fields.price,
      cost: fields.cost,
      minStock: fields.minStock,
      updatedAt: Timestamp.now(),
    })
  },

  /**
   * Elimina una referencia completa (producto + todas sus tallas + sus códigos).
   * Solo si TODAS las tallas están en cero: borrar con stock descuadraría el
   * inventario. Se leen las tallas y se borra todo en un lote.
   */
  async deleteProduct(id: ProductId): Promise<void> {
    if (DEMO) return demoBackend.deleteProduct(id)
    const variantsSnap = await getDocs(variantsRef(id))
    const variants = variantsSnap.docs.map(variantFromDoc)
    if (variants.some((v) => v.stock !== 0)) {
      throw new DomainError('HAS_STOCK', 'No se puede eliminar una referencia con stock. Primero sácala del inventario.')
    }
    const batch = writeBatch(db)
    for (const v of variants) {
      batch.delete(variantRef(id, v.size))
      if (v.barcode) batch.delete(barcodeRef(v.barcode))
    }
    batch.delete(productRef(id))
    await batch.commit()
  },
}
