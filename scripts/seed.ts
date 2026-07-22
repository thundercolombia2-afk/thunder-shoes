/**
 * Siembra el Firestore con los datos de arranque REALES del negocio:
 *   · 2 locales (163 Sede principal, 173 Sede norte)
 *   · 20 referencias de zapatillas con sus tallas y códigos de barras
 *   · stock inicial por talla (inventario de apertura)
 *
 * NO crea movimientos: el libro mayor arranca limpio y se llena al operar.
 * Así el dashboard refleja ventas reales desde el primer día, no datos mock.
 *
 * Orden:
 *   1. Corre la app (npm run dev) y regístrate: serás el SOCIO DUEÑO.
 *   2. Pon ese mismo correo y contraseña en .env (SEED_EMAIL / SEED_PASSWORD).
 *   3. npm run seed
 *
 * El seed entra como ese socio (las reglas exigen un perfil para escribir) y
 * usa el SDK cliente con las MISMAS credenciales del .env: sin cuenta de
 * servicio, sin tocar nada fuera de tu proyecto.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { initializeApp } from 'firebase/app'
import {
  getFirestore,
  writeBatch,
  doc,
  collection,
  Timestamp,
} from 'firebase/firestore'
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth'
import { money, SIZES, type Size } from '../src/domain/models'
import { buildBarcode, buildSearchTokens } from '../src/domain/rules'

// ── Cargar .env manualmente (esto corre en Node, no en Vite) ─────────────────
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

// ── Datos de arranque ────────────────────────────────────────────────────────

const STORES = [
  { code: '163', name: 'Sede principal' },
  { code: '173', name: 'Sede norte' },
]

// [marca, nombre, sku, precio]  (precios en pesos, unidades enteras)
const PRODUCTS: [string, string, string, number][] = [
  ['Nike', 'Air Force 1 Low', 'AF1-WHT', 459900],
  ['Nike', 'Air Max 90', 'AM90-BLK', 589900],
  ['Nike', 'Dunk Low Panda', 'DNK-PND', 529900],
  ['Adidas', 'Superstar', 'SUP-WHT', 419900],
  ['Adidas', 'Forum Low', 'FRM-BLU', 479900],
  ['Adidas', 'Samba OG', 'SMB-BGE', 499900],
  ['Puma', 'Suede Classic', 'SUE-RED', 299900],
  ['Puma', 'RS-X', 'RSX-MLT', 389900],
  ['New Balance', '550 White', 'NB550-WHT', 649900],
  ['New Balance', '574 Grey', 'NB574-GRY', 429900],
  ['Converse', 'Chuck 70 Hi', 'CK70-BLK', 369900],
  ['Vans', 'Old Skool', 'OS-BLK', 339900],
  ['Reebok', 'Club C 85', 'CC85-WHT', 329900],
  ['Asics', 'Gel-Lyte III', 'GL3-CRM', 459900],
  ['Jordan', '1 Mid Chicago', 'J1M-CHI', 799900],
  ['Nike', 'Cortez', 'CTZ-WHT', 379900],
  ['Adidas', 'Gazelle', 'GZL-GRN', 449900],
  ['Fila', 'Disruptor II', 'DIS-WHT', 289900],
  ['Skechers', 'D’Lites', 'DLT-PNK', 319900],
  ['Under Armour', 'Curry Flow', 'CRY-BLK', 689900],
]

// PRNG determinista: mismo seed → mismo inventario inicial en cada corrida.
function makeRng(seed: number) {
  let s = seed | 0
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

async function main() {
  const email = need('SEED_EMAIL')
  const password = need('SEED_PASSWORD')
  console.log(`→ Entrando como ${email}…`)
  try {
    await signInWithEmailAndPassword(getAuth(app), email, password)
  } catch {
    console.error(
      '\n✗ No se pudo entrar. Regístrate primero en la app (serás socio dueño) y pon ese\n' +
        '  mismo correo y contraseña en SEED_EMAIL / SEED_PASSWORD dentro de .env.\n',
    )
    process.exit(1)
  }

  const rng = makeRng(20260722)
  const ri = (a: number, b: number) => Math.floor(rng() * (b - a + 1)) + a
  const now = Timestamp.now()

  // Los batches de Firestore admiten hasta 500 operaciones; agrupamos en tandas.
  let batch = writeBatch(db)
  let ops = 0
  let writes = 0
  const flushIfNeeded = async () => {
    if (ops >= 450) {
      await batch.commit()
      batch = writeBatch(db)
      ops = 0
    }
  }

  // Locales
  for (const store of STORES) {
    batch.set(doc(db, 'stores', store.code), { code: store.code, name: store.name, active: true })
    ops++
    writes++
  }

  // Catálogo
  for (const [brand, name, sku, price] of PRODUCTS) {
    const productRef = doc(collection(db, 'products'))
    const productId = productRef.id
    const minStock = ri(2, 4)
    const cost = Math.round((price * (0.52 + rng() * 0.14)) / 100) * 100

    batch.set(productRef, {
      sku: sku.toUpperCase(),
      brand,
      name,
      price: money(price),
      cost: money(cost),
      minStock,
      active: true,
      searchTokens: buildSearchTokens(name, brand, sku),
      createdAt: now,
      updatedAt: now,
    })
    ops++
    writes++
    await flushIfNeeded()

    for (const size of SIZES as readonly Size[]) {
      const edge = size <= 37 || size >= 44
      const stock = edge ? ri(0, 5) : ri(2, 14)
      const barcode = buildBarcode(sku, size)

      batch.set(doc(db, 'products', productId, 'variants', String(size)), {
        productId,
        size,
        barcode,
        stock,
        minStock,
        active: true,
        updatedAt: now,
      })
      ops++
      writes++

      batch.set(doc(db, 'barcodes', barcode), {
        productId,
        variantId: `${productId}:${size}`,
        size,
        createdAt: now,
      })
      ops++
      writes++
      await flushIfNeeded()
    }
  }

  await batch.commit()
  console.log(`✓ Seed completo: ${STORES.length} locales, ${PRODUCTS.length} referencias (${writes} documentos).`)
  console.log('  El libro mayor arranca vacío; el dashboard se llena al registrar ventas.')
  process.exit(0)
}

main().catch((err) => {
  console.error('\n✗ Falló el seed:', err)
  process.exit(1)
})
