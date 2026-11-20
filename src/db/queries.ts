import type { PGlite } from '@electric-sql/pglite'
import { asUser } from './client'

export type Role = 'owner' | 'recruiter' | 'viewer'
export type Stage = 'sourced' | 'screen' | 'submitted' | 'interview' | 'offer' | 'placed' | 'rejected'
export const STAGES: Stage[] = ['sourced', 'screen', 'submitted', 'interview', 'offer', 'placed', 'rejected']

export type Membership = { agency_id: string; agency: string; role: Role }
export type Row = {
  id: string; candidate: string; skills: string[]; title: string; client: string; stage: Stage
  bill_rate: number; pay_rate: number | null; recruiter: string | null; updated_at: string
}
export type Kpis = { open_orders: number; active_pipeline: number; placements: number; interviewing: number; avg_days_to_fill: number | null }
export type MarginRow = { title: string; client: string; placements: number; avg_bill: number; avg_pay: number; margin_pct: number }

const num = (v: unknown) => (v == null ? null : Number(v))

export async function myMemberships(db: PGlite, user: string) {
  return asUser(db, user, async (tx) => (await tx.query<Membership>(`
    select m.agency_id, a.name agency, m.role from public.memberships m
    join public.agencies a on a.id = m.agency_id
    where m.user_id = auth.uid() order by a.name`)).rows)
}

export async function pipeline(db: PGlite, user: string, agency: string): Promise<Row[]> {
  return asUser(db, user, async (tx) => (await tx.query<Row>(`
    select s.id, c.full_name candidate, c.skills, j.title, cl.name client, s.stage,
           j.bill_rate, r.pay_rate, p.full_name recruiter, s.updated_at
    from public.submissions s
    join public.candidates c on c.id = s.candidate_id
    join public.job_orders j on j.id = s.job_order_id
    join public.clients cl on cl.id = j.client_id
    left join public.submission_rates r on r.submission_id = s.id
    left join public.profiles p on p.id = s.recruiter_id
    where s.agency_id = $1
    order by s.updated_at desc`, [agency])).rows.map((r) => ({
      ...r, bill_rate: Number(r.bill_rate), pay_rate: num(r.pay_rate),
    })))
}

export async function kpis(db: PGlite, user: string, agency: string): Promise<Kpis | null> {
  return asUser(db, user, async (tx) => {
    const r = (await tx.query<Kpis>('select * from public.agency_kpis where agency_id = $1', [agency])).rows[0]
    return r ? { ...r, open_orders: Number(r.open_orders), active_pipeline: Number(r.active_pipeline),
      placements: Number(r.placements), interviewing: Number(r.interviewing), avg_days_to_fill: num(r.avg_days_to_fill) } : null
  })
}

export async function margins(db: PGlite, user: string, agency: string): Promise<MarginRow[]> {
  return asUser(db, user, async (tx) => (await tx.query<MarginRow>(
    'select title, client, placements, avg_bill, avg_pay, margin_pct from public.margin_report($1)', [agency])).rows
    .map((r) => ({ ...r, placements: Number(r.placements), avg_bill: Number(r.avg_bill), avg_pay: Number(r.avg_pay), margin_pct: Number(r.margin_pct) })))
}

export async function setStage(db: PGlite, user: string, id: string, stage: Stage) {
  return asUser(db, user, async (tx) =>
    (await tx.query('update public.submissions set stage = $2 where id = $1', [id, stage])).affectedRows ?? 0)
}

export async function history(db: PGlite, user: string, id: string) {
  return asUser(db, user, async (tx) => (await tx.query<{ from_stage: Stage | null; to_stage: Stage; at: string; actor: string | null }>(`
    select e.from_stage, e.to_stage, e.at, p.full_name actor from public.stage_events e
    left join public.profiles p on p.id = e.actor_id
    where e.submission_id = $1 order by e.at, e.id`, [id])).rows)
}

export type RunResult = { ok: true; rows: Record<string, unknown>[]; affected?: number; ms: number } | { ok: false; error: string; code?: string; ms: number }

/** Free-form SQL as the current user. Always rolled back: the demo stays clean. */
export async function runAs(db: PGlite, user: string | null, sql: string): Promise<RunResult> {
  const t0 = performance.now()
  try {
    let rows: Record<string, unknown>[] = []
    let affected: number | undefined
    await asUser(db, user, async (tx) => {
      const res = await tx.exec(sql)
      const last = res[res.length - 1]
      rows = (last?.rows ?? []) as Record<string, unknown>[]
      affected = last?.affectedRows
      await tx.rollback()
    })
    return { ok: true, rows, affected, ms: performance.now() - t0 }
  } catch (e) {
    const err = e as { message?: string; code?: string }
    return { ok: false, error: err.message ?? String(e), code: err.code, ms: performance.now() - t0 }
  }
}
