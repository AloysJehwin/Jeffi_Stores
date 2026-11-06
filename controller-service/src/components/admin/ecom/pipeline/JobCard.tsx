'use client'

import { useEffect, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { StatusBadge } from '@/components/admin/kit'
import type { JobView } from '@controller/lib/provisioning/pipeline-view'
import { StepRow } from './StepRow'
import { PIPELINE_STATUS, STEP_ICON, fmtDuration } from './status'

const OPEN = ['running', 'waiting', 'failed']

/** A pipeline job as an accordion (small screens); open while it runs or after it failed. */
export function JobCard({ job, startIndex, certificatesHref }: { job: JobView; startIndex: number; certificatesHref?: string }) {
  const [open, setOpen] = useState(OPEN.includes(job.status))
  useEffect(() => {
    if (OPEN.includes(job.status)) setOpen(true)
  }, [job.status])
  const { icon: Icon, cls } = STEP_ICON[job.status]
  const finished = job.steps.filter(s => ['success', 'skipped', 'warning'].includes(s.status)).length

  return (
    <section className="min-w-0 rounded-xl border border-border-default bg-surface-elevated overflow-hidden">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(v => !v)}
        className="flex w-full items-center gap-2.5 px-3 py-3 text-left hover:bg-surface-secondary"
      >
        <Icon className={`w-4 h-4 shrink-0 ${cls}`} />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{job.label}</span>
        <span className="shrink-0 text-[11px] tabular-nums text-foreground-muted">
          {finished}/{job.steps.length}
          {job.durationMs != null && ` · ${fmtDuration(job.durationMs)}`}
        </span>
        <StatusBadge status={job.status} map={PIPELINE_STATUS} />
        <ChevronRight className={`w-3.5 h-3.5 shrink-0 text-foreground-muted transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && (
        <ol className="space-y-0.5 border-t border-border-default px-1 py-2">
          {job.steps.map((s, i) => (
            <StepRow key={s.id} step={s} index={startIndex + i} certificatesHref={certificatesHref} />
          ))}
        </ol>
      )}
    </section>
  )
}
