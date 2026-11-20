import { useMemo, useState } from 'react'
import {
  flexRender, getCoreRowModel, getFilteredRowModel, getPaginationRowModel, getSortedRowModel,
  useReactTable, type ColumnDef, type SortingState,
} from '@tanstack/react-table'
import { STAGES, type Row, type Stage } from '../db/queries'
import { Card, money, StagePill, stageTone } from './ui'

type Props = {
  rows: Row[]
  canWrite: boolean
  onStage: (id: string, stage: Stage) => void
  onOpen: (row: Row) => void
}

export function Pipeline({ rows, canWrite, onStage, onOpen }: Props) {
  const [sorting, setSorting] = useState<SortingState>([])
  const [query, setQuery] = useState('')
  const [stage, setStage] = useState<Stage | 'all'>('all')
  const showPay = rows.some((r) => r.pay_rate != null)

  const counts = useMemo(() => {
    const c = Object.fromEntries(STAGES.map((s) => [s, 0])) as Record<Stage, number>
    for (const r of rows) c[r.stage]++
    return c
  }, [rows])

  const data = useMemo(() => (stage === 'all' ? rows : rows.filter((r) => r.stage === stage)), [rows, stage])

  const columns = useMemo<ColumnDef<Row>[]>(() => {
    const cols: ColumnDef<Row>[] = [
      {
        header: 'Candidate', accessorKey: 'candidate',
        cell: ({ row }) => (
          <button onClick={() => onOpen(row.original)} className="text-left">
            <div className="font-medium hover:underline">{row.original.candidate}</div>
            <div className="text-[11px] text-stone-500 dark:text-stone-400">{row.original.skills.join(' · ')}</div>
          </button>
        ),
      },
      {
        header: 'Job order', accessorKey: 'title',
        cell: ({ row }) => (<div><div>{row.original.title}</div><div className="text-[11px] text-stone-500 dark:text-stone-400">{row.original.client}</div></div>),
      },
      {
        header: 'Stage', accessorKey: 'stage',
        sortingFn: (a, b) => STAGES.indexOf(a.original.stage) - STAGES.indexOf(b.original.stage),
        cell: ({ row }) => canWrite ? (
          <select
            aria-label={`Stage for ${row.original.candidate}`}
            value={row.original.stage}
            onChange={(e) => onStage(row.original.id, e.target.value as Stage)}
            className={`rounded-full border-0 px-2 py-0.5 text-xs font-medium ${stageTone(row.original.stage)}`}
          >
            {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        ) : <StagePill stage={row.original.stage} />,
      },
      { header: 'Bill', accessorKey: 'bill_rate', cell: (c) => <span className="tabular-nums">{money(c.getValue<number>())}</span> },
    ]
    if (showPay) {
      cols.push(
        { header: 'Pay', accessorKey: 'pay_rate', cell: (c) => <span className="tabular-nums">{money(c.getValue<number>())}</span> },
        {
          id: 'margin', header: 'Margin',
          accessorFn: (r) => (r.pay_rate == null ? null : 1 - r.pay_rate / r.bill_rate),
          cell: (c) => { const v = c.getValue<number | null>(); return <span className="tabular-nums">{v == null ? '—' : `${(v * 100).toFixed(0)}%`}</span> },
        },
      )
    }
    cols.push(
      { header: 'Recruiter', accessorKey: 'recruiter', cell: (c) => <span className="text-stone-600 dark:text-stone-400">{c.getValue<string>() ?? '—'}</span> },
      {
        header: 'Updated', accessorKey: 'updated_at',
        cell: (c) => <span className="tabular-nums text-stone-500 dark:text-stone-400">{new Date(c.getValue<string>()).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>,
      },
    )
    return cols
  }, [canWrite, showPay, onStage, onOpen])

  const table = useReactTable({
    data, columns,
    state: { sorting, globalFilter: query },
    onSortingChange: setSorting,
    onGlobalFilterChange: setQuery,
    globalFilterFn: (row, _id, value: string) => {
      const v = value.toLowerCase()
      const r = row.original
      return [r.candidate, r.title, r.client, r.recruiter ?? '', ...r.skills].some((s) => s.toLowerCase().includes(v))
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    autoResetPageIndex: false,
    initialState: { pagination: { pageSize: 12 } },
  })

  const chip = 'rounded-full px-2.5 py-1 text-xs'
  const idle = 'text-stone-600 hover:bg-stone-100 dark:text-stone-400 dark:hover:bg-stone-800'

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2 border-b border-stone-200 p-3 dark:border-stone-800">
        <input
          value={query} onChange={(e) => { setQuery(e.target.value); table.setPageIndex(0) }} placeholder="Search name, job, skill…"
          aria-label="Search submissions"
          className="w-full rounded-lg border border-stone-300 bg-transparent px-3 py-1.5 text-sm sm:w-64 dark:border-stone-700"
        />
        <div className="flex flex-wrap gap-1">
          <button onClick={() => { setStage('all'); table.setPageIndex(0) }}
            className={`${chip} ${stage === 'all' ? 'bg-stone-900 text-white dark:bg-white dark:text-stone-900' : idle}`}>
            all {rows.length}
          </button>
          {STAGES.map((s) => (
            <button key={s} onClick={() => { setStage(s); table.setPageIndex(0) }}
              className={`${chip} ${stage === s ? stageTone(s) + ' ring-1 ring-current' : idle}`}>
              {s} {counts[s]}
            </button>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Submissions">
        <table className="w-full text-sm">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} className="text-left text-xs text-stone-500 dark:text-stone-400">
                {hg.headers.map((h) => (
                  <th key={h.id} className="whitespace-nowrap px-3 py-2 font-medium">
                    <button onClick={h.column.getToggleSortingHandler()} className="inline-flex items-center gap-1 hover:text-stone-900 dark:hover:text-white">
                      {flexRender(h.column.columnDef.header, h.getContext())}
                      <span className="w-2">{{ asc: '↑', desc: '↓' }[h.column.getIsSorted() as string] ?? ''}</span>
                    </button>
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((r) => (
              <tr key={r.id} className="border-t border-stone-100 dark:border-stone-800/70">
                {r.getVisibleCells().map((c) => <td key={c.id} className="whitespace-nowrap px-3 py-2 align-top">{flexRender(c.column.columnDef.cell, c.getContext())}</td>)}
              </tr>
            ))}
            {table.getRowModel().rows.length === 0 && (
              <tr><td colSpan={8} className="px-3 py-8 text-center text-stone-500 dark:text-stone-400">No rows. Row-level security returned nothing for this user, or the filter matched nothing.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between border-t border-stone-200 px-3 py-2 text-xs text-stone-500 dark:text-stone-400 dark:border-stone-800">
        <span>{table.getFilteredRowModel().rows.length} submissions{!showPay && rows.length > 0 && ' · pay rates hidden for your role'}</span>
        <div className="flex items-center gap-2">
          <button disabled={!table.getCanPreviousPage()} onClick={() => table.previousPage()} className="rounded px-2 py-1 hover:bg-stone-100 disabled:opacity-30 dark:hover:bg-stone-800">Prev</button>
          <span className="tabular-nums">{table.getState().pagination.pageIndex + 1} / {Math.max(1, table.getPageCount())}</span>
          <button disabled={!table.getCanNextPage()} onClick={() => table.nextPage()} className="rounded px-2 py-1 hover:bg-stone-100 disabled:opacity-30 dark:hover:bg-stone-800">Next</button>
        </div>
      </div>
    </Card>
  )
}
