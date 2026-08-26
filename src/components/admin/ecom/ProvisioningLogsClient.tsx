'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

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
  steps: string[]
  job: Job | null
}

const TERMINAL = ['done', 'failed']

type StepState = 'done' | 'current' | 'pending' | 'failed'

const PHASES: { label: string; steps: string[] }[] = [
  { label: 'Preflight', steps: ['preflight'] },
  { label: 'Database', steps: ['create_param_group', 'create_db_instance', 'wait_db_available', 'load_schema', 'restore_data', 'seed_data'] },
  { label: 'Storage', steps: ['create_bucket', 'write_infra', 'generate_legals'] },
  { label: 'Compute', steps: ['ensure_compute', 'setup_delhivery'] },
  { label: 'Network', steps: ['configure_dns', 'verify_serving'] },
  { label: 'Go live', steps: ['activate'] },
]

function StepRow({ name, index, state }: { name: string; index: number; state: StepState }) {
  const dot = state === 'done' ? 'bg-green-500 border-green-500'
    : state === 'current' ? 'bg-accent-500 border-accent-500'
    : state === 'failed' ? 'bg-red-500 border-red-500'
    : 'bg-surface-elevated border-border-default'
  const text = state === 'pending' ? 'text-foreground-muted' : 'text-foreground'
  return (
    <li className="relative flex items-center gap-3 pl-0">
      <span className="relative z-10 flex items-center justify-center shrink-0">
        <span className={`w-3 h-3 rounded-full border-2 ${dot} ${state === 'current' ? 'animate-pulse' : ''}`} />
      </span>
      <span className="text-[10px] tabular-nums text-foreground-muted w-4 shrink-0">{index + 1}</span>
      <span className={`text-sm font-mono truncate ${text}`}>{name}</span>
      {state === 'current' && (
        <span className="ml-auto shrink-0 text-[11px] font-medium text-accent-600 dark:text-accent-400">running…</span>
      )}
      {state === 'failed' && (
        <span className="ml-auto shrink-0 text-[11px] font-medium text-red-600 dark:text-red-400">failed</span>
      )}
    </li>
  )
}

function Res({ label, value, wide }: { label: string; value: React.ReactNode; wide?: boolean }) {
  return (
    <div className={`min-w-0 ${wide ? 'sm:col-span-2' : ''}`}>
      <dt className="text-[11px] uppercase tracking-wide text-foreground-muted">{label}</dt>
      <dd className="text-xs font-mono text-foreground mt-0.5 break-all">{value || '—'}</dd>
    </div>
  )
}

export default function ProvisioningLogsClient({ tenantId }: { tenantId: string }) {
  const [data, setData] = useState<Data | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [live, setLive] = useState(true)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/ecom/customers/${tenantId}/provisioning`, { cache: 'no-store' })
      const d = await res.json()
      if (!res.ok) { setErr(d.error || 'Failed to load'); return }
      setErr(null); setData(d)
      if (!d.job || TERMINAL.includes(d.job.status)) setLive(false)
    } catch { setErr('Network error') }
  }, [tenantId])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!live) return
    timer.current = setInterval(load, 4000)
    return () => { if (timer.current) clearInterval(timer.current) }
  }, [live, load])

  const job = data?.job
  const steps = data?.steps ?? []
  const currentIdx = job ? steps.indexOf(job.step) : -1
  const res = job?.created_resources ?? {}
  const pct = !job ? 0 : job.status === 'done' ? 100 : currentIdx < 0 ? 0 : Math.round((currentIdx / steps.length) * 100)

  function stateOf(i: number): StepState {
    if (!job) return 'pending'
    if (job.status === 'failed' && i === currentIdx) return 'failed'
    if (job.status === 'done' || i < currentIdx) return 'done'
    if (i === currentIdx) return 'current'
    return 'pending'
  }

  const bannerTone = !job ? 'border-border-default bg-surface-elevated'
    : job.status === 'done' ? 'border-green-300 dark:border-green-800 bg-green-50 dark:bg-green-900/20'
    : job.status === 'failed' ? 'border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/20'
    : 'border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20'

  const barTone = job?.status === 'failed' ? 'bg-red-500' : job?.status === 'done' ? 'bg-green-500' : 'bg-accent-500'

  return (
    <div className="space-y-5 min-w-0">
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={load} className="px-3 py-1.5 rounded-lg border border-border-default text-sm font-medium hover:bg-surface-secondary transition-colors">
          Refresh
        </button>
        <label className="flex items-center gap-2 text-sm text-foreground-muted select-none cursor-pointer">
          <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} className="rounded" />
          Live
          {live && <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />}
        </label>
        {job && (
          <span className="ml-auto text-xs text-foreground-muted">
            Updated {new Date(job.updated_at).toLocaleTimeString('en-IN')}
          </span>
        )}
      </div>

      {err && (
        <div className="rounded-xl border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-4">
          <p className="text-sm text-red-700 dark:text-red-300">{err}</p>
        </div>
      )}

      {!job && !err && (
        <div className="rounded-xl border border-border-default p-6 bg-surface-elevated">
          <p className="text-sm text-foreground-muted">
            No provisioning job for this tenant yet. One is created when the owner pays and provisioning is triggered.
          </p>
        </div>
      )}

      {job && (
        <>
          <div className={`rounded-xl border p-4 sm:p-5 ${bannerTone}`}>
            <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2">
              <span className="font-semibold text-foreground capitalize text-base">{job.status}</span>
              <span className="text-sm text-foreground-muted min-w-0">
                step <span className="font-mono text-foreground break-all">{job.step}</span>
              </span>
              <span className="text-sm text-foreground-muted" title="Worker ticks consumed, including polling iterations — not failures">
                ticks <span className="tabular-nums text-foreground">{job.attempts}</span>
              </span>
              {job.next_attempt_at && new Date(job.next_attempt_at) > new Date() && (
                <span className="text-sm text-amber-700 dark:text-amber-400">
                  retry at {new Date(job.next_attempt_at).toLocaleTimeString('en-IN')}
                </span>
              )}
            </div>

            <div className="mt-3.5">
              <div className="h-1.5 rounded-full bg-black/5 dark:bg-white/10 overflow-hidden">
                <div className={`h-full ${barTone} transition-all duration-500`} style={{ width: `${pct}%` }} />
              </div>
              <div className="flex justify-between mt-1.5 text-[11px] text-foreground-muted tabular-nums">
                <span>{currentIdx < 0 ? 0 : job.status === 'done' ? steps.length : currentIdx} of {steps.length} steps</span>
                <span>{pct}%</span>
              </div>
            </div>

            {job.last_error && (
              <pre className="mt-3.5 text-xs text-red-800 dark:text-red-300 whitespace-pre-wrap break-all bg-red-100/60 dark:bg-red-950/40 rounded-lg p-3 max-h-48 overflow-y-auto">
                {job.last_error}
              </pre>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-5 gap-5 items-start">
            <section className="lg:col-span-3 min-w-0 rounded-xl border border-border-default bg-surface-elevated overflow-hidden">
              <div className="px-5 py-3.5 border-b border-border-default">
                <h2 className="font-semibold text-foreground text-sm">Pipeline</h2>
              </div>
              <div className="p-5 space-y-5">
                {PHASES.map((phase) => {
                  const rows = phase.steps.filter((s) => steps.includes(s))
                  if (rows.length === 0) return null
                  const idxs = rows.map((s) => steps.indexOf(s))
                  const allDone = idxs.every((i) => stateOf(i) === 'done')
                  return (
                    <div key={phase.label} className="min-w-0">
                      <div className="flex items-center gap-2 mb-2.5">
                        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-foreground-muted">{phase.label}</h3>
                        {allDone && <span className="text-[11px] text-green-600 dark:text-green-400">✓</span>}
                      </div>
                      <ol className="relative space-y-2.5 before:absolute before:left-[5px] before:top-2 before:bottom-2 before:w-px before:bg-border-default">
                        {rows.map((s) => (
                          <StepRow key={s} name={s} index={steps.indexOf(s)} state={stateOf(steps.indexOf(s))} />
                        ))}
                      </ol>
                    </div>
                  )
                })}
              </div>
            </section>

            <section className="lg:col-span-2 min-w-0 rounded-xl border border-border-default bg-surface-elevated overflow-hidden">
              <div className="px-5 py-3.5 border-b border-border-default">
                <h2 className="font-semibold text-foreground text-sm">Created resources</h2>
              </div>
              <div className="p-5">
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Res label="RDS endpoint" value={res.endpoint || data?.tenant.rds_endpoint} wide />
                  <Res label="DB instance" value={res.dbInstanceId} />
                  <Res label="Param group" value={res.paramGroup} />
                  <Res label="S3 bucket" value={res.bucket || data?.tenant.s3_bucket} wide />
                  <Res
                    label="DNS hosts"
                    wide
                    value={Array.isArray(res.dnsHosts) && res.dnsHosts.length
                      ? <span className="flex flex-col gap-0.5">{res.dnsHosts.map((hst: string) => <span key={hst}>{hst}</span>)}</span>
                      : null}
                  />
                </dl>
                <details className="mt-4 group">
                  <summary className="text-xs text-foreground-muted cursor-pointer hover:text-foreground transition-colors">
                    Raw created_resources
                  </summary>
                  <pre className="mt-2 text-[11px] whitespace-pre-wrap break-all bg-surface-secondary rounded-lg p-3 max-h-64 overflow-y-auto">
                    {JSON.stringify(res, null, 2)}
                  </pre>
                </details>
              </div>
            </section>
          </div>

          <p className="text-[11px] text-foreground-muted break-all">
            Job {job.id} · created {new Date(job.created_at).toLocaleString('en-IN')}
          </p>
        </>
      )}
    </div>
  )
}
