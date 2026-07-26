/**
 * Andamiaje MÍNIMO para PROBAR con una base limpia y datos propios.
 *
 * Crea SOLO los dos locales fijos (163, 173). Nada más: la contraseña de
 * ingreso y las bodegas las configuras y asignas TÚ desde Configuración, como
 * dueña. Así nada queda "establecido" sin que tú lo decidas.
 *
 * Orden:
 *   1. Vacía la base si quieres partir de cero (ver README / firebase CLI).
 *   2. Corre la app (npm run dev) e INICIA SESIÓN: si la base está limpia,
 *      quedas como socio dueño.
 *   3. Pon ese mismo correo y contraseña en .env (SEED_EMAIL / SEED_PASSWORD).
 *   4. npm run seed:scaffold
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { initializeApp } from 'firebase/app'
import { getFirestore, writeBatch, doc, getDoc, updateDoc, Timestamp } from 'firebase/firestore'
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth'

const __dirname = dirname(fileURLToPath(import.meta.url))
const envPath = resolve(__dirname, '..', '.env')

function loadEnv(): Record<string, string> {
  let raw: string
  try {
    raw = readFileSync(envPath, 'utf8')
  } catch {
    console.error(`\n✗ No se encontró .env en ${envPath}. Copia .env.example a .env y pega la config de Firebase.\n`)
    process.exit(1)
  }
  const env: Record<string, string> = {}
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim()
  }
  return env
}

const env = loadEnv()
const need = (key: string): string => {
  const value = env[key]
  if (!value) {
    console.error(`\n✗ Falta ${key} en .env\n`)
    process.exit(1)
  }
  return value
}

const app = initializeApp({
  apiKey: need('VITE_FIREBASE_API_KEY'),
  authDomain: need('VITE_FIREBASE_AUTH_DOMAIN'),
  projectId: need('VITE_FIREBASE_PROJECT_ID'),
  storageBucket: need('VITE_FIREBASE_STORAGE_BUCKET'),
  messagingSenderId: need('VITE_FIREBASE_MESSAGING_SENDER_ID'),
  appId: need('VITE_FIREBASE_APP_ID'),
})
const db = getFirestore(app)

const STORES = [
  { code: '163', name: 'Sede principal' },
  { code: '173', name: 'Sede norte' },
]

async function main() {
  const email = need('SEED_EMAIL')
  const password = need('SEED_PASSWORD')
  console.log(`→ Entrando como ${email}…`)
  let uid = ''
  let displayName = ''
  try {
    const cred = await signInWithEmailAndPassword(getAuth(app), email, password)
    uid = cred.user.uid
    displayName = cred.user.displayName || email.split('@')[0] || 'Socio'
  } catch {
    console.error(
      '\n✗ No se pudo entrar. Revisa SEED_EMAIL / SEED_PASSWORD en .env (deben ser una cuenta real\n' +
        '  de Firebase Authentication de tu proyecto).\n',
    )
    process.exit(1)
  }

  const now = Timestamp.now()

  // 1. Asegurar el perfil de DUEÑA. Las reglas exigen un perfil para escribir
  //    locales; si la base está limpia, este script hace el "arranque".
  const userSnap = await getDoc(doc(db, 'users', uid))
  if (!userSnap.exists()) {
    const stateSnap = await getDoc(doc(db, 'system', 'state'))
    if (stateSnap.exists()) {
      console.error(
        '\n✗ Ya hay un dueño en la plataforma, pero esta cuenta no tiene perfil.\n' +
          '  Entra a la app con la cuenta dueña, o usa una invitación. No puedo sembrar con esta.\n',
      )
      process.exit(1)
    }
    const boot = writeBatch(db)
    boot.set(doc(db, 'system', 'state'), { bootstrapped: true, ownerUid: uid, createdAt: now })
    boot.set(doc(db, 'users', uid), { name: displayName, email, role: 'socio', owner: true, active: true, createdAt: now })
    await boot.commit()
    console.log(`✓ Perfil de dueña creado (${displayName}).`)
  } else if (userSnap.data().owner !== true) {
    // "Sana" una cuenta dueña creada antes de que existiera la marca `owner`.
    await updateDoc(doc(db, 'users', uid), { owner: true })
    console.log('✓ Marca de dueña restaurada en tu perfil.')
  }

  // 2. Solo los dos locales fijos. La contraseña de ingreso y las bodegas las
  //    configuras tú desde Configuración.
  const batch = writeBatch(db)
  for (const store of STORES) {
    batch.set(doc(db, 'stores', store.code), { code: store.code, name: store.name, active: true })
  }
  await batch.commit()

  console.log(`✓ Locales listos: ${STORES.map((s) => s.code).join(', ')}.`)
  console.log('  Ahora, en la app: elige tu local, configura la contraseña de ingreso y crea tus bodegas.')
  process.exit(0)
}

main().catch((err) => {
  console.error('\n✗ Falló el andamiaje:', err)
  process.exit(1)
})
