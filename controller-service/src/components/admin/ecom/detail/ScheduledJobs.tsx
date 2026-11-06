import { ChevronRight } from 'lucide-react'
import { StatusBadge, type StatusMap } from '@/components/admin/kit/status'
import type { StoreCronJobView } from '@controller/lib/cron/store-jobs'
import { Section } from '../EcomUI'
import { dateTimeIN } from '../cells'

const RUN_STATUS: StatusMap = {
  ok: { label: 'OK', tone: 'green' },
  failed: { label: 'Failed', tone: 'red' },
  skipped: { label: 'Skipped', tone: 'amber' },
  never: { label: 'Not run', tone: 'muted' },
}

/** The jobs the store's plan gets from the platform's cron fan-out, with the store's last result for each. */
export default function ScheduledJobs({ jobs }: { jobs: StoreCronJobView[] }) {
  const failing = jobs.filter(j => j.last?.status === 'failed').length
  const ok = jobs.filter(j => j.last?.status === 'ok').length
  return (
    <Section
      title="Scheduled jobs"
      action={
        <span className="text-xs text-foreground-muted">
          {jobs.length} {jobs.length === 1 ? 'job' : 'jobs'}
          {failing > 0 && <span className="text-red-600 dark:text-red-400"> · {failing} failing</span>}
        </span>
      }
    >
      {jobs.length === 0 ? (
        <p className="text-sm text-foreground-muted">The store&apos;s plan has no scheduled jobs.</p>
      ) : (
        // Collapsed unless something is failing.
        <details open={failing > 0} className="group">
          <summary className="flex items-center gap-2 cursor-pointer list-none text-sm text-foreground [&::-webkit-details-marker]:hidden">
            <ChevronRight className="w-4 h-4 shrink-0 text-foreground-muted transition-transform group-open:rotate-90" aria-hidden />
            <span>{ok} ok</span>
            {failing > 0 && <span className="text-red-600 dark:text-red-400">· {failing} failing</span>}
            {jobs.length - ok - failing > 0 && <span className="text-foreground-muted">· {jobs.length - ok - failing} not run or skipped</span>}
          </summary>
        <ul className="divide-y divide-border-default mt-2 min-w-0">
          {jobs.map(j => (
            <li key={j.id} className="py-2 min-w-0">
              <div className="flex items-start justify-between gap-3 min-w-0">
                <div className="min-w-0">
                  <p className="text-sm text-foreground truncate">{j.name}</p>
                  <p className="text-[11px] text-foreground-muted truncate">{j.interval}</p>
                </div>
                <div className="flex flex-col items-end gap-0.5 shrink-0">
                  <StatusBadge status={j.last?.status ?? 'never'} map={RUN_STATUS} />
                  {j.last?.at && <span className="text-[11px] tabular-nums text-foreground-muted">{dateTimeIN(j.last.at)}</span>}
                </div>
              </div>
              {j.last?.detail && j.last.status !== 'ok' && <p className="mt-1 text-[11px] text-foreground-muted break-words">{j.last.detail}</p>}
            </li>
          ))}
        </ul>
        </details>
      )}
    </Section>
  )
}
