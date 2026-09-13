/**
 * RELLENO del resumen de stock por referencia (`Product.stock` y
 * `Product.stockByLocation`).
 *
 * Recorre las referencias, suma el stock de sus tallas y escribe el total en el
 * documento del producto. Es la proyección que la lista de inventario necesita
 * para no tener que leer las ~1.750 variantes del catálogo en cada carga.
 *
 * IDEMPOTENTE: se puede correr las veces que haga falta. Escribe valores
 * ABSOLUTOS (no deltas), así que una segunda corrida corrige cualquier desvío
 * en vez de duplicarlo. Por eso también sirve de VERIFICADOR: si al terminar
 * dice "0 corregidas", el resumen está cuadrado con las tallas.
 *
 * Orden de puesta en marcha (IMPORTA):
 *   1. firebase deploy --only firestore:rules   ← o las ventas de un vendedor se
 *      caen con permission-denied.
 *   2. npm run backfill:stock                   ← ANTES de desplegar la app.
 *   3. Desplegar la app.
 *   4. npm run backfill:stock                   ← otra vez: debe decir 0.
 *
 * El paso 2 va ANTES del despliegue porque la lista de inventario LEE este
 * resumen: si la app saliera primero, toda referencia sin rellenar mostraría 0
 * pares. Los campos son aditivos, así que la app vieja los ignora sin problema.
 *
 * El paso 4 cierra la ventana entre el relleno y el despliegue: una venta hecha
 * ahí movió las tallas sin mover el resumen (la app vieja no lo mantenía), y
 * como el relleno escribe valores absolutos, volver a correrlo lo cuadra.
 *
 * Usa el SDK cliente y las credenciales de .env igual que `seed.ts`: sin cuenta
 * de servicio, sin tocar nada fuera de tu proyecto.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { initializeApp } from 'firebase/app'
import { collection, getDocs, getFirestore, writeBatch } from 'firebase/firestore'
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth'

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

/** Mapa `{ ubicacion: cantidad }` saneado, descartando ceros. */
const sanitize = (value: unknown): Record<string, number> => {
  if (!value || typeof value !== 'object') return {}
  const out: Record<string, number> = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const n = Number(raw)
    if (Number.isFinite(n) && n !== 0) out[key] = n
  }
  return out
}

/** Compara dos mapas de ubicaciones (ya saneados) para saber si hubo cambio. */
const sameMap = (a: Record<string, number>, b: Record<string, number>): boolean => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const key of keys) if ((a[key] ?? 0) !== (b[key] ?? 0)) return false
  return true
}

async function main(): Promise<void> {
  const email = need('SEED_EMAIL')
  const password = need('SEED_PASSWORD')
  console.log(`→ Entrando como ${email}…`)
  try {
    await signInWithEmailAndPassword(getAuth(app), email, password)
  } catch {
    console.error(
      '\n✗ No se pudo entrar. Pon el correo y la contraseña de la dueña en\n' +
        '  SEED_EMAIL / SEED_PASSWORD dentro de .env.\n',
    )
    process.exit(1)
  }

  console.log('→ Leyendo referencias…')
  const productsSnap = await getDocs(collection(db, 'products'))
  console.log(`  ${productsSnap.size} referencias.`)

  // Los batches de Firestore admiten hasta 500 operaciones; agrupamos en tandas.
  let batch = writeBatch(db)
  let ops = 0
  let fixed = 0
  let alreadyOk = 0
  let variantsRead = 0

  for (const productDoc of productsSnap.docs) {
    const variantsSnap = await getDocs(collection(db, 'products', productDoc.id, 'variants'))
    variantsRead += variantsSnap.size

    let stock = 0
    const byLocation: Record<string, number> = {}
    for (const variantDoc of variantsSnap.docs) {
      const data = variantDoc.data()
      stock += Number(data.stock ?? 0)
      for (const [key, qty] of Object.entries(sanitize(data.stockByLocation))) {
        byLocation[key] = (byLocation[key] ?? 0) + qty
      }
    }
    // Un total que quedó en cero no debe dejar la clave colgando en el mapa.
    for (const key of Object.keys(byLocation)) if (byLocation[key] === 0) delete byLocation[key]

    const current = productDoc.data()
    const currentStock = typeof current.stock === 'number' ? current.stock : null
    const currentByLocation = sanitize(current.stockByLocation)
    if (currentStock === stock && sameMap(currentByLocation, byLocation)) {
      alreadyOk++
      continue
    }

    // `update` y no `set`: el resumen se agrega al documento existente sin
    // arriesgar ningún otro campo de la referencia (precio, costo, nombre).
    batch.update(productDoc.ref, { stock, stockByLocation: byLocation })
    ops++
    fixed++
    const sku = String(current.sku ?? productDoc.id)
    const was = currentStock === null ? 'sin calcular' : String(currentStock)
    console.log(`  · ${sku}: ${was} → ${stock} pares`)

    if (ops >= 450) {
      await batch.commit()
      batch = writeBatch(db)
      ops = 0
    }
  }

  if (ops > 0) await batch.commit()

  console.log('')
  console.log(`✓ Relleno completo.`)
  console.log(`  ${fixed} referencias corregidas, ${alreadyOk} ya estaban al día.`)
  console.log(`  Costo: ${productsSnap.size + variantsRead} lecturas, ${fixed} escrituras.`)
  if (fixed === 0) {
    console.log('  El resumen está cuadrado con las tallas.')
  } else {
    console.log('  Vuelve a correrlo con nadie operando: debe decir 0 corregidas.')
  }
  process.exit(0)
}

main().catch((err) => {
  console.error('\n✗ Falló el relleno:', err)
  process.exit(1)
})
