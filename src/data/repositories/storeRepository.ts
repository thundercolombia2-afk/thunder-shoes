import { getDocs, orderBy, query, where } from 'firebase/firestore'
import { storesRef } from '../paths'
import { storeFromDoc } from '../converters'
import { DEMO } from '@/config'
import { demoBackend } from '../demoBackend'
import type { Store } from '@/domain/models'

export const storeRepository = {
  async listActive(): Promise<Store[]> {
    if (DEMO) return demoBackend.listStores()
    const snap = await getDocs(query(storesRef(), where('active', '==', true), orderBy('code')))
    return snap.docs.map(storeFromDoc)
  },
}
