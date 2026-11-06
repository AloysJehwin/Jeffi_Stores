import { flatSteps, pipelineOf, type StoredPipeline } from './pipeline'

// A provisioning job as the admin (and, stripped, the owner) sees it: the pinned pipeline's jobs and
// steps with each step's state, timing and log. Pure.

export type StepStatus = 'queued' | 'running' | 'waiting' | 'success' | 'failed' | 'skipped' | 'warning'
export type RunStatus = 'queued' | 'running' | 'waiting' | 'success' | 'failed'

type When = string | Date | null | undefined

export interface ViewJobInput {
  status: string
  step: string
  attempts?: number
  last_error?: string | null
  next_attempt_at?: When
  step_started_at?: When
  created_at: When
  updated_at: When
  created_resources?: Record<string, any> | null
  pipeline?: StoredPipeline | null
}

export interface ViewEventInput {
  step: string
  status: string
  message: string | null
  detail?: Record<string, unknown> | null
  started_at?: When
  duration_ms?: number | null
  created_at: When
}

export interface EventView {
  status: string
  message: string | null
  detail: Record<string, unknown>
  started_at: string | null
  duration_ms: number | null
  created_at: string | null
}

export interface StepView {
  id: string
  label: string
  status: StepStatus
  startedAt: string | null
  finishedAt: string | null
  durationMs: number | null
  attempts: number
  detail: string | null
  events: EventView[]
}

export interface JobView {
  id: string
  label: string
  status: StepStatus
  startedAt: string | null
  durationMs: number | null
  steps: StepView[]
}

export interface PipelineView {
  v: number
  status: RunStatus
  startedAt: string | null
  finishedAt: string | null
  durationMs: number | null
  progress: { done: number; total: number; skipped: number; warnings: number }
  current: { id: string; label: string } | null
  jobs: JobView[]
}

const ms = (w: When): number | null => {
  if (w === null || w === undefined) return null
  const t = new Date(w).getTime()
  return Number.isFinite(t) ? t : null
}
const iso = (t: number | null) => (t === null ? null : new Date(t).toISOString())

const OUTCOME: Record<string, StepStatus> = { ok: 'success', skipped: 'skipped', warning: 'warning' }
const FINISHED: StepStatus[] = ['success', 'skipped', 'warning']

function rollUp(steps: StepView[]): StepStatus {
  const has = (s: StepStatus) => steps.some(x => x.status === s)
  if (has('failed')) return 'failed'
  if (has('running')) return 'running'
  if (has('waiting')) return 'waiting'
  const finished = steps.filter(s => FINISHED.includes(s.status))
  if (!finished.length) return 'queued'
  if (finished.length < steps.length) return 'running'
  if (has('warning')) return 'warning'
  return finished.every(s => s.status === 'skipped') ? 'skipped' : 'success'
}

export function describePipeline(job: ViewJobInput, events: ViewEventInput[], now = Date.now()): PipelineView {
  const p = pipelineOf(job.pipeline)
  const all = flatSteps(p)
  const done = job.status === 'done'
  const failed = job.status === 'failed'
  const at = done ? all.length : all.indexOf(job.step as (typeof all)[number])
  const retryAt = ms(job.next_attempt_at)
  const backingOff = job.status === 'pending' && retryAt !== null && retryAt > now
  const updated = ms(job.updated_at)
  const created = ms(job.created_at)

  const byStep = new Map<string, ViewEventInput[]>()
  for (const e of [...events].sort((a, b) => (ms(a.created_at) ?? 0) - (ms(b.created_at) ?? 0))) {
    if (!all.includes(e.step as (typeof all)[number])) continue
    byStep.set(e.step, [...(byStep.get(e.step) ?? []), e])
  }

  let prevFinished: number | null = created
  let flatIndex = 0
  const jobs: JobView[] = p.jobs.map(j => {
    const steps: StepView[] = j.steps.map(s => {
      const i = flatIndex++
      const evs = byStep.get(s.id) ?? []
      const view: StepView = {
        id: s.id,
        label: s.label,
        status: 'queued',
        startedAt: null,
        finishedAt: null,
        durationMs: null,
        attempts: 0,
        detail: null,
        events: evs.map(e => ({
          status: e.status,
          message: e.message,
          detail: (e.detail ?? {}) as Record<string, unknown>,
          started_at: iso(ms(e.started_at)),
          duration_ms: e.duration_ms ?? null,
          created_at: iso(ms(e.created_at)),
        })),
      }
      const errors = evs.filter(e => e.status === 'error').length
      if (at >= 0 && i < at) {
        const last = [...evs].reverse().find(e => OUTCOME[e.status])
        // A legacy step that left no event still ran: the job moved past it.
        view.status = last ? OUTCOME[last.status] : 'success'
        view.attempts = errors + 1
        if (last) {
          const finished = ms(last.created_at)
          const started = ms(last.started_at) ?? prevFinished
          view.finishedAt = iso(finished)
          view.startedAt = iso(started)
          view.durationMs = started !== null && finished !== null ? Math.max(0, finished - started) : (last.duration_ms ?? null)
          prevFinished = finished ?? prevFinished
        }
      } else if (i === at) {
        view.status = failed ? 'failed' : backingOff ? 'waiting' : 'running'
        view.attempts = errors + (failed ? 0 : 1)
        const started = ms(job.step_started_at) ?? prevFinished ?? updated
        const end = failed ? updated : now
        view.startedAt = iso(started)
        view.finishedAt = failed ? iso(updated) : null
        view.durationMs = started !== null && end !== null ? Math.max(0, end - started) : null
        view.detail = failed ? null : (job.created_resources?.stepDetail ?? null)
      }
      return view
    })
    const startedAt = steps.find(s => s.startedAt)?.startedAt ?? null
    const timed = steps.filter(s => s.durationMs !== null)
    return {
      id: j.id,
      label: j.label,
      status: rollUp(steps),
      startedAt,
      durationMs: timed.length ? timed.reduce((n, s) => n + (s.durationMs as number), 0) : null,
      steps,
    }
  })

  const flat = jobs.flatMap(j => j.steps)
  const current = !done && at >= 0 ? flat[at] : null
  const status: RunStatus = done
    ? 'success'
    : failed
      ? 'failed'
      : backingOff
        ? 'waiting'
        : at === 0 && !job.attempts && !flat[0]?.events.length
          ? 'queued'
          : 'running'
  const finishedAt = done || failed ? updated : null
  return {
    v: p.v,
    status,
    startedAt: iso(created),
    finishedAt: iso(finishedAt),
    durationMs: created !== null ? Math.max(0, (finishedAt ?? now) - created) : null,
    progress: {
      done: flat.filter(s => FINISHED.includes(s.status)).length,
      total: flat.length,
      skipped: flat.filter(s => s.status === 'skipped').length,
      warnings: flat.filter(s => s.status === 'warning').length,
    },
    current: current ? { id: current.id, label: current.label } : null,
    jobs,
  }
}

/** What the store owner sees: labels, states, timing and progress. No messages, resources or errors. */
export interface OwnerPipelineView {
  status: RunStatus
  failed: boolean
  startedAt: string | null
  finishedAt: string | null
  durationMs: number | null
  progress: PipelineView['progress']
  current: string | null
  jobs: { id: string; label: string; status: StepStatus; durationMs: number | null; steps: { id: string; label: string; status: StepStatus; durationMs: number | null }[] }[]
}

export function ownerPipelineView(v: PipelineView): OwnerPipelineView {
  return {
    status: v.status,
    failed: v.status === 'failed',
    startedAt: v.startedAt,
    finishedAt: v.finishedAt,
    durationMs: v.durationMs,
    progress: v.progress,
    current: v.current?.label ?? null,
    jobs: v.jobs.map(j => ({
      id: j.id,
      label: j.label,
      status: j.status,
      durationMs: j.durationMs,
      steps: j.steps.map(s => ({ id: s.id, label: s.label, status: s.status, durationMs: s.durationMs })),
    })),
  }
}
