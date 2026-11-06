import { StatusBadge } from '@/components/admin/kit'
import type { PipelineView } from '@controller/lib/provisioning/pipeline-view'
import { BAR_CLS, PIPELINE_STATUS, fmtDuration } from './status'

/** The run at a glance: status, duration, steps done, a bar segment per job, and the last error. */
export function PipelineSummary({
  pipeline,
  lastError,
  retryAt,
}: {
  pipeline: PipelineView
  lastError: string | null
  retryAt: string | null
}) {
  const { progress } = pipeline
  const retrying = retryAt && new Date(retryAt) > new Date()
  return (
    <div className="min-w-0 rounded-xl border border-border-default bg-surface-elevated p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <StatusBadge status={pipeline.status} map={PIPELINE_STATUS} />
        {pipeline.current && <span className="min-w-0 truncate text-sm text-foreground">{pipeline.current.label}</span>}
        <span className="text-sm text-foreground-muted tabular-nums">
          {progress.done} of {progress.total} steps
        </span>
        {pipeline.durationMs != null && <span className="text-sm text-foreground-muted tabular-nums">{fmtDuration(pipeline.durationMs)}</span>}
        {progress.skipped > 0 && <span className="text-xs text-foreground-muted">{progress.skipped} skipped</span>}
        {progress.warnings > 0 && (
          <span className="text-xs text-amber-700 dark:text-amber-400">
            {progress.warnings} {progress.warnings === 1 ? 'warning' : 'warnings'}
          </span>
        )}
        {retrying && (
          <span className="text-xs text-amber-700 dark:text-amber-400">retry at {new Date(retryAt).toLocaleTimeString('en-IN')}</span>
        )}
      </div>

      <div className="mt-3.5 flex h-1.5 gap-0.5 overflow-hidden rounded-full" role="img" aria-label={`${progress.done} of ${progress.total} steps`}>
        {pipeline.jobs.map(j => (
          <div key={j.id} title={`${j.label}: ${PIPELINE_STATUS[j.status]?.label ?? j.status}`} className={BAR_CLS[j.status]} style={{ flex: j.steps.length }} />
        ))}
      </div>

      {lastError && (
        <pre className="mt-3.5 max-h-48 overflow-y-auto whitespace-pre-wrap break-all rounded-lg bg-red-500/10 p-3 text-xs text-red-700 dark:text-red-400">
          {lastError}
        </pre>
      )}
    </div>
  )
}
