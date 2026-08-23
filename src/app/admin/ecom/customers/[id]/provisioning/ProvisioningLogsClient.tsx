'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'

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

function StepDot({ state }: { state: 'done' | 'current' | 'pending' | 'failed' }) {
  const cls = state === 'done' ? 'bg-green-500 border-green-500'
    : state === 'current' ? 'bg-accent-500 border-accent-500 animate-pulse'
    : state === 'failed' ? 'bg-red-500 border-red-500'
    : 'bg-transparent border-border-default'
  return <span className={`inline-block w-3 h-3 rounded-full border-2 ${cls}`} />
}

export default function ProvisioningLogsClient({ tenantId, slug }: { tenantId: string; slug: string }) {
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
      // Stop polling once the job is terminal (or there is no job).
      if (!d.job || TERMINAL.includes(d.job.status)) setLive(false)
    } catch { setErr('Network error') }
  }, [tenantId])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (!live) return
    timer.current = setInterval(load, 4000)
    return () => { if (timer.current) clearInterval(timer.current) }
  }, [live, load])

  const job = data?.job
  const steps = data?.steps ?? []
  const currentIdx = job ? steps.indexOf(job.step) : -1
  const res = job?.created_resources ?? {}

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={load} className="px-3 py-1.5 rounded-lg border border-border-default text-sm hover:bg-surface-secondary">Refresh</button>
        <label className="flex items-center gap-2 text-sm text-foreground-muted">
          <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} />
          Live {live && <span className="inline-block w-2 h-2 rounded-full bg-green-500 animate-pulse" />}
        </label>
        {job && <span className="text-xs text-foreground-muted ml-auto">Updated {new Date(job.updated_at).toLocaleTimeString('en-IN')}</span>}
      </div>

      {err && <p className="text-sm text-red-600 dark:text-red-400">{err}</p>}

      {!job && !err && (
        <div className="rounded-xl border border-border-default p-6 bg-surface-elevated text-sm text-foreground-muted">
          No provisioning job for this tenant yet. It is created when the owner pays and provisioning is triggered.
        </div>
      )}

      {job && (
        <>
          {/* Status banner */}
          <div className={`rounded-xl border p-4 ${
            job.status === 'done' ? 'border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-900/20'
            : job.status === 'failed' ? 'border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/20'
            : 'border-accent-300 dark:border-accent-700 bg-accent-50 dark:bg-accent-900/20'
          }`}>
            <div className="flex items-center gap-3 flex-wrap">
              <span className="font-semibold text-foreground capitalize">{job.status}</span>
              <span className="text-sm text-foreground-muted">step: <span className="font-mono">{job.step}</span></span>
              <span className="text-sm text-foreground-muted">attempts: {job.attempts}</span>
              {job.next_attempt_at && new Date(job.next_attempt_at) > new Date() && (
                <span className="text-sm text-amber-600 dark:text-amber-400">next retry {new Date(job.next_attempt_at).toLocaleTimeString('en-IN')}</span>
              )}
            </div>
            {job.last_error && (
              <pre className="mt-3 text-xs text-red-700 dark:text-red-300 whitespace-pre-wrap break-all bg-red-100/50 dark:bg-red-900/30 rounded p-2">{job.last_error}</pre>
            )}
          </div>

          {/* Step timeline + resources side by side on wide screens */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Step timeline */}
            <div className="rounded-xl border border-border-default p-5 bg-surface-elevated">
              <h2 className="font-semibold text-foreground mb-4">Steps</h2>
              <ol className="space-y-2.5">
                {steps.map((s, i) => {
                  const state = job.status === 'failed' && i === currentIdx ? 'failed'
                    : i < currentIdx || job.status === 'done' ? 'done'
                    : i === currentIdx ? 'current'
                    : 'pending'
                  return (
                    <li key={s} className="flex items-center gap-3">
                      <StepDot state={state} />
                      <span className={`text-sm font-mono ${state === 'pending' ? 'text-foreground-muted' : 'text-foreground'}`}>{s}</span>
                      {state === 'current' && <span className="text-xs text-accent-600 dark:text-accent-400">running…</span>}
                    </li>
                  )
                })}
              </ol>
            </div>

            {/* Created resources */}
            <div className="rounded-xl border border-border-default p-5 bg-surface-elevated">
              <h2 className="font-semibold text-foreground mb-4">Created resources</h2>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                <div><dt className="text-xs uppercase text-foreground-muted">RDS endpoint</dt><dd className="font-mono text-xs break-all">{res.endpoint || data?.tenant.rds_endpoint || '—'}</dd></div>
                <div><dt className="text-xs uppercase text-foreground-muted">DB instance</dt><dd className="font-mono text-xs">{res.dbInstanceId || '—'}</dd></div>
                <div><dt className="text-xs uppercase text-foreground-muted">Param group</dt><dd className="font-mono text-xs">{res.paramGroup || '—'}</dd></div>
                <div><dt className="text-xs uppercase text-foreground-muted">S3 bucket</dt><dd className="font-mono text-xs">{res.bucket || data?.tenant.s3_bucket || '—'}</dd></div>
                <div className="sm:col-span-2"><dt className="text-xs uppercase text-foreground-muted">DNS hosts</dt><dd className="font-mono text-xs break-all">{Array.isArray(res.dnsHosts) ? res.dnsHosts.join(', ') : '—'}</dd></div>
              </dl>
              <details className="mt-4">
                <summary className="text-xs text-foreground-muted cursor-pointer">Raw created_resources</summary>
                <pre className="mt-2 text-xs whitespace-pre-wrap break-all bg-surface-secondary rounded p-2">{JSON.stringify(res, null, 2)}</pre>
              </details>
            </div>
          </div>

          <div className="text-xs text-foreground-muted">
            Job {job.id} · created {new Date(job.created_at).toLocaleString('en-IN')}
          </div>
        </>
      )}

      <Link href={`/admin/ecom/customers/${tenantId}`} className="inline-block text-sm text-accent-600 dark:text-accent-400 hover:underline">← Back to {slug}</Link>
    </div>
  )
}
