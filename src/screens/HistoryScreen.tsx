/**
 * Historial de movimientos. Lee páginas del libro mayor (nunca la colección
 * entera) y filtra por tipo en el servidor. La búsqueda afina en memoria sobre
 * lo ya cargado. La utilidad solo se ve en modo admin, como el diseño.
 */

import { useMemo, useState } from 'react'
import { useMovements } from '@/app/hooks'
import { useSession } from '@/app/session'
import { movementRepository } from '@/data/repositories/movementRepository'
import { MOVEMENT_LABEL, signedQuantity } from '@/domain/rules'
import { MOVEMENT_TYPES, type Movement, type MovementType } from '@/domain/models'
import { formatMoney, formatShortDate, recentDayKeys } from '@/lib/format'
import { downloadCsv, toCsv } from '@/lib/csv'
import { RoleBadge } from './_shared'
import { SearchBox } from './InventoryScreen'
import { Icon } from '@/ui/Icon'

const TYPE_FILTERS: { label: string; value: MovementType | 'all' }[] = [
  { label: 'Todos', value: 'all' },
  // La "entrada" (compra) es ingresar mercancía al inventario: nombre más claro.
  ...MOVEMENT_TYPES.map((t) => ({ label: t === 'purchase' ? 'Ingresar al inventario' : MOVEMENT_LABEL[t], value: t })),
]

const TONE: Record<MovementType, string> = {
  sale: 'var(--iw-orange)',
  purchase: 'var(--iw-plum)',
  return: 'var(--color-danger)',
  salida: 'var(--iw-amber)',
  retorno: 'var(--color-success)',
}

export function HistoryScreen() {
  const { user, can } = useSession()
  const seeCosts = can('seeCosts')
  const [typeFilter, setTypeFilter] = useState<MovementType | 'all'>('all')
  const [search, setSearch] = useState('')
  const [exporting, setExporting] = useState(false)

  const { movements, loading, hasMore, loadMore } = useMovements(
    typeFilter === 'all' ? {} : { type: typeFilter },
  )

  const term = search.trim().toLowerCase()
  const rows = useMemo(
    () =>
      movements.filter(
        (m) =>
          !term ||
          m.snapshot.productName.toLowerCase().includes(term) ||
          m.snapshot.barcode.toLowerCase().includes(term) ||
          m.snapshot.sku.toLowerCase().includes(term),
      ),
    [movements, term],
  )

  const exportCsv = async () => {
    setExporting(true)
    try {
      // Exporta el último mes desde el servidor, no solo lo que está en pantalla.
      const keys = recentDayKeys(31)
      const all = await movementRepository.listForExport(keys[0]!, keys.at(-1)!)
      const headers = [
        'Fecha', 'Tipo', 'Referencia', 'Codigo', 'Talla', 'Cantidad', 'Local', 'Usuario',
        'Cliente', 'Telefono', 'Pago', 'Venta', 'Total', 'Utilidad',
      ]
      const data = all.map((m) => [
        formatShortDate(m.occurredAt),
        MOVEMENT_LABEL[m.type],
        m.snapshot.productName,
        m.snapshot.barcode,
        m.snapshot.size,
        m.quantity,
        m.storeId,
        m.userName,
        m.customerName ?? '',
        m.customerPhone ?? '',
        m.payment ?? '',
        // El id de venta permite reagrupar en Excel las líneas de un tiquete.
        m.saleId ?? m.id,
        m.total,
        seeCosts ? m.margin : '',
      ])
      downloadCsv('historial-movimientos.csv', toCsv(headers, data))
    } finally {
      setExporting(false)
    }
  }

  return (
    <div style={{ padding: '18px 20px 28px', display: 'flex', flexDirection: 'column', gap: 16 }} className="iw-fade">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, font: '700 24px var(--font-display)', flex: 1 }}>Historial</h1>
        {user ? <RoleBadge role={user.role} /> : null}
        <button
          onClick={exportCsv}
          disabled={exporting}
          className="iw-press"
          style={{
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            background: 'var(--iw-plum)',
            color: '#fff',
            border: 'none',
            borderRadius: 'var(--radius-pill)',
            padding: '9px 16px',
            font: '700 13px var(--font-display)',
            opacity: exporting ? 0.6 : 1,
          }}
        >
          <Icon name="download" size={16} strokeWidth={2.2} /> {exporting ? 'Exportando…' : 'Exportar'}
        </button>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 180 }}>
          <SearchBox value={search} onChange={setSearch} placeholder="Referencia o código…" />
        </div>
        {TYPE_FILTERS.map((f) => {
          const on = typeFilter === f.value
          return (
            <button
              key={f.value}
              onClick={() => setTypeFilter(f.value)}
              className="iw-press"
              style={{
                cursor: 'pointer',
                background: on ? 'var(--iw-plum)' : 'var(--surface-card)',
                color: on ? '#fff' : 'var(--text-secondary)',
                border: `1.5px solid ${on ? 'var(--iw-plum)' : 'var(--border-subtle)'}`,
                borderRadius: 'var(--radius-pill)',
                padding: '9px 15px',
                font: '700 13px var(--font-body)',
              }}
            >
              {f.label}
            </button>
          )
        })}
      </div>

      <div
        style={{
          background: 'var(--surface-card)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-sm)',
          overflowX: 'auto',
        }}
      >
        <div style={{ minWidth: 720 }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: gridCols(seeCosts),
              background: 'var(--iw-plum)',
              color: 'var(--iw-cream)',
              font: '700 11px var(--font-body)',
              padding: '11px 16px',
              letterSpacing: '.02em',
              gap: 6,
            }}
          >
            <span>Fecha</span>
            <span>Tipo</span>
            <span>Referencia</span>
            <span>Talla</span>
            <span>Cant.</span>
            <span>Local</span>
            <span>Usuario</span>
            <span style={{ textAlign: 'right' }}>Total</span>
            {seeCosts ? <span style={{ textAlign: 'right' }}>Utilidad</span> : null}
          </div>

          {loading && rows.length === 0 ? (
            <Empty text="Cargando movimientos…" />
          ) : rows.length === 0 ? (
            <Empty text="No hay movimientos que coincidan." />
          ) : (
            rows.map((m) => <HistoryRow key={m.id} movement={m} admin={seeCosts} />)
          )}
        </div>
      </div>

      {hasMore ? (
        <button
          onClick={loadMore}
          disabled={loading}
          className="iw-press"
          style={{
            alignSelf: 'center',
            cursor: 'pointer',
            background: 'var(--surface-card)',
            border: '1.5px solid var(--border-subtle)',
            borderRadius: 'var(--radius-pill)',
            padding: '10px 22px',
            font: '700 13px var(--font-body)',
            color: 'var(--text-secondary)',
          }}
        >
          {loading ? 'Cargando…' : 'Cargar más'}
        </button>
      ) : null}
    </div>
  )
}

function HistoryRow({ movement: m, admin }: { movement: Movement; admin: boolean }) {
  const qtyColor = m.type === 'sale' ? 'var(--color-danger)' : 'var(--color-success)'
  return (
    <div
      className="iw-row"
      style={{
        display: 'grid',
        gridTemplateColumns: gridCols(admin),
        alignItems: 'center',
        padding: '11px 16px',
        borderBottom: '1px solid var(--border-subtle)',
        fontSize: 13,
        gap: 6,
      }}
    >
      <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{formatShortDate(m.occurredAt)}</span>
      <span
        style={{
          background: TONE[m.type],
          color: '#fff',
          font: '700 10px var(--font-body)',
          padding: '3px 8px',
          borderRadius: 'var(--radius-pill)',
          textAlign: 'center',
          justifySelf: 'start',
        }}
      >
        {MOVEMENT_LABEL[m.type]}
      </span>
      <span style={{ minWidth: 0 }}>
        <span
          style={{
            display: 'block',
            fontWeight: 600,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {m.snapshot.productName}
        </span>
        {m.customerName || m.payment ? (
          <span
            style={{
              display: 'block',
              fontSize: 11,
              color: 'var(--text-muted)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {[m.customerName, m.payment].filter(Boolean).join(' · ')}
          </span>
        ) : null}
      </span>
      <span>{m.snapshot.size}</span>
      <span style={{ fontWeight: 700, color: qtyColor }}>{signedQuantity(m)}</span>
      <span style={{ color: 'var(--text-muted)' }}>{m.storeId}</span>
      <span style={{ color: 'var(--text-muted)', fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.userName}</span>
      <span style={{ textAlign: 'right', fontWeight: 700 }}>{formatMoney(m.total)}</span>
      {admin ? (
        <span style={{ textAlign: 'right', color: m.margin >= 0 ? 'var(--color-success)' : 'var(--color-danger)', fontWeight: 700 }}>
          {formatMoney(m.margin)}
        </span>
      ) : null}
    </div>
  )
}

const gridCols = (admin: boolean) =>
  admin
    ? '92px 80px 1.4fr 46px 50px 56px 96px 88px 92px'
    : '92px 80px 1.4fr 46px 50px 56px 96px 88px'

function Empty({ text }: { text: string }) {
  return <div style={{ padding: 28, textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 }}>{text}</div>
}
