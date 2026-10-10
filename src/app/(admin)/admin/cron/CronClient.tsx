'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Clock,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Lock,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import { ap } from '@/lib/shared/admin-path'

type Job = {
  id: string
  name: string
  path: string
  intervalMs: number
  intervalLabel: string
  tenantScope: string | null
  inPlan: boolean
  enabled: boolean
  lastRun: string | null
  lastStatus: string | null
  lastError: string | null
  log: Array<{ t: string; ok: boolean; err?: string }>
}

const fmt = (s: string | null) => {
  if (!s) return '—'
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return s
  return d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
}

function StatusBadge({ status }: { status: string | null }) {
  if (status === 'ok')
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 dark:text-green-400">
        <CheckCircle2 className="w-4 h-4" /> Success
      </span>
    )
  if (status === 'error' || status === 'fail')
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-red-700 dark:text-red-400">
        <XCircle className="w-4 h-4" /> Failed
      </span>
    )
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-foreground-secondary">
      <Clock className="w-4 h-4" /> Not yet run
    </span>
  )
}

function JobRow({ job }: { job: Job }) {
  const [open, setOpen] = useState(false)
  const hasLog = job.log && job.log.length > 0
  return (
    <div
      className={`rounded-xl border border-border bg-surface ${job.inPlan ? '' : 'opacity-55'}`}
    >
      <div className="flex items-start justify-between gap-4 p-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-foreground">{job.name}</span>
            {!job.inPlan && (
              <span className="inline-flex items-center gap-1 rounded-full bg-foreground/5 px-2 py-0.5 text-[11px] font-medium text-foreground-secondary">
                <Lock className="w-3 h-3" /> Not in your plan
              </span>
            )}
            {job.inPlan && !job.enabled && (
              <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-400">
                Disabled
              </span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-foreground-secondary">
            <span className="inline-flex items-center gap-1">
              <RefreshCw className="w-3.5 h-3.5" /> {job.intervalLabel}
            </span>
            {job.inPlan && <span>Last run: {fmt(job.lastRun)}</span>}
          </div>
          {job.inPlan && job.lastError && (
            <div className="mt-2 flex items-start gap-1.5 rounded-lg bg-red-500/5 px-2.5 py-1.5 text-xs text-red-700 dark:text-red-400">
              <AlertTriangle className="mt-0.5 w-3.5 h-3.5 shrink-0" />
              <span className="break-words">{job.lastError}</span>
            </div>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          {job.inPlan ? <StatusBadge status={job.lastStatus} /> : <span className="text-xs">—</span>}
          {job.inPlan && hasLog && (
            <button
              onClick={() => setOpen(o => !o)}
              className="inline-flex items-center gap-1 text-xs text-foreground-secondary hover:text-foreground"
            >
              {open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              History
            </button>
          )}
        </div>
      </div>
      {open && hasLog && (
        <div className="border-t border-border px-4 py-2">
          <ul className="space-y-1">
            {job.log
              .slice()
              .reverse()
              .map((e, i) => (
                <li key={i} className="flex items-center gap-2 text-xs">
                  {e.ok ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-green-600" />
                  ) : (
                    <XCircle className="w-3.5 h-3.5 text-red-600" />
                  )}
                  <span className="text-foreground-secondary">{fmt(e.t)}</span>
                  {e.err && <span className="text-red-600 dark:text-red-400">— {e.err}</span>}
                </li>
              ))}
          </ul>
        </div>
      )}
    </div>
  )
}

export default function CronClient() {
  const [jobs, setJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(ap('/api/admin/cron/status'), { cache: 'no-store' })
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || `HTTP ${res.status}`)
      const data = await res.json()
      setJobs(data.jobs || [])
    } catch (e: any) {
      setError(e?.message || 'Failed to load scheduled jobs')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const [inPlan, outOfPlan] = useMemo(() => {
    const yes: Job[] = []
    const no: Job[] = []
    for (const j of jobs) (j.inPlan ? yes : no).push(j)
    return [yes, no]
  }, [jobs])

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Scheduled Jobs</h1>
          <p className="mt-1 text-sm text-foreground-secondary">
            Background tasks that run automatically for your store on a schedule.
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="inline-flex h-control items-center gap-2 rounded-lg border border-border px-3 text-sm font-medium text-foreground hover:bg-foreground/5 disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-red-500/5 px-4 py-3 text-sm text-red-700 dark:text-red-400">
          {error}
        </div>
      )}

      {loading && jobs.length === 0 ? (
        <div className="space-y-3">
          {[0, 1, 2].map(i => (
            <div key={i} className="h-20 animate-pulse rounded-xl border border-border bg-surface" />
          ))}
        </div>
      ) : (
        <div className="space-y-6">
          <div className="space-y-3">
            {inPlan.length === 0 ? (
              <p className="text-sm text-foreground-secondary">No scheduled jobs run for your plan.</p>
            ) : (
              inPlan.map(j => <JobRow key={j.id} job={j} />)
            )}
          </div>

          {outOfPlan.length > 0 && (
            <div>
              <h2 className="mb-3 text-sm font-semibold text-foreground-secondary">
                Available on higher plans
              </h2>
              <div className="space-y-3">
                {outOfPlan.map(j => (
                  <JobRow key={j.id} job={j} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
