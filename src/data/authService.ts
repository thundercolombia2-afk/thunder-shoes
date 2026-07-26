/**
 * Autenticación: registro, ingreso y salida. Traduce los errores de Firebase
 * Auth a mensajes en español y orquesta el registro con invitación o arranque.
 *
 * El registro NUNCA deja que quien se inscribe elija su rol:
 *   · Si la plataforma está vacía → el primer registro es el socio dueño.
 *   · Si ya hay dueño → hace falta un código de invitación, y el rol lo hereda
 *     de esa invitación (lo puso un socio, no el que se registra).
 */

import {
  createUserWithEmailAndPassword,
  EmailAuthProvider,
  onAuthStateChanged,
  reauthenticateWithCredential,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updatePassword,
  updateProfile,
  type User,
} from 'firebase/auth'
import { getDoc, getDocs, limit, query, runTransaction, Timestamp, updateDoc } from 'firebase/firestore'
import { auth, db } from './firebase'
import { inviteRef, systemStateRef, userRef, usersRef } from './paths'
import { userFromDoc } from './converters'
import { DEMO } from '@/config'
import { demoBackend } from './demoBackend'
import { isStoreRole, type Role, type UserProfile } from '@/domain/users'

/** Traduce códigos de Firebase Auth a español. */
function authErrorMessage(error: unknown): string {
  const code = (error as { code?: string })?.code ?? ''
  switch (code) {
    case 'auth/invalid-email':
      return 'El correo no es válido.'
    case 'auth/email-already-in-use':
      return 'Ya existe una cuenta con ese correo. Inicia sesión.'
    case 'auth/weak-password':
      return 'La contraseña debe tener al menos 6 caracteres.'
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Correo o contraseña incorrectos.'
    case 'auth/too-many-requests':
      return 'Demasiados intentos. Espera un momento e intenta de nuevo.'
    case 'auth/network-request-failed':
      return 'Sin conexión. Revisa tu internet.'
    default:
      return 'No se pudo completar. Intenta de nuevo.'
  }
}

export const authService = {
  onChange(callback: (user: User | null) => void) {
    return onAuthStateChanged(auth, callback)
  },

  async login(email: string, password: string): Promise<void> {
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password)
    } catch (e) {
      throw new Error(authErrorMessage(e))
    }
  },

  async logout(): Promise<void> {
    await signOut(auth)
  },

  /** uid de la sesión actual, o null. */
  currentUid(): string | null {
    if (DEMO) return demoBackend.demoUser.id
    return auth.currentUser?.uid ?? null
  },

  /** Envía un enlace de recuperación de contraseña al correo. */
  async sendReset(email: string): Promise<void> {
    if (DEMO) return
    try {
      await sendPasswordResetEmail(auth, email.trim())
    } catch (e) {
      throw new Error(authErrorMessage(e))
    }
  },

  /** Actualiza el nombre visible (en Auth y en el perfil de Firestore). */
  async updateName(name: string): Promise<void> {
    if (DEMO) return demoBackend.updateName(name)
    const user = auth.currentUser
    if (!user) throw new Error('Sesión no válida.')
    const clean = name.trim()
    if (!clean) throw new Error('El nombre no puede quedar vacío.')
    await updateProfile(user, { displayName: clean }).catch(() => undefined)
    await updateDoc(userRef(user.uid), { name: clean })
  },

  /**
   * Cambia la contraseña. Firebase exige haber iniciado sesión hace poco, así
   * que primero re-autenticamos con la contraseña actual.
   */
  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    if (DEMO) return
    const user = auth.currentUser
    if (!user || !user.email) throw new Error('Sesión no válida.')
    if (newPassword.length < 6) throw new Error('La nueva contraseña debe tener al menos 6 caracteres.')
    try {
      const credential = EmailAuthProvider.credential(user.email, currentPassword)
      await reauthenticateWithCredential(user, credential)
      await updatePassword(user, newPassword)
    } catch (e) {
      throw new Error(authErrorMessage(e))
    }
  },

  /** ¿La plataforma está vacía? Entonces el próximo registro es el dueño. */
  async isBootstrap(): Promise<boolean> {
    const snap = await getDoc(systemStateRef())
    return !snap.exists()
  },

  /**
   * Registra una persona. `inviteCode` es obligatorio salvo en el arranque
   * (primer usuario del sistema, que queda como socio dueño).
   */
  async register(input: {
    name: string
    email: string
    password: string
    inviteCode?: string
  }): Promise<UserProfile> {
    const name = input.name.trim()
    const bootstrap = await this.isBootstrap()

    // 1. Crear la credencial en Firebase Auth.
    let user: User
    try {
      const cred = await createUserWithEmailAndPassword(auth, input.email.trim(), input.password)
      user = cred.user
    } catch (e) {
      throw new Error(authErrorMessage(e))
    }
    await updateProfile(user, { displayName: name }).catch(() => undefined)

    // 2. Crear el perfil (rol incluido) de forma atómica con su origen:
    //    arranque → también sella el centinela; invitación → la consume.
    try {
      const profile = await runTransaction(db, async (tx) => {
        const now = Timestamp.now()

        if (bootstrap) {
          const state = await tx.get(systemStateRef())
          if (state.exists()) {
            // Alguien ganó la carrera del arranque: ya hay dueño.
            throw new Error('La plataforma ya tiene dueño. Pide una invitación.')
          }
          tx.set(systemStateRef(), { bootstrapped: true, ownerUid: user.uid, createdAt: now })
          tx.set(userRef(user.uid), profileDoc(name, input.email, 'socio', now, { owner: true }))
          return { role: 'socio' as Role, now }
        }

        const code = (input.inviteCode ?? '').trim().toUpperCase()
        if (!code) throw new Error('Necesitas un código de invitación.')
        const inviteSnap = await tx.get(inviteRef(code))
        if (!inviteSnap.exists() || inviteSnap.data().active !== true) {
          throw new Error('La invitación no existe o ya fue usada.')
        }
        const data = inviteSnap.data()
        const role = data.role as Role
        tx.update(inviteRef(code), { active: false, usedBy: user.uid, usedAt: now })
        // La asignación la trae la INVITACIÓN (la fijó la dueña): local para los
        // roles de venta, bodega para el bodeguero. El que se registra no elige.
        const opts: { storeId?: string; bodegaIds?: string[] } = {}
        if (isStoreRole(role) && data.storeId) opts.storeId = String(data.storeId)
        if (role === 'bodeguero' && data.bodegaId) opts.bodegaIds = [String(data.bodegaId)]
        tx.set(userRef(user.uid), {
          ...profileDoc(name, input.email, role, now, opts),
          inviteCode: code,
        })
        return { role, now }
      })

      return {
        id: user.uid as UserProfile['id'],
        name,
        email: input.email.trim(),
        role: profile.role,
        active: true,
        createdAt: profile.now.toDate(),
      }
    } catch (e) {
      // Si el perfil falla, la credencial quedó huérfana: la borramos para que
      // el correo no quede "ocupado" con una cuenta sin perfil.
      await user.delete().catch(() => undefined)
      const code = (e as { code?: string })?.code
      throw new Error(
        code?.startsWith('auth/') ? authErrorMessage(e) : (e as Error).message || 'No se pudo registrar.',
      )
    }
  },

  /**
   * Amarra al usuario a un local por primera vez (solo si aún no tiene uno).
   * Lo usa el socio dueño del arranque, que se registró antes de que existieran
   * los locales: elige el suyo una vez y queda fijo.
   */
  async bindStore(storeId: string): Promise<void> {
    if (DEMO) return demoBackend.bindStore(storeId)
    const user = auth.currentUser
    if (!user) throw new Error('Sesión no válida.')
    await updateDoc(userRef(user.uid), { storeId })
  },

  /** Lee el perfil (rol) de un usuario ya autenticado. */
  async loadProfile(uid: string): Promise<UserProfile | null> {
    if (DEMO) return demoBackend.loadProfile()
    const snap = await getDoc(userRef(uid))
    return snap.exists() ? userFromDoc(snap as never) : null
  },

  /**
   * Convierte al usuario autenticado en SOCIO DUEÑO si la plataforma está vacía.
   * Permite crear el primer usuario donde sea (consola de Firebase o registro
   * en la app): al iniciar sesión por primera vez, si aún no hay dueño, se le
   * crea el perfil de socio. Devuelve null si ya había dueño (no es arranque).
   */
  async claimBootstrapProfile(user: User): Promise<UserProfile | null> {
    try {
      return await runTransaction(db, async (tx) => {
        const state = await tx.get(systemStateRef())
        if (state.exists()) return null // ya hay dueño: no es arranque
        const now = Timestamp.now()
        const name = (user.displayName || user.email?.split('@')[0] || 'Socio').trim()
        const email = user.email ?? ''
        tx.set(systemStateRef(), { bootstrapped: true, ownerUid: user.uid, createdAt: now })
        tx.set(userRef(user.uid), profileDoc(name, email, 'socio', now, { owner: true }))
        return {
          id: user.uid as UserProfile['id'],
          name,
          email,
          role: 'socio' as Role,
          owner: true,
          active: true,
          createdAt: now.toDate(),
        }
      })
    } catch {
      return null
    }
  },

  /** ¿Hay al menos un usuario? Se usa para decidir textos del registro. */
  async hasAnyUser(): Promise<boolean> {
    const snap = await getDocs(query(usersRef(), limit(1)))
    return !snap.empty
  },
}

function profileDoc(
  name: string,
  email: string,
  role: Role,
  now: Timestamp,
  opts: { storeId?: string; bodegaIds?: string[]; owner?: boolean } = {},
) {
  const doc: {
    name: string
    email: string
    role: Role
    active: boolean
    createdAt: Timestamp
    storeId?: string
    bodegaIds?: string[]
    owner?: boolean
  } = { name, email: email.trim(), role, active: true, createdAt: now }
  if (opts.storeId) doc.storeId = opts.storeId
  if (opts.bodegaIds && opts.bodegaIds.length) doc.bodegaIds = opts.bodegaIds
  if (opts.owner) doc.owner = true
  return doc
}
