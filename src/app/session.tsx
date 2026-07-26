/**
 * Sesión: quién inició sesión (persona real + rol) y en qué local está
 * operando. El rol viene del perfil en Firestore, nunca del cliente, y decide
 * los permisos (ver costos, gestionar equipo, etc.).
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { authService } from '@/data/authService'
import { DEMO } from '@/config'
import { demoBackend } from '@/data/demoBackend'
import type { Store, StoreId } from '@/domain/models'
import { can as roleCan, isStoreRole, type Capability, type UserProfile } from '@/domain/users'
import type { MovementActor } from '@/data/repositories/movementRepository'

/**
 * loading   → resolviendo la sesión / el perfil
 * signedOut → sin sesión: mostrar ingreso / registro
 * noProfile → hay credencial pero no perfil (cuenta incompleta): salir
 * disabled  → perfil existe pero la dueña lo DESACTIVÓ: no puede operar
 * ready     → perfil cargado: elegir local y operar
 */
type Status = 'loading' | 'signedOut' | 'noProfile' | 'disabled' | 'ready'

interface SessionValue {
  status: Status
  user: UserProfile | null
  store: Store | null
  selectStore: (store: Store) => void
  clearStore: () => void
  logout: () => Promise<void>
  can: (capability: Capability) => boolean
  actor: MovementActor | null
  /** Vuelve a leer el perfil (tras editar el nombre, por ejemplo). */
  refreshProfile: () => Promise<void>
}

const SessionContext = createContext<SessionValue | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>(DEMO ? 'ready' : 'loading')
  const [user, setUser] = useState<UserProfile | null>(DEMO ? demoBackend.demoUser : null)
  const [store, setStore] = useState<Store | null>(null)

  useEffect(() => {
    // Modo demo: sin login, se entra como el usuario de ejemplo.
    if (DEMO) return
    // Un solo observador de la sesión de Firebase Auth. Cuando aparece una
    // credencial, cargamos su perfil (rol) desde Firestore.
    let cancelled = false
    const unsubscribe = authService.onChange(async (fbUser) => {
      if (!fbUser) {
        setUser(null)
        setStore(null)
        setStatus('signedOut')
        return
      }
      setStatus('loading')
      // Justo tras registrarse, el perfil se escribe una fracción de segundo
      // después de que aparece la credencial. Reintentamos unas veces antes de
      // declarar la cuenta incompleta, para no confundir "recién creada" con
      // "sin perfil".
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          const profile = await authService.loadProfile(fbUser.uid)
          if (cancelled) return
          if (profile) {
            // Cuenta desactivada por la dueña: tiene credencial y perfil, pero no
            // se le deja operar. Se queda en la pantalla de "cuenta desactivada".
            if (profile.active === false) {
              setUser(null)
              setStatus('disabled')
              return
            }
            setUser(profile)
            setStatus('ready')
            return
          }
          // Sin perfil: si la plataforma está vacía, este usuario (creado en la
          // consola o en la app) se convierte en el socio dueño.
          const claimed = await authService.claimBootstrapProfile(fbUser)
          if (cancelled) return
          if (claimed) {
            setUser(claimed)
            setStatus('ready')
            return
          }
        } catch {
          if (cancelled) return
        }
        await new Promise((r) => setTimeout(r, 600))
      }
      if (!cancelled) {
        setUser(null)
        setStatus('noProfile')
      }
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  const selectStore = useCallback((next: Store) => setStore(next), [])
  const clearStore = useCallback(() => setStore(null), [])

  const logout = useCallback(async () => {
    await authService.logout()
    setStore(null)
  }, [])

  const can = useCallback(
    (capability: Capability): boolean => (user ? roleCan(user.role, capability) : false),
    [user],
  )

  const refreshProfile = useCallback(async () => {
    const uid = authService.currentUid()
    if (!uid) return
    const profile = await authService.loadProfile(uid)
    if (profile) setUser(profile)
  }, [])

  const actor = useMemo<MovementActor | null>(() => {
    if (!user) return null
    // Los roles de venta necesitan un local; el bodeguero opera sin él (sus
    // movimientos son salidas/retornos, cuyo lugar va en from/to).
    if (isStoreRole(user.role) && !store) return null
    return {
      storeId: (store?.id ?? '') as StoreId,
      userId: user.id,
      userName: user.name,
    }
  }, [user, store])

  const value = useMemo<SessionValue>(
    () => ({ status, user, store, selectStore, clearStore, logout, can, actor, refreshProfile }),
    [status, user, store, selectStore, clearStore, logout, can, actor, refreshProfile],
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession debe usarse dentro de <SessionProvider>')
  return ctx
}
