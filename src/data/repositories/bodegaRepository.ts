/**
 * Bodegas: almacenes que se crean y administran desde Configuración. Cada una
 * lleva su propio stock (en `Variant.stockByLocation`) y una lista de usuarios
 * autorizados a operarla (salidas / retornos).
 */

import {
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase/firestore'
import { bodegasRef } from '../paths'
import { bodegaFromDoc, bodegaToDoc } from '../converters'
import type { Bodega, BodegaId } from '@/domain/models'
import { DEMO } from '@/config'
import { demoBackend } from '../demoBackend'

export const bodegaRepository = {
  /** Todas las bodegas, ordenadas por código. */
  async list(): Promise<Bodega[]> {
    if (DEMO) return demoBackend.listBodegas()
    const snap = await getDocs(query(bodegasRef(), orderBy('code')))
    return snap.docs.map((d) => bodegaFromDoc(d as QueryDocumentSnapshot<DocumentData>))
  },

  /** Suscripción en vivo (para Configuración y la vista de bodega). */
  subscribe(onChange: (bodegas: Bodega[]) => void): () => void {
    if (DEMO) return demoBackend.subscribeBodegas(onChange)
    return onSnapshot(query(bodegasRef(), orderBy('code')), (snap) => {
      onChange(snap.docs.map((d) => bodegaFromDoc(d as QueryDocumentSnapshot<DocumentData>)))
    })
  },

  async create(input: { code: string; name: string }): Promise<BodegaId> {
    if (DEMO) return demoBackend.createBodega(input)
    const ref = doc(bodegasRef())
    await setDoc(
      ref,
      bodegaToDoc({
        code: input.code.trim(),
        name: input.name.trim() || input.code.trim(),
        active: true,
        createdAt: new Date(),
      }),
    )
    return ref.id as BodegaId
  },
}
