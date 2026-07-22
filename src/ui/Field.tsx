/**
 * Campo de formulario con etiqueta. Reemplaza el `Input` del sistema de
 * diseño. Controlado, para poder validar en el dominio antes de escribir.
 */

import type { InputHTMLAttributes } from 'react'

interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'style'> {
  label: string
  hint?: string
  error?: string | undefined
  prefix?: string
}

export function Field({ label, hint, error, prefix, ...input }: FieldProps) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
      <span style={{ font: '700 13px var(--font-body)', color: 'var(--text-secondary)' }}>{label}</span>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          background: 'var(--surface-card)',
          border: `1.5px solid ${error ? 'var(--color-danger)' : 'var(--border-subtle)'}`,
          borderRadius: 'var(--radius-md)',
          padding: '13px 15px',
        }}
      >
        {prefix ? (
          <span style={{ font: '700 16px var(--font-display)', color: 'var(--text-muted)' }}>{prefix}</span>
        ) : null}
        <input
          {...input}
          style={{
            flex: 1,
            minWidth: 0,
            width: '100%',
            border: 'none',
            outline: 'none',
            background: 'transparent',
            font: '600 15px var(--font-body)',
            color: 'var(--text-primary)',
          }}
        />
      </div>
      {error ? (
        <span style={{ fontSize: 12, color: 'var(--color-danger)', fontWeight: 700 }}>{error}</span>
      ) : hint ? (
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{hint}</span>
      ) : null}
    </label>
  )
}
