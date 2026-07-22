/**
 * Botón. Reemplaza el componente `Button` del sistema de diseño original,
 * respetando sus variantes (primary/outline/ghost) y tamaños.
 */

import type { ButtonHTMLAttributes, ReactNode } from 'react'

type Variant = 'primary' | 'outline' | 'ghost' | 'accent'
type Size = 'md' | 'lg'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  fullWidth?: boolean
  children: ReactNode
}

const BASE: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  border: '1.5px solid transparent',
  borderRadius: 'var(--radius-lg)',
  fontFamily: 'var(--font-display)',
  fontWeight: 600,
  cursor: 'pointer',
  transition: 'transform var(--dur-fast) var(--ease-out), background var(--dur-fast)',
  whiteSpace: 'nowrap',
}

const VARIANTS: Record<Variant, React.CSSProperties> = {
  primary: { background: 'var(--iw-plum)', color: '#fff' },
  accent: { background: 'var(--iw-yellow)', color: 'var(--iw-plum)', boxShadow: 'var(--shadow-accent)' },
  outline: { background: 'transparent', color: 'var(--iw-plum)', borderColor: 'var(--border-strong)' },
  ghost: { background: 'var(--surface-sunken)', color: 'var(--text-secondary)' },
}

const SIZES: Record<Size, React.CSSProperties> = {
  md: { padding: '11px 18px', fontSize: 14 },
  lg: { padding: '15px 22px', fontSize: 17 },
}

export function Button({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  style,
  disabled,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled}
      className="iw-press"
      style={{
        ...BASE,
        ...VARIANTS[variant],
        ...SIZES[size],
        ...(fullWidth ? { width: '100%' } : null),
        ...(disabled ? { opacity: 0.5, cursor: 'not-allowed' } : null),
        ...style,
      }}
    >
      {children}
    </button>
  )
}
