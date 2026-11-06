// The provisioning pipeline: jobs of steps, built once per run from the store's compute and pinned on the
// job, so the runner and the admin view agree on what this store runs. Pure: no IO, safe for the client.

export type StepId =
  | 'preflight'
  | 'create_param_group'
  | 'create_db_instance'
  | 'wait_db_available'
  | 'launch_server'
  | 'attach_db_disk'
  | 'start_postgres'
  | 'create_database'
  | 'load_schema'
  | 'restore_data'
  | 'seed_data'
  | 'create_bucket'
  | 'write_infra'
  | 'generate_legals'
  | 'seed_settings'
  | 'ensure_compute'
  | 'setup_delhivery'
  | 'configure_dns'
  | 'verify_serving'
  | 'issue_owner_certificate'
  | 'activate'
  | 'connect_crons'

export interface PipelineStep {
  id: StepId
  label: string
}
export interface PipelineJob {
  id: string
  label: string
  steps: PipelineStep[]
}
/** v1: the fixed list jobs ran before pipelines were pinned; v2: built per store. */
export interface PipelineDef {
  v: 1 | 2
  jobs: PipelineJob[]
}

/** How a step ended (or that it must be polled again). */
export type StepResult =
  | { ok: true; message?: string }
  | { skip: string }
  | { warn: string }
  | { wait: true; detail?: string }

export const ok = (message?: string): StepResult => ({ ok: true, ...(message ? { message } : {}) })
export const skip = (reason: string): StepResult => ({ skip: reason })
export const warn = (message: string): StepResult => ({ warn: message })
export const wait = (detail?: string): StepResult => ({ wait: true, ...(detail ? { detail } : {}) })

export interface StepPolicy {
  /** The runner fails a waiting step after this long (from step_started_at). Steps that bound their own wait leave it unset. */
  timeoutMs?: number
  /** Out of attempts: record a warning and carry on instead of failing and rolling back. */
  continueOnError?: boolean
  maxAttempts?: number
  /** Step name the failure alert uses. */
  alertAs?: string
  /** created_resources keys this step produces (its visible output). */
  outputs: string[]
}

const MIN = 60_000

export const STEP_CATALOG: Record<StepId, StepPolicy> = {
  preflight: { outputs: [] },
  create_param_group: { outputs: ['paramGroup'] },
  create_db_instance: { outputs: ['dbInstanceId'] },
  wait_db_available: { outputs: ['endpoint', 'dbWaitStartedAt'] },
  launch_server: { timeoutMs: 15 * MIN, outputs: ['nodeInstances', 'poolInstanceId', 'computeMode'] },
  attach_db_disk: { timeoutMs: 10 * MIN, outputs: [] },
  start_postgres: { timeoutMs: 15 * MIN, outputs: [] },
  create_database: { timeoutMs: 5 * MIN, outputs: ['endpoint', 'dbName'] },
  load_schema: { outputs: [] },
  restore_data: { outputs: [] },
  seed_data: { outputs: ['seeded', 'seedProfile'] },
  create_bucket: { outputs: ['bucket'] },
  write_infra: { outputs: [] },
  generate_legals: { outputs: ['legalsGenerated'] },
  seed_settings: { outputs: ['settingsSeeded'] },
  ensure_compute: { outputs: ['ec2Target', 'ec2InstanceId', 'computeMode'] },
  setup_delhivery: { outputs: ['delhiveryPickup'] },
  configure_dns: { outputs: ['dnsHosts'] },
  verify_serving: { outputs: ['verifyAttempts', 'verifyStartedAt'] },
  issue_owner_certificate: { continueOnError: true, maxAttempts: 4, alertAs: 'owner_admin_cert', outputs: ['ownerCert', 'mtlsFleet'] },
  activate: { outputs: [] },
  // Unreachable within the timeout: a few backed-off retries, then a warning and an alert; never a rollback.
  connect_crons: { timeoutMs: 5 * MIN, continueOnError: true, maxAttempts: 4, alertAs: 'cron_connect', outputs: ['cronJobs', 'cronPing'] },
}

const step = (id: StepId, label: string): PipelineStep => ({ id, label })

/** The 16 steps every job ran before pipelines, in order. */
export const LEGACY_STEP_IDS = [
  'preflight',
  'create_param_group',
  'create_db_instance',
  'wait_db_available',
  'load_schema',
  'restore_data',
  'seed_data',
  'create_bucket',
  'write_infra',
  'generate_legals',
  'seed_settings',
  'ensure_compute',
  'setup_delhivery',
  'configure_dns',
  'verify_serving',
  'activate',
] as const satisfies readonly StepId[]

/** Jobs without a pinned pipeline (started before pipelines) run this. */
export const LEGACY_PIPELINE: PipelineDef = {
  v: 1,
  jobs: [
    { id: 'preflight', label: 'Preflight', steps: [step('preflight', 'Preflight checks')] },
    {
      id: 'database',
      label: 'Database',
      steps: [
        step('create_param_group', 'Create parameter group'),
        step('create_db_instance', 'Create database'),
        step('wait_db_available', 'Wait for database'),
        step('load_schema', 'Load schema'),
        step('restore_data', 'Restore data'),
        step('seed_data', 'Seed starter catalogue'),
      ],
    },
    {
      id: 'storage',
      label: 'Storage & settings',
      steps: [
        step('create_bucket', 'Create storage bucket'),
        step('write_infra', 'Save infrastructure'),
        step('generate_legals', 'Generate legal pages'),
        step('seed_settings', 'Copy store settings'),
      ],
    },
    {
      id: 'compute',
      label: 'Compute',
      steps: [step('ensure_compute', 'Launch app server'), step('setup_delhivery', 'Register Delhivery pickup')],
    },
    {
      id: 'network',
      label: 'Network',
      steps: [step('configure_dns', 'Configure DNS'), step('verify_serving', 'Verify the store serves')],
    },
    { id: 'golive', label: 'Go live', steps: [step('activate', 'Go live')] },
  ],
}

export interface PipelineOptions {
  engine: 'k8s' | 'ec2'
  provider: 'aws' | 'stub'
  /** The job restores a backup (restoreFromKey). */
  restore: boolean
  /** The job seeds a starter catalogue (seedProfile, no restore). */
  seed: boolean
}

type DbMode = 'shared' | 'dedicated' | 'node'

/**
 * The steps this store runs. Whatever the spec, plan or environment decides now leaves steps out; what only
 * the data decides at run time stays in and may finish skipped or with a warning.
 */
export function buildPipeline(spec: { db: { mode: DbMode } }, plan: string | null, opts: PipelineOptions): PipelineDef {
  const mode = spec.db.mode
  const database: PipelineStep[] =
    mode === 'node'
      ? [
          step('launch_server', 'Launch server'),
          step('attach_db_disk', 'Attach database disk'),
          step('start_postgres', 'Start Postgres'),
          step('create_database', 'Create database'),
        ]
      : mode === 'shared'
        ? [step('create_db_instance', 'Reserve shared database seat'), step('wait_db_available', 'Create database on shared host')]
        : [
            step('create_param_group', 'Create parameter group'),
            step('create_db_instance', 'Create RDS instance'),
            step('wait_db_available', 'Wait for RDS'),
          ]
  const schema: PipelineStep[] = [step('load_schema', 'Load schema')]
  if (opts.restore) schema.push(step('restore_data', 'Restore data'))
  if (opts.seed && !opts.restore) schema.push(step('seed_data', 'Seed starter catalogue'))
  const computeLabel =
    opts.engine !== 'k8s'
      ? plan && ['growth', 'pro', 'enterprise'].includes(plan)
        ? 'Launch app server'
        : 'Join shared app server'
      : mode === 'node'
        ? 'Start store services'
        : 'Launch servers & start services'
  const network: PipelineStep[] = []
  if (opts.engine !== 'k8s') network.push(step('configure_dns', 'Configure DNS'))
  if (opts.provider === 'aws') network.push(step('verify_serving', 'Verify the store serves'))
  const jobs: PipelineJob[] = [
    { id: 'preflight', label: 'Preflight', steps: [step('preflight', 'Preflight checks')] },
    { id: 'database', label: 'Database', steps: database },
    { id: 'schema', label: 'Schema & data', steps: schema },
    {
      id: 'storage',
      label: 'Storage & settings',
      steps: [
        step('create_bucket', 'Create storage bucket'),
        step('write_infra', 'Save infrastructure'),
        step('generate_legals', 'Generate legal pages'),
        step('seed_settings', 'Copy store settings'),
      ],
    },
    { id: 'compute', label: 'Compute', steps: [step('ensure_compute', computeLabel), step('setup_delhivery', 'Register Delhivery pickup')] },
  ]
  if (network.length) jobs.push({ id: 'network', label: 'Network', steps: network })
  // Under the stub provider the owner's admin comes from the worker once the job is done (fireOwnerAdmin).
  const golive = opts.provider === 'aws' ? [step('issue_owner_certificate', 'Issue owner certificate'), step('activate', 'Go live')] : [step('activate', 'Go live')]
  jobs.push({ id: 'golive', label: 'Go live', steps: golive })
  // The platform's cron fan-out reaches the store's pods: checked once it is live (a store host answers only then).
  if (opts.engine === 'k8s' && opts.provider === 'aws')
    jobs.push({ id: 'crons', label: 'Scheduled jobs', steps: [step('connect_crons', 'Connect scheduled jobs')] })
  return { v: 2, jobs }
}

/** A pipeline as stored on the job (provisioning_jobs.pipeline). */
export interface StoredPipeline {
  v: number
  jobs: { id: string; label: string; steps: { id: string; label: string }[] }[]
}

/** A job's pipeline: pinned, else the legacy list. */
export const pipelineOf = (p: StoredPipeline | null | undefined): PipelineDef =>
  p && Array.isArray(p.jobs) && p.jobs.length ? (p as PipelineDef) : LEGACY_PIPELINE

export const flatSteps = (p: PipelineDef): StepId[] => p.jobs.flatMap(j => j.steps.map(s => s.id))

export const indexOfStep = (p: PipelineDef, id: string): number => flatSteps(p).indexOf(id as StepId)

export function nextStepAfter(p: PipelineDef, id: string): StepId | null {
  const all = flatSteps(p)
  const i = all.indexOf(id as StepId)
  return i < 0 || i === all.length - 1 ? null : all[i + 1]
}

/** True when the pipeline issues the owner's certificate itself (so nothing else should). */
export const issuesOwnerCertificate = (p: StoredPipeline | null | undefined): boolean =>
  flatSteps(pipelineOf(p)).includes('issue_owner_certificate')
