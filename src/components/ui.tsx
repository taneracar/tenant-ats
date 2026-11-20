import type { ReactNode } from 'react'
import type { Role, Stage } from '../db/queries'

export const money = (n: number | null) => (n == null ? '—' : `$${n.toFixed(2)}`)

const STAGE_TONE: Record<Stage, string> = {
  sourced: 'bg-stone-200 text-stone-700 dark:bg-stone-800 dark:text-stone-300',
  screen: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300',
  submitted: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300',
  interview: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  offer: 'bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-950 dark:text-fuchsia-300',
  placed: 'bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-300',
  rejected: 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300',
}
export const stageTone = (s: Stage) => STAGE_TONE[s]

export function StagePill({ stage }: { stage: Stage }) {
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STAGE_TONE[stage]}`}>{stage}</span>
}

const ROLE_TONE: Record<Role, string> = {
  owner: 'bg-teal-700 text-white',
  recruiter: 'bg-indigo-600 text-white',
  viewer: 'bg-stone-500 text-white',
}
export function RoleBadge({ role }: { role: Role }) {
  return <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${ROLE_TONE[role]}`}>{role}</span>
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-xl border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900 ${className}`}>{children}</section>
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <Card className="px-4 py-3">
      <div className="text-xs text-stone-500 dark:text-stone-400">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-stone-500 dark:text-stone-400">{hint}</div>}
    </Card>
  )
}
