import { useCallback, useEffect, useState } from 'react'
import type { PGlite } from '@electric-sql/pglite'
import { createDb } from './db/client'
import { AGENCIES, USERS } from './db/seed'
import {
  history, kpis as loadKpis, margins as loadMargins, myMemberships, pipeline, setStage,
  type Kpis, type MarginRow, type Membership, type Row, type Stage,
} from './db/queries'
import { Pipeline } from './components/Pipeline'
import { RlsLab } from './components/RlsLab'
import { Card, money, RoleBadge, Stat, StagePill } from './components/ui'

type UserKey = keyof typeof USERS
type Tab = 'pipeline' | 'margins' | 'lab'

const PERSONAS: Record<UserKey, string> = {
  ava: 'Owns Harbor Staffing',
  ben: 'Recruiter at Harbor, viewer at Summit',
  cara: "Client's hiring manager, read-only",
  dev: 'Owns Summit Talent',
  eli: 'Signed up, no agency yet',
}

export function App() {
  const [db, setDb] = useState<PGlite | null>(null)
  const [bootMs, setBootMs] = useState(0)
  const [bootError, setBootError] = useState<string | null>(null)
  const [userKey, setUserKey] = useState<UserKey>('ava')
  const [memberships, setMemberships] = useState<Membership[]>([])
  const [agencyId, setAgencyId] = useState<string | null>(null)
  const [rows, setRows] = useState<Row[]>([])
  const [kpis, setKpis] = useState<Kpis | null>(null)
  const [margins, setMargins] = useState<MarginRow[] | string>([])
  const [tab, setTab] = useState<Tab>('pipeline')
  const [toast, setToast] = useState<string | null>(null)
  const [open, setOpen] = useState<{ row: Row; events: Awaited<ReturnType<typeof history>> } | null>(null)

  const user = USERS[userKey]

  useEffect(() => {
    const t0 = performance.now()
    createDb().then((d) => { setDb(d); setBootMs(performance.now() - t0) }).catch((e) => setBootError(String(e)))
  }, [])

  // who am I in which agencies
  useEffect(() => {
    if (!db) return
    myMemberships(db, user.id).then((m) => {
      setMemberships(m)
      setAgencyId((cur) => (m.some((x) => x.agency_id === cur) ? cur : m[0]?.agency_id ?? null))
    })
  }, [db, user.id])

  const membership = memberships.find((m) => m.agency_id === agencyId) ?? null
  const canWrite = membership?.role === 'owner' || membership?.role === 'recruiter'

  const refresh = useCallback(async () => {
    if (!db) return
    if (!agencyId) { setRows([]); setKpis(null); setMargins([]); return }
    const [r, k] = await Promise.all([pipeline(db, user.id, agencyId), loadKpis(db, user.id, agencyId)])
    setRows(r); setKpis(k)
    loadMargins(db, user.id, agencyId).then(setMargins).catch((e: Error) => setMargins(e.message))
  }, [db, user.id, agencyId])

  useEffect(() => { refresh() }, [refresh])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3500)
    return () => clearTimeout(t)
  }, [toast])

  const onStage = useCallback(async (id: string, stage: Stage) => {
    if (!db) return
    try {
      const n = await setStage(db, user.id, id, stage)
      setToast(n === 1 ? `Moved to ${stage}. Logged to history as ${user.name}.` : 'Update matched 0 rows (RLS).')
      await refresh()
    } catch (e) { setToast((e as Error).message) }
  }, [db, user, refresh])

  const onOpen = useCallback(async (row: Row) => {
    if (!db) return
    setOpen({ row, events: await history(db, user.id, row.id) })
  }, [db, user.id])

  if (bootError) return <Centered>Could not start Postgres in this browser: {bootError}</Centered>
  if (!db) return <Centered><span className="animate-pulse">Booting Postgres in your browser, applying migrations, seeding two agencies…</span></Centered>

  const other = agencyId === AGENCIES.summit.id ? AGENCIES.harbor : AGENCIES.summit

  return (
    <div className="mx-auto max-w-6xl px-4 pb-16">
      <header className="flex flex-wrap items-end justify-between gap-4 py-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">tenant-ats</h1>
          <p className="max-w-xl text-sm text-stone-500">
            A staffing-agency ATS where tenant isolation lives in Postgres row-level security, not in app code.
            The database is real Postgres running in this tab ({(bootMs / 1000).toFixed(1)}s to boot, migrate and seed).
          </p>
        </div>
        <a href="https://github.com/taneracar/tenant-ats" className="text-sm text-teal-700 hover:underline dark:text-teal-400">Source + tests ↗</a>
      </header>

      <Card className="mb-4 p-3">
        <div className="mb-2 text-xs font-medium text-stone-500">Signed in as (each switch changes the JWT <code>sub</code> Postgres sees)</div>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Signed-in user">
          {(Object.keys(USERS) as UserKey[]).map((k) => (
            <button key={k} role="radio" aria-checked={k === userKey} onClick={() => setUserKey(k)}
              className={`rounded-lg border px-3 py-1.5 text-left text-sm transition ${k === userKey
                ? 'border-teal-700 bg-teal-50 dark:border-teal-500 dark:bg-teal-950/40'
                : 'border-stone-200 hover:border-stone-400 dark:border-stone-700'}`}>
              <div className="font-medium">{USERS[k].name}</div>
              <div className="text-[11px] text-stone-500">{PERSONAS[k]}</div>
            </button>
          ))}
        </div>
        {memberships.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-stone-100 pt-3 text-sm dark:border-stone-800">
            <span className="text-xs text-stone-500">Agency</span>
            {memberships.map((m) => (
              <button key={m.agency_id} onClick={() => setAgencyId(m.agency_id)}
                className={`flex items-center gap-2 rounded-full px-3 py-1 ${m.agency_id === agencyId ? 'bg-stone-900 text-white dark:bg-white dark:text-stone-900' : 'hover:bg-stone-100 dark:hover:bg-stone-800'}`}>
                {m.agency} <RoleBadge role={m.role} />
              </button>
            ))}
          </div>
        )}
      </Card>

      {!membership ? (
        <Card className="p-6">
          <p className="font-medium">{user.name} belongs to no agency.</p>
          <p className="mt-1 text-sm text-stone-500">Every table returns zero rows for this user. The app does not filter anything; Postgres does. Try it in the console:</p>
          <div className="mt-4"><RlsLab db={db} user={user.id} userName={user.name} agency={AGENCIES.harbor.id} otherAgency={AGENCIES.harbor} /></div>
        </Card>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
            <Stat label="Open job orders" value={kpis?.open_orders ?? '—'} />
            <Stat label="Active pipeline" value={kpis?.active_pipeline ?? '—'} />
            <Stat label="Interviewing" value={kpis?.interviewing ?? '—'} />
            <Stat label="Placements" value={kpis?.placements ?? '—'} />
            <Stat label="Avg days to fill" value={kpis?.avg_days_to_fill ?? '—'} hint="order opened → placed event" />
          </div>

          <nav className="mb-3 flex gap-1 text-sm" role="tablist">
            {([['pipeline', 'Pipeline'], ['margins', 'Margins'], ['lab', 'RLS lab']] as const).map(([k, label]) => (
              <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
                className={`rounded-lg px-3 py-1.5 ${tab === k ? 'bg-white font-medium shadow-sm ring-1 ring-stone-200 dark:bg-stone-900 dark:ring-stone-700' : 'text-stone-500 hover:text-stone-900 dark:hover:text-white'}`}>
                {label}
              </button>
            ))}
          </nav>

          {tab === 'pipeline' && <Pipeline rows={rows} canWrite={canWrite} onStage={onStage} onOpen={onOpen} />}
          {tab === 'margins' && <Margins data={margins} />}
          {tab === 'lab' && <RlsLab db={db} user={user.id} userName={user.name} agency={agencyId!} otherAgency={other} />}
        </>
      )}

      {open && (
        <div className="fixed inset-0 z-10 flex justify-end bg-black/30" onClick={() => setOpen(null)}>
          <aside className="h-full w-full max-w-sm overflow-y-auto bg-white p-5 shadow-xl dark:bg-stone-900" onClick={(e) => e.stopPropagation()} aria-label="Submission history">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="font-semibold">{open.row.candidate}</h2>
                <p className="text-sm text-stone-500">{open.row.title} · {open.row.client}</p>
              </div>
              <button onClick={() => setOpen(null)} aria-label="Close" className="text-stone-400 hover:text-stone-900 dark:hover:text-white">✕</button>
            </div>
            <p className="mt-4 text-xs text-stone-500">Stage history. Written by a trigger, never by the client, so it cannot be forged.</p>
            <ol className="mt-3 space-y-3 border-l border-stone-200 pl-4 dark:border-stone-700">
              {open.events.map((e, i) => (
                <li key={i} className="text-sm">
                  <div className="flex items-center gap-2">{e.from_stage && <><StagePill stage={e.from_stage} /> →</>} <StagePill stage={e.to_stage} /></div>
                  <div className="mt-1 text-[11px] text-stone-500">{new Date(e.at).toLocaleString()} · {e.actor ?? 'system'}</div>
                </li>
              ))}
            </ol>
          </aside>
        </div>
      )}

      {toast && (
        <div role="status" className="fixed bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-lg bg-stone-900 px-4 py-2 text-sm text-white shadow-lg dark:bg-white dark:text-stone-900">
          {toast}
        </div>
      )}
    </div>
  )
}

function Margins({ data }: { data: MarginRow[] | string }) {
  if (typeof data === 'string') {
    return (
      <Card className="p-6">
        <p className="font-medium">The database refused this report.</p>
        <p className="mt-2 rounded bg-rose-50 px-3 py-2 font-mono text-[13px] text-rose-800 dark:bg-rose-950/50 dark:text-rose-300">{data}</p>
        <p className="mt-2 text-sm text-stone-500">Margins need pay rates, and pay rates are hidden from viewers by policy. The UI did not hide this tab; Postgres answered.</p>
      </Card>
    )
  }
  const max = Math.max(...data.map((d) => d.margin_pct), 1)
  return (
    <Card className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr className="text-left text-xs text-stone-500">
          {['Job order', 'Client', 'Placed', 'Avg bill', 'Avg pay', 'Gross margin'].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}
        </tr></thead>
        <tbody>
          {data.map((d, i) => (
            <tr key={i} className="border-t border-stone-100 dark:border-stone-800/70">
              <td className="px-3 py-2">{d.title}</td>
              <td className="px-3 py-2 text-stone-500">{d.client}</td>
              <td className="px-3 py-2 tabular-nums">{d.placements}</td>
              <td className="px-3 py-2 tabular-nums">{money(d.avg_bill)}</td>
              <td className="px-3 py-2 tabular-nums">{money(d.avg_pay)}</td>
              <td className="px-3 py-2">
                <div className="flex items-center gap-2">
                  <div className="h-2 w-28 rounded bg-stone-100 dark:bg-stone-800">
                    <div className="h-2 rounded bg-teal-600" style={{ width: `${(d.margin_pct / max) * 100}%` }} />
                  </div>
                  <span className="tabular-nums">{d.margin_pct}%</span>
                </div>
              </td>
            </tr>
          ))}
          {data.length === 0 && <tr><td colSpan={6} className="px-3 py-8 text-center text-stone-500">No placements yet.</td></tr>}
        </tbody>
      </table>
    </Card>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="grid min-h-screen place-items-center px-4 text-center text-sm text-stone-500">{children}</div>
}
