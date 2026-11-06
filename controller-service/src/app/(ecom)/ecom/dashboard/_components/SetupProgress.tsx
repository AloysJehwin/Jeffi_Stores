'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, CheckCircle2, Circle, Clock, Loader2, MinusCircle, XCircle } from 'lucide-react'
import type { OwnerPipelineView, StepStatus } from '@controller/lib/provisioning/pipeline-view'

const ICON: Record<StepStatus, { icon: typeof Circle; cls: string }> = {
  queued: { icon: Circle, cls: 'text-foreground-muted' },
  running: { icon: Loader2, cls: 'text-[var(--console-terracotta)] animate-spin' },
  waiting: { icon: Clock, cls: 'text-[var(--console-terracotta)]' },
  success: { icon: CheckCircle2, cls: 'org-sage-text' },
  failed: { icon: XCircle, cls: 'text-[#8a2e1f]' },
  skipped: { icon: MinusCircle, cls: 'text-foreground-muted' },
  warning: { icon: AlertTriangle, cls: 'text-[var(--console-terracotta)]' },
}

const minutes = (ms: number | null) => (ms == null ? '' : ms < 60_000 ? `${Math.max(1, Math.round(ms / 1000))}s` : `${Math.round(ms / 60_000)} min`)

/** The owner's live view of their store being set up. Polls until it is done, then refreshes the page. */
export default function SetupProgress({ tenantId }: { tenantId: string }) {
  const router = useRouter()
  const [p, setP] = useState<OwnerPipelineView | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let stop = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = async () => {
      try {
        const res = await fetch(`/api/ecom/provisioning?tenantId=${tenantId}`, { cache: 'no-store' })
        const d = res.ok ? await res.json() : null
        if (stop) return
        setP(d?.pipeline ?? null)
        setLoaded(true)
        if (d?.pipeline?.status === 'success') {
          router.refresh()
          return
        }
        if (d?.pipeline?.status === 'failed') return
      } catch {
        /* try again next tick */
      }
      if (!stop) timer = setTimeout(tick, 5000)
    }
    tick()
    return () => {
      stop = true
      if (timer) clearTimeout(timer)
    }
  }, [tenantId, router])

  if (!p) {
    return (
      <div className="flex items-center gap-2 text-sm text-foreground-secondary">
        <span className="w-4 h-4 shrink-0 border-2 border-[var(--console-terracotta)] border-t-transparent rounded-full animate-spin" />
        {loaded ? 'Provisioning in progress…' : 'Checking progress…'}
      </div>
    )
  }

  const pct = p.progress.total ? Math.round((p.progress.done / p.progress.total) * 100) : 0
  return (
    <div className="min-w-0 space-y-3">
      <div>
        <div className="flex items-baseline justify-between gap-3 text-sm">
          <span className="min-w-0 truncate font-medium text-foreground">
            {p.failed ? 'Setup paused — our team has been notified' : p.status === 'success' ? 'Your store is ready' : (p.current ?? 'Starting…')}
          </span>
          <span className="shrink-0 text-xs tabular-nums text-foreground-muted">
            {p.progress.done}/{p.progress.total}
          </span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-secondary" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className={`h-full transition-all duration-500 ${p.failed ? 'bg-[#8a2e1f]' : 'bg-[var(--console-terracotta)]'}`} style={{ width: `${pct}%` }} />
        </div>
      </div>
      <ol className="space-y-1.5">
        {p.jobs.map(j => {
          const { icon: Icon, cls } = ICON[j.status]
          return (
            <li key={j.id} className="flex items-center gap-2 text-sm min-w-0">
              <Icon className={`w-4 h-4 shrink-0 ${cls}`} />
              <span className={`min-w-0 flex-1 truncate ${j.status === 'queued' ? 'text-foreground-muted' : 'text-foreground'}`}>{j.label}</span>
              {j.durationMs != null && j.status !== 'queued' && <span className="shrink-0 text-xs tabular-nums text-foreground-muted">{minutes(j.durationMs)}</span>}
            </li>
          )
        })}
      </ol>
    </div>
  )
}
