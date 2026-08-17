import type { ProvisioningProvider } from './provider'
import {
  getTenant,
  getProvisioningJob,
  updateProvisioningJob,
  setTenantStatus,
  writeTenantInfra,
  clearTenantInfra,
  clearTenantCache,
  type ProvisioningJob,
} from '../tenant-registry'

// Ordered provisioning steps. The worker advances a job one step per tick; each
// step is idempotent so a crash/retry re-runs it safely. On success the step
// function returns the NEXT step name (or 'done'); on throw the job is marked
// failed with the error (and can be retried).
//
// `restore_data` runs after the schema is loaded and before the bucket is made — it
// only does work when the job carries a `restoreFromKey` (churned owner re-onboarding),
// otherwise it's a no-op passthrough.
const STEPS = [
  'create_param_group',
  'create_db_instance',
  'wait_db_available',
  'load_schema',
  'restore_data',
  'create_bucket',
  'write_infra',
  'configure_dns',
  'activate',
] as const
type Step = (typeof STEPS)[number]

const MAX_CONNECTIONS = 50 // conservative for db.t4g.micro (100 OOM'd a micro previously)

const ROOT_DOMAIN = process.env.PLATFORM_ROOT_DOMAIN || 'jeffistores.in'

function bucketName(slug: string) { return `jeffi-tenant-${slug}` }
function dbInstanceId(slug: string) { return `jeffi-tenant-${slug}` }
function paramGroupName(slug: string) { return `jeffi-tenant-${slug}-pg16` }

/**
 * Hostnames a tenant needs pointed at the shared app host, by plan tier. Mirrors the
 * subdomain preview in OnboardWizard (storefront + admin + docs; higher tiers add
 * quotation/purchaseorder/forms/business). Basic = storefront + admin + invoice.
 */
function tenantHostnames(slug: string, plan: string | null): string[] {
  const hosts = [`${slug}.${ROOT_DOMAIN}`, `admin-${slug}.${ROOT_DOMAIN}`, `invoice-${slug}.${ROOT_DOMAIN}`]
  if (plan && ['growth', 'pro', 'enterprise'].includes(plan)) {
    hosts.push(`quotation-${slug}.${ROOT_DOMAIN}`, `purchaseorder-${slug}.${ROOT_DOMAIN}`)
  }
  if (plan && ['pro', 'enterprise'].includes(plan)) {
    hosts.push(`forms-${slug}.${ROOT_DOMAIN}`, `${slug}.business.${ROOT_DOMAIN}`)
  }
  return hosts
}

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
        return await next(job.id, 'restore_data', res)

      case 'restore_data': {
        // Only restores when the job was enqueued with a backup key (re-onboarding a
        // churned owner). No key → fresh store → skip straight to bucket creation.
        const key = res.restoreFromKey as string | undefined
        if (key) {
          const { getTenantBackup } = await import('../tenant-backup-store')
          const archive = await getTenantBackup(key)
          await provider.restoreDb(res.endpoint, 'jeffi_stores', archive)
          res.restored = true
        }
        return await next(job.id, 'create_bucket', res)
      }

      case 'create_bucket':
        await provider.ensureBucket(bucketName(slug))
        res.bucket = bucketName(slug)
        return await next(job.id, 'write_infra', res)

      case 'write_infra':
        await writeTenantInfra(job.tenant_id, { rdsEndpoint: res.endpoint, s3Bucket: res.bucket })
        return await next(job.id, 'configure_dns', res)

      case 'configure_dns': {
        const hosts = tenantHostnames(slug, tenant.plan)
        await provider.ensureDns(hosts)
        res.dnsHosts = hosts
        return await next(job.id, 'activate', res)
      }

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

export interface DeprovisionResult {
  ok: boolean
  backupKey: string | null
  backedUp: boolean
  error?: string
}

/**
 * Deprovision a tenant with a backup-first teardown:
 *   1. Flip status → 'terminated' + clear resolver cache → store goes OFFLINE immediately.
 *   2. If the DB was ever provisioned, dump it and stash the archive in S3 (dual
 *      owner/slug keys) so a returning owner can restore.
 *   3. Delete the RDS instance + tenant bucket so nothing keeps billing.
 *   4. Null the infra pointers.
 *
 * Idempotent + defensive: a never-provisioned tenant just goes terminated (no backup);
 * "already gone" deletes are treated as success by the provider.
 */
export async function deprovisionTenant(
  tenantId: string,
  provider: ProvisioningProvider,
  ctx: { ownerId?: string | null },
): Promise<DeprovisionResult> {
  const tenant = await getTenant(tenantId)
  if (!tenant) return { ok: false, backupKey: null, backedUp: false, error: 'tenant not found' }

  // 1. Take the store down FIRST — resolver returns null for any non-active status.
  await setTenantStatus(tenantId, 'terminated')
  clearTenantCache()

  const slug = tenant.slug
  const job = await getProvisioningJob(tenantId)
  const created = (job?.created_resources as Record<string, any>) || {}
  const endpoint: string | null = tenant.rds_endpoint || created.endpoint || null
  const instId: string = created.dbInstanceId || dbInstanceId(slug)
  const bucket: string = tenant.s3_bucket || created.bucket || `jeffi-tenant-${slug}`

  let backupKey: string | null = null
  let backedUp = false

  try {
    // 2. Backup (only if there was ever a DB to back up).
    if (endpoint) {
      const archive = await provider.backupDb(endpoint, tenant.rds_db || 'jeffi_stores')
      const { putTenantBackup } = await import('../tenant-backup-store')
      const { ownerKey } = await putTenantBackup({
        buffer: archive,
        ownerId: ctx.ownerId || 'unknown',
        slug,
      })
      backupKey = ownerKey
      backedUp = true
    }

    // 3. Delete billable resources (idempotent).
    await provider.deleteDbInstance(instId)
    await provider.deleteBucket(bucket)

    // 3b. Remove the tenant's DNS records so the subdomains stop resolving.
    const dnsHosts = (created.dnsHosts as string[] | undefined) ?? tenantHostnames(slug, tenant.plan)
    await provider.removeDns(dnsHosts).catch(() => {})

    // 4. Clear infra pointers.
    await clearTenantInfra(tenantId)

    if (job) {
      await updateProvisioningJob(job.id, {
        status: 'done',
        created_resources: { ...created, deprovisioned: true, backupKey },
      })
    }
    return { ok: true, backupKey, backedUp }
  } catch (e: any) {
    if (job) {
      await updateProvisioningJob(job.id, {
        status: 'failed',
        last_error: `deprovision: ${e?.message || 'error'}`,
        created_resources: { ...created, backupKey },
      })
    }
    return { ok: false, backupKey, backedUp, error: e?.message || 'deprovision failed' }
  }
}

export { STEPS, MAX_CONNECTIONS, dbInstanceId }
