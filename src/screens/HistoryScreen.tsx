/**
 * Historial de movimientos. Lee páginas del libro mayor (nunca la colección
 * entera) y filtra por tipo en el servidor. La búsqueda afina en memoria sobre
 * lo ya cargado. La utilidad solo se ve en modo admin, como el diseño.
 */

import { useEffect, useMemo, useState } from 'react'
import { useBodegas, useMovements, useStores } from '@/app/hooks'
import { useSession } from '@/app/session'
import { movementRepository } from '@/data/repositories/movementRepository'
import { configRepository } from '@/data/repositories/configRepository'
import {
  MOVEMENT_LABEL,
  errorMessage,
  SALE_STATUS_LABEL,
  saleStatusOf,
  saleValue,
  signedQuantity,
} from '@/domain/rules'
import { matchesMovement } from '@/domain/sales'
import { MOVEMENT_TYPES, type Movement, type MovementType } from '@/domain/models'
import { formatMoney, formatShortDate, recentDayKeys } from '@/lib/format'
import { downloadCsv, toCsv } from '@/lib/csv'
import { movementPlace, RoleBadge, SaleStatusChip, type MovementPlace } from './_shared'
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
  baja: 'var(--color-danger)',
}

export function HistoryScreen() {
  const { user, can } = useSession()
  const { data: stores } = useStores()
  const bodegas = useBodegas()
  const seeCosts = can('seeCosts')
  const canWipe = user?.owner === true // vaciar historial: solo la dueña
  // El bodeguero ve un historial acotado: solo SUS entregas (salidas) y recibos
  // (retornos), no las ventas del negocio.
  const isBodeguero = user?.role === 'bodeguero'
  const [typeFilter, setTypeFilter] = useState<MovementType | 'all'>(isBodeguero ? 'salida' : 'all')
  const [search, setSearch] = useState('')
  const [exporting, setExporting] = useState(false)
  const [wiping, setWiping] = useState(false)

  const filters: { label: string; value: MovementType | 'all' }[] = isBodeguero
    ? [
        { label: 'Entregado (salidas)', value: 'salida' },
        { label: 'Recibido (retornos)', value: 'retorno' },
      ]
    : TYPE_FILTERS

  const { movements, loading, hasMore, loadMore } = useMovements(
    typeFilter === 'all' ? {} : { type: typeFilter },
  )

  const rows = useMemo(
    () =>
      movements.filter(
        (m) =>
          // El bodeguero solo ve lo que ÉL mismo entregó o recibió.
          (!isBodeguero || m.userId === user?.id) && matchesMovement(m, search),
      ),
    [movements, search, isBodeguero, user?.id],
  )

  const exportCsv = async () => {
    setExporting(true)
    try {
      // Exporta el último mes desde el servidor, no solo lo que está en pantalla.
      const keys = recentDayKeys(31)
      const all = await movementRepository.listForExport(keys[0]!, keys.at(-1)!)
      const headers = [
        'Fecha', 'Tipo', 'Referencia', 'Codigo', 'Talla', 'Cantidad', 'Local', 'Bodega',
        'Usuario', 'Entregado a', 'Cliente', 'Telefono', 'Pago', 'Estado', 'Venta',
        'Valor venta', 'Valor costeado', 'Utilidad',
      ]
      const data = all.map((m) => {
        const place = movementPlace(m, stores, bodegas)
        return [
          formatShortDate(m.occurredAt),
          MOVEMENT_LABEL[m.type],
          m.snapshot.productName,
          m.snapshot.barcode,
          m.snapshot.size,
          m.quantity,
          place.store,
          place.bodega,
          m.userName,
          place.person,
          m.customerName ?? '',
          m.customerPhone ?? '',
          m.payment ?? '',
          m.type === 'sale' ? SALE_STATUS_LABEL[saleStatusOf(m)] : '',
          // El id de venta permite reagrupar en Excel las líneas de un tiquete.
          m.saleId ?? m.id,
          saleValue(m),
          // En pantalla el costo se oculta, pero el export de la dueña sí lo
          // necesita: es con lo que concilia las entradas contra las facturas
          // del proveedor. `total` es el valor al costo en entradas y traslados.
          seeCosts ? m.total : '',
          seeCosts ? m.margin : '',
        ]
      })
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
        {canWipe ? (
          <button
            onClick={() => setWiping(true)}
            title="Vaciar todo el historial"
            className="iw-press"
            style={{
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              background: 'var(--surface-card)',
              color: 'var(--color-danger)',
              border: '1.5px solid rgba(224,52,29,.4)',
              borderRadius: 'var(--radius-pill)',
              padding: '9px 16px',
              font: '700 13px var(--font-display)',
            }}
          >
            <Icon name="trash" size={16} strokeWidth={2.2} /> Vaciar
          </button>
        ) : null}
      </div>

      {wiping ? <WipeHistoryDialog onClose={() => setWiping(false)} /> : null}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 180 }}>
          <SearchBox value={search} onChange={setSearch} placeholder="Referencia o código…" />
        </div>
        {filters.map((f) => {
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
        <div style={{ minWidth: 900 }}>
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
            <span style={{ textAlign: 'right' }}>Valor venta</span>
            {seeCosts ? <span style={{ textAlign: 'right' }}>Utilidad</span> : null}
          </div>

          {loading && rows.length === 0 ? (
            <Empty text="Cargando movimientos…" />
          ) : rows.length === 0 ? (
            <Empty text="No hay movimientos que coincidan." />
          ) : (
            rows.map((m) => (
              <HistoryRow key={m.id} movement={m} admin={seeCosts} place={movementPlace(m, stores, bodegas)} />
            ))
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

function HistoryRow({
  movement: m,
  admin,
  place,
}: {
  movement: Movement
  admin: boolean
  place: MovementPlace
}) {
  const qtyColor = m.type === 'sale' ? 'var(--color-danger)' : 'var(--color-success)'
  const status = saleStatusOf(m)
  // En una salida el par VA hacia la persona; en un retorno VIENE de ella.
  const personPrefix = m.type === 'retorno' ? '←' : '→'
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
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            fontWeight: 600,
            overflowWrap: 'anywhere',
            lineHeight: 1.25,
          }}
          title={m.snapshot.productName}
        >
          {m.snapshot.productName}
        </span>
        {m.customerName || m.payment || m.bajaReason || m.returnReason ? (
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
            {[m.customerName, m.payment, m.bajaReason, m.returnReason].filter(Boolean).join(' · ')}
          </span>
        ) : null}
        {m.type === 'sale' && status !== 'cobrado' ? (
          <span style={{ display: 'block', marginTop: 3 }}>
            <SaleStatusChip status={status} size="sm" />
          </span>
        ) : null}
      </span>
      <span>{m.snapshot.size}</span>
      <span style={{ fontWeight: 700, color: qtyColor }}>{signedQuantity(m)}</span>
      <span style={{ color: 'var(--text-muted)', minWidth: 0 }}>
        <span style={{ display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {place.store || '—'}
        </span>
        {place.bodega ? (
          <span style={{ display: 'block', fontSize: 10.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={place.bodega}>
            {place.bodega}
          </span>
        ) : null}
      </span>
      <span style={{ color: 'var(--text-muted)', fontSize: 12, minWidth: 0 }}>
        <span style={{ display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={m.userName}>
          {m.userName}
        </span>
        {place.person ? (
          <span
            style={{ display: 'block', fontSize: 11, color: 'var(--iw-plum)', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
            title={`${personPrefix} ${place.person}`}
          >
            {personPrefix} {place.person}
          </span>
        ) : null}
      </span>
      <span style={{ textAlign: 'right', fontWeight: 700 }}>{formatMoney(saleValue(m))}</span>
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
    ? '92px 80px minmax(150px,1.6fr) 46px 50px 74px 120px 100px 92px'
    : '92px 80px minmax(150px,1.6fr) 46px 50px 74px 120px 100px'

function Empty({ text }: { text: string }) {
  return <div style={{ padding: 28, textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 }}>{text}</div>
}

/**
 * Confirmación fuerte para VACIAR todo el historial y reiniciar el dashboard.
 * Pide escribir "VACIAR" y el PIN de autorización (si está configurado). Es
 * irreversible; no toca el stock del inventario. Solo la dueña ve el botón.
 */
function WipeHistoryDialog({ onClose }: { onClose: () => void }) {
  const [pin, setPin] = useState('')
  const [needPin, setNeedPin] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')

  useEffect(() => {
    configRepository.hasAuthPin().then(setNeedPin).catch(() => setNeedPin(false))
  }, [])

  const submit = async () => {
    setError('')
    if (confirmText.trim().toUpperCase() !== 'VACIAR') {
      setError('Escribe VACIAR (en mayúsculas) para confirmar.')
      return
    }
    setBusy(true)
    try {
      if (needPin && !(await configRepository.verifyAuthPin(pin.trim()))) {
        setError('PIN incorrecto.')
        setBusy(false)
        return
      }
      const res = await movementRepository.wipeAllHistory()
      setDone(`Listo: se borraron ${res.movements} movimientos y el dashboard quedó en cero. Recargando…`)
      window.setTimeout(() => window.location.reload(), 1400)
    } catch (e) {
      setError(errorMessage(e))
      setBusy(false)
    }
  }

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(12,12,13,.55)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 70, padding: 20, overflowY: 'auto' }}
    >
      <div onClick={(e) => e.stopPropagation()} style={{ width: 440, maxWidth: '100%', background: 'var(--surface-card)', borderRadius: 'var(--radius-2xl)', boxShadow: 'var(--shadow-lg)', padding: '22px 24px 24px', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <h2 style={{ margin: 0, font: '700 20px var(--font-display)', color: 'var(--color-danger)' }}>Vaciar historial</h2>
          <button onClick={onClose} aria-label="Cerrar" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 22, lineHeight: 1 }}>✕</button>
        </div>
        <div style={{ background: 'rgba(224,52,29,.08)', border: '1px solid rgba(224,52,29,.3)', borderRadius: 'var(--radius-md)', padding: '11px 13px', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: 14 }}>
          Esto borra <b>permanentemente</b> todo el historial de movimientos (ventas, entradas, devoluciones, bajas) y reinicia el dashboard a cero. <b>No se puede deshacer.</b> El <b>stock del inventario no cambia</b>.
        </div>

        {done ? (
          <div style={{ background: 'rgba(21,119,79,.1)', border: '1px solid rgba(21,119,79,.3)', borderRadius: 'var(--radius-md)', padding: '11px 13px', color: 'var(--color-success)', fontSize: 13, fontWeight: 700 }}>
            {done}
          </div>
        ) : (
          <>
            <label style={{ display: 'block', marginBottom: 14 }}>
              <span style={{ display: 'block', font: '700 12.5px var(--font-body)', color: 'var(--text-secondary)', marginBottom: 5 }}>Escribe VACIAR para confirmar</span>
              <input
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                autoComplete="off"
                placeholder="VACIAR"
                style={{ width: '100%', height: 44, padding: '0 13px', border: '1.5px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', font: '700 15px var(--font-body)', letterSpacing: '.1em', outline: 'none', background: 'var(--surface-card)', color: 'var(--text-primary)', boxSizing: 'border-box' }}
              />
            </label>
            {needPin ? (
              <label style={{ display: 'block', marginBottom: 14 }}>
                <span style={{ display: 'block', font: '700 12.5px var(--font-body)', color: 'var(--text-secondary)', marginBottom: 5 }}>PIN de autorización</span>
                <input
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="••••"
                  style={{ width: '100%', height: 44, padding: '0 13px', border: '1.5px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', font: '700 16px var(--font-mono)', letterSpacing: '.2em', outline: 'none', background: 'var(--surface-card)', color: 'var(--text-primary)', boxSizing: 'border-box' }}
                />
              </label>
            ) : null}
            {error ? (
              <div style={{ marginBottom: 12, background: 'rgba(224,52,29,.1)', border: '1px solid rgba(224,52,29,.3)', borderRadius: 'var(--radius-md)', padding: '9px 12px', color: 'var(--color-danger)', fontSize: 12.5, fontWeight: 700 }}>
                {error}
              </div>
            ) : null}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={onClose} className="iw-press" style={{ height: 44, padding: '0 18px', background: 'var(--surface-card)', color: 'var(--text-primary)', border: '1.5px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', font: '700 14px var(--font-body)', cursor: 'pointer' }}>Cancelar</button>
              <button
                onClick={() => void submit()}
                disabled={busy}
                className="iw-press"
                style={{ height: 44, padding: '0 22px', border: 'none', borderRadius: 'var(--radius-md)', font: '700 14px var(--font-body)', background: 'var(--color-danger)', color: '#fff', cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.6 : 1 }}
              >
                {busy ? 'Vaciando…' : 'Vaciar todo'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
