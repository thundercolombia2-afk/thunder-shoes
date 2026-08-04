/**
 * Hooks que conectan React con la capa de datos. Cada uno envuelve un
 * repositorio y expone estado de carga/error. Los componentes nunca llaman
 * a Firestore directamente.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { storeRepository } from '@/data/repositories/storeRepository'
import { catalogRepository, type ProductWithVariants } from '@/data/repositories/catalogRepository'
import { statsRepository } from '@/data/repositories/statsRepository'
import { movementRepository } from '@/data/repositories/movementRepository'
import { bodegaRepository } from '@/data/repositories/bodegaRepository'
import type { Bodega, DailyStats, Movement, MovementType, Store, StoreId } from '@/domain/models'
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
 * Catálogo en vivo. Se suscribe una sola vez y se refresca solo cuando
 * Firestore emite cambios: si otro local vende, esta pantalla lo refleja.
 */
export function useCatalog(): AsyncState<ProductWithVariants[]> {
  const [state, setState] = useState<AsyncState<ProductWithVariants[]>>({
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

/** Stats de los últimos `days` días para el dashboard. */
export function useStats(days = 7): AsyncState<DailyStats[]> & { reload: () => void } {
  const [state, setState] = useState<AsyncState<DailyStats[]>>({
    data: [],
    loading: true,
    error: null,
  })
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    let alive = true
    setState((s) => ({ ...s, loading: true }))
    statsRepository
      .listRecentDays(days)
      .then((data) => alive && setState({ data, loading: false, error: null }))
      .catch((error) => alive && setState({ data: [], loading: false, error }))
    return () => {
      alive = false
    }
  }, [days, nonce])

  const reload = useCallback(() => setNonce((n) => n + 1), [])
  return { ...state, reload }
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
