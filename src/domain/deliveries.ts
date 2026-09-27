/**
 * Reparto de un RETORNO a bodega contra las ENTREGAS (salidas) de donde salió.
 *
 * El retorno se registra escaneando pares en el local: no dice de qué entrega
 * vino cada uno, solo de qué referencia y de qué encargado. Para que cada
 * entrega sepa cuánto le queda en el local sin recorrer todo el libro mayor,
 * el reparto se decide UNA vez, al registrar el retorno, y queda escrito en la
 * entrega (`returnedQty`) y en el retorno (`deliveryAllocations`).
 *
 * La MISMA función la usan la app (al registrar) y el script de relleno (para
 * los retornos viejos), así que las dos llegan al mismo resultado.
 */

import type { DeliveryAllocation } from './models'

export interface ReturnCandidate {
  /** Id de la salida. */
  id: string
  occurredAt: Date
  /** Pares entregados. */
  quantity: number
  /** Pares de esa entrega que ya volvieron a bodega. */
  returnedQty: number
  /** Pares cobrados desde esa entrega (ventas con `deliveryId`), netos de devoluciones. */
  soldQty: number
}

/**
 * Reparte `quantity` pares entre las entregas candidatas (mismo encargado,
 * misma referencia y talla, mismo local), de la más antigua a la más nueva:
 *   1. primero contra los pares que siguen SIN VENDER — lo que vuelve a bodega
 *      es mercancía que no se vendió, y la más vieja es la que más tiempo
 *      lleva en el local;
 *   2. si sobra (un par vendido por escáner no queda amarrado a su entrega,
 *      así que puede parecer vendido sin estarlo), contra lo que todavía no ha
 *      vuelto, aunque figure vendido.
 * Lo que no quepa en ninguna entrega (mercancía que llegó al local por otra vía)
 * queda sin repartir.
 */
export function allocateReturn(quantity: number, candidates: ReturnCandidate[]): DeliveryAllocation[] {
  const ordered = [...candidates].sort(
    (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || a.id.localeCompare(b.id),
  )
  const taken = new Map<string, number>()
  let left = quantity

  for (const c of ordered) {
    if (left <= 0) break
    const unsold = c.quantity - c.returnedQty - Math.max(0, c.soldQty)
    const take = Math.min(left, Math.max(0, unsold))
    if (take > 0) {
      taken.set(c.id, take)
      left -= take
    }
  }
  for (const c of ordered) {
    if (left <= 0) break
    const room = c.quantity - c.returnedQty - (taken.get(c.id) ?? 0)
    const take = Math.min(left, Math.max(0, room))
    if (take > 0) {
      taken.set(c.id, (taken.get(c.id) ?? 0) + take)
      left -= take
    }
  }

  return ordered
    .filter((c) => taken.has(c.id))
    .map((c) => ({ deliveryId: c.id, quantity: taken.get(c.id) ?? 0 }))
}
