/**
 * Iconos SVG del diseño, como un solo componente. Los trazos se copiaron tal
 * cual del prototipo para que la apariencia sea idéntica. Todos heredan el
 * color del texto (`stroke="currentColor"`) salvo el rayo de la marca.
 */

export type IconName =
  | 'bolt'
  | 'scan'
  | 'box'
  | 'list'
  | 'chart'
  | 'camera'
  | 'barcode'
  | 'check'
  | 'chevron-left'
  | 'chevron-down'
  | 'arrow-right'
  | 'arrow-up'
  | 'return'
  | 'lock'
  | 'unlock'
  | 'plus'
  | 'search'
  | 'download'
  | 'refresh'
  | 'edit'
  | 'trash'
  | 'menu'
  | 'shoe'
  | 'warning'
  | 'calendar'
  | 'store'
  | 'user'
  | 'settings'

interface IconProps {
  name: IconName
  size?: number
  /** Color del trazo. Por defecto hereda `currentColor`. */
  color?: string
  strokeWidth?: number
  className?: string
}

/** Iconos rellenos (usan `fill`, no `stroke`). */
const FILLED: Partial<Record<IconName, string>> = {
  bolt: 'M13 2 4 14h6l-1 8 9-12h-6z',
}

const PATHS: Record<IconName, string> = {
  bolt: 'M13 2 4 14h6l-1 8 9-12h-6z',
  scan: 'M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 12h10',
  box: 'M21 8l-9-5-9 5 9 5 9-5zM3 8v8l9 5 9-5V8',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  chart: 'M3 3v18h18M8 14v4M13 9v9M18 5v13',
  camera:
    'M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z',
  barcode: 'M3 5v14M7 5v14M11 5v14M15 5v14M19 5v14',
  check: 'M20 6L9 17l-5-5',
  'chevron-left': 'M15 18l-6-6 6-6',
  'chevron-down': 'M6 9l6 6 6-6',
  'arrow-right': 'M5 12h14M13 6l6 6-6 6',
  'arrow-up': 'M12 19V5M5 12l7-7 7 7',
  return: 'M9 14L4 9l5-5M4 9h11a5 5 0 0 1 5 5v3',
  lock: 'M8 10V7a4 4 0 0 1 8 0v3',
  unlock: 'M8 10V7a4 4 0 0 1 7-2.6',
  plus: 'M12 5v14M5 12h14',
  search: 'M21 21l-4-4',
  download: 'M12 3v12M7 10l5 5 5-5M5 21h14',
  refresh: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 4v4h4',
  edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  trash: 'M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1L5 6M10 11v6M14 11v6',
  menu: 'M3 6h18M3 12h18M3 18h18',
  shoe: 'M3 13l2-5h14l2 5v5a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1H7a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1zM5 8V6a2 2 0 0 1 2-2h4',
  warning: 'M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01',
  calendar: 'M3 5h18v16H3zM3 9h18M8 3v4M16 3v4',
  store: 'M3 21h18M6 21V8l6-4 6 4v13',
  user: 'M12 8m-4 0a4 4 0 1 0 8 0a4 4 0 1 0-8 0M4 21a8 8 0 0 1 16 0',
  settings:
    'M19.4 13a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
}

/**
 * El código de barras y la lupa necesitan sub-formas extra (círculo, etc.);
 * los resolvemos con markup específico donde el trazo simple no basta.
 */
export function Icon({ name, size = 20, color, strokeWidth = 2, className }: IconProps) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    className,
    'aria-hidden': true as const,
  }

  if (FILLED[name]) {
    return (
      <svg {...common} fill={color ?? 'currentColor'}>
        <path d={FILLED[name]} />
      </svg>
    )
  }

  const stroke = color ?? 'currentColor'

  if (name === 'search') {
    return (
      <svg {...common} fill="none" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="7" />
        <path d="M21 21l-4-4" />
      </svg>
    )
  }

  if (name === 'camera') {
    return (
      <svg {...common} fill="none" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
        <path d={PATHS.camera} />
        <circle cx="12" cy="13" r="3.5" />
      </svg>
    )
  }

  if (name === 'lock' || name === 'unlock') {
    return (
      <svg {...common} fill="none" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="10" width="16" height="10" rx="2" />
        <path d={PATHS[name]} />
      </svg>
    )
  }

  if (name === 'user') {
    return (
      <svg {...common} fill="none" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21a8 8 0 0 1 16 0" />
      </svg>
    )
  }

  if (name === 'settings') {
    return (
      <svg {...common} fill="none" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d={PATHS.settings} />
      </svg>
    )
  }

  return (
    <svg {...common} fill="none" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <path d={PATHS[name]} />
    </svg>
  )
}
