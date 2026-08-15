/**
 * Lectura de agregados para el dashboard.
 *
 * Nunca recorre `movements`. Los contadores los mantiene al día la misma
 * transacción que registra cada movimiento, así que pintar el dashboard
 * cuesta N lecturas por N días — constante, sin importar el volumen histórico.
 */

import { documentId, getDocs, query, where } from 'firebase/firestore'
import { collection } from 'firebase/firestore'
import { db } from '../firebase'
import { COLLECTIONS } from '../paths'
import { dailyStatsFromDoc, emptyDailyStats } from '../converters'
import type { DailyStats } from '@/domain/models'
import { recentDayKeys, toDayKey } from '@/lib/format'
import { DEMO } from '@/config'
import { demoBackend } from '../demoBackend'

export const statsRepository = {
  /** Stats de los últimos `days` días, incluyendo los días sin actividad. */
  async listRecentDays(days = 7): Promise<DailyStats[]> {
    if (DEMO) return demoBackend.listRecentDays(days)
    const keys = recentDayKeys(days)
    // `documentId() in [...]` admite hasta 30 ids: suficiente para un mes.
    const snap = await getDocs(
      query(collection(db, COLLECTIONS.dailyStats), where(documentId(), 'in', keys.slice(-30))),
    )
    const byKey = new Map(snap.docs.map((d) => [d.id, dailyStatsFromDoc(d)]))
    return keys.map((key) => byKey.get(key) ?? emptyDailyStats(key))
  },

  async getToday(): Promise<DailyStats> {
    const [today] = await this.listRecentDays(1)
    return today ?? emptyDailyStats(toDayKey(new Date()))
  },

  /**
   * Stats de un rango arbitrario (Desde/Hasta de Ingresos y egresos). A
   * diferencia de `listRecentDays`, no tiene tope de 30 días: es una consulta
   * por rango sobre el id del documento (el `dayKey`), no un `in` con la
   * lista completa. Solo trae los días con datos; los que faltan simplemente
   * no aportan al agregarlos, así que no hace falta rellenarlos.
   */
  async listRange(fromDayKey: string, toDayKey_: string): Promise<DailyStats[]> {
    if (DEMO) return demoBackend.listStatsRange(fromDayKey, toDayKey_)
    const snap = await getDocs(
      query(
        collection(db, COLLECTIONS.dailyStats),
        where(documentId(), '>=', fromDayKey),
        where(documentId(), '<=', toDayKey_),
      ),
    )
    return snap.docs.map(dailyStatsFromDoc)
  },
}
