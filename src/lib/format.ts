import type { Money } from '@/domain/models'

/** Zona horaria del negocio. Un `dayKey` siempre se calcula contra esta. */
export const BUSINESS_TIMEZONE = 'America/Bogota'

const currency = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0,
})

/** "$459.900" */
export const formatMoney = (value: Money | number): string => currency.format(Math.round(value))

/** Versión compacta para tarjetas del dashboard: "$4,2 M" */
export function formatMoneyCompact(value: Money | number): string {
  const n = Math.round(value)
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1).replace('.', ',')} M`
  if (Math.abs(n) >= 1_000) return `$${Math.round(n / 1_000)}k`
  return formatMoney(n)
}

const millionsFmt = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 1 })

/**
 * Cómo mostrar un monto SIN que se desborde: si es < 1 millón, el valor completo
 * ("$459.900"); si es mayor, se reduce a millones ("$210,7 M") con un `title`
 * que trae el valor exacto y su escala (millones / miles de millones) para el
 * tooltip. Así el número nunca queda diminuto y no se pierde el detalle.
 */
export function moneyDisplay(value: Money | number): { text: string; exact: string; compact: boolean } {
  const n = Math.round(value)
  const exact = formatMoney(n)
  if (Math.abs(n) >= 1_000_000) {
    return { text: `$${millionsFmt.format(n / 1_000_000)} M`, exact, compact: true }
  }
  return { text: exact, exact, compact: false }
}

const dayKeyFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/**
 * Clave de agrupación diaria, "2026-07-15", en horario de Colombia.
 * Se calcula con Intl y no con `toISOString()`: a las 7pm en Bogotá el UTC
 * ya es del día siguiente, y eso partiría las ventas de la tarde en dos días.
 */
export const toDayKey = (date: Date): string => dayKeyFormatter.format(date)

const shortDate = new Intl.DateTimeFormat('es-CO', {
  timeZone: BUSINESS_TIMEZONE,
  day: 'numeric',
  month: 'short',
})

/** "15 jul" */
export const formatShortDate = (date: Date): string => shortDate.format(date).replace('.', '')

const longDate = new Intl.DateTimeFormat('es-CO', {
  timeZone: BUSINESS_TIMEZONE,
  weekday: 'long',
  day: 'numeric',
  month: 'short',
})

/** "lunes 15 jul" */
export const formatLongDate = (date: Date): string => longDate.format(date).replace('.', '')

const timeFormatter = new Intl.DateTimeFormat('es-CO', {
  timeZone: BUSINESS_TIMEZONE,
  hour: '2-digit',
  minute: '2-digit',
})

export const formatTime = (date: Date): string => timeFormatter.format(date)

/** Días hacia atrás desde hoy, como dayKeys ordenados de más viejo a más nuevo. */
export function recentDayKeys(count: number, from: Date = new Date()): string[] {
  const keys: string[] = []
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(from)
    d.setDate(d.getDate() - i)
    keys.push(toDayKey(d))
  }
  return keys
}

const weekdayFormatter = new Intl.DateTimeFormat('es-CO', {
  timeZone: BUSINESS_TIMEZONE,
  weekday: 'short',
})

/** "lun", "mar"… a partir de un dayKey. */
export function weekdayFromDayKey(dayKey: string): string {
  const [y, m, d] = dayKey.split('-').map(Number)
  if (!y || !m || !d) return ''
  const label = weekdayFormatter.format(new Date(Date.UTC(y, m - 1, d, 12)))
  return label.charAt(0).toUpperCase() + label.slice(1, 3).replace('.', '')
}

/** Parsea lo que el usuario escribe en un campo de precio: "459.900" -> 459900 */
export const parseMoneyInput = (raw: string): number => Number(raw.replace(/\D/g, '')) || 0

/**
 * Agrupa en miles lo que se escribe en un campo de precio, en vivo:
 * "459900" -> "459.900". Cadena vacía si no hay dígitos (para no mostrar "0").
 * Guarda SIEMPRE los dígitos crudos en el estado y formatea solo al pintar.
 */
export const formatMoneyInput = (raw: string | number): string => {
  const digits = String(raw).replace(/\D/g, '')
  return digits ? new Intl.NumberFormat('es-CO').format(Number(digits)) : ''
}
