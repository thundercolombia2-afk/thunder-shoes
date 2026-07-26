/**
 * Dibujo de la etiqueta de código de barras.
 *
 * Las barras son deterministas a partir del texto del código: el mismo código
 * siempre se ve igual, pero NO es un Code128 real. Sirve para que la etiqueta
 * impresa se vea como una etiqueta; el dato que vale es el texto de abajo, que
 * es lo que el lector USB escribe en el campo de escaneo.
 */

/** Rectángulos de la etiqueta, derivados del código con un PRNG sembrado. */
export function barcodeBars(code: string): { x: number; width: number }[] {
  let seed = 0
  for (const ch of code || 'x') seed = (seed * 31 + ch.charCodeAt(0)) >>> 0
  seed = seed || 1
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed / 0x7fffffff
  }

  const bars: { x: number; width: number }[] = []
  let x = 6
  while (x < 252) {
    const width = 1 + Math.round(rnd() * 3)
    if (rnd() > 0.42) bars.push({ x, width })
    x += width + 1 + (rnd() > 0.6 ? 1 : 0)
  }
  return bars
}

/** Misma etiqueta como cadena SVG, para la ventana de impresión. */
export function barcodeSvgString(code: string): string {
  const rects = barcodeBars(code)
    .map((b) => `<rect x="${b.x}" y="6" width="${b.width}" height="50" fill="#111"/>`)
    .join('')
  return (
    '<svg viewBox="0 0 260 64" width="240" height="58" xmlns="http://www.w3.org/2000/svg">' +
    '<rect width="260" height="64" fill="#fff"/>' +
    rects +
    '</svg>'
  )
}
