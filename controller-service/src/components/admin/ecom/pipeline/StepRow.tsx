'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { badgeCls } from '@/components/admin/kit'
import type { EventView, StepView } from '@controller/lib/provisioning/pipeline-view'
import { EVENT_TONE, STEP_ICON, fmtDuration } from './status'

function StepLog({ e }: { e: EventView }) {
  return (
    <div className="text-[11px] min-w-0">
      <div className="flex items-center gap-2 flex-wrap">
        <span className={badgeCls(EVENT_TONE[e.status] ?? 'muted')}>{e.status}</span>
        {e.created_at && <span className="text-foreground-muted tabular-nums">{new Date(e.created_at).toLocaleTimeString('en-IN')}</span>}
        {e.duration_ms != null && <span className="text-foreground-muted tabular-nums">{fmtDuration(e.duration_ms)}</span>}
      </div>
      {e.message && <p className="mt-0.5 text-foreground break-words whitespace-pre-wrap">{e.message}</p>}
      {Object.keys(e.detail).length > 0 && (
        <dl className="mt-1 space-y-0.5">
          {Object.entries(e.detail).map(([k, v]) => (
            <div key={k} className="flex gap-2 min-w-0">
              <dt className="text-foreground-muted shrink-0">{k}</dt>
              <dd className="font-mono text-foreground break-all min-w-0">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  )
}

/** One step: state, duration and attempts; expands to every attempt's log line. */
export function StepRow({ step, index, certificatesHref }: { step: StepView; index: number; certificatesHref?: string }) {
  const [open, setOpen] = useState(step.status === 'failed')
  useEffect(() => {
    if (step.status === 'failed') setOpen(true)
  }, [step.status])
  const { icon: Icon, cls } = STEP_ICON[step.status]
  const hasLog = step.events.length > 0 || !!step.detail
  const errors = step.events.filter(e => e.status === 'error').length
  const muted = step.status === 'queued' || step.status === 'skipped'

  return (
    <li className="min-w-0">
      <button
        type="button"
        disabled={!hasLog}
        aria-expanded={hasLog ? open : undefined}
        onClick={() => setOpen(v => !v)}
        className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-surface-secondary disabled:cursor-default disabled:hover:bg-transparent"
      >
        <Icon className={`w-4 h-4 shrink-0 ${cls}`} />
        <span className="text-[10px] tabular-nums text-foreground-muted w-4 shrink-0">{index + 1}</span>
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-sm ${muted ? 'text-foreground-muted' : 'text-foreground'}`}>{step.label}</span>
          {step.detail && step.status !== 'failed' && <span className="block truncate text-[11px] text-foreground-muted">{step.detail}</span>}
        </span>
        {errors > 0 && <span className={`${badgeCls('red')} shrink-0`}>{errors === 1 ? '1 retry' : `${errors} retries`}</span>}
        {step.durationMs != null && <span className="shrink-0 text-[11px] tabular-nums text-foreground-muted">{fmtDuration(step.durationMs)}</span>}
        {hasLog && <ChevronRight className={`w-3.5 h-3.5 shrink-0 text-foreground-muted transition-transform ${open ? 'rotate-90' : ''}`} />}
      </button>
      {step.status === 'warning' && step.id === 'issue_owner_certificate' && certificatesHref && (
        <p className="ml-[38px] text-[11px] text-amber-700 dark:text-amber-400">
          The store went live without its owner certificate.{' '}
          <Link href={certificatesHref} className="underline">
            Issue it from Certificates
          </Link>
        </p>
      )}
      {open && hasLog && (
        <div className="ml-[38px] mt-1 mb-2 space-y-2 border-l border-border-default pl-3 max-h-64 overflow-y-auto">
          <p className="font-mono text-[10px] text-foreground-muted break-all">{step.id}</p>
          {step.events.map((e, i) => (
            <StepLog key={i} e={e} />
          ))}
        </div>
      )}
    </li>
  )
}
