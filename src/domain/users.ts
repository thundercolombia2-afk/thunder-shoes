/**
 * Personas y permisos. Modelo puro: sin React ni Firebase.
 *
 * Hay dos roles. La diferencia NO es "quién puede operar" (ambos venden,
 * devuelven, reciben mercancía y cuadran), sino:
 *   · el socio VE costos y utilidad, y GESTIONA el equipo (invita gente);
 *   · el empleado NO ve costos ni utilidad, y NO puede invitar a nadie —
 *     así ningún empleado puede ascenderse ni ascender a otro a socio.
 */

import type { UserId } from './models'

export const ROLES = ['socio', 'empleado'] as const
export type Role = (typeof ROLES)[number]

export const isRole = (value: unknown): value is Role =>
  typeof value === 'string' && (ROLES as readonly string[]).includes(value)

export const ROLE_LABEL: Record<Role, string> = {
  socio: 'Socio',
  empleado: 'Empleado',
}

/** Perfil de una persona. El rol vive aquí (en la base), nunca en el cliente. */
export interface UserProfile {
  id: UserId
  name: string
  email: string
  role: Role
  active: boolean
  createdAt: Date
}

/**
 * Invitación de un solo uso. La crea un socio con el rol YA fijado; quien se
 * registra con ella no elige su rol, lo hereda. Al usarse queda inactiva.
 */
export interface Invite {
  code: string
  role: Role
  createdBy: UserId
  createdByName: string
  active: boolean
  usedBy?: UserId
  createdAt: Date
}

// ─────────────────────────────────────────────────────────────────────────────
// Permisos
// ─────────────────────────────────────────────────────────────────────────────

export type Capability =
  | 'sell' // vender / devolver
  | 'receiveStock' // registrar compras / recepción de mercancía
  | 'countStock' // conteo físico / cuadre
  | 'createReference' // crear referencias nuevas
  | 'seeCosts' // ver costo y utilidad
  | 'manageTeam' // invitar personas, ver el equipo

const CAPABILITIES: Record<Role, readonly Capability[]> = {
  socio: ['sell', 'receiveStock', 'countStock', 'createReference', 'seeCosts', 'manageTeam'],
  empleado: ['sell', 'receiveStock', 'countStock', 'createReference'],
}

/** ¿El rol tiene permitido `capability`? Única fuente de verdad de permisos. */
export const can = (role: Role, capability: Capability): boolean =>
  CAPABILITIES[role].includes(capability)
