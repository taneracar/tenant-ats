// Deterministic demo data: same seed, same rows, so tests and the demo agree.
// Runs as the database owner (RLS does not apply), with triggers off so the
// stage history can be written with realistic past timestamps.

export const USERS = {
  ava: { id: '00000000-0000-4000-8000-0000000000a1', name: 'Ava Martinez', email: 'ava@harbor.test' },
  ben: { id: '00000000-0000-4000-8000-0000000000b2', name: 'Ben Okafor', email: 'ben@harbor.test' },
  cara: { id: '00000000-0000-4000-8000-0000000000c3', name: 'Cara Nguyen', email: 'cara@client.test' },
  dev: { id: '00000000-0000-4000-8000-0000000000d4', name: 'Dev Patel', email: 'dev@summit.test' },
  eli: { id: '00000000-0000-4000-8000-0000000000e5', name: 'Eli Brooks', email: 'eli@new.test' },
} as const

export const AGENCIES = {
  harbor: { id: '10000000-0000-4000-8000-000000000001', name: 'Harbor Staffing' },
  summit: { id: '20000000-0000-4000-8000-000000000002', name: 'Summit Talent' },
} as const

export const MEMBERSHIPS: Array<[keyof typeof AGENCIES, keyof typeof USERS, 'owner' | 'recruiter' | 'viewer']> = [
  ['harbor', 'ava', 'owner'],
  ['harbor', 'ben', 'recruiter'],
  ['harbor', 'cara', 'viewer'],
  ['summit', 'dev', 'owner'],
  ['summit', 'ben', 'viewer'],
]

const STAGES = ['sourced', 'screen', 'submitted', 'interview', 'offer', 'placed'] as const

const CLIENTS: Record<keyof typeof AGENCIES, string[]> = {
  harbor: ['Pacific Coast Logistics', 'Newport Dental Group', 'Bayview Health', 'Irvine Robotics'],
  summit: ['Canyon Credit Union', 'Saddleback Builders', 'Orchard Foods', 'Laguna Media'],
}
const TITLES = [
  ['Warehouse Associate', 26], ['Forklift Operator', 31], ['Dental Assistant', 34],
  ['Medical Receptionist', 29], ['Payroll Specialist', 42], ['Staff Accountant', 55],
  ['Help Desk Technician', 38], ['Project Coordinator', 45], ['Electrician', 52],
  ['Customer Service Rep', 27], ['QA Inspector', 36], ['Marketing Coordinator', 40],
] as const
const CITIES = ['Costa Mesa', 'Irvine', 'Newport Beach', 'Santa Ana', 'Anaheim', 'Tustin', 'Long Beach']
const FIRST = ['Maya', 'Luis', 'Grace', 'Omar', 'Hana', 'Jonah', 'Priya', 'Mateo', 'Zoe', 'Kenji', 'Leila',
  'Andre', 'Sofia', 'Noah', 'Amara', 'Ethan', 'Ines', 'Caleb', 'Yara', 'Felix']
const LAST = ['Rivera', 'Kim', 'Haddad', 'Lopez', 'Chen', 'Walker', 'Singh', 'Torres', 'Park', 'Reyes',
  'Novak', 'Ali', 'Baker', 'Silva', 'Ito', 'Moreno']
const SKILLS = ['forklift', 'osha-10', 'excel', 'quickbooks', 'bilingual', 'epic-ehr', 'cpr', 'sap',
  'customer-service', 'scheduling', 'adp', 'salesforce', 'blueprints', 'windows-support']

function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// uuid v4-shaped, derived from a counter so ids are stable across runs
function idFactory(prefix: number) {
  let n = 0
  return () => {
    n++
    const hex = n.toString(16).padStart(12, '0')
    return `${prefix.toString(16).padStart(8, '0')}-0000-4000-8000-${hex}`
  }
}

const q = (s: string) => `'${s.replace(/'/g, "''")}'`

export function seedSql(today = new Date(), seed = 42): string {
  const rand = mulberry32(seed)
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)]
  const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1))
  const day = 86_400_000
  const out: string[] = ['set session_replication_role = replica;']

  for (const u of Object.values(USERS)) {
    out.push(`insert into auth.users (id, email) values (${q(u.id)}, ${q(u.email)});`)
    out.push(`insert into public.profiles (id, full_name) values (${q(u.id)}, ${q(u.name)});`)
  }
  for (const a of Object.values(AGENCIES)) {
    out.push(`insert into public.agencies (id, name) values (${q(a.id)}, ${q(a.name)});`)
  }
  for (const [a, u, role] of MEMBERSHIPS) {
    out.push(`insert into public.memberships values (${q(AGENCIES[a].id)}, ${q(USERS[u].id)}, ${q(role)});`)
  }

  let agencyNo = 0
  for (const key of Object.keys(AGENCIES) as Array<keyof typeof AGENCIES>) {
    agencyNo++
    const agency = AGENCIES[key].id
    const nextId = idFactory(0xa0000000 + agencyNo * 0x1000000)
    const recruiter = key === 'harbor' ? [USERS.ava.id, USERS.ben.id] : [USERS.dev.id]

    const clientIds = CLIENTS[key].map((name) => {
      const id = nextId()
      out.push(`insert into public.clients (id, agency_id, name) values (${q(id)}, ${q(agency)}, ${q(name)});`)
      return id
    })

    const orders = Array.from({ length: 9 }, () => {
      const id = nextId()
      const [title, base] = pick(TITLES)
      const bill = Math.round((base * (1.3 + rand() * 0.25)) * 100) / 100
      const openedAgo = int(12, 95)
      const opened = new Date(today.getTime() - openedAgo * day)
      out.push(`insert into public.job_orders (id, agency_id, client_id, title, location, openings, bill_rate, status, opened_on)
        values (${q(id)}, ${q(agency)}, ${q(pick(clientIds))}, ${q(title)}, ${q(pick(CITIES))}, ${int(1, 4)}, ${bill}, 'open', ${q(opened.toISOString().slice(0, 10))});`)
      return { id, bill, opened, openedAgo }
    })

    const candidates = Array.from({ length: 36 }, (_, i) => {
      const id = nextId()
      const first = pick(FIRST), last = pick(LAST)
      const skills = Array.from(new Set([pick(SKILLS), pick(SKILLS), pick(SKILLS)]))
      out.push(`insert into public.candidates (id, agency_id, full_name, email, skills)
        values (${q(id)}, ${q(agency)}, ${q(`${first} ${last}`)}, ${q(`${first}.${last}.${i}@mail.test`.toLowerCase())}, ${q(`{${skills.join(',')}}`)});`)
      return id
    })

    const used = new Set<string>()
    for (let i = 0; i < 58; i++) {
      const order = pick(orders), cand = pick(candidates)
      if (used.has(order.id + cand)) continue
      used.add(order.id + cand)
      const id = nextId()
      // skewed funnel: most candidates stall early
      const r = rand()
      const reached = r < 0.25 ? 0 : r < 0.45 ? 1 : r < 0.62 ? 2 : r < 0.78 ? 3 : r < 0.86 ? 4 : 5
      const rejected = reached < 5 && rand() < 0.3
      const stage = rejected ? 'rejected' : STAGES[reached]

      // walk the stages forward in time, never past today
      let t = order.opened.getTime() + int(1, 6) * day
      const events: Array<[string | null, string, number]> = []
      let prev: string | null = null
      for (let s = 0; s <= reached; s++) {
        events.push([prev, STAGES[s], Math.min(t, today.getTime() - 3600_000)])
        prev = STAGES[s]
        t += int(1, 9) * day
      }
      if (rejected) events.push([prev, 'rejected', Math.min(t, today.getTime() - 3600_000)])
      const last = events[events.length - 1][2]
      const owner = pick(recruiter)

      out.push(`insert into public.submissions (id, agency_id, job_order_id, candidate_id, stage, recruiter_id, updated_at)
        values (${q(id)}, ${q(agency)}, ${q(order.id)}, ${q(cand)}, ${q(stage)}, ${q(owner)}, ${q(new Date(last).toISOString())});`)
      const pay = Math.round(order.bill * (0.62 + rand() * 0.16) * 100) / 100
      out.push(`insert into public.submission_rates values (${q(id)}, ${q(agency)}, ${pay});`)
      for (const [from, to, at] of events) {
        out.push(`insert into public.stage_events (agency_id, submission_id, from_stage, to_stage, actor_id, at)
          values (${q(agency)}, ${q(id)}, ${from ? q(from) : 'null'}, ${q(to)}, ${q(owner)}, ${q(new Date(at).toISOString())});`)
      }
    }
    out.push(`update public.job_orders j set status = 'filled' where agency_id = ${q(agency)}
      and (select count(*) from public.submissions s where s.job_order_id = j.id and s.stage = 'placed') >= j.openings;`)
  }

  out.push('set session_replication_role = origin;')
  return out.join('\n')
}
