import type { ProvisioningProvider } from './provider'
import { appBootUserData } from './user-data'
import {
  getTenant,
  getProvisioningJob,
  updateProvisioningJob,
  setTenantStatus,
  writeTenantInfra,
  writeTenantEc2,
  clearTenantInfra,
  clearTenantCache,
  controlPlanePool,
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
] as const
type Step = (typeof STEPS)[number]

const MAX_CONNECTIONS = 50 // conservative for db.t4g.micro (100 OOM'd a micro previously)

// The flagship app box serves jeffistores.in only — never a tenant.
const FLAGSHIP_APP_IP = process.env.FLAGSHIP_APP_IP || '52.20.193.62'

function tenantComputeConfigured(): boolean {
  return !!process.env.TENANT_APP_AMI_ID || !!process.env.POOL_INSTANCE_ID
}

const ROOT_DOMAIN = process.env.PLATFORM_ROOT_DOMAIN || 'jeffistores.in'

function bucketName(slug: string) { return `jeffi-tenant-${slug}` }
function dbInstanceId(slug: string) { return `jeffi-tenant-${slug}` }
function paramGroupName(slug: string) { return `jeffi-tenant-${slug}-pg16` }

/** Higher plans (growth/pro/enterprise) get a DEDICATED EC2; Basic uses the shared pool. */
function isDedicatedPlan(plan: string | null): boolean {
  return !!plan && ['growth', 'pro', 'enterprise'].includes(plan)
}

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
      case 'preflight': {
        // Fail fast on missing prerequisites BEFORE creating any billable infra, so a
        // misconfigured environment produces one clear error instead of a cryptic
        // mid-provision failure (e.g. absent RDS_MASTER_PASSWORD → "Invalid master
        // password" at create_db_instance; unset TENANT_APP_TARGET_IP → dead DNS).
        const missing: string[] = []
        if (!process.env.RDS_MASTER_PASSWORD) missing.push('RDS_MASTER_PASSWORD')
        const target = process.env.TENANT_APP_TARGET_IP
        if (!target || !target.trim()) missing.push('TENANT_APP_TARGET_IP')
        if (missing.length) {
          throw new Error(`preflight: missing required env: ${missing.join(', ')}`)
        }
        if (!tenantComputeConfigured() && (target || '').trim() === FLAGSHIP_APP_IP) {
          throw new Error(
            `preflight: TENANT_APP_TARGET_IP is the flagship app instance (${FLAGSHIP_APP_IP}) and no tenant compute is configured — ` +
            `set TENANT_APP_AMI_ID (or POOL_INSTANCE_ID) so tenants are served by their own pool instance.`
          )
        }
        return await next(job.id, 'create_param_group', res)
      }

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
        // Bound the wait: a db.t4g.micro is normally available in ~9 min. If it never
        // reaches available (stuck in creating/incompatible-parameters, wrong id), fail
        // after the deadline instead of polling forever — the catch triggers rollback.
        if (!res.dbWaitStartedAt) res.dbWaitStartedAt = Date.now()
        const DB_WAIT_DEADLINE_MS = 25 * 60 * 1000 // 25 min
        const endpoint = await provider.getDbEndpoint(res.dbInstanceId)
        if (!endpoint) {
          if (Date.now() - res.dbWaitStartedAt > DB_WAIT_DEADLINE_MS) {
            throw new Error(`wait_db_available: ${res.dbInstanceId} did not become available within ${Math.round(DB_WAIT_DEADLINE_MS / 60000)} min`)
          }
          // Still provisioning — stay on this step, worker will poll again next tick.
          await updateProvisioningJob(job.id, { status: 'pending', created_resources: res })
          return 'pending'
        }
        res.endpoint = endpoint
        return await next(job.id, 'load_schema', res)
      }

      case 'load_schema':
        // Loads the desired-state SCHEMA ONLY (0 rows) into the tenant's own DB. A fresh
        // tenant store is intentionally EMPTY — the owner adds their own catalog. Starter
        // data, if ever wanted, goes through the optional seed_data step below (not here).
        await provider.loadSchema(res.endpoint, 'jeffi_stores')
        return await next(job.id, 'restore_data', res)

      case 'restore_data': {
        // Only restores when the job was enqueued with a backup key (re-onboarding a
        // churned owner). No key → fresh store → fall through to optional seeding.
        const key = res.restoreFromKey as string | undefined
        if (key) {
          const { getTenantBackup } = await import('../tenant-backup-store')
          const archive = await getTenantBackup(key)
          await provider.restoreDb(res.endpoint, 'jeffi_stores', archive)
          res.restored = true
        }
        return await next(job.id, 'seed_data', res)
      }

      case 'seed_data': {
        // Optional starter-catalog seed. No-op unless the job carries a `seedProfile`
        // (mirrors restore_data's opt-in shape). Deliberately separate from load_schema so
        // "empty store" stays the default and seeding never runs by accident. Skipped
        // entirely when the store was restored from a backup.
        const profile = res.seedProfile as string | undefined
        if (profile && !res.restored) {
          const { seedTenantData } = await import('./seed')
          await seedTenantData(res.endpoint, 'jeffi_stores', profile)
          res.seeded = profile
        }
        return await next(job.id, 'create_bucket', res)
      }

      case 'generate_legals': {
        // Generate the tenant's own legal pages (terms/privacy/refund/…) templated from their
        // business details + uploaded logo/seal, into the tenant bucket. Runs AFTER create_bucket
        // + write_infra so the bucket exists. NON-FATAL — a legals failure must not block go-live.
        try {
          const { generateTenantLegals } = await import('../legals/provision')
          await generateTenantLegals(job.tenant_id, res.endpoint)
          res.legalsGenerated = true
        } catch (e: any) {
          res.legalsError = e?.message || 'legals generation failed'
        }
        return await next(job.id, 'seed_settings', res)
      }

      case 'seed_settings': {
        // Copy the owner's onboarding identity + warehouse (control-plane tenant/KYC/draft) into
        // the tenant's own site_settings so the storefront renders the registered business name,
        // contact, logo and seller/pickup fields instead of slug/blank/platform defaults. Runs
        // after create_bucket + write_infra (logo copy needs the tenant bucket) and mirrors the
        // legals identity read. NON-FATAL — a settings failure must not block go-live.
        try {
          const { controlPlanePool } = await import('../tenant-registry')
          const ownerRow = await controlPlanePool().query(
            `SELECT owner_id FROM owner_tenants WHERE tenant_id=$1 LIMIT 1`, [job.tenant_id]).catch(() => null)
          const ownerId = ownerRow?.rows?.[0]?.owner_id
          if (ownerId && res.endpoint) {
            const { seedTenantSiteSettings } = await import('./seed-settings')
            await seedTenantSiteSettings(job.tenant_id, ownerId, res.endpoint, 'jeffi_stores')
            res.settingsSeeded = true
          } else {
            res.settingsSeeded = 'skipped (missing owner or db endpoint)'
          }
        } catch (e: any) {
          res.settingsError = e?.message || 'settings seeding failed'
        }
        return await next(job.id, 'ensure_compute', res)
      }

      case 'create_bucket':
        await provider.ensureBucket(bucketName(slug))
        res.bucket = bucketName(slug)
        return await next(job.id, 'write_infra', res)

      case 'write_infra':
        await writeTenantInfra(job.tenant_id, { rdsEndpoint: res.endpoint, s3Bucket: res.bucket })
        return await next(job.id, 'generate_legals', res)

      case 'ensure_compute': {
        // Stand up the app compute that will serve this tenant's storefront + admin, by plan:
        //   Basic  → shared pool EC2 (create-if-missing); DNS later points at the pool IP.
        //   higher → a DEDICATED EC2 for this tenant; DNS points at its own IP.
        // The resolved serving IP is persisted to tenant_infra.ec2_target and used by
        // configure_dns. Same app image on every instance (Host-routed).
        //
        // FALLBACK: if EC2 launch isn't configured (no TENANT_APP_AMI_ID and, for Basic, no
        // pre-existing POOL_INSTANCE_ID), skip real EC2 and serve from the shared
        // TENANT_APP_TARGET_IP — the flagship/pool host. This keeps provisioning working before
        // per-tenant/pool EC2 is set up, and is the sane default rather than a hard failure.
        const ec2Configured = tenantComputeConfigured()
        if (!ec2Configured) {
          const target = (process.env.TENANT_APP_TARGET_IP || '').trim()
          if (!target || target === FLAGSHIP_APP_IP) {
            throw new Error(
              `compute blocked: refusing to serve tenant "${slug}" from the flagship app instance (${FLAGSHIP_APP_IP}) — ` +
              `set TENANT_APP_AMI_ID or POOL_INSTANCE_ID.`
            )
          }
          res.ec2Target = target
          res.computeMode = 'shared-target'
        } else if (isDedicatedPlan(tenant.plan)) {
          if (!res.ec2InstanceId) {
            const { instanceId, ip } = await provider.ensureAppInstance(
              {
                name: `jeffi-tenant-${slug}`, instanceType: process.env.TENANT_DEDICATED_EC2_TYPE || 't4g.small',
                userData: appBootUserData(),
              },
              // Persist before the readiness wait so rollback can terminate it if that throws.
              async (id) => {
                res.ec2InstanceId = id
                await updateProvisioningJob(job.id, { created_resources: res })
              },
            )
            res.ec2InstanceId = instanceId
            res.ec2Target = ip
            res.computeMode = 'dedicated'
          }
        } else {
          const { ensurePoolInstance } = await import('../pool-autoscale')
          const { ip } = await ensurePoolInstance()
          res.ec2Target = ip
          res.computeMode = 'pool'
        }
        if (res.ec2Target) await writeTenantEc2(job.tenant_id, res.ec2Target, res.ec2InstanceId)
        return await next(job.id, 'setup_delhivery', res)
      }

      case 'setup_delhivery': {
        // Register the tenant's Delhivery pickup/client-warehouse from their onboarding
        // warehouse config. NON-FATAL — a pickup-registration failure must not block go-live
        // (it can be retried/fixed later; shipments just can't be created until then).
        try {
          const { getKyc, getDraft, controlPlanePool } = await import('../tenant-registry')
          const ownerRow = await controlPlanePool().query(
            `SELECT owner_id FROM owner_tenants WHERE tenant_id=$1 LIMIT 1`, [job.tenant_id]).catch(() => null)
          const ownerId = ownerRow?.rows?.[0]?.owner_id
          const draft = ownerId ? await getDraft(ownerId).catch(() => null) : null
          const wh = (draft?.data as any)?.wh
          const kyc = await getKyc(job.tenant_id).catch(() => null)
          if (wh?.sellerPhone && wh?.originPincode) {
            const { createDelhiveryPickupLocation } = await import('../delhivery')
            const r = await createDelhiveryPickupLocation({
              name: wh.pickupLocation || tenant.slug,
              phone: wh.sellerPhone,
              pincode: wh.originPincode,
              address: wh.sellerAddress || kyc?.business_address || '',
              registeredName: wh.sellerName || tenant.display_name,
              tenantId: job.tenant_id,
            })
            res.delhiveryPickup = r.ok ? 'created' : `error: ${r.error}`
          } else {
            res.delhiveryPickup = 'skipped (no warehouse config)'
          }
        } catch (e: any) {
          res.delhiveryPickup = `error: ${e?.message || 'failed'}`
        }
        return await next(job.id, 'configure_dns', res)
      }

      case 'configure_dns': {
        const hosts = tenantHostnames(slug, tenant.plan)
        // Point at this tenant's serving IP (dedicated instance or pool); falls back to env.
        await provider.ensureDns(hosts, res.ec2Target)
        res.dnsHosts = hosts
        return await next(job.id, 'verify_serving', res)
      }

      case 'verify_serving': {
        // Prove the tenant host actually SERVES before marking the store active. Without
        // this, activate "lies": it flips status to active with no evidence the app tier
        // (nginx server_name + TLS + reachable target) answers the new hostname — a real
        // signup could go live pointing at a host that 404s or times out. DNS/serving can
        // lag right after configure_dns, so we allow a bounded number of pending retries
        // (each worker tick) before giving up and failing the job for rollback.
        //
        // Under the STUB provider (local dev / tests) there is no real infra or DNS, so the
        // probe can never succeed — skip it and advance. The guard stays fully active for the
        // real AWS provider, which is the only place a host actually serves.
        if (process.env.PROVISIONING_PROVIDER !== 'aws') {
          return await next(job.id, 'activate', res)
        }
        const rootDomain = ROOT_DOMAIN
        const primaryHost = `${slug}.${rootDomain}`
        const attempts = (res.verifyAttempts || 0) + 1
        res.verifyAttempts = attempts
        const MAX_VERIFY_ATTEMPTS = 6
        // For a dedicated tenant, refuse to activate over a corpse: if the box we
        // provisioned is gone/terminated, the host can only resolve to a dead IP.
        // Treat it exactly like "not serving yet" (bounded retries) so a transient
        // describe-instances blip doesn't trigger a rollback on the first bad read.
        let served = false
        if (res.ec2InstanceId && res.computeMode === 'dedicated') {
          const gone = await provider.isInstanceGone(res.ec2InstanceId).catch(() => false)
          if (gone) {
            if (attempts < MAX_VERIFY_ATTEMPTS) {
              await updateProvisioningJob(job.id, { status: 'pending', created_resources: res })
              return 'pending'
            }
            throw new Error(`verify_serving: dedicated instance ${res.ec2InstanceId} is gone/terminated after ${attempts} attempts`)
          }
        }
        try {
          const ctrl = new AbortController()
          const timer = setTimeout(() => ctrl.abort(), 10000)
          const resp = await fetch(`https://${primaryHost}/`, { redirect: 'manual', signal: ctrl.signal })
          clearTimeout(timer)
          // Any HTTP response (2xx/3xx/4xx) proves the app tier is answering this host.
          // A network failure/timeout (host unreachable, TLS fail, no server_name) throws.
          served = resp.status > 0
        } catch {
          served = false
        }
        if (served) return await next(job.id, 'activate', res)
        if (attempts < MAX_VERIFY_ATTEMPTS) {
          // Not serving yet — stay on this step; the worker retries next tick (DNS/TLS lag).
          await updateProvisioningJob(job.id, { status: 'pending', created_resources: res })
          return 'pending'
        }
        throw new Error(`verify_serving: ${primaryHost} did not serve after ${attempts} attempts (app tier / DNS / TLS not ready)`)
      }

      case 'activate': {
        // Guard the write_infra→activate invariant: never mark a tenant active without a
        // persisted RDS endpoint (else getPool would silently fall back to the platform DB).
        const fresh = await getTenant(job.tenant_id)
        if (!fresh?.rds_endpoint) {
          throw new Error('activate blocked: tenant_infra.rds_endpoint not persisted')
        }
        // Close the verify→activate window: never flip active over a dedicated box that
        // died between the serving probe and now (mirrors the rds_endpoint invariant).
        if (res.ec2InstanceId && res.computeMode === 'dedicated') {
          const gone = await provider.isInstanceGone(res.ec2InstanceId).catch(() => false)
          if (gone) {
            throw new Error(`activate blocked: dedicated instance ${res.ec2InstanceId} is gone/terminated`)
          }
        }
        await setTenantStatus(job.tenant_id, 'active')
        await recordStepEvent(job.id, 'activate', 'ok', 'tenant activated', {})
        await updateProvisioningJob(job.id, { status: 'done', created_resources: res })
        return 'done'
      }

      default:
        await updateProvisioningJob(job.id, { status: 'failed', last_error: `unknown step ${step}` })
        return 'failed'
    }
  } catch (e: any) {
    const msg = e?.message || String(e) || 'error'
    const attempts = (job.attempts || 0) + 1
    await recordStepEvent(job.id, job.step, 'error', msg, resourcesFor(job.step as Step, res))
    // Classify: transient errors get retried with backoff; deterministic errors fail now.
    const terminal = isTerminalError(msg) || attempts >= MAX_PROVISION_ATTEMPTS
    if (!terminal) {
      // Retryable — keep the job alive (pending) and back off before the next tick.
      const delayMs = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** (attempts - 1))
      const jitter = Math.floor(delayMs * 0.2 * (attempts % 3) / 2) // deterministic small jitter (no Math.random)
      const nextAttemptAt = new Date(Date.now() + delayMs + jitter)
      await updateProvisioningJob(job.id, {
        status: 'pending', last_error: `retryable (attempt ${attempts}): ${msg}`,
        created_resources: res, bumpAttempts: true, nextAttemptAt,
      })
      return 'pending'
    }
    // Terminal (or out of attempts) → fail + auto-rollback billable resources.
    await updateProvisioningJob(job.id, { status: 'failed', last_error: msg, created_resources: res, bumpAttempts: true })
    try {
      await rollbackProvisioning(job.tenant_id, provider)
    } catch { /* rollback failure already recorded; original failure stands */ }
    try {
      const { alertProvisioningFailure } = await import('./alerts')
      await alertProvisioningFailure(slug, job.step, msg, job.tenant_id)
    } catch { /* alerting must never mask the failure */ }
    return 'failed'
  }
}

// Retry tuning for the provisioning state machine.
const MAX_PROVISION_ATTEMPTS = 8
const BACKOFF_BASE_MS = 15_000   // 15s, doubling
const BACKOFF_CAP_MS = 600_000   // capped at 10 min

/** Deterministic errors that won't fix themselves on retry → fail fast (no wasted retries). */
function isTerminalError(msg: string): boolean {
  return /AccessDenied|not authorized|UnauthorizedOperation|InvalidParameterValue|Invalid master password|preflight:|activate blocked|compute blocked|InvalidParameterCombination|missing required env/i.test(msg)
}

function isTransientDnsError(msg: string): boolean {
  if (/InvalidChangeBatch|InvalidInput|NoSuchHostedZone|AccessDenied|not authorized/i.test(msg)) return false
  return /Throttling|PriorRequestNotComplete|ServiceUnavailable|InternalError|RequestTimeout|\((429|500|502|503|504)\)|ETIMEDOUT|ECONNRESET|EAI_AGAIN|fetch failed|network/i.test(msg)
}

async function retryTransient<T>(
  fn: () => Promise<T>,
  isTransient: (msg: string) => boolean,
  attempts = 3,
): Promise<{ value?: T; error?: any; attempts: number }> {
  let lastError: any
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return { value: await fn(), attempts: attempt }
    } catch (e: any) {
      lastError = e
      if (attempt === attempts || !isTransient(e?.message || String(e))) break
      const backoff = 500 * 3 ** (attempt - 1)
      await new Promise((r) => setTimeout(r, backoff + Math.floor(Math.random() * 250)))
    }
  }
  return { error: lastError, attempts }
}


/**
 * Record what a step actually did, so the admin UI can show each stage's history.
 *
 * provisioning_jobs holds only the CURRENT step and last_error, so the moment a job advances,
 * everything the previous step did is lost — including the error that made it retry. These rows
 * are the per-stage log.
 *
 * tenant_id and the duration are derived in SQL from the job row (updated_at was set when the
 * step went 'running'), so callers need only the job id. Never throws: a missing log line must
 * not fail a provisioning step.
 */
async function recordStepEvent(
  jobId: string,
  step: string,
  status: 'ok' | 'error',
  message: string | null,
  detail: Record<string, unknown> = {},
): Promise<void> {
  try {
    await controlPlanePool().query(
      `INSERT INTO provisioning_step_events (job_id, tenant_id, step, status, message, detail, duration_ms)
       SELECT j.id, j.tenant_id, $2, $3, $4, $5::jsonb,
              GREATEST(0, (EXTRACT(EPOCH FROM (now() - j.updated_at)) * 1000)::int)
         FROM provisioning_jobs j WHERE j.id = $1`,
      [jobId, step, status, message, JSON.stringify(detail)],
    )
  } catch { /* the log is not worth failing a provisioning step over */ }
}

async function next(id: string, step: Step, res: Record<string, any>): Promise<string> {
  // `step` is where we are GOING; the one that just succeeded is its predecessor. STEPS is a
  // linear pipeline, so that is unambiguous and saves threading the completed step through
  // fifteen call sites.
  const completed = STEPS[Math.max(0, STEPS.indexOf(step) - 1)]
  await recordStepEvent(id, completed, 'ok', null, resourcesFor(completed, res))

  // Clear any backoff timer on a successful step transition (prior retries are resolved).
  await updateProvisioningJob(id, { step, status: 'pending', created_resources: res, clearNextAttempt: true })
  return 'pending'
}

/** The created_resources keys a given step is responsible for — its visible output. */
const STEP_OUTPUTS: Partial<Record<Step, string[]>> = {
  create_param_group: ['paramGroup'],
  create_db_instance: ['dbInstanceId'],
  wait_db_available: ['endpoint', 'dbWaitStartedAt'],
  seed_data: ['seeded', 'seedProfile'],
  create_bucket: ['bucket'],
  generate_legals: ['legalsGenerated'],
  seed_settings: ['settingsSeeded'],
  ensure_compute: ['ec2Target', 'ec2InstanceId', 'computeMode'],
  setup_delhivery: ['delhiveryPickup'],
  configure_dns: ['dnsHosts'],
  verify_serving: ['verifyAttempts'],
}

function resourcesFor(step: Step, res: Record<string, any>): Record<string, unknown> {
  const keys = STEP_OUTPUTS[step]
  if (!keys) return {}
  const out: Record<string, unknown> = {}
  for (const k of keys) if (res[k] !== undefined) out[k] = res[k]
  return out
}

/** Delete a param group after its DB instance is fully gone (RDS refuses while attached).
 * Bounded polling — if the DB is still deleting after the budget, skip (a later teardown /
 * reconciliation sweep retries). Best-effort; never throws. */
async function deleteParamGroupWhenDbGone(
  provider: ProvisioningProvider, dbInstanceId: string | undefined, paramGroup: string | undefined,
): Promise<void> {
  if (!paramGroup) return
  try {
    if (dbInstanceId) {
      for (let i = 0; i < 20; i++) {
        if (await provider.isDbInstanceGone(dbInstanceId)) break
        await new Promise((r) => setTimeout(r, 15_000))
      }
    }
    await provider.deleteParamGroup(paramGroup)
  } catch { /* still attached / transient — a later teardown or sweep will retry */ }
}

/** Rollback a failed job's created resources (avoid leaked billing + leave a safe state). */
export async function rollbackProvisioning(tenantId: string, provider: ProvisioningProvider): Promise<void> {
  const job = await getProvisioningJob(tenantId)
  const tenant = await getTenant(tenantId)
  const r = (job?.created_resources as Record<string, any>) || {}
  // DNS first (cheap, no dependency) — use recorded hosts, else derive from slug.
  const hosts = (r.dnsHosts as string[] | undefined)
    ?? (tenant ? tenantHostnames(tenant.slug, tenant.plan) : [])
  // Best-effort but LOUD: a swallowed removeDns failure leaves zombie A-records pointing at a
  // torn-down box (records outliving the instance). Record it + flag the lingering hosts for a
  // reconciler instead of failing the rollback.
  if (hosts.length) {
    try {
      await provider.removeDns(hosts)
    } catch (e: any) {
      if (job) await recordStepEvent(job.id, 'rollback', 'error', `removeDns failed: ${e?.message || e}`, { dnsHosts: hosts })
      r.manualCleanup = { ...(r.manualCleanup as Record<string, unknown> || {}), dnsHosts: hosts }
    }
  }
  // Dedicated EC2 (higher plans) — terminate it; a Basic tenant used the shared pool (left alone
  // here, reclaimed by deletePoolIfEmpty on the final deprovision). Prefer the durably-persisted
  // instance id (tenant_infra.ec2_instance_id) over the job JSON, which can be trimmed/lost.
  const rollbackInstanceId = r.ec2InstanceId || tenant?.ec2_instance_id
  if (rollbackInstanceId) await provider.deleteAppInstance(rollbackInstanceId).catch(() => {})
  // Billable resources.
  if (r.bucket) await provider.deleteBucket(r.bucket).catch(() => {})
  if (r.dbInstanceId) await provider.deleteDbInstance(r.dbInstanceId).catch(() => {})
  // Param group can only be deleted once the DB is gone.
  await deleteParamGroupWhenDbGone(provider, r.dbInstanceId, r.paramGroup)
  // Null infra pointers so the resolver never routes to deleted infra.
  await clearTenantInfra(tenantId).catch(() => {})
  // Reconcile the tenant row: NEVER leave it 'active'/'provisioning' pointing at torn-down
  // infra. 'suspended' = not served, distinguishable from a clean 'terminated' deprovision.
  await setTenantStatus(tenantId, 'suspended').catch(() => {})
  if (job) await updateProvisioningJob(job.id, { status: 'failed', last_error: 'rolled back', created_resources: { ...r, rolledBack: true } })
}

export interface ReprovisionResult {
  ok: boolean
  added: string[]
  removed: string[]
  error?: string
}

/**
 * Re-apply a tenant's DNS to match its CURRENT plan tier — used on plan
 * upgrade/downgrade. This is DNS-ONLY: it never touches RDS/S3 and never enqueues a
 * provisioning job (which would re-run create_db_instance and destroy live infra).
 *
 * The plan must already be updated in the registry (updateTenantPlan) before calling.
 * `tenantHostnames(slug, plan)` yields more subdomains for higher tiers; a downgrade
 * therefore REMOVES the higher-tier subdomains, an upgrade ADDS them. The set of hosts
 * actually applied is tracked in the provisioning job's created_resources.dnsHosts so the
 * add/remove delta is exact and this stays idempotent across repeated calls.
 */
export async function reprovisionDns(tenantId: string, provider: ProvisioningProvider): Promise<ReprovisionResult> {
  const tenant = await getTenant(tenantId)
  if (!tenant) return { ok: false, added: [], removed: [], error: 'tenant not found' }
  if (tenant.status !== 'active' || !tenant.rds_endpoint) {
    // Only meaningful for a live tenant; a provisioning/suspended one gets DNS from the
    // engine's configure_dns step instead.
    return { ok: false, added: [], removed: [], error: 'tenant not active / no infra' }
  }

  const desired = tenantHostnames(tenant.slug, tenant.plan)
  const job = await getProvisioningJob(tenantId)
  const created = (job?.created_resources as Record<string, any>) || {}
  const prev = (created.dnsHosts as string[] | undefined) ?? desired

  const desiredSet = new Set(desired)
  const prevSet = new Set(prev)
  const added = desired.filter((h) => !prevSet.has(h))
  const removed = prev.filter((h) => !desiredSet.has(h))

  try {
    // COMPUTE MOVE: if the new plan tier crosses the Basic↔dedicated boundary, the tenant's
    // serving host changes — stand up / tear down a dedicated EC2 and repoint ALL hosts at the
    // new target IP. (RDS/S3 are untouched — only compute + DNS move.)
    const hadDedicated = !!created.ec2InstanceId
    const wantDedicated = isDedicatedPlan(tenant.plan)
    let targetIp: string | undefined = created.ec2Target
    let computeChanged = false

    if (wantDedicated && !hadDedicated) {
      // Basic → higher: provision a dedicated EC2, move off the pool.
      const { instanceId, ip } = await provider.ensureAppInstance(
        { name: `jeffi-tenant-${tenant.slug}`, instanceType: process.env.TENANT_DEDICATED_EC2_TYPE || 't4g.small' },
        async (id) => {
          created.ec2InstanceId = id
          if (job) await updateProvisioningJob(job.id, { created_resources: created })
        },
      )
      created.ec2InstanceId = instanceId
      targetIp = ip
      computeChanged = true
    } else if (!wantDedicated && hadDedicated) {
      // higher → Basic: fall back to the shared pool, terminate the dedicated instance.
      const { ensurePoolInstance } = await import('../pool-autoscale')
      const { ip } = await ensurePoolInstance()
      const oldInstance = created.ec2InstanceId
      targetIp = ip
      delete created.ec2InstanceId
      computeChanged = true
      if (oldInstance) await provider.deleteAppInstance(oldInstance).catch(() => {})
    }

    if (computeChanged && targetIp) {
      created.ec2Target = targetIp
      await writeTenantEc2(tenantId, targetIp)
      // Repoint every desired host at the new target (UPSERT is idempotent).
      await provider.ensureDns(desired, targetIp)
    } else {
      // Same compute tier: DNS delta only, against the existing target.
      if (added.length) await provider.ensureDns(added, targetIp)
    }
    if (removed.length) await provider.removeDns(removed)

    // Record the now-authoritative host set + compute so the next change diffs correctly.
    if (job) {
      await updateProvisioningJob(job.id, {
        created_resources: { ...created, dnsHosts: desired },
      })
    }
    return { ok: true, added: computeChanged ? desired : added, removed }
  } catch (e: any) {
    return { ok: false, added, removed, error: e?.message || 'reprovision failed' }
  }
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

    // 3a. Compute teardown: a dedicated EC2 (higher plans) is terminated; a Basic tenant used
    // the shared pool — reclaim the pool only when this was the LAST active tenant. Prefer the
    // durably-persisted instance id over the job JSON (which can be trimmed/lost).
    const dedicatedInstanceId = created.ec2InstanceId || tenant.ec2_instance_id
    if (dedicatedInstanceId) {
      await provider.deleteAppInstance(dedicatedInstanceId).catch(() => {})
    } else {
      const { deletePoolIfEmpty } = await import('../pool-autoscale')
      await deletePoolIfEmpty().catch(() => {})
    }

    // 3b. Remove the tenant's DNS records so the subdomains stop resolving. Best-effort but LOUD:
    // a swallowed failure leaves zombie A-records pointing at the just-terminated box (records
    // outliving the instance — a host that "resolves" to a dead IP). Record it + flag the hosts.
    const dnsHosts = (created.dnsHosts as string[] | undefined) ?? tenantHostnames(slug, tenant.plan)
    let dnsRemovalFailed: string[] | null = null
    const dnsResult = await retryTransient(() => provider.removeDns(dnsHosts), isTransientDnsError)
    if (dnsResult.error) {
      dnsRemovalFailed = dnsHosts
      if (job) await recordStepEvent(job.id, 'deprovision', 'error', `removeDns failed after ${dnsResult.attempts} attempt(s): ${dnsResult.error?.message || dnsResult.error}`, { dnsHosts, attempts: dnsResult.attempts })
    }

    // 3c. Delete the tenant's param group once the DB instance is fully gone (else RDS
    // refuses). Best-effort — a still-deleting DB is retried by a later sweep.
    await deleteParamGroupWhenDbGone(provider, instId, created.paramGroup || paramGroupName(slug))

    // 3d. Neither provider supports deletion. Razorpay has no delete for a linked account and
    // cannot clear a settlement bank (product-update only overwrites account/ifsc/beneficiary);
    // Delhivery's client warehouse API is create and edit only. Both are therefore marked and
    // recorded for an operator to close by hand, rather than silently left behind. The Razorpay
    // id is kept: a second account on the same owner email is refused, so a re-onboarding has
    // to reuse this one.
    const manualCleanup: Record<string, unknown> = {}
    if (dnsRemovalFailed) manualCleanup.dnsHosts = dnsRemovalFailed
    try {
      if (tenant.razorpay_linked_account_id) {
        const { markLinkedAccountDeprovisioned } = await import('../razorpay-route')
        const marked = await markLinkedAccountDeprovisioned(tenant.razorpay_linked_account_id, slug)
        manualCleanup.routeAccount = {
          id: tenant.razorpay_linked_account_id,
          settlementBankRemovable: false,
          needsManualSuspension: true,
          marked: marked.ok,
          ...(marked.error ? { markError: marked.error } : {}),
        }
      }
      const { getDraft: loadDraft } = await import('../tenant-registry')
      const draft = await loadDraft((created.ownerId as string) ?? '').catch(() => null)
      const pickupName = (draft?.data as any)?.wh?.pickupLocation || slug
      const { deactivateDelhiveryPickupLocation } = await import('../delhivery')
      const deactivated = await deactivateDelhiveryPickupLocation(pickupName).catch(
        (e: any) => ({ ok: false, error: e?.message ?? String(e) }),
      )
      manualCleanup.delhiveryPickup = {
        name: pickupName,
        deletable: false,
        deactivated: deactivated.ok,
        ...(deactivated.error ? { deactivateError: deactivated.error } : {}),
      }
      const { alertProvisioningFailure } = await import('./alerts')
      await alertProvisioningFailure(slug, 'external_cleanup',
        `Deprovisioned, but these cannot be deleted by API and need closing by hand: ${JSON.stringify(manualCleanup)}`,
        tenantId)
    } catch { /* bookkeeping must never fail a teardown that already deleted the billable resources */ }
    const routeAccount = Object.keys(manualCleanup).length ? manualCleanup : undefined

    // 4. Clear infra pointers.
    await clearTenantInfra(tenantId)

    if (job) {
      await updateProvisioningJob(job.id, {
        status: 'done',
        created_resources: { ...created, deprovisioned: true, backupKey, ...(routeAccount ? { manualCleanup: routeAccount } : {}) },
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

export { STEPS, MAX_CONNECTIONS, dbInstanceId, tenantHostnames }
