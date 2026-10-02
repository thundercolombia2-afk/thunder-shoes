/**
 * Anular una línea de venta registrada por error. Pide el PIN de autorización
 * de la dueña (Configuración) y un motivo, y deja la venta marcada "Anulada":
 * el par vuelve a su ubicación y la plata sale del día en que se contó (ver
 * `movementRepository.voidSaleLine`).
 *
 * Sin PIN configurado NO se puede anular: a diferencia de dar de baja, aquí hay
 * plata de por medio, y una anulación sin freno sería la puerta a una estafa.
 */

import { useEffect, useState } from 'react'
import { configRepository } from '@/data/repositories/configRepository'
import { movementRepository, type MovementActor } from '@/data/repositories/movementRepository'
import { DomainError, errorMessage } from '@/domain/rules'
import type { Movement } from '@/domain/models'
import { formatShortDate } from '@/lib/format'
import { Button } from '@/ui/Button'
import { Money } from '@/ui/Money'
import { ModalHeader } from './_shared'
import { ErrorNote, Overlay } from './SellModals'

const fieldStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 13px',
  border: '1.5px solid var(--border-subtle)',
  borderRadius: 'var(--radius-md)',
  font: '600 14px var(--font-body)',
  outline: 'none',
  background: 'var(--surface-card)',
  color: 'var(--text-primary)',
  boxSizing: 'border-box',
}
const labelStyle: React.CSSProperties = {
  display: 'block',
  font: '700 12.5px var(--font-body)',
  color: 'var(--text-secondary)',
  marginBottom: 5,
}

export function VoidSaleDialog({
  sale,
  actor,
  onClose,
  onDone,
}: {
  sale: Movement
  actor: MovementActor
  onClose: () => void
  /**
   * Se llama tras anular (`true`) o al cerrar después de un fallo (`false`),
   * para recargar y ver el estado real: en ese caso la anulación pudo o no
   * haberse escrito, así que la pantalla NO debe darla por hecha.
   */
  onDone: (voided: boolean) => void
}) {
  /** null = todavía no se sabe si hay PIN configurado. */
  const [hasPin, setHasPin] = useState<boolean | null>(null)
  const [pin, setPin] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    configRepository
      .hasAuthPin()
      .then(setHasPin)
      .catch(() => setHasPin(false))
  }, [])

  const submit = async () => {
    setError('')
    if (reason.trim().length < 3) return setError('Escribe el motivo de la anulación.')
    setBusy(true)
    try {
      if (!(await configRepository.verifyAuthPin(pin.trim()))) {
        setError('PIN incorrecto.')
        setBusy(false)
        return
      }
      await movementRepository.voidSaleLine(sale, reason, actor)
      onDone(true)
    } catch (e) {
      setError(errorMessage(e))
      // Un DomainError sale de las comprobaciones previas (ya anulada, ya
      // devuelta…): no se escribió nada. Cualquier otro error (red, permisos)
      // pudo dejar la anulación escrita: como en el retorno a bodega, no se
      // reintenta a ciegas, se cierra y se recarga.
      if (!(e instanceof DomainError)) setFailed(true)
      setBusy(false)
    }
  }

  return (
    <Overlay onClose={onClose} width={440}>
      <ModalHeader title="Anular venta" onClose={onClose} />

      <div style={{ background: 'var(--surface-muted)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', padding: '12px 15px', margin: '12px 0 14px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ font: '700 15px var(--font-display)' }}>
            {sale.snapshot.productName} · T{sale.snapshot.size} · ×{sale.quantity}
          </div>
          <div style={{ font: '700 15px var(--font-display)', whiteSpace: 'nowrap' }}>
            <Money value={sale.total} />
          </div>
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 3 }}>
          {[formatShortDate(sale.occurredAt), sale.payment, sale.customerName, sale.userName].filter(Boolean).join(' · ')}
        </div>
      </div>

      <p style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
        Es como si la venta nunca hubiera pasado: el par vuelve a donde estaba y la plata sale del total del día en
        que se contó. Queda en el historial como <b>Anulada</b>, con tu nombre y el motivo. <b>No se puede deshacer.</b>
      </p>

      {hasPin === false ? (
        <div style={{ fontSize: 13, color: 'var(--color-danger)', fontWeight: 700, lineHeight: 1.5 }}>
          Para anular ventas, la dueña tiene que configurar el PIN de autorización en Configuración.
        </div>
      ) : (
        <>
          <label style={{ display: 'block', marginBottom: 12 }}>
            <span style={labelStyle}>Motivo</span>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ej.: se marcó la talla equivocada"
              maxLength={140}
              style={fieldStyle}
            />
          </label>
          <label style={{ display: 'block' }}>
            <span style={labelStyle}>PIN de autorización de la dueña</span>
            <input
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              type="password"
              inputMode="numeric"
              autoComplete="off"
              style={{ ...fieldStyle, letterSpacing: '.2em' }}
            />
          </label>
        </>
      )}

      <ErrorNote text={error} />

      <div style={{ display: 'flex', gap: 10, marginTop: 18, justifyContent: 'flex-end' }}>
        <Button variant="outline" onClick={failed ? () => onDone(false) : onClose}>
          {failed ? 'Cerrar y actualizar' : 'Cancelar'}
        </Button>
        {!failed && hasPin ? (
          <Button variant="danger" onClick={() => void submit()} disabled={busy || pin.trim() === ''}>
            {busy ? 'Anulando…' : 'Anular venta'}
          </Button>
        ) : null}
      </div>
    </Overlay>
  )
}
