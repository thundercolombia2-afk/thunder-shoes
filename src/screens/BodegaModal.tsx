/**
 * Vista de Bodega (modal desde /scan). Con el producto ya escaneado, se elige
 * una bodega —de las que el usuario tiene autorizadas, una pestaña por bodega— y
 * dentro se hace una SALIDA (bodega → local de un usuario) o un RETORNO
 * (local de un usuario → bodega).
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { bodegaRepository } from '@/data/repositories/bodegaRepository'
import { teamRepository } from '@/data/repositories/teamRepository'
import { bodegaKey, storeKey } from '@/domain/locations'
import { ROLE_LABEL, type UserProfile } from '@/domain/users'
import type { Bodega } from '@/domain/models'
import type { CartLine } from '@/app/cart'

type Action = 'salida' | 'retorno'

export function BodegaModal({
  lines,
  authorizedBodegaIds,
  stockAtLoc,
  busy,
  error,
  onClose,
  onConfirm,
}: {
  lines: CartLine[]
  /** Bodegas que el usuario actual puede operar (de su perfil). */
  authorizedBodegaIds: string[]
  /** Stock de una variante en una ubicación (clave de domain/locations). */
  stockAtLoc: (variantId: string, key: string) => number
  busy: boolean
  error: string
  onClose: () => void
  onConfirm: (action: Action, bodega: Bodega, targetStoreId: string) => void
}) {
  const [bodegas, setBodegas] = useState<Bodega[]>([])
  const [team, setTeam] = useState<UserProfile[]>([])
  const [bodegaId, setBodegaId] = useState('')
  const [action, setAction] = useState<Action>('salida')
  // Se guarda el USUARIO elegido, no el local: varios usuarios comparten local,
  // y por id no se confunde a quién le entregas.
  const [targetUserId, setTargetUserId] = useState('')

  useEffect(() => bodegaRepository.subscribe(setBodegas), [])
  useEffect(() => {
    teamRepository.listTeam().then(setTeam).catch(() => undefined)
  }, [])

  // Solo las bodegas que este usuario tiene asignadas en su perfil.
  const mine = useMemo(
    () => bodegas.filter((b) => b.active && authorizedBodegaIds.includes(b.id)),
    [bodegas, authorizedBodegaIds],
  )
  const bodega = mine.find((b) => b.id === bodegaId) ?? mine[0]

  // Destino (salida) u origen (retorno): usuarios amarrados a un local.
  const localUsers = useMemo(() => team.filter((u) => u.storeId), [team])
  const target = localUsers.find((u) => u.id === targetUserId)
  const targetStoreId = target?.storeId ?? ''

  const sourceKey = bodega
    ? action === 'salida'
      ? bodegaKey(bodega.id)
      : targetStoreId
        ? storeKey(targetStoreId)
        : ''
    : ''

  const availableFor = (variantId: string) => (sourceKey ? stockAtLoc(variantId, sourceKey) : 0)
  const insufficient = lines.some((l) => l.quantity > availableFor(l.variantId))
  const ready = !!bodega && !!targetStoreId && !insufficient && lines.length > 0 && !busy

  const confirm = () => {
    if (bodega && ready) onConfirm(action, bodega, targetStoreId)
  }

  return (
    <Overlay onClose={onClose} width={560}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0, font: '700 22px var(--font-display)' }}>Bodega</h2>
        <button onClick={onClose} aria-label="Cerrar" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 22, lineHeight: 1 }}>
          ✕
        </button>
      </div>

      {lines.length === 0 ? (
        <Note>Escanea uno o más productos antes de moverlos a o desde una bodega.</Note>
      ) : mine.length === 0 ? (
        <Note>No tienes bodegas autorizadas. Pide a un socio que te autorice en Configuración → Autorizaciones.</Note>
      ) : (
        <>
          {/* Pestañas: una por bodega autorizada */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16 }}>
            {mine.map((b) => {
              const on = b.id === (bodega?.id ?? '')
              return (
                <button
                  key={b.id}
                  onClick={() => setBodegaId(b.id)}
                  className="iw-press"
                  style={{
                    padding: '9px 15px',
                    borderRadius: 'var(--radius-lg)',
                    border: `1.5px solid ${on ? 'var(--iw-plum)' : 'var(--border-subtle)'}`,
                    background: on ? 'var(--iw-plum)' : 'var(--surface-card)',
                    color: on ? '#fff' : 'var(--text-secondary)',
                    font: '700 13.5px var(--font-body)',
                    cursor: 'pointer',
                  }}
                >
                  {b.code}
                </button>
              )
            })}
          </div>

          {/* Acción: salida | retorno */}
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            {(['salida', 'retorno'] as Action[]).map((a) => {
              const on = a === action
              return (
                <button
                  key={a}
                  onClick={() => setAction(a)}
                  className="iw-press"
                  style={{
                    flex: 1,
                    height: 44,
                    borderRadius: 'var(--radius-lg)',
                    border: `1.5px solid ${on ? 'var(--iw-plum)' : 'var(--border-subtle)'}`,
                    background: on ? 'var(--iw-plum)' : 'var(--surface-card)',
                    color: on ? '#fff' : 'var(--text-secondary)',
                    font: '700 14.5px var(--font-body)',
                    cursor: 'pointer',
                  }}
                >
                  {a === 'salida' ? 'Salida a un local' : 'Retorno a bodega'}
                </button>
              )
            })}
          </div>
          <p style={{ margin: '9px 0 0', fontSize: 12.5, color: 'var(--text-muted)' }}>
            {action === 'salida'
              ? `Los pares salen de ${bodega?.code} y quedan en el local del usuario que elijas.`
              : `Los pares vuelven del local del usuario que elijas a ${bodega?.code}.`}
          </p>

          {/* Usuario destino/origen (define el local) */}
          <div style={{ marginTop: 14, font: '700 13.5px var(--font-body)', color: 'var(--text-secondary)' }}>
            {action === 'salida' ? '¿A qué usuario/local?' : '¿De qué usuario/local?'}
          </div>
          {localUsers.length === 0 ? (
            <Note>No hay usuarios amarrados a un local todavía.</Note>
          ) : (
            <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {localUsers.map((u) => {
                const on = u.id === targetUserId
                return (
                  <button
                    key={u.id}
                    onClick={() => setTargetUserId(u.id)}
                    className="iw-press"
                    style={{
                      textAlign: 'left',
                      padding: '9px 13px',
                      borderRadius: 'var(--radius-lg)',
                      border: `1.5px solid ${on ? 'var(--iw-plum)' : 'var(--border-subtle)'}`,
                      background: on ? 'rgba(90,42,90,.08)' : 'var(--surface-card)',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ font: '700 13.5px var(--font-body)', color: 'var(--text-primary)' }}>{u.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{ROLE_LABEL[u.role]} · Local {u.storeId}</div>
                  </button>
                )
              })}
            </div>
          )}

          {/* Productos escaneados + disponibilidad en el origen */}
          <div style={{ marginTop: 16, font: '700 13.5px var(--font-body)', color: 'var(--text-secondary)' }}>
            Productos a mover
          </div>
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {lines.map((l) => {
              const avail = availableFor(l.variantId)
              const short = l.quantity > avail
              return (
                <div
                  key={l.variantId}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    border: `1px solid ${short ? 'rgba(224,52,29,.4)' : 'var(--border-subtle)'}`,
                    borderRadius: 'var(--radius-lg)',
                    padding: '10px 14px',
                    background: short ? 'rgba(224,52,29,.06)' : 'var(--surface-card)',
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ font: '700 14px var(--font-display)' }}>
                      {l.name} · T{l.size}
                    </div>
                    <div style={{ fontSize: 12, color: short ? 'var(--color-danger)' : 'var(--text-muted)', marginTop: 2 }}>
                      Mover {l.quantity} · disponible en origen {avail}
                      {short ? ' · no alcanza' : ''}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {error ? <ErrorNote text={error} /> : null}

          <div style={{ display: 'flex', gap: 10, marginTop: 20, justifyContent: 'flex-end' }}>
            <button
              onClick={onClose}
              className="iw-press"
              style={{ padding: '0 20px', height: 48, background: 'var(--surface-card)', color: 'var(--text-primary)', border: '1.5px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', font: '700 15px var(--font-body)', cursor: 'pointer' }}
            >
              Cancelar
            </button>
            <button
              onClick={confirm}
              disabled={!ready}
              className="iw-press"
              style={{
                flex: 1.3,
                height: 48,
                border: 'none',
                borderRadius: 'var(--radius-lg)',
                font: '700 15px var(--font-body)',
                background: ready ? 'var(--iw-plum)' : 'var(--surface-muted)',
                color: ready ? '#fff' : 'var(--text-muted)',
                cursor: ready ? 'pointer' : 'not-allowed',
              }}
            >
              {busy
                ? 'Registrando…'
                : action === 'salida'
                  ? `Sacar a ${target ? `Local ${target.storeId}` : 'un local'}`
                  : `Retornar a ${bodega?.code ?? 'bodega'}`}
            </button>
          </div>
        </>
      )}
    </Overlay>
  )
}

// ── Piezas ────────────────────────────────────────────────────────────────────

function Overlay({ onClose, children, width = 440 }: { onClose: () => void; children: ReactNode; width?: number }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(12,12,13,.55)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, padding: 20, overflowY: 'auto' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width, maxWidth: '100%', background: 'var(--surface-card)', borderRadius: 'var(--radius-2xl)', boxShadow: 'var(--shadow-lg)', padding: '22px 24px 24px', boxSizing: 'border-box' }}
      >
        {children}
      </div>
    </div>
  )
}

function Note({ children }: { children: ReactNode }) {
  return (
    <div style={{ marginTop: 16, padding: '14px 16px', background: 'var(--surface-muted)', border: '1px dashed var(--border-subtle)', borderRadius: 'var(--radius-lg)', color: 'var(--text-muted)', fontSize: 13.5, lineHeight: 1.5 }}>
      {children}
    </div>
  )
}

function ErrorNote({ text }: { text: string }) {
  return (
    <div style={{ marginTop: 14, background: 'rgba(224,52,29,.1)', border: '1px solid rgba(224,52,29,.3)', borderRadius: 'var(--radius-md)', padding: '10px 14px', color: 'var(--color-danger)', fontSize: 13, fontWeight: 700 }}>
      {text}
    </div>
  )
}
