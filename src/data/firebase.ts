/**
 * Único punto donde se inicializa Firebase. Nada más en la app llama a
 * `initializeApp` ni importa `firebase/app` directamente.
 */

import { initializeApp, type FirebaseApp } from 'firebase/app'
import {
  connectFirestoreEmulator,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from 'firebase/firestore'
import { connectAuthEmulator, getAuth, type Auth } from 'firebase/auth'
import { DEMO } from '@/config'

const required = (key: string): string => {
  // En modo demo no hay Firebase: devolvemos un valor ficticio para que el SDK
  // inicialice sin red. Los repositorios no lo usan (leen del backend en memoria).
  if (DEMO) return 'demo'
  const value = import.meta.env[key as keyof ImportMetaEnv]
  if (!value) {
    throw new Error(
      `Falta la variable de entorno ${key}. Copia .env.example a .env y pega la config de Firebase.`,
    )
  }
  return value as string
}

export const firebaseApp: FirebaseApp = initializeApp({
  apiKey: required('VITE_FIREBASE_API_KEY'),
  authDomain: required('VITE_FIREBASE_AUTH_DOMAIN'),
  projectId: required('VITE_FIREBASE_PROJECT_ID'),
  storageBucket: required('VITE_FIREBASE_STORAGE_BUCKET'),
  messagingSenderId: required('VITE_FIREBASE_MESSAGING_SENDER_ID'),
  appId: required('VITE_FIREBASE_APP_ID'),
})

/**
 * Caché persistente en IndexedDB. En un local con wifi inestable el POS sigue
 * mostrando el inventario y encolando escrituras; Firestore las sincroniza
 * cuando vuelve la conexión. `persistentMultipleTabManager` evita que se
 * peleen dos pestañas abiertas en la misma caja.
 */
export const db: Firestore = initializeFirestore(firebaseApp, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
})

/**
 * Autenticación real (correo + contraseña). Cada persona inicia sesión, y las
 * reglas de Firestore exigen `request.auth != null` con un perfil válido: lo
 * que no pase por una cuenta creada queda rechazado. La sesión la persiste el
 * propio SDK de Auth en IndexedDB, así que no hay que volver a entrar en cada
 * recarga.
 */
export const auth: Auth = getAuth(firebaseApp)

if (import.meta.env.VITE_USE_EMULATORS === 'true') {
  connectFirestoreEmulator(db, '127.0.0.1', 8080)
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
}
