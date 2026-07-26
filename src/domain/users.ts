/**
 * Personas y permisos. Modelo puro: sin React ni Firebase.
 *
 * Tres roles:
 *   · socio    — VE costos y utilidad, GESTIONA el equipo y la configuración,
 *                vende y opera bodegas. Amarrado a un local.
 *   · empleado — vende, devuelve, recibe mercancía y crea referencias. NO ve
 *                costos ni gestiona equipo. Amarrado a un local.
 *   · bodeguero — SOLO opera bodegas (salidas/retornos donde esté autorizado) y
 *                crea referencias. Ve costos. NO vende ni queda amarrado a un
 *                local.
 */

import type { StoreId, UserId } from './models'

export const ROLES = ['socio', 'empleado', 'bodeguero'] as const
export type Role = (typeof ROLES)[number]

export const isRole = (value: unknown): value is Role =>
  typeof value === 'string' && (ROLES as readonly string[]).includes(value)

export const ROLE_LABEL: Record<Role, string> = {
  socio: 'Socio',
  empleado: 'Empleado',
  bodeguero: 'Bodeguero',
}

/** Roles que operan en un local (venden). El bodeguero no. */
export const isStoreRole = (role: Role): boolean => role === 'socio' || role === 'empleado'

/** Perfil de una persona. El rol vive aquí (en la base), nunca en el cliente. */
export interface UserProfile {
  id: UserId
  name: string
  email: string
  role: Role
  /** Local al que pertenece. Los de venta lo tienen; el bodeguero no. */
  storeId?: StoreId
  /** Bodegas que este usuario puede operar (salidas/retornos). */
  bodegaIds?: string[]
  /** `true` solo para la dueña (la primera cuenta). Ve Configuración. */
  owner?: boolean
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
  /** Asignación que la dueña fija al crear el código: */
  storeId?: string // local (socio/empleado)
  bodegaId?: string // bodega (bodeguero)
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
  | 'receiveStock' // registrar entradas / recepción de mercancía
  | 'countStock' // conteo físico / cuadre
  | 'createReference' // crear referencias nuevas
  | 'seeCosts' // ver costo y utilidad
  | 'manageTeam' // invitar personas, gestionar configuración
  | 'operateBodega' // hacer salidas / retornos en bodegas autorizadas

const CAPABILITIES: Record<Role, readonly Capability[]> = {
  socio: ['sell', 'receiveStock', 'countStock', 'createReference', 'seeCosts', 'manageTeam', 'operateBodega'],
  empleado: ['sell', 'receiveStock', 'countStock', 'createReference'],
  bodeguero: ['createReference', 'seeCosts', 'operateBodega'],
}

/** ¿El rol tiene permitido `capability`? Única fuente de verdad de permisos. */
export const can = (role: Role, capability: Capability): boolean =>
  CAPABILITIES[role].includes(capability)
