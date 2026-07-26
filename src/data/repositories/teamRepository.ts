/**
 * Equipo e invitaciones. Solo la DUEÑA usa esto (lo refuerzan las reglas):
 *   · genera códigos de invitación con el rol Y la asignación (local o bodega)
 *     ya fijados — quien se registra no elige nada;
 *   · ve el equipo y edita el rol / local / bodegas de cada persona.
 */

import { getDocs, orderBy, query, setDoc, updateDoc, Timestamp } from 'firebase/firestore'
import { invitesRef, inviteRef, userRef, usersRef } from '../paths'
import { inviteFromDoc, userFromDoc } from '../converters'
import { DEMO } from '@/config'
import { demoBackend } from '../demoBackend'
import type { Invite, Role, UserProfile } from '@/domain/users'

/** Código legible y difícil de adivinar: "THR-7QK2". */
function generateCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // sin O/0, I/1 para no confundir
  let body = ''
  const values = crypto.getRandomValues(new Uint32Array(4))
  for (const v of values) body += alphabet[v % alphabet.length]
  return `THR-${body}`
}

export interface InviteInput {
  role: Role
  /** Local (socio/empleado) que hereda quien use el código. */
  storeId?: string
  /** Bodega (bodeguero) a la que queda autorizado quien use el código. */
  bodegaId?: string
}

export const teamRepository = {
  /** Crea una invitación de un solo uso con el rol y la asignación ya fijados. */
  async createInvite(input: InviteInput, creator: Pick<UserProfile, 'id' | 'name'>): Promise<Invite> {
    if (DEMO) return demoBackend.createInvite(input, { id: creator.id, name: creator.name })
    const code = generateCode()
    const now = Timestamp.now()
    const doc_: Record<string, unknown> = {
      role: input.role,
      createdBy: creator.id,
      createdByName: creator.name,
      active: true,
      createdAt: now,
    }
    if (input.storeId) doc_.storeId = input.storeId
    if (input.bodegaId) doc_.bodegaId = input.bodegaId
    await setDoc(inviteRef(code), doc_)
    const invite: Invite = {
      code,
      role: input.role,
      createdBy: creator.id,
      createdByName: creator.name,
      active: true,
      createdAt: now.toDate(),
    }
    if (input.storeId) invite.storeId = input.storeId
    if (input.bodegaId) invite.bodegaId = input.bodegaId
    return invite
  },

  async listInvites(): Promise<Invite[]> {
    if (DEMO) return demoBackend.listInvites()
    const snap = await getDocs(query(invitesRef(), orderBy('createdAt', 'desc')))
    return snap.docs.map(inviteFromDoc)
  },

  async listTeam(): Promise<UserProfile[]> {
    if (DEMO) return demoBackend.listTeam()
    const snap = await getDocs(query(usersRef(), orderBy('createdAt', 'asc')))
    return snap.docs.map(userFromDoc)
  },

  /** La dueña cambia el rol de una persona. */
  async setUserRole(uid: string, role: Role): Promise<void> {
    if (DEMO) return demoBackend.setUserRole(uid, role)
    await updateDoc(userRef(uid), { role })
  },

  /** La dueña asigna/cambia el local de una persona ("" para quitarlo). */
  async setUserStore(uid: string, storeId: string): Promise<void> {
    if (DEMO) return demoBackend.setUserStore(uid, storeId)
    await updateDoc(userRef(uid), { storeId })
  },

  /** La dueña asigna las bodegas que una persona puede operar. */
  async setUserBodegas(uid: string, bodegaIds: string[]): Promise<void> {
    if (DEMO) return demoBackend.setUserBodegas(uid, bodegaIds)
    await updateDoc(userRef(uid), { bodegaIds })
  },

  /**
   * La dueña activa/desactiva una cuenta. Una cuenta desactivada conserva su
   * historial pero no puede volver a entrar (lo bloquea la sesión al cargar el
   * perfil). Sirve para cortar el acceso de quien ya no trabaja.
   */
  async setUserActive(uid: string, active: boolean): Promise<void> {
    if (DEMO) return demoBackend.setUserActive(uid, active)
    await updateDoc(userRef(uid), { active })
  },
}
