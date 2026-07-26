import { getDocs } from 'firebase/firestore'
import { storesRef } from '../paths'
import { storeFromDoc } from '../converters'
import { DEMO } from '@/config'
import { demoBackend } from '../demoBackend'
import type { Store } from '@/domain/models'

export const storeRepository = {
  /**
   * Locales activos, ordenados por código.
   *
   * Se traen todos y se filtran/ordenan en memoria a propósito: son un puñado
   * de documentos, y combinar `where('active')` con `orderBy('code')` obligaría
   * a mantener un índice compuesto en Firestore sin ganar nada a esta escala.
   */
  async listActive(): Promise<Store[]> {
    if (DEMO) return demoBackend.listStores()
    const snap = await getDocs(storesRef())
    return snap.docs
      .map(storeFromDoc)
      .filter((store) => store.active)
      .sort((a, b) => a.code.localeCompare(b.code))
  },
}
