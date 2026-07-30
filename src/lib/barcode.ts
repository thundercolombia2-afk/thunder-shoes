/**
 * Generación de códigos de barras Code 128 REALES.
 *
 * Antes esta etiqueta dibujaba barras decorativas (un PRNG sembrado con el
 * texto): se veían como un código pero no codificaban nada, así que ningún
 * lector físico podía leerlas. Ahora se emite Code 128 de verdad, con su
 * dígito de control módulo 103 y sus zonas de silencio, para que cualquier
 * escáner (USB/Bluetooth HID, cámara, etc.) devuelva exactamente el texto.
 *
 * Se usa el juego B (ASCII 32–126) sin cambios de juego: los códigos de esta
 * app son cortos y alfanuméricos (`SKU-TALLA`), y un solo juego mantiene el
 * codificador simple y auditable. No se usa el juego C (dígitos en pares):
 * comprimiría códigos puramente numéricos, pero no es necesario aquí.
 */

/**
 * Los 107 símbolos de Code 128. Cada patrón son los anchos, en módulos, de
 * barra/espacio alternando y EMPEZANDO POR BARRA. Todos suman 11 módulos y
 * las barras suman siempre un número par (la "paridad par" del estándar).
 */
const PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312',
  '132212', '221213', '221312', '231212', '112232', '122132', '122231', '113222',
  '123122', '123221', '223211', '221132', '221231', '213212', '223112', '312131',
  '311222', '321122', '321221', '312212', '322112', '322211', '212123', '212321',
  '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121',
  '313121', '211331', '231131', '213113', '213311', '213131', '311123', '311321',
  '331121', '312113', '312311', '332111', '314111', '221411', '431111', '111224',
  '111422', '121124', '121421', '141122', '141221', '112214', '112412', '122114',
  '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112',
  '421211', '212141', '214121', '412121', '111143', '111341', '131141', '114113',
  '114311', '411113', '411311', '113141', '114131', '311141', '411131', '211412',
  '211214', '211232', '233111',
] as const

const START_B = 104
const STOP = 106
/** El símbolo de parada lleva una barra final extra de 2 módulos. */
const STOP_PATTERN = `${PATTERNS[STOP]}2`
/** Zona de silencio: el estándar exige ≥10 módulos en blanco a cada lado. */
const QUIET_MODULES = 10

/** Un rectángulo negro de la etiqueta, en MÓDULOS (no en píxeles). */
export interface BarcodeBar {
  x: number
  width: number
}

/** Dibujo completo: barras y ancho total, ambos en módulos. */
export interface BarcodeDrawing {
  bars: BarcodeBar[]
  /** Ancho total en módulos, zonas de silencio incluidas. */
  width: number
}

/**
 * Deja el texto en el rango imprimible del juego B (ASCII 32–126).
 * Los códigos de la app ya salen en mayúsculas y sin espacios, así que esto
 * solo protege de una tilde o un carácter raro pegado a mano: se descarta en
 * vez de emitir una etiqueta que codifique algo distinto a lo que se ve.
 */
function sanitize(text: string): string {
  return [...text].filter((ch) => ch.charCodeAt(0) >= 32 && ch.charCodeAt(0) <= 126).join('')
}

/**
 * Convierte el texto en la secuencia de símbolos Code 128 B:
 * arranque + datos + dígito de control + parada.
 *
 * El control es un módulo 103 PONDERADO POR POSICIÓN: el arranque pesa 1 y
 * cada dato pesa su posición (1, 2, 3…). Sin él el lector rechaza la etiqueta.
 */
function symbolsFor(text: string): number[] {
  const values = [...text].map((ch) => ch.charCodeAt(0) - 32)
  let checksum = START_B
  values.forEach((value, i) => {
    checksum += value * (i + 1)
  })
  return [START_B, ...values, checksum % 103, STOP]
}

/**
 * Barras de un código, en módulos. El primer elemento de cada patrón es una
 * BARRA y a partir de ahí se alterna barra/espacio; solo se emiten las barras.
 */
export function barcodeBars(code: string): BarcodeDrawing {
  const text = sanitize(code)
  if (!text) return { bars: [], width: QUIET_MODULES * 2 }

  const bars: BarcodeBar[] = []
  let x = QUIET_MODULES

  for (const symbol of symbolsFor(text)) {
    const pattern = symbol === STOP ? STOP_PATTERN : PATTERNS[symbol]
    // `pattern` siempre existe: los valores salen de charCode 32–126 (0–94),
    // del arranque (104) y de un módulo 103, todos dentro de la tabla.
    for (let i = 0; i < (pattern as string).length; i++) {
      const width = Number((pattern as string)[i])
      if (i % 2 === 0) bars.push({ x, width })
      x += width
    }
  }

  return { bars, width: x + QUIET_MODULES }
}

/**
 * El mismo código como cadena SVG, para la ventana de impresión.
 *
 * El `viewBox` se calcula sobre el ancho real en módulos, así que un código
 * largo produce módulos más finos en vez de barras cortadas. Las medidas van
 * en milímetros: una etiqueta impresa mide lo mismo en cualquier impresora.
 *
 * Cuidado con el ancho: por debajo de ~0,25 mm por módulo muchos lectores
 * baratos fallan. Con 46 mm útiles, un código de ~12 caracteres queda en el
 * límite; si hay que alargar los SKU, conviene subir el ancho de la etiqueta.
 */
export function barcodeSvgString(code: string, widthMm = 46, heightMm = 9): string {
  const { bars, width } = barcodeBars(code)
  const height = 64
  const rects = bars
    .map((b) => `<rect x="${b.x}" y="0" width="${b.width}" height="${height}" fill="#000"/>`)
    .join('')
  return (
    `<svg viewBox="0 0 ${width} ${height}" width="${widthMm}mm" height="${heightMm}mm" ` +
    'preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">' +
    `<rect width="${width}" height="${height}" fill="#fff"/>` +
    rects +
    '</svg>'
  )
}
