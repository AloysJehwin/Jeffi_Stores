import { describe, it, expect } from 'vitest'
import { describePipeline, ownerPipelineView } from '@controller/lib/provisioning/pipeline-view'

const T0 = Date.parse('2026-11-01T10:00:00Z')
const at = (s: number) => new Date(T0 + s * 1000).toISOString()
const pinned = {
  v: 2,
  jobs: [
    { id: 'a', label: 'A', steps: [{ id: 'preflight', label: 'Preflight' }, { id: 'load_schema', label: 'Schema' }] },
    { id: 'b', label: 'B', steps: [{ id: 'seed_settings', label: 'Settings' }, { id: 'activate', label: 'Go live' }] },
  ],
}
const job = (o: Record<string, unknown> = {}) => ({
  status: 'running',
  step: 'seed_settings',
  attempts: 3,
  created_at: at(0),
  updated_at: at(50),
  step_started_at: at(40),
  created_resources: {},
  pipeline: pinned,
  ...o,
})
const ev = (step: string, status: string, created: number, started?: number, message: string | null = null) => ({
  step,
  status,
  message,
  detail: {},
  started_at: started === undefined ? null : at(started),
  duration_ms: null,
  created_at: at(created),
})

describe('describePipeline', () => {
  it('steps before the current one take their last outcome; the current runs; the rest are queued', () => {
    const v = describePipeline(job(), [ev('preflight', 'ok', 10, 0), ev('load_schema', 'error', 20), ev('load_schema', 'skipped', 40, 25)], T0 + 60_000)
    const [pre, schema, settings, live] = v.jobs.flatMap(j => j.steps)
    expect(pre).toMatchObject({ status: 'success', durationMs: 10_000, attempts: 1 })
    expect(schema).toMatchObject({ status: 'skipped', durationMs: 15_000, attempts: 2 })
    expect(settings).toMatchObject({ status: 'running', startedAt: at(40), durationMs: 20_000 })
    expect(live.status).toBe('queued')
    expect(v.jobs.map(j => j.status)).toEqual(['success', 'running'])
    expect(v).toMatchObject({ status: 'running', current: { id: 'seed_settings', label: 'Settings' }, progress: { done: 2, total: 4, skipped: 1, warnings: 0 } })
  })

  it('a legacy event without started_at is timed from the previous step’s finish; a step with no event still ran', () => {
    const v = describePipeline(job({ step: 'seed_settings', pipeline: pinned }), [ev('load_schema', 'ok', 30)], T0 + 60_000)
    const [pre, schema] = v.jobs[0].steps
    expect(pre).toMatchObject({ status: 'success', durationMs: null })
    expect(schema).toMatchObject({ status: 'success', startedAt: at(0), durationMs: 30_000 })
  })

  it('a failed job marks its step failed; a backing-off job is waiting', () => {
    const failed = describePipeline(job({ status: 'failed', step: 'load_schema' }), [], T0 + 60_000)
    expect(failed.jobs[0].steps[1].status).toBe('failed')
    expect(failed).toMatchObject({ status: 'failed', finishedAt: at(50), durationMs: 50_000 })
    const waiting = describePipeline(job({ status: 'pending', next_attempt_at: at(120) }), [], T0 + 60_000)
    expect(waiting.status).toBe('waiting')
    expect(waiting.current?.id).toBe('seed_settings')
  })

  it('a warning rolls up into its job; a done job has every step finished', () => {
    const v = describePipeline(job({ status: 'done', step: 'activate' }), [ev('seed_settings', 'warning', 45, 41, 'no owner')], T0 + 60_000)
    expect(v.status).toBe('success')
    expect(v.jobs[1].status).toBe('warning')
    expect(v.progress).toMatchObject({ done: 4, total: 4, warnings: 1 })
    expect(v.current).toBeNull()
  })

  it('a job with no pinned pipeline is shown as the legacy list; unknown event steps are ignored', () => {
    const v = describePipeline(job({ pipeline: null, step: 'create_param_group' }), [ev('launch_server', 'ok', 5)], T0)
    expect(v.v).toBe(1)
    expect(v.jobs.flatMap(j => j.steps).some(s => s.id === 'launch_server')).toBe(false)
    expect(v.jobs[1].steps[0]).toMatchObject({ id: 'create_param_group', status: 'running' })
  })

  it('the waiting step carries its detail', () => {
    const v = describePipeline(job({ created_resources: { stepDetail: 'waiting for the Postgres pod' } }), [], T0)
    expect(v.jobs[1].steps[0].detail).toBe('waiting for the Postgres pod')
  })
})

describe('ownerPipelineView', () => {
  it('keeps labels, states and timing, and drops messages and detail', () => {
    const v = describePipeline(job({ status: 'failed', step: 'load_schema', last_error: 'secret host' }), [ev('preflight', 'ok', 10, 0, 'internal')], T0)
    const o = ownerPipelineView(v)
    expect(o).toMatchObject({ status: 'failed', failed: true, current: 'Schema' })
    expect(JSON.stringify(o)).not.toMatch(/internal|secret|events|detail/)
  })
})
