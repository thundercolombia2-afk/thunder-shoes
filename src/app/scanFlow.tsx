/**
 * Estado efímero del flujo de escaneo: qué se escaneó y qué se registró por
 * última vez. Vive en memoria (no en la URL) porque es un flujo de caja de
 * segundos; si se recarga la página, se vuelve a escanear, igual que en una
 * caja real.
 */

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import type { Movement, VariantWithProduct } from '@/domain/models'

interface ScanFlowValue {
  scanned: VariantWithProduct | null
  lastRecorded: Movement | null
  setScanned: (v: VariantWithProduct | null) => void
  setLastRecorded: (m: Movement | null) => void
}

const ScanFlowContext = createContext<ScanFlowValue | null>(null)

export function ScanFlowProvider({ children }: { children: ReactNode }) {
  const [scanned, setScanned] = useState<VariantWithProduct | null>(null)
  const [lastRecorded, setLastRecorded] = useState<Movement | null>(null)

  const value = useMemo<ScanFlowValue>(
    () => ({ scanned, lastRecorded, setScanned, setLastRecorded }),
    [scanned, lastRecorded],
  )

  return <ScanFlowContext.Provider value={value}>{children}</ScanFlowContext.Provider>
}

export function useScanFlow(): ScanFlowValue {
  const ctx = useContext(ScanFlowContext)
  if (!ctx) throw new Error('useScanFlow debe usarse dentro de <ScanFlowProvider>')
  return ctx
}

/** Overlay de "Escaneando…" controlado globalmente para taparlo todo. */
const ScanOverlayContext = createContext<{
  scanning: boolean
  setScanning: (v: boolean) => void
} | null>(null)

export function ScanOverlayProvider({ children }: { children: ReactNode }) {
  const [scanning, setScanning] = useState(false)
  const value = useMemo(() => ({ scanning, setScanning }), [scanning])
  return <ScanOverlayContext.Provider value={value}>{children}</ScanOverlayContext.Provider>
}

export function useScanOverlay() {
  const ctx = useContext(ScanOverlayContext)
  if (!ctx) throw new Error('useScanOverlay debe usarse dentro de <ScanOverlayProvider>')
  return ctx
}

/** Envuelve una función de escaneo con el overlay mientras resuelve. */
export function useScanWithOverlay() {
  const { setScanning } = useScanOverlay()
  return useCallback(
    async <T,>(resolve: () => Promise<T>, minMs = 650): Promise<T | null> => {
      setScanning(true)
      const started = Date.now()
      try {
        const result = await resolve()
        return result
      } finally {
        // Un mínimo de tiempo para que la animación no parpadee.
        const elapsed = Date.now() - started
        if (elapsed < minMs) await new Promise((r) => setTimeout(r, minMs - elapsed))
        setScanning(false)
      }
    },
    [setScanning],
  )
}
