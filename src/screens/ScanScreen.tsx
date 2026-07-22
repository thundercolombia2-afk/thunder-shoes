/**
 * Pantalla de escaneo (home). En una caja real el lector de código de barras
 * USB se comporta como un teclado: escribe el código en el campo enfocado y
 * envía Enter. Por eso el "visor" es un input autoenfocado; también funciona
 * escribiendo a mano o tocando un código de ejemplo.
 */

import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSession } from '@/app/session'
import { useScanFlow, useScanWithOverlay } from '@/app/scanFlow'
import { catalogRepository } from '@/data/repositories/catalogRepository'
import { errorMessage } from '@/domain/rules'
import { Icon } from '@/ui/Icon'
import type { VariantWithProduct } from '@/domain/models'

export function ScanScreen() {
  const { store } = useSession()
  const { setScanned } = useScanFlow()
  const scanWithOverlay = useScanWithOverlay()
  const navigate = useNavigate()

  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [samples, setSamples] = useState<VariantWithProduct[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    catalogRepository
      .listSampleBarcodes(6)
      .then(setSamples)
      .catch(() => setSamples([]))
  }, [])

  const resolve = async (barcode: string) => {
    const trimmed = barcode.trim()
    if (!trimmed) return
    setError('')
    const found = await scanWithOverlay(() => catalogRepository.findByBarcode(trimmed)).catch((e) => {
      setError(errorMessage(e))
      return null
    })
    if (found) {
      setScanned(found)
      setCode('')
      navigate('/scan/result')
    } else {
      // Vuelve a enfocar para el siguiente intento del lector.
      inputRef.current?.focus()
    }
  }

  const pick = (v: VariantWithProduct) => resolve(v.variant.barcode)

  return (
    <div style={{ padding: '22px 20px 28px', display: 'flex', flexDirection: 'column', gap: 20 }} className="iw-fade">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span
          style={{
            font: '700 11px/1 var(--font-body)',
            letterSpacing: '.08em',
            textTransform: 'uppercase',
            color: 'var(--iw-orange)',
          }}
        >
          Local {store?.code}
        </span>
        <h1 style={{ margin: 0, font: '700 26px/1.1 var(--font-display)', color: 'var(--text-primary)' }}>
          Escanear producto
        </h1>
        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 14 }}>
          Escanea un código de barras para registrar una compra o venta.
        </p>
      </div>

      {/* Hero de escaneo */}
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void resolve(code)
        }}
        style={{
          position: 'relative',
          background: 'var(--iw-plum)',
          borderRadius: 'var(--radius-xl)',
          padding: '26px 22px',
          boxShadow: 'var(--shadow-md)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'radial-gradient(120% 90% at 80% 0%,rgba(255,209,0,.16),transparent 60%)',
          }}
        />
        <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              background: 'rgba(255,255,255,.12)',
              border: '1.5px solid rgba(255,255,255,.22)',
              borderRadius: 'var(--radius-md)',
              padding: '14px 16px',
            }}
          >
            <Icon name="barcode" size={22} color="var(--iw-yellow)" />
            <input
              ref={inputRef}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Esperando código…"
              autoComplete="off"
              spellCheck={false}
              style={{
                flex: 1,
                minWidth: 0,
                border: 'none',
                outline: 'none',
                background: 'transparent',
                color: 'var(--iw-cream)',
                fontSize: 15,
                fontFamily: 'ui-monospace,monospace',
                letterSpacing: '.05em',
              }}
            />
            <div
              style={{
                width: 9,
                height: 9,
                borderRadius: '50%',
                background: 'var(--iw-yellow)',
                boxShadow: '0 0 0 4px rgba(255,209,0,.35)',
                animation: 'iwscan 1.4s ease-in-out infinite',
              }}
            />
          </div>
          <button
            type="submit"
            className="iw-press"
            style={{
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
              background: 'var(--iw-yellow)',
              color: '#17171a',
              border: 'none',
              font: '600 17px var(--font-display)',
              padding: 16,
              borderRadius: 'var(--radius-pill)',
              boxShadow: 'var(--shadow-accent)',
            }}
          >
            <Icon name="camera" size={24} />
            Buscar código
          </button>
        </div>
      </form>

      {error ? (
        <div
          style={{
            background: 'rgba(224,52,29,.1)',
            border: '1px solid rgba(224,52,29,.3)',
            borderRadius: 'var(--radius-md)',
            padding: '11px 15px',
            color: 'var(--color-danger)',
            fontSize: 13,
            fontWeight: 700,
          }}
        >
          {error}
        </div>
      ) : null}

      {/* Códigos de ejemplo (del catálogo real) */}
      {samples.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span style={{ font: '700 12px var(--font-body)', color: 'var(--text-secondary)' }}>
            O toca un código de ejemplo
          </span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {samples.map((s) => (
              <button
                key={s.variant.id}
                onClick={() => pick(s)}
                style={{
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2,
                  background: 'var(--surface-card)',
                  border: '1.5px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-md)',
                  padding: '9px 13px',
                  textAlign: 'left',
                }}
              >
                <span style={{ font: '700 12px ui-monospace,monospace', color: 'var(--text-primary)' }}>
                  {s.variant.barcode}
                </span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {s.product.name.length > 18 ? s.product.name.slice(0, 17) + '…' : s.product.name}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
