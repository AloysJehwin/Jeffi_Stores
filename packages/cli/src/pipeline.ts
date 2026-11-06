// Terminal view of a provisioning pipeline (GET /v1/platform/ecom/customers/{id}/provisioning).
import { formatDuration } from './util'

export type StepStatus = 'queued' | 'running' | 'waiting' | 'success' | 'failed' | 'skipped' | 'warning'

export interface PipelineStep {
  id: string
  label?: string
  status: StepStatus
  durationMs?: number | null
  attempts?: number
  detail?: unknown
}

export interface PipelineJob {
  id: string
  label?: string
  status: StepStatus
  durationMs?: number | null
  steps: PipelineStep[]
}

export interface PipelineView {
  status: 'queued' | 'running' | 'waiting' | 'success' | 'failed'
  durationMs?: number | null
  progress?: { done: number; total: number; skipped?: number; warnings?: number }
  jobs: PipelineJob[]
}

export interface ProvisioningResponse {
  tenant?: { id?: string; slug?: string; status?: string }
  job?: { status?: string; step?: string; attempts?: number; last_error?: string | null; next_attempt_at?: string | null } | null
  pipeline?: PipelineView
  steps?: string[]
}

const ICON: Record<StepStatus, string> = { success: '✓', failed: '✗', running: '●', waiting: '◷', queued: '○', skipped: '–', warning: '!' }
const COLOR: Record<StepStatus, number> = { success: 32, failed: 31, running: 36, waiting: 33, queued: 90, skipped: 90, warning: 33 }

export const isTerminal = (s: string | undefined) => s === 'success' || s === 'failed'

/** Older servers answer without `pipeline`; build a flat one from `steps` and the job's current step. */
export function pipelineOf(res: ProvisioningResponse): PipelineView | null {
  if (res.pipeline) return res.pipeline
  if (!res.job || !Array.isArray(res.steps)) return null
  const current = res.steps.indexOf(res.job.step ?? '')
  const jobStatus = res.job.status
  const done = jobStatus === 'done' || jobStatus === 'succeeded'
  const steps: PipelineStep[] = res.steps.map((id, i) => ({
    id,
    status: done || i < current ? 'success' : i === current ? (jobStatus === 'failed' ? 'failed' : 'running') : 'queued',
  }))
  const status: PipelineView['status'] = done ? 'success' : jobStatus === 'failed' ? 'failed' : 'running'
  return { status, jobs: [{ id: 'provision', label: 'Provision', status, steps }], progress: { done: steps.filter(s => s.status === 'success').length, total: steps.length } }
}

function detailText(d: unknown): string {
  if (d == null || d === '') return ''
  if (typeof d === 'string') return d
  if (typeof d === 'object' && 'message' in (d as object)) return String((d as { message: unknown }).message)
  return JSON.stringify(d)
}

export function renderPipeline(res: ProvisioningResponse, opts: { color?: boolean; width?: number } = {}): string[] {
  const paint = (s: StepStatus, text: string) => (opts.color ? `\x1b[${COLOR[s] ?? 0}m${text}\x1b[0m` : text)
  const dim = (text: string) => (opts.color ? `\x1b[2m${text}\x1b[0m` : text)
  const width = opts.width ?? 100
  const p = pipelineOf(res)
  const lines: string[] = []
  const who = res.tenant?.slug ? `${res.tenant.slug} ` : ''
  if (!p) {
    lines.push(`${who}no provisioning job yet`)
    return lines
  }
  const prog = p.progress ? ` · ${p.progress.done} of ${p.progress.total} steps` : ''
  const extras = [p.progress?.skipped ? `${p.progress.skipped} skipped` : '', p.progress?.warnings ? `${p.progress.warnings} warnings` : ''].filter(Boolean).join(', ')
  lines.push(`${who}${paint(p.status, `${ICON[p.status] ?? '?'} ${p.status}`)}${prog}${extras ? ` (${extras})` : ''}${p.durationMs ? ` · ${formatDuration(p.durationMs)}` : ''}`)
  for (const job of p.jobs) {
    lines.push(`${paint(job.status, ICON[job.status] ?? '?')} ${job.label ?? job.id}${job.durationMs ? dim(`  ${formatDuration(job.durationMs)}`) : ''}`)
    for (const st of job.steps) {
      const meta = [st.durationMs ? formatDuration(st.durationMs) : '', st.attempts && st.attempts > 1 ? `attempt ${st.attempts}` : ''].filter(Boolean).join(', ')
      lines.push(`  ${paint(st.status, ICON[st.status] ?? '?')} ${st.label ?? st.id}${meta ? dim(`  ${meta}`) : ''}`)
      if (st.status === 'running' || st.status === 'failed' || st.status === 'warning' || st.status === 'waiting') {
        const d = detailText(st.detail)
        if (d) lines.push(dim(`      ${d.length > width - 6 ? d.slice(0, width - 7) + '…' : d}`))
      }
    }
  }
  if (res.job?.next_attempt_at && p.status === 'waiting') lines.push(dim(`retry at ${res.job.next_attempt_at}`))
  if (res.job?.last_error && p.status === 'failed') lines.push(paint('failed', `error: ${res.job.last_error}`))
  return lines
}
