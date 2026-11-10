'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { ActionButton, StatusBadge } from '@/components/admin/kit'
import type { PipelineView as PipelineData } from '@controller/lib/provisioning/pipeline-view'
import { JobCard } from './JobCard'
import { PipelineLoading } from './PipelineLoading'
import { PipelineSummary } from './PipelineSummary'
import { ResourcesPanel } from './ResourcesPanel'
import { StepRow } from './StepRow'
import { PIPELINE_STATUS, STEP_ICON, fmtDuration } from './status'

interface Job {
  id: string
  step: string
  status: string
  attempts: number
  last_error: string | null
  next_attempt_at: string | null
  created_resources: Record<string, any>
  created_at: string
  updated_at: string
}
interface Data {
  tenant: { id: string; slug: string; status: string; rds_endpoint: string | null; s3_bucket: string | null; region: string | null }
  job: Job | null
  pipeline: PipelineData | null
}

const TERMINAL = ['done', 'failed']

/** The provisioning run, GitHub Actions style: jobs of steps, each with its state, timing and log. Polls while live. */
export function PipelineView({ tenantId }: { tenantId: string }) {
  const [data, setData] = useState<Data | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [live, setLive] = useState(true)
  const [selected, setSelected] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/ecom/customers/${tenantId}/provisioning`, { cache: 'no-store' })
      const d = await res.json()
      if (!res.ok) {
        setErr(d.error || 'Failed to load')
        return
      }
      setErr(null)
      setData(d)
      if (!d.job || TERMINAL.includes(d.job.status)) setLive(false)
    } catch {
      setErr('Network error')
    }
  }, [tenantId])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (!live) return
    timer.current = setInterval(load, 4000)
    return () => {
      if (timer.current) clearInterval(timer.current)
    }
  }, [live, load])

  const job = data?.job
  const pipeline = data?.pipeline
  const certificatesHref = `/admin/ecom/customers/${tenantId}/view?tab=certificates`
  const tenant = data?.tenant
  const starts = (pipeline?.jobs ?? []).map((_, i, js) => js.slice(0, i).reduce((n, j) => n + j.steps.length, 0))
  // The rail follows the running (or failed) job until an operator picks one.
  const activeJob = pipeline?.jobs.find(j => ['running', 'waiting', 'failed'].includes(j.status)) ?? pipeline?.jobs[pipeline.jobs.length - 1]
  const shownIdx = Math.max(0, pipeline?.jobs.findIndex(j => j.id === (selected ?? activeJob?.id)) ?? 0)
  const shown = pipeline?.jobs[shownIdx]

  return (
    <div className="space-y-5 min-w-0">
      <div className="flex flex-wrap items-center gap-3">
        <ActionButton action={{ label: 'Refresh', icon: RefreshCw, onClick: load }} />
        <label className="flex items-center gap-2 text-sm text-foreground-muted select-none cursor-pointer">
          <input type="checkbox" checked={live} onChange={e => setLive(e.target.checked)} className="rounded" />
          Live
          {live && <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />}
        </label>
        {job && <span className="ml-auto text-xs text-foreground-muted">Updated {new Date(job.updated_at).toLocaleTimeString('en-IN')}</span>}
      </div>

      {err && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/5 p-4">
          <p className="text-sm text-red-700 dark:text-red-400">{err}</p>
        </div>
      )}

      {!data && !err && <PipelineLoading />}

      {!job && !err && data && (
        <div className="rounded-xl border border-border-default p-4 sm:p-6 bg-surface-elevated">
          <p className="text-sm text-foreground-muted">
            No provisioning job for this tenant yet. One is created when the owner pays and provisioning is triggered.
          </p>
        </div>
      )}

      {job && pipeline && tenant && (
        <>
          <PipelineSummary pipeline={pipeline} lastError={job.last_error} retryAt={job.next_attempt_at} />

          <div className="space-y-3 lg:hidden">
            {pipeline.jobs.map((j, i) => (
              <JobCard key={j.id} job={j} startIndex={starts[i]} certificatesHref={certificatesHref} />
            ))}
          </div>

          <div className="hidden lg:grid lg:grid-cols-[16rem_minmax(0,1fr)] gap-5 items-start">
            <nav aria-label="Pipeline jobs" className="rounded-xl border border-border-default bg-surface-elevated p-2 space-y-0.5">
              {pipeline.jobs.map(j => {
                const { icon: Icon, cls } = STEP_ICON[j.status]
                const on = j.id === shown?.id
                return (
                  <button
                    key={j.id}
                    type="button"
                    aria-current={on ? 'true' : undefined}
                    onClick={() => setSelected(j.id)}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm ${on ? 'bg-surface-secondary text-foreground font-medium' : 'text-foreground hover:bg-surface-secondary'}`}
                  >
                    <Icon className={`w-4 h-4 shrink-0 ${cls}`} />
                    <span className="min-w-0 flex-1 truncate">{j.label}</span>
                    {j.durationMs != null && <span className="shrink-0 text-[11px] tabular-nums text-foreground-muted">{fmtDuration(j.durationMs)}</span>}
                  </button>
                )
              })}
            </nav>
            {shown && (
              <section className="min-w-0 rounded-xl border border-border-default bg-surface-elevated overflow-hidden">
                <div className="flex items-center gap-3 px-5 py-3.5 border-b border-border-default">
                  <h2 className="min-w-0 flex-1 truncate font-semibold text-foreground text-sm">{shown.label}</h2>
                  <StatusBadge status={shown.status} map={PIPELINE_STATUS} />
                </div>
                <ol className="space-y-0.5 p-3">
                  {shown.steps.map((s, i) => (
                    <StepRow key={s.id} step={s} index={starts[shownIdx] + i} certificatesHref={certificatesHref} />
                  ))}
                </ol>
              </section>
            )}
          </div>

          <ResourcesPanel res={job.created_resources ?? {}} tenant={tenant} />

          <p className="text-[11px] text-foreground-muted break-all">
            Job {job.id} · created {new Date(job.created_at).toLocaleString('en-IN')}
            {pipeline.v === 1 && ' · started before per-store pipelines'}
          </p>
        </>
      )}
    </div>
  )
}
