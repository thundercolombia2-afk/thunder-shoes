/**
 * Hooks que conectan React con la capa de datos. Cada uno envuelve un
 * repositorio y expone estado de carga/error. Los componentes nunca llaman
 * a Firestore directamente.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { storeRepository } from '@/data/repositories/storeRepository'
import { catalogRepository, type ProductRow } from '@/data/repositories/catalogRepository'
import { movementRepository } from '@/data/repositories/movementRepository'
import { bodegaRepository } from '@/data/repositories/bodegaRepository'
import type { Bodega, Movement, MovementType, ProductId, Store, StoreId, Variant } from '@/domain/models'
import type { DocumentData, QueryDocumentSnapshot } from 'firebase/firestore'

interface AsyncState<T> {
  data: T
  loading: boolean
  error: unknown
}

/** Locales activos (para la pantalla de selección). */
export function useStores(): AsyncState<Store[]> {
  const [state, setState] = useState<AsyncState<Store[]>>({ data: [], loading: true, error: null })

  useEffect(() => {
    let alive = true
    storeRepository
      .listActive()
      .then((data) => alive && setState({ data, loading: false, error: null }))
      .catch((error) => alive && setState({ data: [], loading: false, error }))
    return () => {
      alive = false
    }
  }, [])

  return state
}

/** Bodegas en vivo. Varias pantallas necesitan traducir "b:abc" a "Bodega 1". */
export function useBodegas(): Bodega[] {
  const [bodegas, setBodegas] = useState<Bodega[]>([])
  useEffect(() => bodegaRepository.subscribe(setBodegas), [])
  return bodegas
}

/**
 * LISTA del catálogo en vivo: una fila por referencia con su resumen de stock,
 * SIN las tallas. Se refresca cuando Firestore emite cambios: si otro local
 * vende, esta pantalla lo refleja.
 *
 * Para las tallas de una referencia concreta está `useProductVariants`, y para
 * las tallas con stock de todo el catálogo `useVariantsWithStock`.
 */
export function useCatalog(): AsyncState<ProductRow[]> {
  const [state, setState] = useState<AsyncState<ProductRow[]>>({
    data: [],
    loading: true,
    error: null,
  })

  useEffect(() => {
    const unsubscribe = catalogRepository.subscribeToCatalog(
      (catalog) => setState({ data: catalog, loading: false, error: null }),
      // Sin esto, un error de permisos o de índice dejaba el inventario colgado
      // en "Cargando…" para siempre. Ahora corta la carga y expone el error.
      (error) => setState((s) => ({ ...s, loading: false, error })),
    )
    return unsubscribe
  }, [])

  return state
}

/**
 * Tallas de UNA referencia, en vivo (~9 documentos). `null` no se suscribe a
 * nada: así el detalle solo paga cuando está abierto.
 *
 * `loading` arranca en true y solo baja cuando llega la primera emisión. Quien
 * pinte tallas tiene que esperarlo: una lista vacía todavía cargando se ve
 * igual que una referencia sin tallas, y no son lo mismo.
 */
export function useProductVariants(productId: ProductId | null): {
  variants: Variant[]
  loading: boolean
  error: unknown
} {
  const [state, setState] = useState<{ variants: Variant[]; loading: boolean; error: unknown }>({
    variants: [],
    loading: productId !== null,
    error: null,
  })

  useEffect(() => {
    if (productId === null) {
      setState({ variants: [], loading: false, error: null })
      return
    }
    setState({ variants: [], loading: true, error: null })
    return catalogRepository.subscribeToProductVariants(
      productId,
      (variants) => setState({ variants, loading: false, error: null }),
      (error) => setState({ variants: [], loading: false, error }),
    )
  }, [productId])

  return state
}

/**
 * Tallas CON STOCK de todo el catálogo, en vivo. Solo para las pantallas que
 * preguntan "qué hay en mi local" atravesando el catálogo; es más caro que la
 * lista, así que no se usa en las pantallas de entrada.
 */
export function useVariantsWithStock(): { variants: Variant[]; loading: boolean } {
  const [state, setState] = useState<{ variants: Variant[]; loading: boolean }>({
    variants: [],
    loading: true,
  })

  useEffect(
    () =>
      catalogRepository.subscribeToVariantsWithStock(
        (variants) => setState({ variants, loading: false }),
        () => setState({ variants: [], loading: false }),
      ),
    [],
  )

  return state
}

interface MovementsFilter {
  type?: MovementType
  storeId?: StoreId
}

/** Historial paginado con "cargar más". */
export function useMovements(filter: MovementsFilter = {}) {
  const [movements, setMovements] = useState<Movement[]>([])
  const [loading, setLoading] = useState(true)
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const cursor = useRef<QueryDocumentSnapshot<DocumentData> | undefined>(undefined)

  const load = useCallback(
    async (reset: boolean) => {
      setLoading(true)
      try {
        const page = await movementRepository.listPage({
          ...(filter.type ? { type: filter.type } : {}),
          ...(filter.storeId ? { storeId: filter.storeId } : {}),
          ...(reset ? {} : { cursor: cursor.current }),
        })
        cursor.current = page.cursor
        setHasMore(page.hasMore)
        setMovements((prev) => (reset ? page.movements : [...prev, ...page.movements]))
        setError(null)
      } catch (e) {
        setError(e)
      } finally {
        setLoading(false)
      }
    },
    [filter.type, filter.storeId],
  )

  // Recarga desde cero cuando cambian los filtros.
  useEffect(() => {
    cursor.current = undefined
    void load(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter.type, filter.storeId])

  const loadMore = useCallback(() => {
    if (!loading && hasMore) void load(false)
  }, [load, loading, hasMore])

  return { movements, loading, hasMore, error, loadMore }
}
