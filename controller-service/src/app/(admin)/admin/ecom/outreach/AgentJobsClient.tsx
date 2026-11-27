'use client'

import { useCallback, useEffect, useState } from 'react'
import { api, btnGhost, inputCls, when } from '@/components/admin/kit/core'
import { Card } from '@/components/admin/kit/layout'
import type { InputSpec, JobStatus } from '@controller/lib/outreach/agent/types'
import { JOB_STATUSES } from '@controller/lib/outreach/agent/types'
import { API, JOB_STATUS_LABEL, SOURCE_LABEL, slugLabel } from './shared'
import AddJobs from './AddJobs'
import JobDetailClient, { JobStatusChip } from './JobDetailClient'

export type JobListRow = {
  id: string
  status: JobStatus
  outcome: string | null
  source: string
  source_ref: string | null
  due_at: string
  created_at: string
  ended_at: string | null
  contact: { id: string; name: string | null; phone_last4: string }
  inputs: Record<string, unknown>
}
type Page = { rows: JobListRow[]; total: number; page: number; pageSize: number }

/** An agent's jobs: filters, the table with paging, adding jobs, and a job's detail. No ?page in the URL. */
export default function AgentJobsClient({
  agentId, agentStatus, inputs, outcomes, canWrite,
}: {
  agentId: string
  agentStatus: string
  inputs: Record<string, InputSpec>
  outcomes: string[]
  canWrite: boolean
}) {
  const [status, setStatus] = useState<JobStatus | ''>('')
  const [outcome, setOutcome] = useState('')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<Page | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [openJob, setOpenJob] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let live = true
    const p = new URLSearchParams({ page: String(page) })
    if (status) p.set('status', status)
    if (outcome) p.set('outcome', outcome)
    api<Page>(`${API}/agents/${agentId}/jobs?${p}`).then(({ ok, data: d }) => {
      if (!live) return
      if (!ok) return setError(d.error || 'Could not load the jobs')
      setError(null)
      setData(d)
    })
    return () => {
      live = false
    }
  }, [agentId, status, outcome, page, tick])

  const refresh = useCallback(() => setTick(t => t + 1), [])
  const pick = (s: JobStatus | '') => {
    setStatus(cur => (cur === s ? '' : s))
    setPage(1)
  }

  if (openJob) return <JobDetailClient jobId={openJob} onBack={() => { setOpenJob(null); refresh() }} />

  const rows = data?.rows ?? []
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1

  return (
    <div className="space-y-5">
      <Card
        title="Jobs"
        hint="One job is one person reached by this agent. Open a job to see its calls, messages and tool calls."
        action={
          <button type="button" className={btnGhost} aria-expanded={adding} disabled={!canWrite} onClick={() => setAdding(a => !a)}>
            {adding ? 'Close' : 'Add jobs'}
          </button>
        }
      >
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by status">
            {JOB_STATUSES.map(s => (
              <button
                key={s}
                type="button"
                aria-pressed={status === s}
                onClick={() => pick(s)}
                className={`rounded-full border px-2.5 py-1 text-xs ${status === s ? 'border-accent-500 text-foreground font-medium' : 'border-border-default text-foreground-muted hover:text-foreground'}`}
              >
                {JOB_STATUS_LABEL[s]}
              </button>
            ))}
            {!!status && (
              <button type="button" className="px-2 text-xs text-foreground-muted underline" onClick={() => pick('')}>
                Clear
              </button>
            )}
            <select aria-label="Filter by outcome" className={`${inputCls} sm:max-w-[14rem] ml-auto`} value={outcome} onChange={e => { setOutcome(e.target.value); setPage(1) }}>
              <option value="">Any outcome</option>
              {outcomes.map(o => (
                <option key={o} value={o}>{slugLabel(o)}</option>
              ))}
            </select>
          </div>

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          {!data && !error && <div className="h-32 rounded-lg bg-surface-secondary animate-pulse" />}
          {data && !rows.length && <p className="text-sm text-foreground-muted py-6 text-center">No jobs match.</p>}
          {data && !!rows.length && (
            <>
              <div className="overflow-x-auto rounded-lg border border-border-default">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-foreground-muted border-b border-border-default">
                      <th className="px-3 py-2">Created</th>
                      <th className="px-3 py-2">Contact</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Outcome</th>
                      <th className="px-3 py-2">Source</th>
                      <th className="px-3 py-2">Due / ended</th>
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(j => (
                      <tr key={j.id} className="border-t border-border-default/60">
                        <td className="px-3 py-2 whitespace-nowrap">{when(j.created_at)}</td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <span className="font-medium text-foreground">{j.contact.name || '-'}</span>
                          <span className="ml-1.5 tabular-nums text-xs text-foreground-muted">{`••${j.contact.phone_last4}`}</span>
                        </td>
                        <td className="px-3 py-2"><JobStatusChip status={j.status} /></td>
                        <td className="px-3 py-2 text-xs">{slugLabel(j.outcome)}</td>
                        <td className="px-3 py-2 text-xs">{SOURCE_LABEL[j.source] ?? j.source}</td>
                        <td className="px-3 py-2 whitespace-nowrap text-xs">{when(j.ended_at ?? j.due_at)}</td>
                        <td className="px-3 py-2 text-right">
                          <button type="button" className={btnGhost} aria-label={`Open job for ${j.contact.name || j.contact.phone_last4}`} onClick={() => setOpenJob(j.id)}>
                            Open
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between text-xs text-foreground-muted">
                <span>{`${data.total.toLocaleString('en-IN')} jobs`}</span>
                <div className="flex items-center gap-2">
                  <button type="button" className={btnGhost} disabled={page <= 1} onClick={() => setPage(page - 1)}>
                    Previous
                  </button>
                  <span>{`${page} / ${pages}`}</span>
                  <button type="button" className={btnGhost} disabled={page >= pages} onClick={() => setPage(page + 1)}>
                    Next
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </Card>

      {adding && <AddJobs agentId={agentId} agentStatus={agentStatus} inputs={inputs} canWrite={canWrite} onCreated={refresh} onOpenJob={setOpenJob} />}
    </div>
  )
}
