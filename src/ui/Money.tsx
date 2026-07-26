/**
 * Muestra un monto en pesos que NO se desborda: valor completo si cabe, y si es
 * muy grande lo reduce a millones ("$210,7 M") con un tooltip (title) que trae
 * el valor exacto y su escala. Ver `moneyDisplay` en lib/format.
 */

import { moneyDisplay } from '@/lib/format'
import type { Money as MoneyType } from '@/domain/models'

export function Money({ value, style }: { value: MoneyType | number; style?: React.CSSProperties }) {
  const { text, title } = moneyDisplay(value)
  return (
    <span title={title} style={{ whiteSpace: 'nowrap', ...style }}>
      {text}
    </span>
  )
}
