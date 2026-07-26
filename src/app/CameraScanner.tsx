/**
 * Escaneo con la cámara del dispositivo.
 *
 * Usa `BarcodeDetector`, el detector de códigos que trae el propio navegador.
 * Ventaja: cero librerías, cero peso extra en el bundle y decodificación
 * nativa (rápida y sin gastar batería de más).
 *
 * Limitación honesta: hoy lo traen Chrome/Edge en Android y en escritorio.
 * Safari de iPhone NO lo trae, así que ahí este botón avisa y hay que usar el
 * lector USB o escribir el código a mano. Por eso el campo de texto sigue
 * siendo el camino principal y esto es un extra.
 */

import { useEffect, useRef, useState } from 'react'
import { Icon } from '@/ui/Icon'

/** Simetría mínima de la API del navegador; no está en los tipos de TS. */
interface DetectedBarcode {
  rawValue: string
}
interface BarcodeDetectorLike {
  detect: (source: CanvasImageSource) => Promise<DetectedBarcode[]>
}
type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => BarcodeDetectorLike

const getDetectorCtor = (): BarcodeDetectorCtor | null =>
  (globalThis as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector ?? null

export const cameraScanSupported = (): boolean =>
  getDetectorCtor() !== null && typeof navigator !== 'undefined' && !!navigator.mediaDevices

/** Formatos de etiqueta de producto que tiene sentido buscar en una zapatería. */
const FORMATS = ['code_128', 'code_39', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'qr_code', 'itf']

export function CameraScanner({ onDetected, onClose }: { onDetected: (code: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const Ctor = getDetectorCtor()
    if (!Ctor) {
      setError('Este navegador no puede usar la cámara para leer códigos. Usa el lector USB o escribe el código.')
      return
    }

    let stream: MediaStream | null = null
    let frame = 0
    let stopped = false
    const detector = new Ctor({ formats: FORMATS })

    const tick = async () => {
      const video = videoRef.current
      if (stopped || !video || video.readyState < 2) {
        frame = requestAnimationFrame(() => void tick())
        return
      }
      try {
        const found = await detector.detect(video)
        const code = found[0]?.rawValue?.trim()
        if (code) {
          stopped = true
          onDetected(code)
          return
        }
      } catch {
        // Un frame ilegible no es un error: se intenta con el siguiente.
      }
      frame = requestAnimationFrame(() => void tick())
    }

    navigator.mediaDevices
      // `environment` = cámara trasera: la que apunta al producto.
      .getUserMedia({ video: { facingMode: { ideal: 'environment' } } })
      .then((s) => {
        if (stopped) {
          s.getTracks().forEach((t) => t.stop())
          return
        }
        stream = s
        if (videoRef.current) {
          videoRef.current.srcObject = s
          void videoRef.current.play()
        }
        void tick()
      })
      .catch(() => {
        setError('No se pudo abrir la cámara. Revisa el permiso del navegador y que la página esté en HTTPS.')
      })

    return () => {
      stopped = true
      cancelAnimationFrame(frame)
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [onDetected])

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 80,
        background: 'rgba(10,10,11,.92)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
        padding: 20,
      }}
    >
      <div style={{ position: 'relative', width: '100%', maxWidth: 420, aspectRatio: '4 / 3', borderRadius: 'var(--radius-xl)', overflow: 'hidden', background: '#000' }}>
        <video ref={videoRef} muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        <div
          style={{
            position: 'absolute',
            inset: '22% 12%',
            border: '2.5px solid var(--iw-yellow)',
            borderRadius: 'var(--radius-lg)',
            boxShadow: '0 0 0 100vmax rgba(0,0,0,.35)',
          }}
        />
      </div>

      <p style={{ margin: 0, color: 'var(--iw-cream)', fontSize: 14, textAlign: 'center', maxWidth: 420 }}>
        {error || 'Apunta la cámara al código de barras de la etiqueta.'}
      </p>

      <button
        onClick={onClose}
        className="iw-press"
        style={{
          background: 'var(--iw-yellow)',
          color: '#0c0c0d',
          border: 'none',
          borderRadius: 'var(--radius-pill)',
          padding: '13px 26px',
          font: '700 15px var(--font-display)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <Icon name="return" size={17} /> Cerrar cámara
      </button>
    </div>
  )
}
