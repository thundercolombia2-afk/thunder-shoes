/**
 * Egresos: gastos cargados A MANO por el administrador (arriendo, nómina,
 * servicios…). No salen de un movimiento de inventario. Solo se crean y se
 * leen; para corregir un error se registra otro egreso o lo borra la dueña.
 */

import { addDoc, onSnapshot, orderBy, query, Timestamp, type Unsubscribe } from 'firebase/firestore'
import { expensesRef } from '../paths'
import { expenseFromDoc } from '../converters'
import { toDayKey } from '@/lib/format'
import type { Expense, ExpenseDraft } from '@/domain/models'
import { DEMO } from '@/config'
import { demoBackend } from '../demoBackend'

/** Quién carga el egreso (persona real). */
export interface ExpenseActor {
  userId: string
  userName: string
}

export const expenseRepository = {
  /** Suscripción en vivo a los egresos, del más reciente al más antiguo. */
  subscribe(onChange: (expenses: Expense[]) => void, onError?: (e: unknown) => void): Unsubscribe {
    if (DEMO) return demoBackend.subscribeExpenses(onChange)
    return onSnapshot(
      query(expensesRef(), orderBy('occurredAt', 'desc')),
      (snap) => onChange(snap.docs.map(expenseFromDoc)),
      (error) => onError?.(error),
    )
  },

  /** Registra un egreso a nombre de quien lo carga. */
  async create(draft: ExpenseDraft, actor: ExpenseActor): Promise<void> {
    if (DEMO) return demoBackend.createExpense(draft, actor)
    await addDoc(expensesRef(), {
      concept: draft.concept,
      detail: draft.detail,
      quantity: draft.quantity,
      value: draft.value,
      occurredAt: Timestamp.fromDate(draft.occurredAt),
      dayKey: toDayKey(draft.occurredAt),
      userId: actor.userId,
      userName: actor.userName,
      createdAt: Timestamp.now(),
    })
  },
}
