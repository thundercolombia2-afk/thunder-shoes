/**
 * Muestra un monto en pesos que NO se desborda: valor completo si cabe, y si es
 * ≥ 1 millón lo reduce a millones ("$210,7 M"). Cuando va compacto, el número
 * queda con subrayado punteado y, al pasar el mouse o tocarlo, muestra un
 * tooltip aclarando que "M = millones" con el valor exacto. El tooltip se pinta
 * con un portal para no recortarse dentro de tarjetas ni tablas.
 */

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { moneyDisplay } from '@/lib/format'
import type { Money as MoneyType } from '@/domain/models'

export function Money({ value, style }: { value: MoneyType | number; style?: React.CSSProperties }) {
  const { text, exact, compact } = moneyDisplay(value)
  const ref = useRef<HTMLSpanElement>(null)
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => {
    if (!tip) return
    const close = () => setTip(null)
    window.addEventListener('scroll', close, true)
    // Se difiere para no cerrarlo con el mismo toque que lo abrió.
    const t = window.setTimeout(() => window.addEventListener('click', close, { once: true }), 0)
    return () => {
      window.removeEventListener('scroll', close, true)
      window.clearTimeout(t)
    }
  }, [tip])

  if (!compact) {
    return <span style={{ whiteSpace: 'nowrap', ...style }}>{text}</span>
  }

  const show = () => {
    const r = ref.current?.getBoundingClientRect()
    if (r) setTip({ x: r.left, y: r.bottom + 6 })
  }
  const hide = () => setTip(null)

  return (
    <>
      <span
        ref={ref}
        onMouseEnter={show}
        onMouseLeave={hide}
        onClick={(e) => {
          e.stopPropagation()
          if (tip) hide()
          else show()
        }}
        title={`${exact} — "M" significa millones`}
        style={{ whiteSpace: 'nowrap', cursor: 'help', borderBottom: '1px dotted currentColor', ...style }}
      >
        {text}
      </span>
      {tip
        ? createPortal(
            <div
              style={{
                position: 'fixed',
                left: Math.min(tip.x, window.innerWidth - 220),
                top: tip.y,
                zIndex: 200,
                background: 'var(--surface-card)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 8,
                boxShadow: 'var(--shadow-lg)',
                padding: '8px 11px',
                font: '600 12px var(--font-body)',
                whiteSpace: 'nowrap',
                pointerEvents: 'none',
                maxWidth: '90vw',
              }}
            >
              <b>{text}</b> = {exact} · <span style={{ color: 'var(--text-muted)' }}>M = millones</span>
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
