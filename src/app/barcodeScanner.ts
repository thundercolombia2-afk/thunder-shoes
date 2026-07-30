/**
 * Captura de lectores de código de barras tipo "keyboard wedge".
 *
 * Casi todo lector del mercado (USB con cable, dongle 2.4 GHz o Bluetooth HID,
 * incluido el América Store JP-S3) se presenta al sistema como un TECLADO: al
 * leer, teclea el código carácter por carácter y normalmente cierra con Enter.
 * No hay driver, ni SDK, ni permisos: para la app son pulsaciones de tecla.
 *
 * Lo que distingue a un lector de una persona es la VELOCIDAD: el lector teclea
 * en intervalos de 5–30 ms, una persona rara vez baja de 80 ms. Sobre esa
 * diferencia se construyen los dos hooks de este módulo:
 *
 *  · `useBarcodeScanner`  → escanear sin que haya ningún campo enfocado.
 *  · `useScannerFieldSubmit` → cerrar la lectura en un campo cuando el lector
 *    NO manda Enter (hay unidades que salen de fábrica sin sufijo).
 *
 * Ambos comparten el mismo antirrebote: nunca se emite dos veces el mismo
 * código dentro de la ventana de deduplicación (un lector con el gatillo
 * trabado repite la lectura varias veces por segundo).
 */

import { useEffect, useRef } from 'react'

/** Intervalo máximo entre teclas para considerar que teclea un lector. */
const MAX_KEY_INTERVAL_MS = 60
/** Silencio tras el que se da por terminada una lectura sin Enter. */
const END_TIMEOUT_MS = 90
/** Un código más corto que esto es basura o una tecla suelta. */
const MIN_LENGTH = 3
/**
 * El mismo código repetido dentro de esta ventana se ignora.
 *
 * Es un equilibrio: protege del gatillo trabado y del modo continuo (que
 * repiten la lectura varias veces por segundo), a costa de descartar un
 * segundo disparo LEGÍTIMO del mismo par hecho a menos de 0,7 s. Un lector de
 * mano no alcanza a re-disparar tan rápido; si en el mostrador se escanean dos
 * pares iguales seguidos y se pierde el segundo, bajar este número.
 */
const DEDUPE_MS = 700

/**
 * ¿El evento va dirigido a un campo de texto?
 *
 * Si el foco está en un input, el navegador ya hace lo correcto (el código se
 * escribe ahí y el Enter envía el formulario). El hook global NO se mete: si
 * lo hiciera, robaría también lo que la persona escribe a mano.
 */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  return target.isContentEditable
}

/** Deja solo caracteres imprimibles y descarta lo que no tenga nada legible. */
function clean(raw: string): string {
  const code = [...raw]
    .filter((ch) => ch.charCodeAt(0) >= 32 && ch.charCodeAt(0) <= 126)
    .join('')
    .trim()
  return /[A-Za-z0-9]/.test(code) ? code : ''
}

export interface BarcodeScannerOptions {
  /** Se llama con el código completo, ya limpio y sin repetidos. */
  onScan: (code: string) => void
  /** Permite apagarlo (por ejemplo mientras hay un modal de cámara abierto). */
  enabled?: boolean
  minLength?: number
  maxKeyIntervalMs?: number
  endTimeoutMs?: number
  dedupeMs?: number
}

/**
 * Escucha el lector en toda la página, SIN necesidad de que haya un campo
 * enfocado. Resuelve el caso real de mostrador: alguien pulsa un botón, el
 * foco se va del visor, y el siguiente disparo del lector se perdía.
 *
 * Solo actúa cuando el foco NO está en un campo de texto; ahí manda el campo.
 */
export function useBarcodeScanner({
  onScan,
  enabled = true,
  minLength = MIN_LENGTH,
  maxKeyIntervalMs = MAX_KEY_INTERVAL_MS,
  endTimeoutMs = END_TIMEOUT_MS,
  dedupeMs = DEDUPE_MS,
}: BarcodeScannerOptions): void {
  // La función se guarda en una ref para no resuscribir el listener en cada
  // render (la pantalla de venta re-renderiza en cada tecla del carrito).
  const onScanRef = useRef(onScan)
  onScanRef.current = onScan

  const buffer = useRef('')
  const lastKeyAt = useRef(0)
  const timer = useRef<number | null>(null)
  const lastEmit = useRef({ code: '', at: 0 })

  useEffect(() => {
    if (!enabled) return

    const cancelTimer = () => {
      if (timer.current !== null) {
        window.clearTimeout(timer.current)
        timer.current = null
      }
    }

    /** Cierra la lectura: valida, deduplica y entrega. */
    const flush = () => {
      cancelTimer()
      const code = clean(buffer.current)
      buffer.current = ''
      if (code.length < minLength) return
      const now = performance.now()
      // Antirrebote: el gatillo trabado o un lector en modo continuo repiten
      // la misma lectura muchas veces; una sola cuenta.
      if (code === lastEmit.current.code && now - lastEmit.current.at < dedupeMs) return
      lastEmit.current = { code, at: now }
      onScanRef.current(code)
    }

    const onKeyDown = (e: KeyboardEvent) => {
      // Atajos del sistema y escritura con IME: no son lecturas.
      if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return
      // Si hay un campo enfocado, el campo manda (ver `isEditableTarget`).
      if (isEditableTarget(e.target)) return

      const now = performance.now()
      const gap = now - lastKeyAt.current
      lastKeyAt.current = now

      // Fin de lectura explícito. Muchos lectores mandan Enter; algunos, Tab.
      if (e.key === 'Enter' || e.key === 'Tab') {
        if (buffer.current) {
          e.preventDefault()
          flush()
        }
        return
      }

      // Teclas no imprimibles (Shift, F5, flechas, Escape…) no forman parte del
      // código: se dejan pasar intactas para no romper la navegación ni los
      // modales, que cierran con Escape.
      if (e.key.length !== 1) return

      // Una pausa larga significa que empezó una lectura nueva: lo anterior era
      // ruido (una tecla suelta) y se descarta en vez de concatenarse.
      if (gap > maxKeyIntervalMs) buffer.current = ''
      buffer.current += e.key
      // Con el foco fuera de todo campo, el carácter no tiene a dónde ir; se
      // consume para que no active atajos del navegador.
      e.preventDefault()

      // Plan B para lectores sin sufijo Enter: si se hace el silencio, se
      // considera terminada la lectura.
      cancelTimer()
      timer.current = window.setTimeout(flush, endTimeoutMs)
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      cancelTimer()
      buffer.current = ''
    }
  }, [enabled, minLength, maxKeyIntervalMs, endTimeoutMs, dedupeMs])
}

export interface ScannerFieldSubmitOptions {
  /** Valor actual del campo controlado que recibe el escaneo. */
  value: string
  /** Se llama cuando el lector terminó de escribir en el campo. */
  onComplete: (code: string) => void
  enabled?: boolean
  minLength?: number
  maxKeyIntervalMs?: number
  endTimeoutMs?: number
  dedupeMs?: number
}

/**
 * Cierra la lectura dentro de un campo enfocado cuando el lector NO manda
 * Enter. Observa cómo CRECE el valor del campo: si los cambios llegan a ritmo
 * de máquina y luego se hace el silencio, entrega el código.
 *
 * No intercepta teclas: si la persona escribe a mano, los intervalos son
 * humanos, nunca se marca la ráfaga y el campo se comporta como siempre.
 */
export function useScannerFieldSubmit({
  value,
  onComplete,
  enabled = true,
  minLength = MIN_LENGTH,
  maxKeyIntervalMs = MAX_KEY_INTERVAL_MS,
  endTimeoutMs = END_TIMEOUT_MS,
  dedupeMs = DEDUPE_MS,
}: ScannerFieldSubmitOptions): void {
  const onCompleteRef = useRef(onComplete)
  onCompleteRef.current = onComplete

  const lastChangeAt = useRef(0)
  const fastChanges = useRef(0)
  const lastValue = useRef(value)
  const lastEmit = useRef({ code: '', at: 0 })

  useEffect(() => {
    if (!enabled) return

    const previous = lastValue.current
    lastValue.current = value
    const now = performance.now()
    const gap = now - lastChangeAt.current
    lastChangeAt.current = now

    // Solo cuenta como ráfaga si el campo CRECE de a poco y rápido: pegar con
    // Ctrl+V salta de golpe y no debe confundirse con un lector.
    const grewByOne = value.length === previous.length + 1 && value.startsWith(previous)
    fastChanges.current = grewByOne && gap <= maxKeyIntervalMs ? fastChanges.current + 1 : 0

    // Tres cambios seguidos a ritmo de máquina: es un lector, no una persona.
    if (fastChanges.current < 3 || value.length < minLength) return

    const id = window.setTimeout(() => {
      const code = clean(value)
      if (code.length < minLength) return
      const at = performance.now()
      if (code === lastEmit.current.code && at - lastEmit.current.at < dedupeMs) return
      lastEmit.current = { code, at }
      fastChanges.current = 0
      onCompleteRef.current(code)
    }, endTimeoutMs)

    return () => window.clearTimeout(id)
  }, [value, enabled, minLength, maxKeyIntervalMs, endTimeoutMs, dedupeMs])
}
