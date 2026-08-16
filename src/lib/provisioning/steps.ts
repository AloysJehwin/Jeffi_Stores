import type { ProvisioningProvider } from './provider'
import {
  getTenant,
  getProvisioningJob,
  updateProvisioningJob,
  setTenantStatus,
  writeTenantInfra,
  type ProvisioningJob,
} from '../tenant-registry'

// Ordered provisioning steps. The worker advances a job one step per tick; each
// step is idempotent so a crash/retry re-runs it safely. On success the step
// function returns the NEXT step name (or 'done'); on throw the job is marked
// failed with the error (and can be retried).
const STEPS = [
  'create_param_group',
  'create_db_instance',
  'wait_db_available',
  'load_schema',
  'create_bucket',
  'write_infra',
  'activate',
] as const
type Step = (typeof STEPS)[number]

const MAX_CONNECTIONS = 50 // conservative for db.t4g.micro (100 OOM'd a micro previously)

function bucketName(slug: string) { return `jeffi-tenant-${slug}` }
function dbInstanceId(slug: string) { return `jeffi-tenant-${slug}` }
function paramGroupName(slug: string) { return `jeffi-tenant-${slug}-pg16` }

/**
 * Advance ONE provisioning job by one step. Returns the job's new status.
 * Pure orchestration — all AWS effects go through `provider` (stub or real).
 */
export async function advanceProvisioningJob(job: ProvisioningJob, provider: ProvisioningProvider): Promise<string> {
  const tenant = await getTenant(job.tenant_id)
  if (!tenant) {
    await updateProvisioningJob(job.id, { status: 'failed', last_error: 'tenant not found' })
    return 'failed'
  }
  const slug = tenant.slug
  const res: Record<string, any> = { ...(job.created_resources || {}) }

  try {
    await updateProvisioningJob(job.id, { status: 'running', bumpAttempts: true })
    const step = job.step as Step

    switch (step) {
      case 'create_param_group':
        await provider.ensureParamGroup(paramGroupName(slug), MAX_CONNECTIONS)
        res.paramGroup = paramGroupName(slug)
        return await next(job.id, 'create_db_instance', res)

      case 'create_db_instance': {
        const { dbInstanceId: id } = await provider.createDbInstance({
          dbInstanceId: dbInstanceId(slug), paramGroup: paramGroupName(slug), maxConnections: MAX_CONNECTIONS,
        })
        res.dbInstanceId = id
        return await next(job.id, 'wait_db_available', res)
      }

      case 'wait_db_available': {
        const endpoint = await provider.getDbEndpoint(res.dbInstanceId)
        if (!endpoint) {
          // Still provisioning — stay on this step, worker will poll again next tick.
          await updateProvisioningJob(job.id, { status: 'pending', created_resources: res })
          return 'pending'
        }
        res.endpoint = endpoint
        return await next(job.id, 'load_schema', res)
      }

      case 'load_schema':
        await provider.loadSchema(res.endpoint, 'jeffi_stores')
        return await next(job.id, 'create_bucket', res)

      case 'create_bucket':
        await provider.ensureBucket(bucketName(slug))
        res.bucket = bucketName(slug)
        return await next(job.id, 'write_infra', res)

      case 'write_infra':
        await writeTenantInfra(job.tenant_id, { rdsEndpoint: res.endpoint, s3Bucket: res.bucket })
        return await next(job.id, 'activate', res)

      case 'activate':
        await setTenantStatus(job.tenant_id, 'active')
        await updateProvisioningJob(job.id, { status: 'done', created_resources: res })
        return 'done'

      default:
        await updateProvisioningJob(job.id, { status: 'failed', last_error: `unknown step ${step}` })
        return 'failed'
    }
  } catch (e: any) {
    await updateProvisioningJob(job.id, { status: 'failed', last_error: e?.message || 'error', created_resources: res })
    return 'failed'
  }
}

async function next(id: string, step: Step, res: Record<string, any>): Promise<string> {
  await updateProvisioningJob(id, { step, status: 'pending', created_resources: res })
  return 'pending'
}

/** Rollback a failed job's created resources (avoid leaked billing). */
export async function rollbackProvisioning(tenantId: string, provider: ProvisioningProvider): Promise<void> {
  const job = await getProvisioningJob(tenantId)
  if (!job) return
  const r = job.created_resources || {}
  if (r.dbInstanceId) await provider.deleteDbInstance(r.dbInstanceId).catch(() => {})
  if (r.bucket) await provider.deleteBucket(r.bucket).catch(() => {})
  await updateProvisioningJob(job.id, { status: 'failed', last_error: 'rolled back' })
}

export { STEPS, MAX_CONNECTIONS, dbInstanceId }
