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
}
