import type { PGlite, Transaction } from '@electric-sql/pglite'
import { asUser } from '../src/db/client'

/** Run as a user, then roll back so tests never see each other's writes. */
export async function probe<T>(db: PGlite, userId: string | null, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  let result!: T
  await asUser(db, userId, async (tx) => {
    result = await fn(tx)
    await tx.rollback()
  })
  return result
}

export async function count(tx: Transaction, sql: string, params: unknown[] = []) {
  const r = await tx.query<{ n: number }>(`select count(*)::int as n from (${sql}) x`, params)
  return r.rows[0].n
}
