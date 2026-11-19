import { PGlite, type Transaction } from '@electric-sql/pglite'
import shim from '../../supabase/migrations/0000_supabase_shim.sql?raw'
import schema from '../../supabase/migrations/0001_schema.sql?raw'
import rls from '../../supabase/migrations/0002_rls.sql?raw'
import triggers from '../../supabase/migrations/0003_triggers_and_reports.sql?raw'
import { seedSql } from './seed'

export const MIGRATIONS = [
  ['0000_supabase_shim', shim],
  ['0001_schema', schema],
  ['0002_rls', rls],
  ['0003_triggers_and_reports', triggers],
] as const

export async function createDb(opts: { seed?: boolean; today?: Date } = {}) {
  const db = await PGlite.create()
  for (const [, sql] of MIGRATIONS) await db.exec(sql)
  if (opts.seed !== false) await db.exec(seedSql(opts.today))
  return db
}

/**
 * Run fn the way a Supabase request would: role `authenticated`, JWT claims
 * set for the transaction only. Nothing leaks into the next call.
 */
export async function asUser<T>(db: PGlite, userId: string | null, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.exec(userId ? 'set local role authenticated' : 'set local role anon')
    await tx.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify(userId ? { sub: userId, role: 'authenticated' } : { role: 'anon' }),
    ])
    return fn(tx)
  })
}
