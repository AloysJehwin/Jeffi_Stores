'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { ArrowLeft, Ban, Download, Loader2, RotateCcw } from 'lucide-react'
import { Card } from './Card'
import { SkeletonRows } from './Skeleton'
import Pager from './Pager'
import { STATUS_PILL, fmt, fmtDate } from './finance'
import { useToast } from '@/contexts/ToastContext'

export interface BulkJob {
  id: string; status: string; total: number; succeeded: number; failed: number; skipped: number; pending: number
  spent_inr: number; reference: string | null; error: string | null; created_at: string; finished_at: string | null; zip_url?: string
}
export interface BulkItem { seq: number; status: string; error: string | null; reference: string | null; to?: string; result: any }

const TONE: Record<string, string> = {
  completed: STATUS_PILL.settled, partial: STATUS_PILL.split, failed: STATUS_PILL.failed, cancelled: 'org-sand',
  running: 'org-sage org-sage-text', queued: 'org-sand', done: STATUS_PILL.settled, skipped: 'org-sand', pending: 'org-sand',
}
const LIVE = new Set(['queued', 'running'])
export const Pill = ({ s }: { s: string }) => <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${TONE[s] ?? 'org-sand'}`}>{s}</span>

function Progress({ j }: { j: BulkJob }) {
  const pct = (n: number) => `${j.total ? (n / j.total) * 100 : 0}%`
  return (
    <div className="flex h-1.5 w-full overflow-hidden rounded-full org-sand">
      <div className="bg-[var(--console-sage-deep,#3f6b4f)]" style={{ width: pct(j.succeeded) }} />
      <div className="bg-[#c0533f]" style={{ width: pct(j.failed) }} />
      <div className="bg-foreground-muted/40" style={{ width: pct(j.skipped) }} />
    </div>
  )
}

/** Bulk job list + detail for one API (`base` = svc proxy path of …/bulk). New jobs come from `form`. */
export default function BulkJobs({ base, form, columns, row, refreshKey = 0 }: {
  base: string
  form: ReactNode
  columns: string[]
  row: (item: BulkItem) => ReactNode[]
  refreshKey?: number
}) {
  const { showToast } = useToast()
  const [jobs, setJobs] = useState<BulkJob[] | null>(null)
  const [open, setOpen] = useState<BulkJob | null>(null)

  const load = useCallback(() => fetch(`${base}?limit=20`).then(r => r.json()).then(d => {
    setJobs(d.items ?? [])
    setOpen(o => (o ? (d.items ?? []).find((j: BulkJob) => j.id === o.id) ?? o : o))
  }).catch(() => setJobs(j => j ?? [])), [base])

  useEffect(() => { load() }, [load, refreshKey])
  const live = !!jobs?.some(j => LIVE.has(j.status))
  useEffect(() => {
    if (!live) return
    const t = setInterval(load, 3000)
    return () => clearInterval(t)
  }, [live, load])

  async function act(j: BulkJob, action: 'retry' | 'cancel') {
    const r = await fetch(`${base}/${j.id}/${action}`, { method: 'POST' })
    if (!r.ok) return showToast(`Could not ${action} the job`, 'error')
    showToast(action === 'retry' ? 'Failed and skipped items queued again' : 'Job cancelled', 'success')
    load()
  }

  if (open) return <JobDetail base={base} job={open} columns={columns} row={row} onBack={() => setOpen(null)} onAct={act} />

  return (
    <div className="space-y-6">
      {form}
      <Card title="Bulk jobs">
        {jobs === null ? <SkeletonRows rows={4} cols={5} /> : jobs.length === 0 ? (
          <p className="text-sm text-foreground-secondary">No bulk jobs yet. Upload a CSV above or call the bulk API.</p>
        ) : (
          <div className="-m-6 overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="org-sand text-foreground-secondary"><tr>{['Started', 'Reference', 'Status', 'Progress', 'Spent', ''].map(h => <th key={h} className="px-6 py-2 text-left text-xs font-semibold">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-border-default">
                {jobs.map(j => (
                  <tr key={j.id} onClick={() => setOpen(j)} className="cursor-pointer hover:bg-surface-secondary/50">
                    <td className="whitespace-nowrap px-6 py-2.5 text-foreground-secondary">{fmtDate(j.created_at)}</td>
                    <td className="px-6 py-2.5 text-xs">{j.reference ?? <span className="font-mono text-foreground-muted">{j.id.slice(0, 8)}</span>}</td>
                    <td className="px-6 py-2.5"><Pill s={j.status} /></td>
                    <td className="w-56 px-6 py-2.5">
                      <Progress j={j} />
                      <div className="mt-1 text-[11px] tabular-nums text-foreground-muted">{j.succeeded} done · {j.failed} failed{j.skipped ? ` · ${j.skipped} skipped` : ''} / {j.total}</div>
                    </td>
                    <td className="px-6 py-2.5 tabular-nums">{fmt(j.spent_inr)}</td>
                    <td className="px-6 py-2.5 text-right text-xs font-semibold org-brown">Open</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}

function JobDetail({ base, job, columns, row, onBack, onAct }: {
  base: string; job: BulkJob; columns: string[]; row: (item: BulkItem) => ReactNode[]
  onBack: () => void; onAct: (j: BulkJob, a: 'retry' | 'cancel') => void
}) {
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [cursors, setCursors] = useState<Array<string | null>>([null])
  const [data, setData] = useState<{ items: BulkItem[]; next: string | null } | null>(null)
  const cursor = cursors[page - 1] ?? null
  // Re-read as the job progresses (job object is refreshed by the parent's poll).
  const tick = `${job.succeeded}-${job.failed}-${job.skipped}-${job.status}`

  useEffect(() => {
    let alive = true
    fetch(`${base}/${job.id}/items?limit=50${status ? `&status=${status}` : ''}${cursor ? `&cursor=${cursor}` : ''}`)
      .then(r => r.json()).then(d => alive && setData({ items: d.items ?? [], next: d.next_cursor ?? null }))
      .catch(() => alive && setData({ items: [], next: null }))
    return () => { alive = false }
  }, [base, job.id, status, cursor, tick])

  const go = (p: number) => {
    if (p > page && data?.next) setCursors(cs => [...cs.slice(0, page), data.next])
    setPage(p)
  }
  const filter = (s: string) => { setStatus(s); setPage(1); setCursors([null]); setData(null) }
  const btn = 'inline-flex items-center gap-1.5 rounded-full border border-border-default px-3 py-1.5 text-xs font-semibold hover:bg-surface-secondary'

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={onBack} className={btn}><ArrowLeft className="w-3.5 h-3.5" /> All jobs</button>
        <Pill s={job.status} />
        {LIVE.has(job.status) && <Loader2 className="w-4 h-4 animate-spin text-foreground-muted" />}
        <span className="text-sm text-foreground-secondary">{job.reference ?? job.id}</span>
        <div className="ml-auto flex flex-wrap gap-2">
          {job.zip_url && job.succeeded > 0 && <a href={`${base}/${job.id}/zip`} className={btn}><Download className="w-3.5 h-3.5" /> Download ZIP</a>}
          {['partial', 'failed', 'cancelled'].includes(job.status) && job.failed + job.skipped > 0 && <button type="button" onClick={() => onAct(job, 'retry')} className={btn}><RotateCcw className="w-3.5 h-3.5" /> Retry {job.failed + job.skipped}</button>}
          {LIVE.has(job.status) && <button type="button" onClick={() => onAct(job, 'cancel')} className={btn}><Ban className="w-3.5 h-3.5" /> Cancel</button>}
        </div>
      </div>
      <Card>
        <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-5">
          {[['Total', job.total], ['Done', job.succeeded], ['Failed', job.failed], ['Skipped', job.skipped], ['Spent', fmt(job.spent_inr)]].map(([k, v]) => (
            <div key={k as string}><div className="text-xs text-foreground-muted">{k}</div><div className="text-lg font-semibold tabular-nums">{v}</div></div>
          ))}
        </div>
        <Progress j={job} />
        {job.error && <p className="mt-3 text-sm text-[#8a2e1f]">Stopped: {job.error}</p>}
      </Card>
      <div role="tablist" className="inline-flex rounded-full org-sand p-1">
        {[['', 'All'], ['done', 'Done'], ['failed', 'Failed'], ['skipped', 'Skipped'], ['pending', 'Pending']].map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={status === k} onClick={() => filter(k)}
            className={`rounded-full px-3 py-1 text-xs font-semibold ${status === k ? 'bg-surface-elevated text-foreground shadow-sm' : 'text-foreground-secondary hover:text-foreground'}`}>{l}</button>
        ))}
      </div>
      <Card>
        {data === null ? <SkeletonRows rows={6} cols={columns.length + 2} /> : data.items.length === 0 ? <p className="text-sm text-foreground-secondary">Nothing here.</p> : (
          <div className="-m-6 overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="org-sand text-foreground-secondary"><tr>{['#', ...columns, 'Status'].map(h => <th key={h} className="px-6 py-2 text-left text-xs font-semibold">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-border-default">
                {data.items.map(it => (
                  <tr key={it.seq}>
                    <td className="px-6 py-2.5 tabular-nums text-foreground-muted">{it.seq}</td>
                    {row(it).map((c, i) => <td key={i} className="px-6 py-2.5">{c}</td>)}
                    <td className="px-6 py-2.5"><Pill s={it.status} />{it.error && <div className="mt-1 max-w-xs text-[11px] text-[#8a2e1f]">{it.error}</div>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Pager page={page} hasNext={!!data?.next} onPage={go} />
    </div>
  )
}
