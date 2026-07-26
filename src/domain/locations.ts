/**
 * Ubicaciones de inventario. Puras: sin React ni Firebase.
 *
 * El stock ya no es un pozo único: vive por UBICACIÓN. Una ubicación es o un
 * LOCAL (punto de venta: 163, 173) o una BODEGA (almacén). El stock de una
 * variante se guarda como un mapa `{ [claveDeUbicacion]: cantidad }`, y esta
 * clave se construye SIEMPRE con `locationKey` para que un id de local y uno de
 * bodega nunca se confundan aunque coincidan como cadena.
 */

export type LocationKind = 'store' | 'bodega'

export interface LocationRef {
  kind: LocationKind
  id: string
}

/** Clave estable para el mapa de stock: "s:163" (local) o "b:abc" (bodega). */
export const locationKey = (ref: LocationRef): string =>
  `${ref.kind === 'store' ? 's' : 'b'}:${ref.id}`

export const storeLocation = (storeId: string): LocationRef => ({ kind: 'store', id: storeId })
export const bodegaLocation = (bodegaId: string): LocationRef => ({ kind: 'bodega', id: bodegaId })

export const storeKey = (storeId: string): string => locationKey(storeLocation(storeId))
export const bodegaKey = (bodegaId: string): string => locationKey(bodegaLocation(bodegaId))

/** Deshace `locationKey`. `null` si la clave no tiene el formato esperado. */
export function parseLocationKey(key: string): LocationRef | null {
  const [prefix, ...rest] = key.split(':')
  const id = rest.join(':')
  if (!id) return null
  if (prefix === 's') return { kind: 'store', id }
  if (prefix === 'b') return { kind: 'bodega', id }
  return null
}

/** Cantidad en una ubicación de un mapa de stock (0 si no aparece). */
export const stockAt = (byLocation: Record<string, number> | undefined, key: string): number =>
  byLocation?.[key] ?? 0

/** Total del mapa: la suma de todas las ubicaciones. */
export const totalStock = (byLocation: Record<string, number> | undefined): number =>
  byLocation ? Object.values(byLocation).reduce((sum, n) => sum + n, 0) : 0
