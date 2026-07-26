/**
 * Carrito de venta. Estado efímero en memoria: una venta dura segundos y si se
 * recarga la página se vuelve a escanear, igual que en una caja real.
 *
 * Guarda una FOTO del precio y del stock al momento de escanear (para pintar la
 * fila sin releer), pero el stock que manda es siempre el del servidor: la
 * transacción revalida al cobrar. Aquí solo se evita el error obvio de sumar
 * más pares de los que hay.
 */

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { addMoney, money, type Money, type Size, type VariantId, type VariantWithProduct } from '@/domain/models'

export interface CartLine {
  variantId: VariantId
  barcode: string
  name: string
  size: Size
  unitPrice: Money
  /** Stock conocido al escanear; sirve de tope local del selector. */
  stock: number
  quantity: number
}

interface CartValue {
  lines: CartLine[]
  /** Último código escaneado con éxito, para la tira "CÓDIGO ESCANEADO". */
  lastScanned: CartLine | null
  add: (found: VariantWithProduct) => void
  setQuantity: (variantId: VariantId, delta: number) => void
  /** Fija la cantidad EXACTA (para venta mayorista: escribir 100 sin pulsar 100 veces). */
  setQuantityTo: (variantId: VariantId, value: number) => void
  remove: (variantId: VariantId) => void
  clear: () => void
  items: number
  units: number
  total: Money
}

const CartContext = createContext<CartValue | null>(null)

export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([])
  const [lastScanned, setLastScanned] = useState<CartLine | null>(null)

  const add = useCallback(({ product, variant }: VariantWithProduct) => {
    const line: CartLine = {
      variantId: variant.id,
      barcode: variant.barcode,
      name: product.name,
      size: variant.size,
      unitPrice: product.price,
      stock: variant.stock,
      quantity: 1,
    }
    setLastScanned(line)
    setLines((prev) => {
      const i = prev.findIndex((l) => l.variantId === variant.id)
      if (i < 0) return [...prev, line]
      const current = prev[i]!
      // Refresca precio y stock con lo recién leído, sin perder la cantidad.
      const next = [...prev]
      next[i] = {
        ...current,
        unitPrice: product.price,
        stock: variant.stock,
        quantity: Math.min(current.quantity + 1, Math.max(1, variant.stock)),
      }
      return next
    })
  }, [])

  const setQuantity = useCallback((variantId: VariantId, delta: number) => {
    setLines((prev) => {
      const i = prev.findIndex((l) => l.variantId === variantId)
      if (i < 0) return prev
      const line = prev[i]!
      const quantity = line.quantity + delta
      if (quantity <= 0) return prev.filter((l) => l.variantId !== variantId)
      const next = [...prev]
      next[i] = { ...line, quantity: Math.min(quantity, Math.max(1, line.stock)) }
      return next
    })
  }, [])

  const setQuantityTo = useCallback((variantId: VariantId, value: number) => {
    setLines((prev) => {
      const i = prev.findIndex((l) => l.variantId === variantId)
      if (i < 0) return prev
      const line = prev[i]!
      // Nunca menos de 1 ni más que el stock conocido (tope local; el servidor
      // revalida al cobrar). Un valor vacío o inválido cae a 1.
      const capped = Math.min(Math.max(1, Math.floor(value || 1)), Math.max(1, line.stock))
      const next = [...prev]
      next[i] = { ...line, quantity: capped }
      return next
    })
  }, [])

  const remove = useCallback((variantId: VariantId) => {
    setLines((prev) => prev.filter((l) => l.variantId !== variantId))
  }, [])

  const clear = useCallback(() => {
    setLines([])
    setLastScanned(null)
  }, [])

  const value = useMemo<CartValue>(() => {
    const units = lines.reduce((sum, l) => sum + l.quantity, 0)
    const total = lines.reduce((sum, l) => addMoney(sum, money(l.unitPrice * l.quantity)), money(0))
    return { lines, lastScanned, add, setQuantity, setQuantityTo, remove, clear, items: lines.length, units, total }
  }, [lines, lastScanned, add, setQuantity, setQuantityTo, remove, clear])

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}

export function useCart(): CartValue {
  const ctx = useContext(CartContext)
  if (!ctx) throw new Error('useCart debe usarse dentro de <CartProvider>')
  return ctx
}
