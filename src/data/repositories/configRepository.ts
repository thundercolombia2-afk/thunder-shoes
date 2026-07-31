/**
 * Configuración global de la plataforma.
 *
 * Por ahora guarda la CONTRASEÑA COMPARTIDA para ingresar mercancía a una
 * bodega: cualquiera que la sepa puede registrar entradas. Es un PIN operativo,
 * no una credencial fuerte — se guarda tal cual en un documento que el cliente
 * puede leer. Ocultarla de verdad exigiría verificarla en el servidor (Cloud
 * Functions), fuera del alcance actual. La escritura sí queda restringida a
 * socios por las reglas de Firestore.
 */

import { Timestamp, getDoc, setDoc } from 'firebase/firestore'
import { systemConfigRef } from '../paths'
import { DEMO } from '@/config'
import { demoBackend } from '../demoBackend'

export const configRepository = {
  async getEntryPassword(): Promise<string> {
    if (DEMO) return demoBackend.getEntryPassword()
    const snap = await getDoc(systemConfigRef())
    return snap.exists() ? String(snap.data().entryPassword ?? '') : ''
  },

  async setEntryPassword(password: string): Promise<void> {
    if (DEMO) return demoBackend.setEntryPassword(password)
    await setDoc(
      systemConfigRef(),
      { entryPassword: password, updatedAt: Timestamp.now() },
      { merge: true },
    )
  },

  async verifyEntryPassword(password: string): Promise<boolean> {
    const stored = await this.getEntryPassword()
    // Sin contraseña configurada, la entrada queda abierta (no bloquea el arranque).
    if (!stored) return true
    return password === stored
  },

  // ── PIN de autorización para acciones destructivas ──────────────────────────
  // Dar de baja stock y eliminar referencias/tallas. Mismo modelo que el PIN de
  // entrada: un freno operativo guardado en claro, no una credencial fuerte. La
  // escritura la restringen las reglas a la dueña; la verificación es en cliente.

  async getAuthPin(): Promise<string> {
    if (DEMO) return demoBackend.getAuthPin()
    const snap = await getDoc(systemConfigRef())
    return snap.exists() ? String(snap.data().authPin ?? '') : ''
  },

  async setAuthPin(pin: string): Promise<void> {
    if (DEMO) return demoBackend.setAuthPin(pin)
    await setDoc(systemConfigRef(), { authPin: pin, updatedAt: Timestamp.now() }, { merge: true })
  },

  /** ¿Está configurado el PIN? Si no, las acciones destructivas no lo piden. */
  async hasAuthPin(): Promise<boolean> {
    return (await this.getAuthPin()).length > 0
  },

  async verifyAuthPin(pin: string): Promise<boolean> {
    const stored = await this.getAuthPin()
    // Sin PIN configurado, no se exige (no bloquea a quien aún no lo definió).
    if (!stored) return true
    return pin === stored
  },
}
