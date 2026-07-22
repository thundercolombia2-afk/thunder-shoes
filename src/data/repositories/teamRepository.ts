/**
 * Equipo e invitaciones. Solo los socios usan esto (lo refuerzan las reglas):
 * generar códigos de invitación con un rol fijo y ver quién está en el equipo.
 */

import { getDocs, orderBy, query, setDoc, Timestamp } from 'firebase/firestore'
import { invitesRef, inviteRef, usersRef } from '../paths'
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

export const teamRepository = {
  /** Crea una invitación de un solo uso con el rol ya fijado por el socio. */
  async createInvite(role: Role, creator: Pick<UserProfile, 'id' | 'name'>): Promise<Invite> {
    if (DEMO) return demoBackend.createInvite(role, { id: creator.id, name: creator.name })
    const code = generateCode()
    const now = Timestamp.now()
    await setDoc(inviteRef(code), {
      role,
      createdBy: creator.id,
      createdByName: creator.name,
      active: true,
      createdAt: now,
    })
    return {
      code,
      role,
      createdBy: creator.id,
      createdByName: creator.name,
      active: true,
      createdAt: now.toDate(),
    }
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
}
