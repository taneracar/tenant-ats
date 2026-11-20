import { useState } from 'react'
import type { PGlite } from '@electric-sql/pglite'
import { runAs, type RunResult } from '../db/queries'
import { Card } from './ui'

type Props = { db: PGlite; user: string; userName: string; agency: string; otherAgency: { id: string; name: string } }

export function RlsLab({ db, user, userName, agency, otherAgency }: Props) {
  const probes = [
    {
      label: `Read ${otherAgency.name}'s candidates`,
      expect: 'Zero rows, unless you belong there too.',
      sql: `select full_name, email from public.candidates\nwhere agency_id = '${otherAgency.id}';`,
    },
    {
      label: `Insert a candidate into ${otherAgency.name}`,
      expect: 'Rejected by the INSERT policy.',
      sql: `insert into public.candidates (agency_id, full_name, email)\nvalues ('${otherAgency.id}', 'Planted Row', 'x@x.test')\nreturning id;`,
    },
    {
      label: 'Read pay rates',
      expect: 'Viewers get nothing back. No error, just no rows.',
      sql: `select count(*) as rates_visible from public.submission_rates\nwhere agency_id = '${agency}';`,
    },
    {
      label: 'Forge a "placed" event in the history',
      expect: 'Permission denied. Only the trigger writes history.',
      sql: `insert into public.stage_events (agency_id, submission_id, to_stage)\nselect agency_id, id, 'placed' from public.submissions limit 1;`,
    },
    {
      label: 'Mark every submission placed',
      expect: 'Viewers update 0 rows. Recruiters can (rolled back).',
      sql: `update public.submissions set stage = 'placed'\nwhere agency_id = '${agency}';`,
    },
    {
      label: 'Who does Postgres think I am?',
      expect: 'The role and JWT subject for this request.',
      sql: `select current_user, auth.uid(),\n  current_setting('request.jwt.claims', true) as claims;`,
    },
  ]

  const [sql, setSql] = useState(probes[0].sql)
  const [result, setResult] = useState<RunResult | null>(null)
  const [running, setRunning] = useState(false)

  async function run(text = sql) {
    setSql(text)
    setRunning(true)
    setResult(await runAs(db, user, text))
    setRunning(false)
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
      <Card className="p-3">
        <h3 className="px-1 text-sm font-semibold">Try to break it</h3>
        <p className="px-1 pb-2 text-xs text-stone-500 dark:text-stone-400">Each probe runs as {userName} with role <code>authenticated</code>. Writes are rolled back.</p>
        <ul className="space-y-1">
          {probes.map((p) => (
            <li key={p.label}>
              <button onClick={() => run(p.sql)} className="w-full rounded-lg px-2 py-2 text-left hover:bg-stone-100 dark:hover:bg-stone-800">
                <div className="text-sm">{p.label}</div>
                <div className="text-[11px] text-stone-500 dark:text-stone-400">{p.expect}</div>
              </button>
            </li>
          ))}
        </ul>
      </Card>
      <Card className="flex min-w-0 flex-col">
        <label htmlFor="sql" className="border-b border-stone-200 px-3 py-2 text-xs text-stone-500 dark:text-stone-400 dark:border-stone-800">
          SQL as <span className="font-medium text-stone-800 dark:text-stone-200">{userName}</span>. Real Postgres 18 (PGlite), running in this tab.
        </label>
        <textarea
          id="sql" value={sql} onChange={(e) => setSql(e.target.value)} spellCheck={false} rows={6}
          onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') run() }}
          className="w-full resize-y bg-transparent p-3 font-mono text-[13px] outline-none"
        />
        <div className="flex items-center justify-between border-t border-stone-200 px-3 py-2 dark:border-stone-800">
          <span className="text-[11px] text-stone-500 dark:text-stone-400">⌘/Ctrl + Enter</span>
          <button onClick={() => run()} disabled={running}
            className="rounded-lg bg-teal-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-50">
            {running ? 'Running…' : 'Run'}
          </button>
        </div>
        {result && <ResultView r={result} />}
      </Card>
    </div>
  )
}

function ResultView({ r }: { r: RunResult }) {
  if (!r.ok) {
    return (
      <div role="status" className="border-t border-rose-200 bg-rose-50 px-3 py-3 font-mono text-[13px] text-rose-800 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-300">
        ERROR{r.code ? ` ${r.code}` : ''}: {r.error}
        <div className="mt-1 font-sans text-[11px] opacity-70">{r.ms.toFixed(1)} ms</div>
      </div>
    )
  }
  const cols = r.rows[0] ? Object.keys(r.rows[0]) : []
  return (
    <div role="status" className="border-t border-stone-200 dark:border-stone-800">
      <div className="px-3 py-2 text-xs text-stone-500 dark:text-stone-400">
        {r.rows.length} row{r.rows.length === 1 ? '' : 's'}
        {r.affected != null && r.rows.length === 0 ? ` · ${r.affected} affected (rolled back)` : ''} · {r.ms.toFixed(1)} ms
      </div>
      {cols.length > 0 && (
        <div className="max-h-72 overflow-auto" tabIndex={0} role="region" aria-label="Query result">
          <table className="w-full font-mono text-[12px]">
            <thead><tr>{cols.map((c) => <th key={c} className="px-3 py-1 text-left font-medium text-stone-500 dark:text-stone-400">{c}</th>)}</tr></thead>
            <tbody>
              {r.rows.slice(0, 100).map((row, i) => (
                <tr key={i} className="border-t border-stone-100 dark:border-stone-800/70">
                  {cols.map((c) => <td key={c} className="whitespace-nowrap px-3 py-1">{fmt(row[c])}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

const fmt = (v: unknown) => (v == null ? 'null' : v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v))
