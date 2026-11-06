import { AlertTriangle, CheckCircle2, Circle, Clock, Loader2, MinusCircle, XCircle, type LucideIcon } from 'lucide-react'
import type { StatusMap, Tone } from '@/components/admin/kit'
import type { StepStatus } from '@controller/lib/provisioning/pipeline-view'

export const PIPELINE_STATUS: StatusMap = {
  queued: { label: 'Queued', tone: 'muted' },
  running: { label: 'Running', tone: 'blue' },
  waiting: { label: 'Waiting', tone: 'amber' },
  success: { label: 'Success', tone: 'green' },
  failed: { label: 'Failed', tone: 'red' },
  skipped: { label: 'Skipped', tone: 'muted' },
  warning: { label: 'Warning', tone: 'amber' },
}

export const STEP_ICON: Record<StepStatus, { icon: LucideIcon; cls: string }> = {
  queued: { icon: Circle, cls: 'text-foreground-muted' },
  running: { icon: Loader2, cls: 'text-blue-600 dark:text-blue-400 animate-spin' },
  waiting: { icon: Clock, cls: 'text-amber-600 dark:text-amber-400' },
  success: { icon: CheckCircle2, cls: 'text-green-600 dark:text-green-400' },
  failed: { icon: XCircle, cls: 'text-red-600 dark:text-red-400' },
  skipped: { icon: MinusCircle, cls: 'text-foreground-muted' },
  warning: { icon: AlertTriangle, cls: 'text-amber-600 dark:text-amber-400' },
}

/** Progress-bar segment colour by job status. */
export const BAR_CLS: Record<StepStatus, string> = {
  queued: 'bg-surface-secondary',
  running: 'bg-blue-500',
  waiting: 'bg-amber-500',
  success: 'bg-green-500',
  failed: 'bg-red-500',
  skipped: 'bg-foreground-muted/40',
  warning: 'bg-amber-500',
}

export const EVENT_TONE: Record<string, Tone> = { ok: 'green', error: 'red', warning: 'amber', skipped: 'muted' }

export function fmtDuration(ms: number | null | undefined): string {
  if (ms == null) return ''
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`
  return `${Math.floor(ms / 3_600_000)}h ${Math.round((ms % 3_600_000) / 60_000)}m`
}
