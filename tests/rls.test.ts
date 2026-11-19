import { beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb } from '../src/db/client'
import { AGENCIES, USERS } from '../src/db/seed'
import { count, probe } from './helpers'

const H = AGENCIES.harbor.id
const S = AGENCIES.summit.id
const TENANT_TABLES = ['clients', 'job_orders', 'candidates', 'submissions', 'stage_events']

let db: PGlite
const totals: Record<string, Record<string, number>> = {}

beforeAll(async () => {
  db = await createDb({ today: new Date('2026-11-19T12:00:00Z') })
  for (const t of TENANT_TABLES) {
    const r = await db.query<{ agency_id: string; n: number }>(
      `select agency_id, count(*)::int n from public.${t} group by agency_id`)
    totals[t] = Object.fromEntries(r.rows.map((x) => [x.agency_id, x.n]))
  }
})

describe('seed', () => {
  it('has data in both agencies, so the isolation tests mean something', () => {
    for (const t of TENANT_TABLES) {
      expect(totals[t][H], t).toBeGreaterThan(0)
      expect(totals[t][S], t).toBeGreaterThan(0)
    }
  })
})

describe('tenant isolation on reads', () => {
  it.each(TENANT_TABLES)('%s: Ava (Harbor owner) sees exactly the Harbor rows', async (t) => {
    const n = await probe(db, USERS.ava.id, (tx) => count(tx, `select 1 from public.${t}`))
    expect(n).toBe(totals[t][H])
  })

  it.each(TENANT_TABLES)('%s: Dev (Summit owner) sees exactly the Summit rows', async (t) => {
    const n = await probe(db, USERS.dev.id, (tx) => count(tx, `select 1 from public.${t}`))
    expect(n).toBe(totals[t][S])
  })

  it('a filter on another agency returns nothing, not an error', async () => {
    const n = await probe(db, USERS.ava.id, (tx) => count(tx, 'select 1 from public.candidates where agency_id = $1', [S]))
    expect(n).toBe(0)
  })

  it('Ben belongs to both agencies and sees both', async () => {
    const n = await probe(db, USERS.ben.id, (tx) => count(tx, 'select 1 from public.candidates'))
    expect(n).toBe(totals.candidates[H] + totals.candidates[S])
  })

  it('a signed-in user with no membership sees nothing anywhere', async () => {
    for (const t of [...TENANT_TABLES, 'agencies', 'memberships', 'submission_rates']) {
      const n = await probe(db, USERS.eli.id, (tx) => count(tx, `select 1 from public.${t}`))
      expect(n, t).toBe(0)
    }
  })

  it('anon cannot touch the schema at all', async () => {
    await expect(probe(db, null, (tx) => tx.query('select * from public.candidates'))).rejects.toThrow(/permission denied/)
  })

  it('profiles: Cara sees her Harbor colleagues but not Dev at Summit', async () => {
    const names = await probe(db, USERS.cara.id, async (tx) =>
      (await tx.query<{ full_name: string }>('select full_name from public.profiles order by 1')).rows.map((r) => r.full_name))
    expect(names).toEqual([USERS.ava.name, USERS.ben.name, USERS.cara.name])
  })
})

describe('roles on writes', () => {
  it('a viewer reads the pipeline but gets zero pay rates', async () => {
    const [subs, rates] = await probe(db, USERS.cara.id, async (tx) => [
      await count(tx, 'select 1 from public.submissions'),
      await count(tx, 'select 1 from public.submission_rates'),
    ])
    expect(subs).toBe(totals.submissions[H])
    expect(rates).toBe(0)
  })

  it('a viewer cannot insert', async () => {
    await expect(probe(db, USERS.cara.id, (tx) => tx.query(
      `insert into public.candidates (agency_id, full_name, email) values ($1, 'X', 'x@x.test')`, [H],
    ))).rejects.toThrow(/row-level security/)
  })

  it('a viewer\'s update silently matches zero rows', async () => {
    const affected = await probe(db, USERS.cara.id, async (tx) =>
      (await tx.query(`update public.submissions set stage = 'placed' where agency_id = $1`, [H])).affectedRows)
    expect(affected).toBe(0)
  })

  it('Ben is a recruiter at Harbor but a viewer at Summit', async () => {
    const [harbor, summit] = await probe(db, USERS.ben.id, async (tx) => [
      (await tx.query(`update public.candidates set skills = skills where agency_id = $1`, [H])).affectedRows,
      (await tx.query(`update public.candidates set skills = skills where agency_id = $1`, [S])).affectedRows,
    ])
    expect(harbor).toBe(totals.candidates[H])
    expect(summit).toBe(0)
  })

  it('a recruiter can write but not delete', async () => {
    const deleted = await probe(db, USERS.ben.id, async (tx) =>
      (await tx.query(`delete from public.candidates where agency_id = $1`, [H])).affectedRows)
    expect(deleted).toBe(0)
  })

  it('an owner cannot write into another agency', async () => {
    await expect(probe(db, USERS.ava.id, (tx) => tx.query(
      `insert into public.candidates (agency_id, full_name, email) values ($1, 'X', 'x@x.test')`, [S],
    ))).rejects.toThrow(/row-level security/)
  })

  it('an owner cannot move a row into another agency', async () => {
    await expect(probe(db, USERS.ava.id, (tx) => tx.query(
      `update public.clients set agency_id = $2 where agency_id = $1`, [H, S],
    ))).rejects.toThrow(/row-level security|foreign key/)
  })
})

describe('database-level guarantees (hold even without RLS)', () => {
  it('a submission cannot point at another agency\'s candidate, even as superuser', async () => {
    const order = (await db.query<{ id: string }>('select id from public.job_orders where agency_id = $1 limit 1', [H])).rows[0].id
    const cand = (await db.query<{ id: string }>('select id from public.candidates where agency_id = $1 limit 1', [S])).rows[0].id
    await expect(db.query(
      'insert into public.submissions (agency_id, job_order_id, candidate_id) values ($1, $2, $3)', [H, order, cand],
    )).rejects.toThrow(/foreign key/)
  })

  it('every stage change is logged with the actor from the JWT', async () => {
    const ev = await probe(db, USERS.ben.id, async (tx) => {
      const sub = (await tx.query<{ id: string }>(
        `select id from public.submissions where agency_id = $1 and stage = 'screen' limit 1`, [H])).rows[0].id
      await tx.query(`update public.submissions set stage = 'submitted' where id = $1`, [sub])
      return (await tx.query<{ from_stage: string; to_stage: string; actor_id: string }>(
        'select from_stage, to_stage, actor_id from public.stage_events where submission_id = $1 order by id desc limit 1', [sub])).rows[0]
    })
    expect(ev).toEqual({ from_stage: 'screen', to_stage: 'submitted', actor_id: USERS.ben.id })
  })

  it('nobody can forge history by inserting events directly', async () => {
    await expect(probe(db, USERS.ava.id, (tx) => tx.query(
      `insert into public.stage_events (agency_id, submission_id, to_stage) select agency_id, id, 'placed' from public.submissions limit 1`,
    ))).rejects.toThrow(/permission denied/)
  })

  it('the last owner cannot demote or remove themself', async () => {
    await expect(probe(db, USERS.ava.id, (tx) => tx.query(
      `update public.memberships set role = 'recruiter' where agency_id = $1 and user_id = $2`, [H, USERS.ava.id],
    ))).rejects.toThrow(/at least one owner/)
  })

  it('deleting an agency cascades cleanly despite the owner rule', async () => {
    await db.transaction(async (tx) => {
      await tx.query('delete from public.agencies where id = $1', [S])
      const n = (await tx.query<{ n: number }>('select count(*)::int n from public.candidates where agency_id = $1', [S])).rows[0].n
      expect(n).toBe(0)
      await tx.rollback()
    })
  })
})

describe('membership management', () => {
  it('an owner can add a member, a recruiter cannot', async () => {
    const added = await probe(db, USERS.ava.id, async (tx) =>
      (await tx.query(`insert into public.memberships values ($1, $2, 'recruiter')`, [H, USERS.eli.id])).affectedRows)
    expect(added).toBe(1)
    await expect(probe(db, USERS.ben.id, (tx) => tx.query(
      `insert into public.memberships values ($1, $2, 'recruiter')`, [H, USERS.eli.id],
    ))).rejects.toThrow(/row-level security/)
  })

  it('a new member sees the agency immediately', async () => {
    const n = await probe(db, USERS.ava.id, async (tx) => {
      await tx.query(`insert into public.memberships values ($1, $2, 'viewer')`, [H, USERS.eli.id])
      await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: USERS.eli.id })])
      return count(tx, 'select 1 from public.candidates')
    })
    expect(n).toBe(totals.candidates[H])
  })
})

describe('reports', () => {
  it('margin report works for an owner and refuses a viewer', async () => {
    const rows = await probe(db, USERS.ava.id, async (tx) => (await tx.query('select * from public.margin_report($1)', [H])).rows)
    expect(rows.length).toBeGreaterThan(0)
    await expect(probe(db, USERS.cara.id, (tx) => tx.query('select * from public.margin_report($1)', [H])))
      .rejects.toThrow(/owner or recruiter/)
  })

  it('margin report refuses an agency you do not belong to', async () => {
    await expect(probe(db, USERS.ava.id, (tx) => tx.query('select * from public.margin_report($1)', [S])))
      .rejects.toThrow(/owner or recruiter/)
  })

  it('the KPI view only returns agencies the caller belongs to', async () => {
    const ids = await probe(db, USERS.dev.id, async (tx) =>
      (await tx.query<{ agency_id: string }>('select agency_id from public.agency_kpis')).rows.map((r) => r.agency_id))
    expect(ids).toEqual([S])
  })

  it('every policy wraps auth.uid() lookups in a sub-select (evaluated once per query)', async () => {
    const r = await db.query<{ tablename: string; policyname: string; expr: string }>(`
      select tablename, policyname, coalesce(qual, '') || ' ' || coalesce(with_check, '') expr
      from pg_policies where schemaname = 'public'`)
    expect(r.rows.length).toBeGreaterThan(20)
    for (const p of r.rows) {
      expect(p.expr, `${p.tablename}.${p.policyname}`).not.toMatch(/(?<!SELECT )private\.\w+\(agency_id\)/)
    }
  })
})
