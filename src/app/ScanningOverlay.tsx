/** Overlay de "Escaneando…". Reproduce el visor con marco y línea del diseño. */

import { useScanOverlay } from './scanFlow'

export function ScanningOverlay() {
  const { scanning } = useScanOverlay()
  if (!scanning) return null

  const corner = (extra: React.CSSProperties): React.CSSProperties => ({
    position: 'absolute',
    width: 22,
    height: 22,
    ...extra,
  })

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 60,
        background: 'rgba(10,10,11,.72)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20 }}>
        <div
          style={{
            position: 'relative',
            width: 220,
            height: 150,
            borderRadius: 'var(--radius-lg)',
            background: 'rgba(255,255,255,.06)',
            border: '2px solid rgba(255,255,255,.15)',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              position: 'absolute',
              left: '8%',
              right: '8%',
              height: 3,
              background: 'var(--iw-yellow)',
              boxShadow: '0 0 14px var(--iw-yellow)',
              borderRadius: 2,
              animation: 'iwscanbox 1.5s var(--ease-out) infinite',
            }}
          />
          <div style={corner({ left: 14, top: 14, borderTop: '3px solid var(--iw-yellow)', borderLeft: '3px solid var(--iw-yellow)', borderRadius: '4px 0 0 0' })} />
          <div style={corner({ right: 14, top: 14, borderTop: '3px solid var(--iw-yellow)', borderRight: '3px solid var(--iw-yellow)' })} />
          <div style={corner({ left: 14, bottom: 14, borderBottom: '3px solid var(--iw-yellow)', borderLeft: '3px solid var(--iw-yellow)' })} />
          <div style={corner({ right: 14, bottom: 14, borderBottom: '3px solid var(--iw-yellow)', borderRight: '3px solid var(--iw-yellow)' })} />
        </div>
        <span style={{ color: 'var(--iw-cream)', font: '700 16px var(--font-display)' }}>Escaneando…</span>
      </div>
    </div>
  )
}
