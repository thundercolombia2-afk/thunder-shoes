/**
 * RELLENO de `returnedQty` en las entregas (salidas de bodega).
 *
 * Desde este cambio, cada retorno a bodega se reparte contra sus entregas al
 * registrarse y suma `returnedQty` en cada una (ver `allocateReturn`). Los
 * retornos VIEJOS no lo hicieron: este script recorre el libro mayor en orden
 * cronológico, reparte cada retorno viejo con la MISMA función que usa la app
 * y deja en cada entrega cuántos pares suyos ya volvieron a bodega. Los
 * retornos nuevos (los que ya traen `deliveryAllocations`) se respetan hasta
 * donde caben en su entrega (ver "Autocorrector" abajo). Solo se corrige
 * `returnedQty`: el `deliveryAllocations` de un retorno es su rastro original y
 * no se reescribe.
 *
 * Por defecto NO ESCRIBE NADA: muestra qué entregas cambiarían. Para aplicar:
 *   npm run backfill:returns -- --write
 *
 * IDEMPOTENTE: escribe valores ABSOLUTOS recalculados desde el libro mayor, así
 * que correrlo otra vez corrige cualquier desvío en vez de duplicarlo. Por eso
 * también sirve de VERIFICADOR: si dice "0 por corregir", está cuadrado.
 *
 * Orden de puesta en marcha (IMPORTA):
 *   1. firebase deploy --only firestore:rules   ← la regla nueva deja a la
 *      dueña fijar `returnedQty` y a los retornos sumarlo.
 *   2. npm run backfill:returns                 ← revisar lo que propone.
 *   3. npm run backfill:returns -- --write
 *   4. Desplegar la app.
 *   5. npm run backfill:returns                 ← otra vez: debe decir 0. Si un
 *      retorno se registró con la app vieja entre 3 y 4, este paso lo reparte.
 *
 * Lecturas: cada corrida lee TODAS las salidas, ventas, devoluciones y retornos
 * del libro mayor. Antes de leer los CUENTA (casi gratis) y, si pasan de
 * 12.000, se detiene: tres corridas el mismo día podrían agotar las 50.000
 * lecturas del plan Spark y dejar el POS con errores. Con `--force` sigue igual.
 *
 * Seguro con la app en uso: cada entrega se escribe en una transacción que
 * comprueba que su `returnedQty` no cambió desde que se leyó; si un retorno se
 * registró mientras tanto, esa entrega se salta y se avisa para volver a correr.
 *
 * Autocorrector: si un reparto ya grabado (`deliveryAllocations`) no cabe en su
 * entrega —p. ej. un retorno registrado con la app nueva ANTES del relleno—, lo
 * que sobra se vuelve a repartir con la misma regla en vez de perderse.
 *
 * Usa el SDK cliente y las credenciales de .env igual que `seed.ts`: entra
 * con SEED_EMAIL / SEED_PASSWORD, que deben ser de la DUEÑA.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { initializeApp } from 'firebase/app'
import {
  collection,
  doc,
  getCountFromServer,
  getDocs,
  getFirestore,
  query,
  runTransaction,
  where,
  type DocumentData,
} from 'firebase/firestore'
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth'
import { allocateReturn } from '../src/domain/deliveries'

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
const WRITE = process.argv.includes('--write')
const FORCE = process.argv.includes('--force')
/** Por encima de esto, una corrida se come buena parte de las 50.000 lecturas diarias del plan Spark. */
const READ_BUDGET = 12000
const TYPES = ['salida', 'sale', 'return', 'retorno']

/** Lo mínimo de un asiento que necesita el reparto. */
interface Row {
  id: string
  type: string
  occurredAt: Date
  quantity: number
  variantId: string
  targetUserId: string
  fromLocation: string
  toLocation: string
  saleId: string
  deliveryId: string
  returnedQty: number
  productName: string
  size: string
  allocations: { deliveryId: string; quantity: number }[] | null
}

const toDate = (value: unknown): Date => {
  if (value && typeof value === 'object' && 'toDate' in value) return (value as { toDate: () => Date }).toDate()
  return new Date(String(value))
}

const toRow = (id: string, d: DocumentData): Row => ({
  id,
  type: String(d.type),
  occurredAt: toDate(d.occurredAt),
  quantity: Number(d.quantity ?? 0),
  variantId: String(d.variantId ?? ''),
  targetUserId: String(d.targetUserId ?? ''),
  fromLocation: String(d.fromLocation ?? ''),
  toLocation: String(d.toLocation ?? ''),
  saleId: String(d.saleId ?? id),
  deliveryId: String(d.deliveryId ?? ''),
  returnedQty: Number(d.returnedQty ?? 0),
  productName: String(d.snapshot?.productName ?? ''),
  size: String(d.snapshot?.size ?? ''),
  allocations: Array.isArray(d.deliveryAllocations)
    ? (d.deliveryAllocations as { deliveryId: unknown; quantity: unknown }[]).map((a) => ({
        deliveryId: String(a.deliveryId),
        quantity: Number(a.quantity),
      }))
    : null,
})

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

  console.log('→ Contando…')
  let total = 0
  for (const type of TYPES) {
    const count = (await getCountFromServer(query(collection(db, 'movements'), where('type', '==', type)))).data().count
    console.log(`  ${type}: ${count}`)
    total += count
  }
  console.log(`  Esta corrida leerá ${total} documentos.`)
  if (total > READ_BUDGET && !FORCE) {
    console.error(
      `\n✗ Son más de ${READ_BUDGET} lecturas. Con el plan Spark (50.000/día) conviene hacer una sola` +
        '\n  corrida por día. Si estás de acuerdo, repite con --force.\n',
    )
    process.exit(1)
  }

  console.log('→ Leyendo salidas, ventas, devoluciones y retornos…')
  const rows: Row[] = []
  for (const type of TYPES) {
    const snap = await getDocs(query(collection(db, 'movements'), where('type', '==', type)))
    console.log(`  ${type}: ${snap.size}`)
    snap.docs.forEach((d) => rows.push(toRow(d.id, d.data())))
  }
  rows.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || a.id.localeCompare(b.id))

  // ── Recorrido cronológico ──────────────────────────────────────────────────
  const deliveries = new Map<string, Row & { returned: number; sold: number }>()
  /** venta (saleId:variante) → entrega de la que se cobró. */
  const deliveryBySaleLine = new Map<string, string>()
  let unallocated = 0

  // Todas las salidas se cargan ANTES del recorrido: `occurredAt` lo pone el
  // reloj del dispositivo, y un retorno con la hora atrasada podría quedar
  // antes que su propia entrega y perder su reparto grabado.
  for (const r of rows) if (r.type === 'salida') deliveries.set(r.id, { ...r, returned: 0, sold: 0 })

  for (const r of rows) {
    if (r.type === 'salida') {
      continue
    } else if (r.type === 'sale' && r.deliveryId) {
      const d = deliveries.get(r.deliveryId)
      if (d) d.sold += r.quantity
      deliveryBySaleLine.set(`${r.saleId}:${r.variantId}`, r.deliveryId)
    } else if (r.type === 'return') {
      const deliveryId = deliveryBySaleLine.get(`${r.saleId}:${r.variantId}`)
      const d = deliveryId ? deliveries.get(deliveryId) : undefined
      if (d) d.sold -= r.quantity
    } else if (r.type === 'retorno') {
      // Igual que la app: sin encargado o sin local de origen no hay a qué
      // entrega amarrarlo.
      if (!r.targetUserId || !r.fromLocation) {
        unallocated += r.quantity
        continue
      }
      let placed = 0
      // Reparto ya grabado por la app: se respeta, pero solo hasta donde cabe.
      for (const a of r.allocations ?? []) {
        const d = deliveries.get(a.deliveryId)
        if (!d) continue
        const take = Math.min(a.quantity, Math.max(0, d.quantity - d.returned))
        d.returned += take
        placed += take
      }
      // Lo que falta (retorno viejo, o reparto grabado que no cabía) se reparte
      // igual que lo haría la app hoy.
      if (placed < r.quantity) {
        const candidates = [...deliveries.values()]
          .filter(
            (d) =>
              d.variantId === r.variantId &&
              d.targetUserId === r.targetUserId &&
              d.toLocation === r.fromLocation &&
              // Solo entregas que ya existían cuando se registró el retorno.
              d.occurredAt.getTime() <= r.occurredAt.getTime(),
          )
          .map((d) => ({ id: d.id, occurredAt: d.occurredAt, quantity: d.quantity, returnedQty: d.returned, soldQty: d.sold }))
        for (const a of allocateReturn(r.quantity - placed, candidates)) {
          const d = deliveries.get(a.deliveryId)
          if (!d) continue
          d.returned += a.quantity
          placed += a.quantity
        }
      }
      if (placed < r.quantity) unallocated += r.quantity - placed
    }
  }

  // ── Qué cambia ─────────────────────────────────────────────────────────────
  const changes = [...deliveries.values()].filter((d) => Math.min(d.returned, d.quantity) !== d.returnedQty)
  console.log(`\n${deliveries.size} entregas revisadas · ${changes.length} por corregir.`)
  for (const d of changes.slice(0, 50)) {
    console.log(
      `  ${d.occurredAt.toISOString().slice(0, 10)} ${d.productName} T${d.size} · entregados ${d.quantity}` +
        ` · retornados ${d.returnedQty} → ${Math.min(d.returned, d.quantity)}  (${d.id})`,
    )
  }
  if (changes.length > 50) console.log(`  … y ${changes.length - 50} más.`)
  if (unallocated > 0) {
    console.log(
      `\nℹ ${unallocated} pares retornados no calzan con ninguna entrega (llegaron al local por otra vía).` +
        ' No se asignan a nadie.',
    )
  }

  if (!WRITE) {
    console.log('\nModo prueba: no se escribió nada. Para aplicar: npm run backfill:returns -- --write\n')
    return
  }

  // Una transacción por entrega: si su `returnedQty` cambió desde que se leyó
  // (un retorno registrado mientras corría el script), no se pisa.
  let written = 0
  let skipped = 0
  for (const d of changes) {
    const ok = await runTransaction(db, async (tx) => {
      const ref = doc(db, 'movements', d.id)
      const snap = await tx.get(ref)
      if (!snap.exists() || Number(snap.data().returnedQty ?? 0) !== d.returnedQty) return false
      tx.update(ref, { returnedQty: Math.min(d.returned, d.quantity) })
      return true
    })
    if (ok) written++
    else skipped++
  }
  console.log(`\n✓ ${written} entregas actualizadas.`)
  if (skipped > 0) {
    console.log(`ℹ ${skipped} cambiaron mientras corría (se registró un retorno): vuelve a correr el script.`)
  }
  console.log('')
}

main()
  .then(() => process.exit(0))
  .catch((e: unknown) => {
    console.error('\n✗ Falló el relleno:', e)
    process.exit(1)
  })
