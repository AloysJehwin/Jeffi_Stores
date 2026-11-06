import { describe, it, expect } from 'vitest'
import {
  LEGACY_PIPELINE,
  LEGACY_STEP_IDS,
  STEP_CATALOG,
  buildPipeline,
  flatSteps,
  issuesOwnerCertificate,
  nextStepAfter,
  pipelineOf,
  type PipelineOptions,
} from '@controller/lib/provisioning/pipeline'

const opts = (o: Partial<PipelineOptions> = {}): PipelineOptions => ({ engine: 'k8s', provider: 'aws', restore: false, seed: false, ...o })
const spec = (mode: 'node' | 'shared' | 'dedicated') => ({ db: { mode } })
const jobIds = (p: ReturnType<typeof buildPipeline>) => p.jobs.map(j => j.id)
const stepsOf = (p: ReturnType<typeof buildPipeline>, job: string) => p.jobs.find(j => j.id === job)?.steps.map(s => s.id)

describe('buildPipeline', () => {
  it('a store with its database on its own server: server, disk, Postgres, database; no RDS steps', () => {
    const p = buildPipeline(spec('node'), 'basic', opts())
    expect(p.v).toBe(2)
    expect(stepsOf(p, 'database')).toEqual(['launch_server', 'attach_db_disk', 'start_postgres', 'create_database'])
    expect(flatSteps(p)).not.toContain('create_param_group')
    expect(flatSteps(p)).not.toContain('wait_db_available')
    expect(p.jobs.find(j => j.id === 'compute')?.steps[0].label).toBe('Start store services')
  })

  it('a store with its own RDS: parameter group, instance, wait', () => {
    const p = buildPipeline(spec('dedicated'), 'growth', opts({ engine: 'ec2' }))
    expect(stepsOf(p, 'database')).toEqual(['create_param_group', 'create_db_instance', 'wait_db_available'])
    expect(stepsOf(p, 'network')).toEqual(['configure_dns', 'verify_serving'])
    expect(p.jobs.find(j => j.id === 'compute')?.steps[0].label).toBe('Launch app server')
  })

  it('a Starter store on a shared host: a seat and its database, no parameter group', () => {
    const p = buildPipeline(spec('shared'), 'starter', opts({ engine: 'ec2', provider: 'stub' }))
    expect(stepsOf(p, 'database')).toEqual(['create_db_instance', 'wait_db_available'])
    expect(stepsOf(p, 'network')).toEqual(['configure_dns'])
    expect(p.jobs.find(j => j.id === 'compute')?.steps[0].label).toBe('Join shared app server')
  })

  it('k8s needs no DNS step (wildcard), and the stub provider has nothing to probe: no network job', () => {
    expect(stepsOf(buildPipeline(spec('node'), 'basic', opts()), 'network')).toEqual(['verify_serving'])
    expect(jobIds(buildPipeline(spec('node'), 'basic', opts({ provider: 'stub' })))).not.toContain('network')
  })

  it('schema & data: restore and seed only when the job asks', () => {
    expect(stepsOf(buildPipeline(spec('node'), 'basic', opts()), 'schema')).toEqual(['load_schema'])
    expect(stepsOf(buildPipeline(spec('node'), 'basic', opts({ seed: true })), 'schema')).toEqual(['load_schema', 'seed_data'])
    expect(stepsOf(buildPipeline(spec('node'), 'basic', opts({ restore: true, seed: true })), 'schema')).toEqual(['load_schema', 'restore_data'])
  })

  it('always ends by issuing the owner certificate, then going live', () => {
    for (const mode of ['node', 'shared', 'dedicated'] as const) {
      const p = buildPipeline(spec(mode), 'pro', opts({ engine: 'ec2' }))
      expect(stepsOf(p, 'golive')).toEqual(['issue_owner_certificate', 'activate'])
      expect(flatSteps(p).at(-1)).toBe('activate')
      expect(issuesOwnerCertificate(p)).toBe(true)
    }
  })

  it('the stub provider leaves the owner certificate to the worker (fireOwnerAdmin)', () => {
    const p = buildPipeline(spec('node'), 'basic', opts({ provider: 'stub' }))
    expect(stepsOf(p, 'golive')).toEqual(['activate'])
    expect(issuesOwnerCertificate(p)).toBe(false)
  })

  it('on k8s with real infra, connects the scheduled jobs once the store is live', () => {
    const p = buildPipeline(spec('node'), 'basic', opts())
    expect(jobIds(p).slice(-2)).toEqual(['golive', 'crons'])
    expect(flatSteps(p).slice(-2)).toEqual(['activate', 'connect_crons'])
    expect(STEP_CATALOG.connect_crons).toMatchObject({ continueOnError: true, alertAs: 'cron_connect' })
    expect(jobIds(buildPipeline(spec('node'), 'basic', opts({ provider: 'stub' })))).not.toContain('crons')
    expect(jobIds(buildPipeline(spec('dedicated'), 'pro', opts({ engine: 'ec2' })))).not.toContain('crons')
  })

  it('every step is unique and has a catalog policy', () => {
    for (const mode of ['node', 'shared', 'dedicated'] as const)
      for (const engine of ['k8s', 'ec2'] as const) {
        const all = flatSteps(buildPipeline(spec(mode), 'growth', opts({ engine, restore: true })))
        expect(new Set(all).size).toBe(all.length)
        for (const id of all) expect(STEP_CATALOG[id]).toBeDefined()
      }
  })
})

describe('legacy pipeline', () => {
  it('groups exactly the old step list, in order', () => {
    expect(flatSteps(LEGACY_PIPELINE)).toEqual([...LEGACY_STEP_IDS])
    expect(LEGACY_PIPELINE.v).toBe(1)
  })

  it('is what a job without a pinned pipeline runs, and it has no certificate step', () => {
    expect(pipelineOf(null)).toBe(LEGACY_PIPELINE)
    expect(pipelineOf({ v: 2, jobs: [] })).toBe(LEGACY_PIPELINE)
    expect(issuesOwnerCertificate(null)).toBe(false)
  })

  it('nextStepAfter follows the list and ends after the last step', () => {
    expect(nextStepAfter(LEGACY_PIPELINE, 'preflight')).toBe('create_param_group')
    expect(nextStepAfter(LEGACY_PIPELINE, 'verify_serving')).toBe('activate')
    expect(nextStepAfter(LEGACY_PIPELINE, 'activate')).toBeNull()
    expect(nextStepAfter(LEGACY_PIPELINE, 'nope')).toBeNull()
  })
})
