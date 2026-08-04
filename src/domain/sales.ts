/**
 * Reconstrucción de VENTAS a partir del libro mayor.
 *
 * El libro mayor guarda asientos por talla, no tiquetes: eso es lo correcto
 * para que el stock cuadre, pero una devolución se hace contra "la venta que le
 * hicimos a Juan el martes". Estas funciones puras vuelven a armar esa vista.
 *
 * Sin React, sin Firebase: solo movimientos entrando y ventas saliendo.
 */

import { money, type Money, type Movement, type Size, type VariantId } from './models'

/** Una línea del tiquete: cuánto se vendió y cuánto ya volvió. */
export interface SaleLine {
  variantId: VariantId
  productName: string
  size: Size
  barcode: string
  unitPrice: Money
  sold: number
  returned: number
  /** Lo que todavía se puede devolver. Nunca negativo. */
  remaining: number
}

/** Una venta reconstruida a partir de sus asientos del libro mayor. */
export interface Sale {
  saleId: string
  occurredAt: Date
  customerName: string
  customerPhone: string
  payment: string
  storeId: string
  userName: string
  total: Money
  lines: SaleLine[]
}

/** Minúsculas y sin tildes: "Ávila" y "avila" deben encontrarse igual. */
export const normalize = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')

/** Coincide por nombre (subcadena) o por celular (comparando solo dígitos). */
export function matchesCustomer(m: Movement, needle: string): boolean {
  if (m.customerName && normalize(m.customerName).includes(needle)) return true
  const digits = needle.replace(/\D/g, '')
  if (!digits || !m.customerPhone) return false
  return m.customerPhone.replace(/\D/g, '').includes(digits)
}

/**
 * ¿Este movimiento coincide con lo que la persona escribió en el buscador?
 *
 * Busca por lo que uno recuerda: el zapato (nombre, SKU o código), el cliente,
 * quién lo registró, a quién se le entregó, o la forma de pago. Normaliza
 * tildes en los dos lados — sin eso, buscar "Interrapidisimo" no encontraba
 * nada. Es la MISMA función en el historial y en la hoja de ingresos, para que
 * el mismo texto dé el mismo resultado en las dos pantallas.
 */
export function matchesMovement(m: Movement, term: string): boolean {
  return matchesFields(
    [
      m.snapshot.productName,
      m.snapshot.sku,
      m.snapshot.barcode,
      m.customerName ?? '',
      m.userName,
      m.targetUserName ?? '',
      m.payment ?? '',
    ],
    term,
  )
}

/** ¿Alguno de estos campos contiene lo buscado? Ignora tildes en ambos lados. */
export function matchesFields(fields: string[], term: string): boolean {
  const needle = normalize(term)
  if (!needle) return true
  return fields.some((field) => normalize(field).includes(needle))
}

/**
 * Agrupa asientos sueltos en ventas. Las ventas suman `sold`; las devoluciones
 * que cuelgan del mismo `saleId` suman `returned`, así la pantalla nunca deja
 * devolver dos veces el mismo par.
 */
export function groupSales(movements: Movement[]): Sale[] {
  const byId = new Map<string, Sale>()
  const linesById = new Map<string, Map<string, SaleLine>>()

  for (const m of movements) {
    // Solo ventas y devoluciones arman un tiquete; entradas y traslados no.
    if (m.type !== 'sale' && m.type !== 'return') continue
    const id = m.saleId ?? m.id

    let sale = byId.get(id)
    if (!sale) {
      sale = {
        saleId: id,
        occurredAt: m.occurredAt,
        customerName: m.customerName ?? '',
        customerPhone: m.customerPhone ?? '',
        payment: m.payment ?? '',
        storeId: String(m.storeId),
        userName: m.userName,
        total: money(0),
        lines: [],
      }
      byId.set(id, sale)
      linesById.set(id, new Map())
    }

    const lines = linesById.get(id)!
    const key = String(m.variantId)
    let line = lines.get(key)
    if (!line) {
      line = {
        variantId: m.variantId,
        productName: m.snapshot.productName,
        size: m.snapshot.size,
        barcode: m.snapshot.barcode,
        unitPrice: m.snapshot.unitPrice,
        sold: 0,
        returned: 0,
        remaining: 0,
      }
      lines.set(key, line)
    }

    if (m.type === 'sale') {
      line.sold += m.quantity
      sale.total = money(sale.total + m.total)
      // Los datos del cliente y la fecha los manda siempre la línea de venta.
      sale.occurredAt = m.occurredAt
      sale.userName = m.userName
      if (m.customerName) sale.customerName = m.customerName
      if (m.customerPhone) sale.customerPhone = m.customerPhone
      if (m.payment) sale.payment = m.payment
    } else {
      line.returned += m.quantity
    }
  }

  for (const [id, sale] of byId) {
    sale.lines = [...(linesById.get(id)?.values() ?? [])]
      .map((line) => ({ ...line, remaining: Math.max(0, line.sold - line.returned) }))
      .filter((line) => line.sold > 0)
      .sort((a, b) => a.productName.localeCompare(b.productName) || a.size - b.size)
  }

  return [...byId.values()].filter((sale) => sale.lines.length > 0)
}
