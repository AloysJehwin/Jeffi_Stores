import type { ProvisioningProvider } from './provider'
import { appBootUserData } from './user-data'
import { dedicatedNodeName } from '@/lib/provisioning/tiers'
import {
  getTenant,
  getProvisioningJob,
  updateProvisioningJob,
  setTenantStatus,
  setStoreRequest,
  writeTenantInfra,
  writeTenantEc2,
  clearTenantInfra,
  clearTenantCache,
  controlPlanePool,
  type ProvisioningJob,
} from '@/lib/tenant-registry'
import {
  AWS_REGION,
  NODE_DB_USER,
  TENANT_DB_NAME,
  nodeDbHost,
  nodeDbSlug,
  tenantDbSecretRef,
  withTenantAdminPool,
  type DbAuth,
  type TenantDbTarget,
} from './tenant-admin-pool'
import {
  LEGACY_STEP_IDS,
  STEP_CATALOG,
  buildPipeline,
  flatSteps,
  nextStepAfter,
  ok,
  pipelineOf,
  skip,
  wait,
  warn,
  type PipelineDef,
  type StepId,
  type StepResult,
} from './pipeline'
import { attachDbDisk, createDatabase, launchServer, startPostgres, type NodeDbCtx } from './node-db-steps'

// Provisioning steps. The worker advances a job one step per tick; each step is idempotent so a
// crash/retry re-runs it safely. A step's handler returns ok / skip / warn (the job moves to the next
// step of its pinned pipeline, pipeline.ts) or wait (stay and poll again); a throw is retried, then
// fails the job and rolls back.
//
// `restore_data` runs after the schema is loaded and before the bucket is made — it
// only does work when the job carries a `restoreFromKey` (churned owner re-onboarding),
// otherwise it's a no-op passthrough.
//
// A store whose Postgres runs on its own server (db.mode 'node') brings that server and the database
// pod up in its Database steps (node-db-steps.ts; wait_db_available on a legacy job), so every step
// after them (schema, restore, seed, settings) has a live database; ensure_compute later re-applies the
// same namespace.
/** @deprecated The legacy pipeline's step ids; a job's steps are its pinned pipeline (pipeline.ts). */
const STEPS = LEGACY_STEP_IDS
type Step = StepId


// A store's own database name; a Starter store's on a shared host is t_{slug} (res.dbName).
const TENANT_DB = TENANT_DB_NAME

// The flagship app box serves jeffistores.in only — never a tenant.
const FLAGSHIP_APP_IP = process.env.FLAGSHIP_APP_IP || '52.20.193.62'

function tenantComputeConfigured(): boolean {
  return !!process.env.TENANT_APP_AMI_ID || !!process.env.POOL_INSTANCE_ID
}

const ROOT_DOMAIN = process.env.PLATFORM_ROOT_DOMAIN || 'jeffistores.in'

function bucketName(slug: string) {
  return `jeffi-tenant-${slug}`
}
function dbInstanceId(slug: string) {
  return `jeffi-tenant-${slug}`
}
function paramGroupName(slug: string) {
  return `jeffi-tenant-${slug}-pg16`
}

/** @deprecated Use getOrCreateTenantDbPassword (tenant-db-secret.ts): a stored password must never be replaced. */
export function genDbPassword(): string {
  return require('crypto').randomBytes(24).toString('base64url')
}
/** @deprecated Overwrites the stored password; use getOrCreateTenantDbPassword (tenant-db-secret.ts). */
export async function ensureTenantDbSecret(slug: string, password: string): Promise<void> {
  const { SecretsManagerClient, CreateSecretCommand, PutSecretValueCommand } = await import(
    '@aws-sdk/client-secrets-manager'
  )
  const client = new SecretsManagerClient({ region: AWS_REGION })
  const SecretId = tenantDbSecretRef(slug)
  const SecretString = JSON.stringify({ username: NODE_DB_USER, password, database: TENANT_DB })
  try {
    await client.send(new CreateSecretCommand({ Name: SecretId, SecretString }))
  } catch (e: any) {
    if (e?.name === 'ResourceExistsException') {
      await client.send(new PutSecretValueCommand({ SecretId, SecretString }))
    } else throw e
  }
}

/** The store's on-node Postgres password (stored once, read back after), for a node-mode spec. */
async function nodeDbPassword(slug: string, spec: { db: { mode: string } }): Promise<{ dbPassword?: string }> {
  if (spec.db.mode !== 'node') return {}
  const { getOrCreateTenantDbPassword } = await import('./tenant-db-secret')
  return { dbPassword: await getOrCreateTenantDbPassword(slug) }
}

const isNodeJob = (r: Record<string, any>) => r.computeSpec?.db?.mode === 'node'
/** Login for a job's own database: an on-node Postgres logs in as `jeffi`; RDS needs nothing extra. */
const jobDbAuth = (slug: string, r: Record<string, any>): DbAuth | undefined =>
  isNodeJob(r) ? { iamAuth: false, dbSecretRef: tenantDbSecretRef(slug) } : undefined
const jobDbTarget = (slug: string, r: Record<string, any>): TenantDbTarget => ({
  endpoint: r.endpoint,
  dbName: r.dbName ?? TENANT_DB,
  ...jobDbAuth(slug, r),
})

/** Higher plans (growth/pro/enterprise) get a DEDICATED EC2; Basic uses the shared pool. */
function isDedicatedPlan(plan: string | null): boolean {
  return !!plan && ['growth', 'pro', 'enterprise'].includes(plan)
}

/**
 * Hostnames a tenant needs pointed at the shared app host, by plan tier. Basic = storefront +
 * admin + invoice + vault. The host tier for each document app MUST match the plan tier that sells the
 * feature (seed-plans.sql): review_forms is sold from Growth, so forms-{slug} is a Growth host —
 * a Growth tenant could otherwise create a form whose shareable link never resolved.
 */
function tenantHostnames(slug: string, plan: string | null): string[] {
  const hosts = [
    `${slug}.${ROOT_DOMAIN}`,
    `admin-${slug}.${ROOT_DOMAIN}`,
    `invoice-${slug}.${ROOT_DOMAIN}`,
    `vault-${slug}.${ROOT_DOMAIN}`,
  ]
  if (plan && ['growth', 'pro', 'enterprise'].includes(plan)) {
    hosts.push(
      `quotation-${slug}.${ROOT_DOMAIN}`,
      `purchaseorder-${slug}.${ROOT_DOMAIN}`,
      `forms-${slug}.${ROOT_DOMAIN}`
    )
  }
  if (plan && ['pro', 'enterprise'].includes(plan)) {
    hosts.push(`${slug}.business.${ROOT_DOMAIN}`)
  }
  return hosts
}

type Tenant = NonNullable<Awaited<ReturnType<typeof getTenant>>>

interface StepCtx {
  job: ProvisioningJob
  tenant: Tenant
  slug: string
  res: Record<string, any>
  provider: ProvisioningProvider
}

type Handler = (ctx: StepCtx) => Promise<StepResult>

/** The node-DB steps reach the servers and namespace through the same helpers as ensure_compute. */
const nodeCtx = ({ job, tenant, slug, res }: StepCtx): NodeDbCtx => ({
  slug,
  res,
  compute: () => jobCompute(job.tenant_id, tenant.plan, res),
  placeNodes: (c, opts) => placeNodes(job.id, slug, c, res, opts),
  applyWorkload: c => applyWorkload(job.tenant_id, slug, tenant.plan, c),
})

/** One handler per step. Bodies are the old switch cases; `ok()` replaces next(<following step>). */
const HANDLERS: Record<Step, Handler> = {
  async preflight({ job, tenant, res }) {
        // Fail fast on missing prerequisites BEFORE creating any billable infra, so a
        // misconfigured environment produces one clear error instead of a cryptic
        // mid-provision failure (e.g. absent RDS_MASTER_PASSWORD → "Invalid master
        // password" at create_db_instance; unset TENANT_APP_TARGET_IP → dead DNS).
        const missing: string[] = []
        // Only an RDS database (its own or a seat on a shared host) needs the master password.
        const { db } = (await jobCompute(job.tenant_id, tenant.plan, res)).spec
        if (db.mode !== 'node' && !process.env.RDS_MASTER_PASSWORD) missing.push('RDS_MASTER_PASSWORD')
        // The on-node Postgres is a pod: it needs the k8s compute engine.
        if (db.mode === 'node' && process.env.PROVISIONING_PROVIDER === 'aws' && process.env.PROVISIONING_COMPUTE !== 'k8s')
          missing.push('PROVISIONING_COMPUTE=k8s (the store database runs on its server)')
        // k8s serves every tenant through the cluster ingress; the EC2 target / flagship checks don't apply.
        if (process.env.PROVISIONING_COMPUTE === 'k8s') {
          if (!(process.env.CLUSTER_INGRESS_IP || '').trim()) missing.push('CLUSTER_INGRESS_IP')
          if (missing.length) throw new Error(`preflight: missing required env: ${missing.join(', ')}`)
          return ok()
        }
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
        return ok()
  },

  async create_param_group({ job, tenant, slug, res, provider }) {
        // max_connections by the database class the store chose (50 on a micro). A Starter store's
        // database lives on a shared host, which has its own; a Basic store runs Postgres as a pod
        // on its own node — no RDS, no param group, no pre-launch DB instance.
        const c = await jobCompute(job.tenant_id, tenant.plan, res)
        if (c.spec.db.mode === 'shared' || c.spec.db.mode === 'node')
          return skip(`${c.spec.db.mode === 'node' ? 'on-server' : 'shared'} database: no parameter group`)
        await provider.ensureParamGroup(paramGroupName(slug), c.maxConnections)
        res.paramGroup = paramGroupName(slug)
        return ok()
  },

  async create_db_instance({ job, tenant, slug, res, provider }) {
        const c = await jobCompute(job.tenant_id, tenant.plan, res)
        const { db } = c.spec
        if (db.mode === 'shared') {
          // A seat on a shared host. Never res.dbInstanceId: rollback deletes that instance.
          if (!res.sharedDbHost) {
            const { reserveSharedDbHost } = await import('@controller/lib/compute/shared-db')
            res.sharedDbHost = (await reserveSharedDbHost(provider)).id
          }
          return ok()
        }
        if (db.mode === 'node') {
          // Postgres on the tenant's own node: no RDS. wait_db_available stands up the server, its
          // data volume and the Postgres pod.
          res.endpoint = nodeDbHost(slug)
          res.dbName = TENANT_DB
          return ok()
        }
        const created = await provider.createDbInstance({
          dbInstanceId: dbInstanceId(slug),
          paramGroup: paramGroupName(slug),
          maxConnections: c.maxConnections,
          instanceClass: db.class ?? undefined,
          storageGb: db.storageGb,
          multiAz: db.multiAz,
        })
        res.dbInstanceId = created.dbInstanceId
        // AWS may fall back to the same size on t3 when t4g has no capacity.
        if (created.instanceClass) res.dbClass = created.instanceClass
        return ok()
  },

  async wait_db_available({ job, tenant, slug, res, provider }) {
        // Bound the wait: a db.t4g.micro is normally available in ~9 min. If it never
        // reaches available (stuck in creating/incompatible-parameters, wrong id), fail
        // after the deadline instead of polling forever — the catch triggers rollback.
        if (!res.dbWaitStartedAt) res.dbWaitStartedAt = Date.now()
        const DB_WAIT_DEADLINE_MS = 25 * 60 * 1000 // 25 min
        const c = await jobCompute(job.tenant_id, tenant.plan, res)
        if (c.spec.db.mode === 'node') {
          // Locally (stub engine) there is no cluster to run it on; the database steps no-op or fail softly.
          if (process.env.PROVISIONING_COMPUTE !== 'k8s') return skip('no cluster (stub engine)')
          if (!(await nodeDbReady(job, tenant, res, c))) {
            if (Date.now() - res.dbWaitStartedAt > NODE_DB_WAIT_DEADLINE_MS) {
              throw new Error(
                `wait_db_available: the database for "${slug}" was not ready within ${NODE_DB_WAIT_DEADLINE_MS / 60000} min` +
                  (res.dbConnectError ? ` (${res.dbConnectError})` : '')
              )
            }
            return wait()
          }
          res.endpoint = nodeDbHost(slug)
          res.dbName = TENANT_DB
          return ok()
        }
        const endpoint = await provider.getDbEndpoint(res.sharedDbHost ?? res.dbInstanceId)
        if (!endpoint) {
          if (Date.now() - res.dbWaitStartedAt > DB_WAIT_DEADLINE_MS) {
            throw new Error(
              `wait_db_available: ${res.dbInstanceId} did not become available within ${Math.round(DB_WAIT_DEADLINE_MS / 60000)} min`
            )
          }
          // Still provisioning — stay on this step, worker will poll again next tick.
          return wait()
        }
        if (res.sharedDbHost) {
          const { markSharedDbHostAvailable, tenantDbNames } = await import('@controller/lib/compute/shared-db')
          await markSharedDbHostAvailable(res.sharedDbHost, endpoint)
          await provider.initSharedDbHost(endpoint)
          const names = tenantDbNames(slug)
          await provider.createTenantDatabase(endpoint, names.db, names.role)
          res.dbName = names.db
          res.rdsUser = names.role
        }
        res.endpoint = endpoint
        return ok()
  },

  launch_server: ctx => launchServer(nodeCtx(ctx)),
  attach_db_disk: ctx => attachDbDisk(nodeCtx(ctx)),
  start_postgres: ctx => startPostgres(nodeCtx(ctx)),
  create_database: ctx => createDatabase(nodeCtx(ctx)),

  async load_schema({ slug, res, provider }) {
        // Loads the desired-state SCHEMA ONLY (0 rows) into the tenant's own DB. A fresh
        // tenant store is intentionally EMPTY — the owner adds their own catalog. Starter
        // data, if ever wanted, goes through the optional seed_data step below (not here).
        const auth = jobDbAuth(slug, res)
        if (res.rdsUser) await provider.loadSchema(res.endpoint, res.dbName, res.rdsUser)
        else if (auth) await provider.loadSchema(res.endpoint, TENANT_DB, undefined, auth)
        else await provider.loadSchema(res.endpoint, TENANT_DB)
        delete res.schemaPending
        return ok()
  },

  async restore_data({ slug, res, provider }) {
        // Only restores when the job was enqueued with a backup key (re-onboarding a
        // churned owner). No key → fresh store → fall through to optional seeding.
        const key = res.restoreFromKey as string | undefined
        if (key) {
          const { getTenantBackup } = await import('@/lib/tenancy/tenant-backup-store')
          const archive = await getTenantBackup(key)
          const auth = jobDbAuth(slug, res)
          if (auth) await provider.restoreDb(res.endpoint, res.dbName ?? TENANT_DB, archive, auth)
          else await provider.restoreDb(res.endpoint, res.dbName ?? TENANT_DB, archive)
          res.restored = true
        }
        return key ? ok() : skip('no backup to restore')
  },

  async seed_data({ slug, res }) {
        // Optional starter-catalog seed. No-op unless the job carries a `seedProfile`
        // (mirrors restore_data's opt-in shape). Deliberately separate from load_schema so
        // "empty store" stays the default and seeding never runs by accident. Skipped
        // entirely when the store was restored from a backup. NON-FATAL: a store without starter
        // rows is still a working store.
        const profile = res.seedProfile as string | undefined
        if (profile && !res.restored) {
          try {
            const { seedTenantData } = await import('./seed')
            const auth = jobDbAuth(slug, res)
            if (auth) await seedTenantData(res.endpoint, res.dbName ?? TENANT_DB, profile, auth)
            else await seedTenantData(res.endpoint, res.dbName ?? TENANT_DB, profile)
            res.seeded = profile
            delete res.seedError
          } catch (e: any) {
            res.seedError = e?.message || 'seeding failed'
          }
        }
        if (!profile || res.restored) return skip(res.restored ? 'store restored from a backup' : 'no starter catalogue chosen')
        return res.seedError ? warn(res.seedError) : ok()
  },

  async generate_legals({ job, res }) {
        // Generate the tenant's own legal pages (terms/privacy/refund/…) templated from their
        // business details + uploaded logo/seal, into the tenant bucket. Runs AFTER create_bucket
        // + write_infra so the bucket exists. NON-FATAL — a legals failure must not block go-live.
        let failed: string | null = null
        try {
          const { generateTenantLegals } = await import('../legals/provision')
          await generateTenantLegals(job.tenant_id, res.endpoint)
          res.legalsGenerated = true
        } catch (e: any) {
          res.legalsError = e?.message || 'legals generation failed'
          failed = res.legalsError
        }
        return failed ? warn(failed) : ok()
  },

  async seed_settings({ job, slug, res }) {
        // Copy the owner's onboarding identity + warehouse (control-plane tenant/KYC/draft) into
        // the tenant's own site_settings so the storefront renders the registered business name,
        // contact, logo and seller/pickup fields instead of slug/blank/platform defaults. Runs
        // after create_bucket + write_infra (logo copy needs the tenant bucket) and mirrors the
        // legals identity read. NON-FATAL — a settings failure must not block go-live.
        let outcome: StepResult = ok()
        try {
          const { controlPlanePool } = await import('@/lib/tenant-registry')
          const ownerRow = await controlPlanePool()
            .query(`SELECT owner_id FROM owner_tenants WHERE tenant_id=$1 LIMIT 1`, [job.tenant_id])
            .catch(() => null)
          const ownerId = ownerRow?.rows?.[0]?.owner_id
          if (ownerId && res.endpoint) {
            const { seedTenantSiteSettings } = await import('./seed-settings')
            await seedTenantSiteSettings(job.tenant_id, ownerId, jobDbTarget(slug, res))
            res.settingsSeeded = true
          } else {
            res.settingsSeeded = 'skipped (missing owner or db endpoint)'
            outcome = skip('missing owner or db endpoint')
          }
        } catch (e: any) {
          res.settingsError = e?.message || 'settings seeding failed'
          outcome = warn(res.settingsError)
        }
        return outcome
  },

  async create_bucket({ slug, res, provider }) {
        await provider.ensureBucket(bucketName(slug))
        res.bucket = bucketName(slug)
        return ok()
  },

  async write_infra({ job, tenant, slug, res }) {
        // Node mode (the store's own Postgres on its EC2 node): password auth, creds in Secrets
        // Manager at jeffi/tenant-db/<slug>. RDS/shared modes stay on IAM auth.
        const nodeMode = (await jobCompute(job.tenant_id, tenant.plan, res)).spec.db.mode === 'node'
        await writeTenantInfra(job.tenant_id, {
          rdsEndpoint: res.endpoint,
          s3Bucket: res.bucket,
          ...(res.sharedDbHost ? { rdsDb: res.dbName, rdsUser: res.rdsUser, sharedDbHost: res.sharedDbHost } : {}),
          ...(nodeMode
            ? { rdsEndpoint: nodeDbHost(slug), rdsDb: TENANT_DB, rdsUser: NODE_DB_USER, iamAuth: false, dbSecretRef: tenantDbSecretRef(slug) }
            : {}),
        })
        return ok()
  },

  async ensure_compute({ job, tenant, slug, res, provider }) {
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
        const k8s = await import('@/lib/k8s/tenant-compute')
        if (k8s.k8sComputeEnabled()) {
          if (!res.computeWaitStartedAt) res.computeWaitStartedAt = Date.now()
          const c = await jobCompute(job.tenant_id, tenant.plan, res)
          const placed = await placeNodes(job.id, slug, c, res)
          if (!placed.ready) {
            if (Date.now() - res.computeWaitStartedAt > 15 * 60 * 1000) {
              throw new Error(`ensure_compute: k8s servers for "${slug}" did not become Ready within 15 min`)
            }
            return wait()
          }
          // An on-node Postgres is already up (wait_db_available) and the same render leaves it running.
          delete res.dbPassword
          await applyWorkload(job.tenant_id, slug, tenant.plan, c)
          // A job started before the database came up first deferred its schema to here.
          if (res.schemaPending && c.spec.db.mode === 'node') {
            if (!(await k8s.postgresPodReady(slug))) {
              return wait()
            }
            await provider.loadSchema(res.endpoint, TENANT_DB, undefined, { iamAuth: false, dbSecretRef: tenantDbSecretRef(slug) })
            delete res.schemaPending
          }
          await recordApplied(job.tenant_id, slug, res.dbClass ? { ...c.spec, db: { ...c.spec.db, class: res.dbClass } } : c.spec, c.nodeGen)
          res.ec2Target = k8s.clusterIngressIp()
          res.computeMode = 'k8s'
          delete res.poolInstanceId
          await writeTenantEc2(job.tenant_id, res.ec2Target, res.ec2InstanceId)
          return ok()
        }

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
                name: `jeffi-tenant-${slug}`,
                instanceType: process.env.TENANT_DEDICATED_EC2_TYPE || 't4g.small',
                userData: appBootUserData(),
              },
              // Persist before the readiness wait so rollback can terminate it if that throws.
              async id => {
                res.ec2InstanceId = id
                await updateProvisioningJob(job.id, { created_resources: res })
              }
            )
            res.ec2InstanceId = instanceId
            res.ec2Target = ip
            res.computeMode = 'dedicated'
          }
        } else {
          const { ensurePoolInstance } = await import('@controller/lib/tenancy/pool-autoscale')
          const { ip } = await ensurePoolInstance()
          res.ec2Target = ip
          res.computeMode = 'pool'
        }
        if (res.ec2Target) await writeTenantEc2(job.tenant_id, res.ec2Target, res.ec2InstanceId)
        return ok()
  },

  async setup_delhivery({ job, tenant, slug, res }) {
        // Register the tenant's Delhivery pickup/client-warehouse from their onboarding
        // warehouse config. NON-FATAL — a pickup-registration failure must not block go-live
        // (it can be retried/fixed later; shipments just can't be created until then).
        try {
          const { getKyc, getTenantWarehouse } = await import('@/lib/tenant-registry')
          // KYC's saved warehouse, else the onboarding draft's.
          const wh = (await getTenantWarehouse(job.tenant_id).catch(() => null)) ?? {}
          const kyc = await getKyc(job.tenant_id).catch(() => null)
          const phone = wh.sellerPhone || kyc?.mobile
          if (phone && wh.originPincode) {
            const { createDelhiveryPickupLocation } = await import('@/lib/shipping/delhivery')
            const pickup = {
              name: wh.pickupLocation || tenant.slug,
              phone,
              pincode: wh.originPincode,
              address: wh.sellerAddress || kyc?.business_address || '',
              registeredName: wh.sellerName || tenant.display_name,
              tenantId: job.tenant_id,
            }
            // The store's admin lists its pickup locations from its own database, so the row goes there
            // (never the control plane's); without a reachable one the store's admin backfills it on read.
            const { tenantAdminPool } = await import('./tenant-admin-pool')
            const db = res.endpoint ? await tenantAdminPool(jobDbTarget(slug, res)).catch(() => null) : null
            try {
              const r = await createDelhiveryPickupLocation(pickup, { db })
              res.delhiveryPickup = r.ok ? 'created' : `error: ${r.error}`
            } finally {
              await db?.end().catch(() => {})
            }
          } else {
            res.delhiveryPickup = 'skipped (no warehouse config)'
          }
        } catch (e: any) {
          res.delhiveryPickup = `error: ${e?.message || 'failed'}`
        }
        const pickup = String(res.delhiveryPickup)
        return pickup === 'created' ? ok() : pickup.startsWith('skipped') ? skip('no warehouse config') : warn(pickup)
  },

  async configure_dns({ tenant, slug, res, provider }) {
        const hosts = tenantHostnames(slug, tenant.plan)
        // k8s: *.jeffistores.in is one wildcard record at the cluster ingress, so nothing to upsert.
        // Otherwise point at this tenant's serving IP (dedicated instance or pool).
        if (res.computeMode !== 'k8s') await provider.ensureDns(hosts, res.ec2Target)
        res.dnsHosts = hosts
        return res.computeMode === 'k8s' ? skip('wildcard DNS at the cluster ingress') : ok()
  },

  async verify_serving({ slug, res, provider }) {
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
          return skip('stub provider: no host to probe')
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
              return wait()
            }
            throw new Error(
              `verify_serving: dedicated instance ${res.ec2InstanceId} is gone/terminated after ${attempts} attempts`
            )
          }
        }
        if (res.computeMode === 'k8s') {
          // The shared ingress answers every host (404/503), so an HTTP reply proves nothing here.
          if (!res.verifyStartedAt) res.verifyStartedAt = Date.now()
          const { tenantWorkloadReady } = await import('@/lib/k8s/tenant-compute')
          served = await tenantWorkloadReady(slug).catch(() => false)
        } else
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
        if (served) return ok()
        // k8s: a fresh node's first image pull + startup can outlast 6 one-minute ticks; bound by time.
        const withinBudget =
          res.computeMode === 'k8s'
            ? Date.now() - res.verifyStartedAt < K8S_VERIFY_DEADLINE_MS
            : attempts < MAX_VERIFY_ATTEMPTS
        if (withinBudget) {
          // Not serving yet — stay on this step; the worker retries next tick (DNS/TLS lag).
          return wait()
        }
        throw new Error(
          `verify_serving: ${primaryHost} did not serve after ${attempts} attempts (app tier / DNS / TLS not ready)`
        )
  },

  async issue_owner_certificate({ job, slug, res }) {
    // The owner's super_admin in the store's own database and their client certificate (tenant CA),
    // emailed as a portal invite. Up to 4 attempts, then a warning: the store still goes live and the
    // certificate can be issued from the customer's Certificates tab.
    if (process.env.PROVISIONING_PROVIDER !== 'aws') return skip('stub provider: no store database')
    const { ensureOwnerAdmin } = await import('@controller/lib/tenancy/tenant-admin-provision')
    const prev = res.ownerCert as { serial?: string; emailed?: boolean } | undefined
    const r = await ensureOwnerAdmin(job.tenant_id, { resendInviteFor: prev?.emailed === false ? prev.serial : undefined })
    if (r.noOwner) return skip('no owner is linked to this store')
    if (!r.success) throw new Error(`owner certificate not issued: ${r.error ?? 'unknown error'}`)
    if (r.outcome !== 'exists') res.ownerCert = { serial: r.serial, emailed: r.emailed }
    else if (prev?.serial && prev.serial.toUpperCase() === r.serial?.toUpperCase()) res.ownerCert = { ...prev, emailed: prev.emailed || r.emailed }
    else res.ownerCert = { serial: r.serial, existing: true }
    // The tenant CA exists now: republish the fleet's client-CA bundle so the admin host asks for it.
    let fleetError: string | null = null
    if (res.mtlsFleet !== 'refreshed') {
      try {
        const { refreshTenantMtlsFleet } = await import('@controller/lib/tenancy/mtls-fleet')
        await refreshTenantMtlsFleet(slug)
        res.mtlsFleet = 'refreshed'
      } catch (e: any) {
        fleetError = e?.message ?? String(e)
        res.mtlsFleet = `error: ${fleetError}`
      }
    }
    if (res.ownerCert.emailed === false) throw new Error(`owner certificate ${r.serial} issued but its invite email failed`)
    if (fleetError) {
      try {
        const { alertProvisioningFailure } = await import('./alerts')
        await alertProvisioningFailure(slug, 'mtls_fleet_refresh', fleetError, job.tenant_id)
      } catch {
        /* alerting must never mask the failure */
      }
      return warn(`certificate ready; client-CA bundle not refreshed: ${fleetError}`)
    }
    return ok(r.outcome === 'exists' ? 'owner certificate already active' : `issued ${r.serial} to ${r.email}`)
  },

  async activate({ job, res, provider }) {
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
        await setStoreRequest(job.tenant_id, null)
        // Once per store; never throws.
        const { notifyStoreLive } = await import('./start-store')
        await notifyStoreLive(job.tenant_id)
        // The runner records the event and moves on (connect_crons on k8s) or marks the job done.
        return ok('tenant activated')
  },

  async connect_crons({ job, slug, res }) {
    // The platform's cron fan-out reaches this store's pods: the same base, Host and bearer it uses
    // (lib/cron/targets.ts) against the store's ping route. Records the jobs the store's plan gets.
    const { CRON_PING_PATH, storeCronJobs } = await import('@/lib/shared/cron-jobs')
    const { getTenantPlan } = await import('@/lib/auth/plan-gate')
    const scopes = await getTenantPlan(job.tenant_id).then(
      p => p.scopes,
      () => new Set<string>()
    )
    res.cronJobs = storeCronJobs(scopes).map(j => j.id)
    if (process.env.PROVISIONING_PROVIDER !== 'aws') return skip('stub provider: no store pods to reach')
    if (!onK8sCompute(res)) return skip('not on k8s: no cron fan-out to the store')
    if (!process.env.CRON_SECRET) throw new Error('connect_crons: missing required env CRON_SECRET on the controller')
    const { storeCronHost, storeCronTarget } = await import('@controller/lib/cron/targets')
    const { storeLayouts } = await import('@controller/lib/compute/store')
    const layout = (await storeLayouts([job.tenant_id]).catch(() => new Map())).get(job.tenant_id) ?? 'services'
    const target = storeCronTarget(slug, layout, CRON_PING_PATH)
    if ('skip' in target) return skip(target.skip)
    const problem = await pingStoreCrons(target.base + CRON_PING_PATH, storeCronHost(slug), slug, res)
    // Not reachable yet: polled until the step's timeout, then retried with backoff and finally a warning.
    if (problem) return wait(problem)
    return ok(`scheduled jobs reach the store (${res.cronJobs.length} jobs)`)
  },
}

/** One ping of the store's cron route; null when every check passes, else what failed. */
async function pingStoreCrons(url: string, host: string, slug: string, res: Record<string, any>): Promise<string | null> {
  const { internalRequest } = await import('@/lib/shared/internal-http')
  const at = new Date().toISOString()
  let r: Awaited<ReturnType<typeof internalRequest>>
  try {
    r = await internalRequest(url, { host, headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` }, timeoutMs: 10_000 })
  } catch (e: any) {
    res.cronPing = { url, ok: false, at, error: e?.message ?? String(e) }
    return `${url} unreachable: ${e?.message ?? e}`
  }
  let body: Record<string, any> = {}
  try {
    body = JSON.parse(r.body)
  } catch {
    /* non-JSON: reported by status below */
  }
  res.cronPing = { url, ok: r.ok && body.ok === true, status: r.status, at, db: body.db, messaging: body.messaging, documents: body.documents }
  if (!r.ok) return `${url} answered HTTP ${r.status}${r.status === 401 ? ' (CRON_SECRET missing or different in the store secret)' : ''}`
  if (body.tenant !== slug) return `${url} answered for ${body.tenant ?? 'no store'}, not ${slug}`
  const failing = (['db', 'messaging', 'documents'] as const).filter(k => body[k] === 'error')
  return failing.length ? `the store's ${failing.join(', ')} check failed` : null
}

/**
 * The store's pipeline, built from its compute and the environment and pinned on the job. Rebuilt on
 * each preflight tick (a fixed environment or a resumed job starts from the current one); fixed after.
 */
async function pinPipeline(job: ProvisioningJob, plan: string | null, res: Record<string, any>): Promise<PipelineDef> {
  const c = await jobCompute(job.tenant_id, plan, res)
  const pipeline = buildPipeline(c.spec, plan, {
    engine: process.env.PROVISIONING_COMPUTE === 'k8s' ? 'k8s' : 'ec2',
    provider: process.env.PROVISIONING_PROVIDER === 'aws' ? 'aws' : 'stub',
    restore: !!res.restoreFromKey,
    seed: !!res.seedProfile && !res.restoreFromKey,
  })
  if (JSON.stringify(pipeline) !== JSON.stringify(job.pipeline ?? null)) await updateProvisioningJob(job.id, { pipeline })
  return pipeline
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
  // A job that started before pipelines were pinned carries on with the legacy steps.
  let pipeline = pipelineOf(job.pipeline)

  try {
    await updateProvisioningJob(job.id, { status: 'running', bumpAttempts: true })
    const step = job.step as Step
    if (step === 'preflight') pipeline = await pinPipeline(job, tenant.plan, res)

    const handler = HANDLERS[step]
    if (!handler || !flatSteps(pipeline).includes(step)) {
      await updateProvisioningJob(job.id, { status: 'failed', last_error: `unknown step ${step}` })
      return 'failed'
    }
    const result = await handler({ job, tenant, slug, res, provider })
    if ('wait' in result) return await waitOn(job, step, res, result.detail)
    if ('skip' in result) return await advance(job, pipeline, res, 'skipped', result.skip)
    if ('warn' in result) return await advance(job, pipeline, res, 'warning', result.warn)
    return await advance(job, pipeline, res, 'ok', result.message ?? null)
  } catch (e: any) {
    const msg = e?.message || String(e) || 'error'
    // Errors on THIS step: job.attempts counts every tick, polls included, so a long wait for a
    // server or database would leave a later step no retries at all.
    const attempts = (res.stepErrors || 0) + 1
    res.stepErrors = attempts
    await recordStepEvent(job.id, job.step, 'error', msg, resourcesFor(job.step as Step, res))
    const policy = STEP_CATALOG[job.step as Step] as (typeof STEP_CATALOG)[Step] | undefined
    // Classify: transient errors get retried with backoff; deterministic errors fail now.
    const terminal = isTerminalError(msg) || attempts >= (policy?.maxAttempts ?? MAX_PROVISION_ATTEMPTS)
    if (!terminal) {
      // Retryable — keep the job alive (pending) and back off before the next tick.
      const delayMs = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** (attempts - 1))
      const jitter = Math.floor((delayMs * 0.2 * (attempts % 3)) / 2) // deterministic small jitter (no Math.random)
      const nextAttemptAt = new Date(Date.now() + delayMs + jitter)
      await updateProvisioningJob(job.id, {
        status: 'pending',
        last_error: `retryable (attempt ${attempts}): ${msg}`,
        created_resources: res,
        bumpAttempts: true,
        nextAttemptAt,
      })
      return 'pending'
    }
    // A step the store can go live without: warn, alert and carry on. Nothing is rolled back.
    if (policy?.continueOnError) {
      try {
        const { alertProvisioningFailure } = await import('./alerts')
        await alertProvisioningFailure(slug, policy.alertAs ?? job.step, msg, job.tenant_id)
      } catch {
        /* alerting must never mask the failure */
      }
      return await advance(job, pipeline, res, 'warning', msg)
    }
    // Terminal (or out of attempts) → fail + auto-rollback billable resources. A resumed job starts its count afresh.
    delete res.stepErrors
    await updateProvisioningJob(job.id, {
      status: 'failed',
      last_error: msg,
      created_resources: res,
      bumpAttempts: true,
    })
    try {
      await rollbackProvisioning(job.tenant_id, provider)
    } catch {
      /* rollback failure already recorded; original failure stands */
    }
    try {
      const { alertProvisioningFailure } = await import('./alerts')
      await alertProvisioningFailure(slug, job.step, msg, job.tenant_id)
    } catch {
      /* alerting must never mask the failure */
    }
    return 'failed'
  }
}

// Retry tuning for the provisioning state machine.
const MAX_PROVISION_ATTEMPTS = 8
const K8S_VERIFY_DEADLINE_MS = 12 * 60 * 1000
const BACKOFF_BASE_MS = 15_000 // 15s, doubling
const BACKOFF_CAP_MS = 600_000 // capped at 10 min

/** Deterministic errors that won't fix themselves on retry → fail fast (no wasted retries). */
export function isTerminalError(msg: string): boolean {
  return /AccessDenied|not authorized|UnauthorizedOperation|InvalidParameterValue|Invalid master password|preflight:|activate blocked|compute blocked|InvalidParameterCombination|missing required env|VcpuLimitExceeded|InstanceLimitExceeded|k8s node launch needs/i.test(
    msg
  )
}

function isTransientDnsError(msg: string): boolean {
  if (/InvalidChangeBatch|InvalidInput|NoSuchHostedZone|AccessDenied|not authorized/i.test(msg)) return false
  return /Throttling|PriorRequestNotComplete|ServiceUnavailable|InternalError|RequestTimeout|\((429|500|502|503|504)\)|ETIMEDOUT|ECONNRESET|EAI_AGAIN|fetch failed|network/i.test(
    msg
  )
}

async function retryTransient<T>(
  fn: () => Promise<T>,
  isTransient: (msg: string) => boolean,
  attempts = 3
): Promise<{ value?: T; error?: any; attempts: number }> {
  let lastError: any
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return { value: await fn(), attempts: attempt }
    } catch (e: any) {
      lastError = e
      if (attempt === attempts || !isTransient(e?.message || String(e))) break
      const backoff = 500 * 3 ** (attempt - 1)
      await new Promise(r => setTimeout(r, backoff + Math.floor(Math.random() * 250)))
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
 * step went 'running'), so callers need only the job id. `fromStepStart` (a step's outcome): the
 * step's start and its whole duration from step_started_at. Never throws: a missing log line must
 * not fail a provisioning step.
 */
async function recordStepEvent(
  jobId: string,
  step: string,
  status: 'ok' | 'skipped' | 'warning' | 'error',
  message: string | null,
  detail: Record<string, unknown> = {},
  fromStepStart = false
): Promise<void> {
  try {
    await controlPlanePool().query(
      fromStepStart
        ? `INSERT INTO provisioning_step_events (job_id, tenant_id, step, status, message, detail, started_at, duration_ms)
       SELECT j.id, j.tenant_id, $2, $3, $4, $5::jsonb, j.step_started_at,
              LEAST(2147483647, GREATEST(0, EXTRACT(EPOCH FROM (now() - COALESCE(j.step_started_at, j.updated_at))) * 1000))::int
         FROM provisioning_jobs j WHERE j.id = $1`
        : `INSERT INTO provisioning_step_events (job_id, tenant_id, step, status, message, detail, duration_ms)
       SELECT j.id, j.tenant_id, $2, $3, $4, $5::jsonb,
              GREATEST(0, (EXTRACT(EPOCH FROM (now() - j.updated_at)) * 1000)::int)
         FROM provisioning_jobs j WHERE j.id = $1`,
      [jobId, step, status, message, JSON.stringify(detail)]
    )
  } catch {
    /* the log is not worth failing a provisioning step over */
  }
}

/** A step finished (ok / skipped / warning): log it and move to the next step of the pipeline, or done. */
async function advance(
  job: ProvisioningJob,
  pipeline: PipelineDef,
  res: Record<string, any>,
  outcome: 'ok' | 'skipped' | 'warning',
  message: string | null
): Promise<string> {
  await recordStepEvent(job.id, job.step, outcome, message, resourcesFor(job.step as Step, res), true)
  delete res.stepErrors
  delete res.stepDetail
  delete res.stepWaitStartedAt
  const nextStep = nextStepAfter(pipeline, job.step)
  if (!nextStep) {
    await updateProvisioningJob(job.id, { status: 'done', created_resources: res })
    return 'done'
  }
  // Clear any backoff timer on a successful step transition (prior retries are resolved).
  await updateProvisioningJob(job.id, { step: nextStep, status: 'pending', created_resources: res, clearNextAttempt: true, stepStarted: true })
  return 'pending'
}

/**
 * Stay on the step; the worker polls it again next tick. A step with a catalog timeout fails once it has
 * waited that long (from step_started_at); the older wait steps bound themselves.
 */
async function waitOn(job: ProvisioningJob, step: Step, res: Record<string, any>, detail?: string): Promise<string> {
  const timeoutMs = STEP_CATALOG[step].timeoutMs
  if (timeoutMs) {
    const started = job.step_started_at ? new Date(job.step_started_at).getTime() : (res.stepWaitStartedAt ??= Date.now())
    if (Date.now() - started > timeoutMs) {
      throw new Error(`${step}: not ready within ${Math.round(timeoutMs / 60000)} min${detail ? ` (${detail})` : ''}`)
    }
  }
  if (detail) res.stepDetail = detail
  await updateProvisioningJob(job.id, { status: 'pending', created_resources: res })
  return 'pending'
}

function resourcesFor(step: Step, res: Record<string, any>): Record<string, unknown> {
  const keys = STEP_CATALOG[step]?.outputs
  if (!keys?.length) return {}
  const out: Record<string, unknown> = {}
  for (const k of keys) if (res[k] !== undefined) out[k] = res[k]
  return out
}

/** Delete a param group after its DB instance is fully gone (RDS refuses while attached).
 * Bounded polling — if the DB is still deleting after the budget, skip (a later teardown /
 * reconciliation sweep retries). Best-effort; never throws. */
async function deleteParamGroupWhenDbGone(
  provider: ProvisioningProvider,
  dbInstanceId: string | undefined,
  paramGroup: string | undefined
): Promise<void> {
  if (!paramGroup) return
  try {
    if (dbInstanceId) {
      for (let i = 0; i < 20; i++) {
        if (await provider.isDbInstanceGone(dbInstanceId)) break
        await new Promise(r => setTimeout(r, 15_000))
      }
    }
    await provider.deleteParamGroup(paramGroup)
  } catch {
    /* still attached / transient — a later teardown or sweep will retry */
  }
}

/** k8s compute: recorded by the job, or the engine is in k8s mode (a job can fail before ensure_compute). */
function onK8sCompute(r: Record<string, any>): boolean {
  return r.computeMode === 'k8s' || !!r.computeWaitStartedAt || process.env.PROVISIONING_COMPUTE === 'k8s'
}

/** The compute this job builds, fixed on first use so the database and servers agree. */
async function jobCompute(tenantId: string, plan: string | null, res: Record<string, any>) {
  const { resolveCompute } = await import('@controller/lib/compute/resolve')
  const c = await resolveCompute(tenantId, plan, { spec: res.computeSpec })
  res.computeSpec = c.spec
  return c
}

type JobCompute = Awaited<ReturnType<typeof jobCompute>>

/** The store's servers (and, for an on-node database, its data volume unless `dbVolume: false`), launched if missing. */
async function placeNodes(
  jobId: string,
  slug: string,
  c: Pick<JobCompute, 'spec' | 'nodeGen'>,
  res: Record<string, any>,
  opts: { dbVolume?: boolean } = {}
) {
  const k8s = await import('@/lib/k8s/tenant-compute')
  return k8s.ensureTenantNodes(
    slug,
    c.spec.node,
    c.nodeGen,
    { instances: knownNodeInstances(slug, res), poolInstanceId: res.poolInstanceId },
    async (id, kind, name) => {
      if (kind === 'dedicated') {
        res.nodeInstances = { ...res.nodeInstances, [name]: id }
        res.ec2InstanceId ??= id
      } else res.poolInstanceId = id
      await updateProvisioningJob(jobId, { created_resources: res })
    },
    c.spec.db.mode === 'node' && opts.dbVolume !== false ? { dbVolume: { sizeGb: c.spec.db.storageGb } } : undefined
  )
}

/** Apply the store's namespace; an on-node database's render always carries its stored password. */
async function applyWorkload(
  tenantId: string,
  slug: string,
  plan: string | null,
  c: Pick<JobCompute, 'spec' | 'dbPoolMax' | 'nodeGen'>,
  hosts = tenantHostnames(slug, plan)
): Promise<void> {
  const k8s = await import('@/lib/k8s/tenant-compute')
  const { routedCustomDomains } = await import('@/lib/tenant-registry/custom-domains')
  const customDomains = await routedCustomDomains(tenantId).catch(() => [])
  await k8s.applyTenantWorkload({
    slug,
    plan,
    hosts,
    customDomains,
    compute: c.spec,
    dbPoolMax: c.dbPoolMax,
    nodeGen: c.nodeGen,
    ...(await nodeDbPassword(slug, c.spec)),
  })
}

const NODE_DB_WAIT_DEADLINE_MS = 30 * 60 * 1000

/**
 * On-node Postgres: the store's server and data volume, its namespace and the Postgres pod, and a login
 * that works. Each call does the next missing piece and reports whether the database takes connections.
 */
async function nodeDbReady(
  job: ProvisioningJob,
  tenant: { slug: string; plan: string | null },
  res: Record<string, any>,
  c: JobCompute
): Promise<boolean> {
  const slug = tenant.slug
  if (!(await placeNodes(job.id, slug, c, res)).ready) return false
  const { dbPassword } = await nodeDbPassword(slug, c.spec)
  await applyWorkload(job.tenant_id, slug, tenant.plan, c)
  const k8s = await import('@/lib/k8s/tenant-compute')
  if (!(await k8s.postgresPodReady(slug))) return false
  try {
    // The image creates the store database only on a fresh data directory; make sure it is there.
    await withTenantAdminPool({ endpoint: nodeDbHost(slug), dbName: 'postgres', dbPassword }, async pool => {
      const found = await pool.query('SELECT 1 FROM pg_database WHERE datname = $1', [TENANT_DB])
      if (!found.rowCount) await pool.query(`CREATE DATABASE ${TENANT_DB}`)
    })
  } catch (e: any) {
    res.dbConnectError = e?.message || String(e)
    return false
  }
  delete res.dbConnectError
  return true
}

/**
 * After a store's own servers are terminated: its database data volume (snapshotted first on a teardown)
 * and its database secret. Never throws; what could not be removed is returned for manual cleanup.
 */
async function cleanupNodeDb(
  slug: string,
  r: Record<string, any>,
  opts: { snapshot: boolean; persist?: () => Promise<void> }
): Promise<Record<string, string>> {
  const left: Record<string, string> = {}
  try {
    const { describeTenantDbVolume, snapshotVolume, deleteVolume } = await import('@/lib/shared/ec2-client')
    const vol = await describeTenantDbVolume(slug)
    if (vol) {
      if (opts.snapshot && !r.dbVolumeSnapshotId) {
        r.dbVolumeSnapshotId = await snapshotVolume(vol.volumeId, slug, `teardown of ${slug}`)
        await opts.persist?.().catch(() => {})
      }
      await deleteVolume(vol.volumeId)
    }
  } catch (e: any) {
    left.dbVolume = `cleanup failed: ${e?.message || e}`
  }
  try {
    const { deleteTenantDbSecret } = await import('./tenant-db-secret')
    await deleteTenantDbSecret(slug)
  } catch (e: any) {
    left.dbSecret = `delete ${tenantDbSecretRef(slug)} failed: ${e?.message || e}`
  }
  return left
}

/** The store's database ran on its own server (the job's spec, the registry, or the endpoint says so). */
const ranNodeDb = (slug: string, r: Record<string, any>, tenant?: { iam_auth?: boolean | null; rds_endpoint?: string | null } | null) =>
  isNodeJob(r) || tenant?.iam_auth === false || nodeDbSlug(tenant?.rds_endpoint ?? r.endpoint) === slug

/** Server instances a job launched, by node name (jobs before generations kept only ec2InstanceId). */
function knownNodeInstances(slug: string, r: Record<string, any>): Record<string, string> {
  return r.nodeInstances ?? (r.ec2InstanceId ? { [dedicatedNodeName(slug)]: r.ec2InstanceId } : {})
}

/** Every instance a store's own servers ran on, from the job and the registry. */
function ownInstanceIds(r: Record<string, any>, registered?: string | null, extra: string[] = []): string[] {
  return [...new Set([r.ec2InstanceId, registered, ...Object.values(r.nodeInstances ?? {}), ...extra].filter(Boolean))] as string[]
}

// Billing reads tenant_compute.applied; a failed write is retried by the next apply, so it never fails a step.
async function recordApplied(tenantId: string, slug: string, spec: import('@/lib/compute/spec').ComputeSpec, gen: number) {
  const { markComputeApplied } = await import('@controller/lib/compute/resolve')
  await markComputeApplied(tenantId, spec, gen).catch((e: any) => console.error(`[provisioning] ${slug}: compute not recorded: ${e?.message}`))
}

/** Terminate a tenant's own instance. On k8s, refuses anything not named for this tenant (returns why). */
async function terminateOwnInstance(
  provider: ProvisioningProvider,
  slug: string,
  instanceId: string,
  k8s: boolean
): Promise<string | null> {
  if (!k8s) {
    await provider.deleteAppInstance(instanceId)
    return null
  }
  const { terminateTenantInstance } = await import('@/lib/k8s/tenant-compute')
  const out = await terminateTenantInstance(slug, instanceId, id => provider.deleteAppInstance(id))
  return out === 'refused' ? `refused to terminate ${instanceId}: not this tenant's node` : null
}

/** Rollback a failed job's created resources (avoid leaked billing + leave a safe state). */
export async function rollbackProvisioning(tenantId: string, provider: ProvisioningProvider): Promise<void> {
  const job = await getProvisioningJob(tenantId)
  const tenant = await getTenant(tenantId)
  const r = (job?.created_resources as Record<string, any>) || {}
  // DNS first (cheap, no dependency) — use recorded hosts, else derive from slug.
  // k8s tenants never get per-host records (the *.jeffistores.in wildcard serves them), so skip.
  const k8s = onK8sCompute(r)
  const hosts = k8s
    ? []
    : ((r.dnsHosts as string[] | undefined) ?? (tenant ? tenantHostnames(tenant.slug, tenant.plan) : []))
  // Best-effort but LOUD: a swallowed removeDns failure leaves zombie A-records pointing at a
  // torn-down box (records outliving the instance). Record it + flag the lingering hosts for a
  // reconciler instead of failing the rollback.
  if (hosts.length) {
    try {
      await provider.removeDns(hosts)
    } catch (e: any) {
      if (job)
        await recordStepEvent(job.id, 'rollback', 'error', `removeDns failed: ${e?.message || e}`, { dnsHosts: hosts })
      r.manualCleanup = { ...((r.manualCleanup as Record<string, unknown>) || {}), dnsHosts: hosts }
    }
  }
  // Dedicated EC2 (higher plans) — terminate it; a Basic tenant used the shared pool (left alone
  // here, reclaimed by deletePoolIfEmpty on the final deprovision). Prefer the durably-persisted
  // instance id (tenant_infra.ec2_instance_id) over the job JSON, which can be trimmed/lost.
  let nodeInstanceIds: string[] = []
  if (k8s && tenant?.slug) {
    const { deleteTenantWorkload } = await import('@/lib/k8s/tenant-compute')
    nodeInstanceIds = await deleteTenantWorkload(tenant.slug).catch(() => [])
  }
  if (tenant?.slug) {
    const refused: string[] = []
    for (const id of ownInstanceIds(r, tenant.ec2_instance_id, nodeInstanceIds)) {
      const why = await terminateOwnInstance(provider, tenant.slug, id, k8s).catch(() => null)
      if (why) refused.push(why)
    }
    if (refused.length) r.manualCleanup = { ...((r.manualCleanup as Record<string, unknown>) || {}), instance: refused.join('; ') }
    // An on-node database: its data volume (now its server is gone) and its password. Nothing of a
    // failed provision is worth a snapshot; a restore's source is still in S3.
    if (k8s && ranNodeDb(tenant.slug, r, tenant)) {
      const left = await cleanupNodeDb(tenant.slug, r, { snapshot: false })
      if (Object.keys(left).length) r.manualCleanup = { ...((r.manualCleanup as Record<string, unknown>) || {}), ...left }
    }
  }
  // Billable resources.
  if (r.bucket) await provider.deleteBucket(r.bucket).catch(() => {})
  if (r.dbInstanceId) await provider.deleteDbInstance(r.dbInstanceId).catch(() => {})
  if (r.sharedDbHost) {
    if (r.endpoint && r.dbName) await provider.dropTenantDatabase(r.endpoint, r.dbName, r.rdsUser ?? null).catch(() => {})
    const { releaseSharedDbSeat } = await import('@controller/lib/compute/shared-db')
    await releaseSharedDbSeat(r.sharedDbHost).catch(() => {})
    delete r.sharedDbHost
  }
  // Param group can only be deleted once the DB is gone.
  await deleteParamGroupWhenDbGone(provider, r.dbInstanceId, r.paramGroup)
  // Null infra pointers so the resolver never routes to deleted infra.
  await clearTenantInfra(tenantId).catch(() => {})
  // Reconcile the tenant row: NEVER leave it 'active'/'provisioning' pointing at torn-down
  // infra. 'suspended' = not served, distinguishable from a clean 'terminated' deprovision.
  await setTenantStatus(tenantId, 'suspended').catch(() => {})
  if (job)
    await updateProvisioningJob(job.id, {
      status: 'failed',
      last_error: 'rolled back',
      created_resources: { ...r, rolledBack: true },
    })
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
  const added = desired.filter(h => !prevSet.has(h))
  const removed = prev.filter(h => !desiredSet.has(h))

  if (created.computeMode === 'k8s') return reconcileK8sPlan(tenantId, provider, { force: true })

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
        async id => {
          created.ec2InstanceId = id
          if (job) await updateProvisioningJob(job.id, { created_resources: created })
        }
      )
      created.ec2InstanceId = instanceId
      targetIp = ip
      computeChanged = true
    } else if (!wantDedicated && hadDedicated) {
      // higher → Basic: fall back to the shared pool, terminate the dedicated instance.
      const { ensurePoolInstance } = await import('@controller/lib/tenancy/pool-autoscale')
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
  ctx: { ownerId?: string | null; /** Tear down even when the backup fails (the data is lost). */ force?: boolean }
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
  // A Starter store's database is one of many on a shared host: drop it, never the instance.
  const sharedHost: string | null = tenant.shared_db_host || created.sharedDbHost || null
  // Postgres on the store's own server: no RDS instance, its volume and secret go instead.
  const nodeDb = !sharedHost && ranNodeDb(slug, created, tenant)

  let backupKey: string | null = null
  let backedUp = false

  try {
    // 2. Backup (only if there was ever a DB to back up).
    if (endpoint) {
      const dbName = tenant.rds_db || created.dbName || TENANT_DB
      try {
        const archive = nodeDb
          ? await provider.backupDb(endpoint, dbName, { iamAuth: false, dbSecretRef: tenantDbSecretRef(slug) })
          : await provider.backupDb(endpoint, dbName)
        const { putTenantBackup } = await import('@/lib/tenancy/tenant-backup-store')
        const { ownerKey } = await putTenantBackup({
          buffer: archive,
          ownerId: ctx.ownerId || 'unknown',
          slug,
        })
        backupKey = ownerKey
        backedUp = true
      } catch (e: any) {
        // Nothing is deleted without a backup unless the operator said so.
        if (!ctx.force) throw e
        created.backupError = e?.message || String(e)
      }
    }

    // 3. Delete billable resources (idempotent).
    if (sharedHost) {
      const dbName = tenant.rds_db || created.dbName
      if (endpoint && dbName && dbName !== TENANT_DB) {
        await provider.dropTenantDatabase(endpoint, dbName, tenant.rds_user || created.rdsUser || null)
      }
      const { releaseSharedDbSeat } = await import('@controller/lib/compute/shared-db')
      if (!created.sharedDbReleased) await releaseSharedDbSeat(sharedHost)
      created.sharedDbReleased = true
    } else if (!nodeDb) await provider.deleteDbInstance(instId)
    await provider.deleteBucket(bucket)

    // 3a. Compute teardown: a dedicated EC2 (higher plans) is terminated; a Basic tenant used
    // the shared pool — reclaim the pool only when this was the LAST active tenant. Prefer the
    // durably-persisted instance id over the job JSON (which can be trimmed/lost).
    // On k8s the shared pool / core node is never reclaimed or terminated by a tenant teardown, and a
    // failed namespace delete must not abort a teardown whose DB is already gone (a retry can't re-backup).
    const onK8s = onK8sCompute(created)
    const computeCleanup: Record<string, unknown> = {}
    let nodeInstanceIds: string[] = []
    if (onK8s) {
      const { deleteTenantWorkload } = await import('@/lib/k8s/tenant-compute')
      nodeInstanceIds = await deleteTenantWorkload(slug).catch((e: any) => {
        computeCleanup.k8sNamespace = `delete failed: ${e?.message || e}`
        return []
      })
    }
    const ownInstances = ownInstanceIds(created, tenant.ec2_instance_id, nodeInstanceIds)
    if (ownInstances.length) {
      const refused: string[] = []
      for (const id of ownInstances) {
        const why = await terminateOwnInstance(provider, slug, id, onK8s).catch(() => null)
        if (why) refused.push(why)
      }
      if (refused.length) computeCleanup.instance = refused.join('; ')
    } else if (!onK8s) {
      const { deletePoolIfEmpty } = await import('@controller/lib/tenancy/pool-autoscale')
      await deletePoolIfEmpty().catch(() => {})
    }

    // 3a.ii A database on the store's own server: snapshot its EBS data volume once (it outlives the
    // server, DeleteOnTermination=false), delete it, and delete the password secret.
    if (onK8s || nodeDb)
      Object.assign(
        computeCleanup,
        await cleanupNodeDb(slug, created, {
          snapshot: true,
          persist: async () => {
            if (job) await updateProvisioningJob(job.id, { created_resources: created })
          },
        })
      )

    // 3b. Remove the tenant's DNS records so the subdomains stop resolving. Best-effort but LOUD:
    // a swallowed failure leaves zombie A-records pointing at the just-terminated box (records
    // outliving the instance — a host that "resolves" to a dead IP). Record it + flag the hosts.
    // A k8s job wrote no per-host records; a legacy tenant's records are still removed.
    const dnsHosts =
      created.computeMode === 'k8s'
        ? []
        : ((created.dnsHosts as string[] | undefined) ?? tenantHostnames(slug, tenant.plan))
    let dnsRemovalFailed: string[] | null = null
    const dnsResult = dnsHosts.length
      ? await retryTransient(() => provider.removeDns(dnsHosts), isTransientDnsError)
      : { error: null as any, attempts: 0 }
    if (dnsResult.error) {
      dnsRemovalFailed = dnsHosts
      if (job)
        await recordStepEvent(
          job.id,
          'deprovision',
          'error',
          `removeDns failed after ${dnsResult.attempts} attempt(s): ${dnsResult.error?.message || dnsResult.error}`,
          { dnsHosts, attempts: dnsResult.attempts }
        )
    }

    // 3c. Delete the tenant's param group once the DB instance is fully gone (else RDS
    // refuses). Best-effort — a still-deleting DB is retried by a later sweep.
    if (!sharedHost && !nodeDb) await deleteParamGroupWhenDbGone(provider, instId, created.paramGroup || paramGroupName(slug))

    // 3d. Neither provider supports deletion. Razorpay has no delete for a linked account and
    // cannot clear a settlement bank (product-update only overwrites account/ifsc/beneficiary);
    // Delhivery's client warehouse API is create and edit only. Both are therefore marked and
    // recorded for an operator to close by hand, rather than silently left behind. The Razorpay
    // id is kept: a second account on the same owner email is refused, so a re-onboarding has
    // to reuse this one.
    const manualCleanup: Record<string, unknown> = { ...computeCleanup }
    if (dnsRemovalFailed) manualCleanup.dnsHosts = dnsRemovalFailed
    try {
      if (tenant.razorpay_linked_account_id) {
        const { markLinkedAccountDeprovisioned } = await import('@/lib/payments/razorpay-route')
        const marked = await markLinkedAccountDeprovisioned(tenant.razorpay_linked_account_id, slug)
        manualCleanup.routeAccount = {
          id: tenant.razorpay_linked_account_id,
          settlementBankRemovable: false,
          needsManualSuspension: true,
          marked: marked.ok,
          ...(marked.error ? { markError: marked.error } : {}),
        }
      }
      const { getDraft: loadDraft } = await import('@/lib/tenant-registry')
      const draft = await loadDraft((created.ownerId as string) ?? '').catch(() => null)
      const pickupName = (draft?.data as any)?.wh?.pickupLocation || slug
      const { deactivateDelhiveryPickupLocation } = await import('@/lib/shipping/delhivery')
      const deactivated = await deactivateDelhiveryPickupLocation(pickupName).catch((e: any) => ({
        ok: false,
        error: e?.message ?? String(e),
      }))
      manualCleanup.delhiveryPickup = {
        name: pickupName,
        deletable: false,
        deactivated: deactivated.ok,
        ...(deactivated.error ? { deactivateError: deactivated.error } : {}),
      }
      const { alertProvisioningFailure } = await import('./alerts')
      await alertProvisioningFailure(
        slug,
        'external_cleanup',
        `Deprovisioned, but these cannot be deleted by API and need closing by hand: ${JSON.stringify(manualCleanup)}`,
        tenantId
      )
    } catch {
      /* bookkeeping must never fail a teardown that already deleted the billable resources */
    }
    const routeAccount = Object.keys(manualCleanup).length ? manualCleanup : undefined

    // 4. Clear infra pointers.
    await clearTenantInfra(tenantId)

    if (job) {
      await updateProvisioningJob(job.id, {
        status: 'done',
        created_resources: {
          ...created,
          k8sPendingPlan: undefined,
          deprovisioned: true,
          backupKey,
          ...(routeAccount ? { manualCleanup: routeAccount } : {}),
        },
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

export { STEPS, dbInstanceId, paramGroupName, tenantHostnames }

/**
 * k8s plan change: make sure the new tier's node exists, then re-apply the namespace (resources,
 * replicas, placement, hosts). A node that is still joining parks the change as k8sPendingPlan; the
 * worker retries it (backing off) until it lands or K8S_PLAN_DEADLINE_MS passes. Errors are recorded
 * on the job (k8sPlanError) and alerted; a capacity/quota error is terminal. Until a change lands the
 * tenant keeps serving from its current namespace. DNS is a wildcard, so no records move. A downgrade
 * off a dedicated node terminates that node only once the pods have rolled onto the pool.
 * `force` (a fresh plan change / operator resync) ignores the backoff and restarts the budget.
 */
export async function reconcileK8sPlan(
  tenantId: string,
  provider: ProvisioningProvider,
  opts: { force?: boolean } = {}
): Promise<ReprovisionResult> {
  const tenant = await getTenant(tenantId)
  if (!tenant) return { ok: false, added: [], removed: [], error: 'tenant not found' }
  const job = await getProvisioningJob(tenantId)
  const created = (job?.created_resources as Record<string, any>) || {}
  const desired = tenantHostnames(tenant.slug, tenant.plan)
  const prev = (created.dnsHosts as string[] | undefined) ?? desired
  const added = desired.filter(h => !prev.includes(h))
  const removed = prev.filter(h => !desired.includes(h))
  const save = (extra: Record<string, unknown>) =>
    job ? updateProvisioningJob(job.id, { created_resources: { ...created, ...extra } }) : Promise.resolve()
  const now = Date.now()

  // A deprovisioned/suspended store must never get a node launched for it.
  if (tenant.status !== 'active') {
    if (created.k8sPendingPlan) {
      delete created.k8sPendingPlan
      delete created.k8sPlanNextAt
      await save({})
    }
    return { ok: false, added: [], removed: [], error: 'tenant not active' }
  }
  if (!opts.force && created.k8sPlanNextAt && now < created.k8sPlanNextAt) {
    return { ok: true, added, removed, error: 'pending: backing off' }
  }
  if (opts.force || created.k8sPendingPlan !== tenant.plan) {
    created.k8sPendingSince = now
    created.k8sPlanAttempts = 0
    delete created.k8sPlanLaunchedInstanceId
  }

  const fail = async (msg: string, retryable: boolean): Promise<ReprovisionResult> => {
    const attempts = (created.k8sPlanAttempts || 0) + 1
    const giveUp = !retryable || attempts >= K8S_PLAN_MAX_ATTEMPTS
    const isNew = created.k8sPlanError !== msg
    delete created.k8sPlanNextAt
    if (giveUp) delete created.k8sPendingPlan
    else {
      created.k8sPendingPlan = tenant.plan
      created.k8sPlanNextAt = now + Math.min(60_000 * 2 ** attempts, 30 * 60_000)
    }
    await save({ k8sPlanAttempts: attempts, k8sPlanError: msg, k8sPlanErrorAt: new Date(now).toISOString() }).catch(
      () => {}
    )
    if (giveUp || isNew) {
      try {
        const { alertProvisioningFailure } = await import('./alerts')
        await alertProvisioningFailure(
          tenant.slug,
          'k8s_plan_change',
          `plan "${tenant.plan}" not applied${giveUp ? ' (gave up)' : ''}: ${msg}`,
          tenantId
        )
      } catch {
        /* alerting must never mask the failure */
      }
    }
    return { ok: false, added, removed, error: msg }
  }

  try {
    const { computeHold } = await import('@controller/lib/compute/store')
    const hold = await computeHold(tenantId)
    // A paused store is re-applied when it resumes.
    if (hold === 'paused') return { ok: true, added, removed, error: 'pending: the store is paused' }
    if (hold === 'switching') {
      delete created.k8sPlanNextAt
      await save({ k8sPendingPlan: tenant.plan })
      return { ok: true, added, removed, error: 'pending: the store is moving to its own services' }
    }
    const k8s = await import('@/lib/k8s/tenant-compute')
    const { resolveCompute } = await import('@controller/lib/compute/resolve')
    // What runs now: the store's applied choice, or (until owners choose) its plan's tier.
    const c = await resolveCompute(tenantId, tenant.plan, { which: 'applied' })
    const wantDedicated = c.spec.node.placement === 'dedicated'
    const oldDedicated = wantDedicated ? [] : ownInstanceIds(created, tenant.ec2_instance_id)
    const placed = await k8s.ensureTenantNodes(
      tenant.slug,
      c.spec.node,
      c.nodeGen,
      { instances: wantDedicated ? knownNodeInstances(tenant.slug, created) : undefined, poolInstanceId: created.poolInstanceId },
      async (id, kind, name) => {
        if (kind === 'dedicated') {
          created.nodeInstances = { ...created.nodeInstances, [name]: id }
          created.ec2InstanceId ??= id
          created.k8sPlanLaunched = [...(created.k8sPlanLaunched ?? []), id]
        } else created.poolInstanceId = id
        await save({})
      },
      // A replacement server for an on-node database launches in its volume's zone and re-attaches it.
      c.spec.db.mode === 'node' ? { dbVolume: { sizeGb: c.spec.db.storageGb } } : undefined
    )
    const overdue = now - (created.k8sPendingSince || now) > K8S_PLAN_DEADLINE_MS
    if (!placed.ready) {
      if (overdue) {
        // Abandon only the instances this change launched; never a pool node or a pre-existing one.
        const launched: string[] = [...(created.k8sPlanLaunched ?? []), created.k8sPlanLaunchedInstanceId].filter(Boolean)
        if (launched.length) {
          const { remove } = await import('@/lib/k8s/client')
          const names = Object.entries(knownNodeInstances(tenant.slug, created)).filter(([, id]) => launched.includes(id))
          for (const [name] of names) await remove('Node', name).catch(() => {})
          for (const id of launched) await terminateOwnInstance(provider, tenant.slug, id, true).catch(() => null)
          if (created.nodeInstances) created.nodeInstances = Object.fromEntries(Object.entries(created.nodeInstances).filter(([, id]) => !launched.includes(id as string)))
          if (launched.includes(created.ec2InstanceId)) delete created.ec2InstanceId
        }
        delete created.k8sPlanLaunched
        delete created.k8sPlanLaunchedInstanceId
        delete created.poolInstanceId
        return await fail(`servers for plan "${tenant.plan}" did not become Ready within 20 min`, false)
      }
      delete created.k8sPlanNextAt
      await save({ k8sPendingPlan: tenant.plan })
      return { ok: true, added, removed, error: 'pending: waiting for node to join' }
    }

    await applyWorkload(tenantId, tenant.slug, tenant.plan, c, desired)

    if (oldDedicated.length) {
      // Keep the dedicated node until every pod has rolled onto the pool, else the store drops.
      if (!(await k8s.tenantRolloutComplete(tenant.slug))) {
        if (overdue) return await fail('pods did not move off the dedicated node within 20 min', false)
        delete created.k8sPlanNextAt
        await save({ k8sPendingPlan: tenant.plan })
        return { ok: true, added, removed, error: 'pending: waiting for pods to move to the pool' }
      }
      const refused: string[] = []
      for (const id of new Set([...oldDedicated, ...(await k8s.removeTenantNodes(tenant.slug))])) {
        const why = await terminateOwnInstance(provider, tenant.slug, id, true).catch(() => null)
        if (why) refused.push(why)
      }
      if (refused.length) created.manualCleanup = { ...(created.manualCleanup || {}), instance: refused.join('; ') }
      const { clearTenantEc2Instance } = await import('@/lib/tenant-registry/lifecycle')
      await clearTenantEc2Instance(tenantId)
      delete created.ec2InstanceId
      delete created.nodeInstances
    } else if (created.ec2InstanceId) {
      await writeTenantEc2(tenantId, k8s.clusterIngressIp(), created.ec2InstanceId)
    }
    for (const k of [
      'k8sPendingPlan',
      'poolInstanceId',
      'k8sPlanNextAt',
      'k8sPlanError',
      'k8sPlanErrorAt',
      'k8sPlanAttempts',
      'k8sPendingSince',
      'k8sPlanLaunched',
      'k8sPlanLaunchedInstanceId',
    ])
      delete created[k]
    await save({ dnsHosts: desired })
    await recordApplied(tenantId, tenant.slug, c.spec, c.nodeGen)
    return { ok: true, added, removed }
  } catch (e: any) {
    const msg = e?.message || 'k8s reconcile failed'
    return fail(msg, !isTerminalError(msg))
  }
}

const K8S_PLAN_DEADLINE_MS = 20 * 60 * 1000
const K8S_PLAN_MAX_ATTEMPTS = 6
