import 'server-only'
import type { ProvisioningProvider } from './provider'
import { dbInstanceId, isTerminalError, paramGroupName, tenantHostnames } from './steps'
import {
  clearTenantCache,
  getProvisioningJob,
  getTenant,
  setTenantInstanceState,
  updateProvisioningJob,
  writeTenantEc2,
  writeTenantInfra,
} from '../tenant-registry'
import { computeSpecEnabled } from '@/lib/compute/catalog'
import { legacySpecFor } from '@/lib/compute/legacy'
import { specKey } from '@/lib/compute/presets'
import { catalogOrDefault, computeParams, rateFor } from '@/lib/compute/resolve'
import { getTenantCompute, patchTenantCompute, type TenantCompute } from '@/lib/compute/store'
import type { ComputeSpec } from '@/lib/compute/spec'
import { tenantNodeName } from './tiers'

// Applies a running store's compute change (tenant_compute.desired → applied), a step per provisioning
// worker tick so each one can be retried:
//   1. its database moves between a shared host and its own instance (the store is offline for the copy)
//   2. servers and pods: a new server type, or fewer servers, starts the next generation; pods roll onto
//      it before the old servers go, so the store stays up
//   3. its own database: storage and standby now, class now or in the maintenance window
// `applied` is saved as each part lands, so billing follows what runs.

const SERVERS_DEADLINE_MS = 20 * 60_000
const DB_DEADLINE_MS = 40 * 60_000
const DRAIN_MS = 90_000 // the 60 s tenant cache, then requests in flight
const OLD_DB_KEEP_MS = 24 * 3600_000
const MAX_ATTEMPTS = 6
const TENANT_DB = 'jeffi_stores'

interface DbRef {
  kind: 'dedicated' | 'shared'
  id: string // the RDS instance (own, or the shared host)
  endpoint?: string
  dbName: string
  role: string | null
  class?: string
}

interface Progress {
  gen?: number
  since?: number
  launched?: Record<string, string>
  poolInstanceId?: string
  podsApplied?: boolean
  poolMax?: number
  dbOnline?: number
  dbClass?: number
  move?: { step: 'create' | 'wait' | 'freeze' | 'copy'; since?: number; frozenAt?: number; source?: DbRef; target?: DbRef; switched?: boolean }
  oldDb?: DbRef & { dropAfter: number }
}

type Tenant = NonNullable<Awaited<ReturnType<typeof getTenant>>>
type Ctx = {
  tenantId: string
  tenant: Tenant
  row: TenantCompute
  desired: ComputeSpec
  applied: ComputeSpec
  p: Progress
  provider: ProvisioningProvider
  save: () => Promise<void>
}
type Outcome = 'done' | 'wait' | 'window'

export interface ComputeChangeResult {
  ok: boolean
  status: string
  error?: string
}

export async function reconcileCompute(tenantId: string, provider: ProvisioningProvider): Promise<ComputeChangeResult> {
  if (!computeSpecEnabled()) return { ok: true, status: 'disabled' }
  const row = await getTenantCompute(tenantId)
  if (!row) return { ok: true, status: 'none' }
  const p: Progress = { ...(row.progress ?? {}) }
  const tenant = await getTenant(tenantId)
  if (p.oldDb && p.oldDb.dropAfter <= Date.now()) {
    // Never the database the store is using now.
    const inUse = tenant?.rds_endpoint === p.oldDb.endpoint && (tenant?.rds_db || TENANT_DB) === p.oldDb.dbName
    if (inUse) console.error(`[compute] ${tenantId}: old database ${p.oldDb.id}/${p.oldDb.dbName} is in use, not dropped`)
    else await dropDatabase(provider, p.oldDb).catch(e => console.error(`[compute] old database of ${tenantId} not dropped: ${e?.message}`))
    delete p.oldDb
    await patchTenantCompute(tenantId, { progress: Object.keys(p).length ? p : null })
  }
  if (row.status !== 'pending' && row.status !== 'applying') return { ok: true, status: row.status }
  if (!tenant || tenant.status !== 'active') return { ok: true, status: 'waiting for the store' }

  const applied: ComputeSpec = JSON.parse(JSON.stringify(row.applied ?? legacySpecFor(tenant.plan)))
  const ctx: Ctx = {
    tenantId,
    tenant,
    row,
    desired: row.desired,
    applied,
    p,
    provider,
    save: () => patchTenantCompute(tenantId, { applied, progress: p, status: 'applying' }),
  }
  try {
    for (const stage of [moveDatabase, serversAndPods, ownDatabase]) {
      const out = await stage(ctx)
      if (out !== 'done') {
        await ctx.save()
        // A class change waiting for the maintenance window is checked every quarter hour.
        if (out === 'window') await patchTenantCompute(tenantId, { next_at: new Date(Date.now() + 15 * 60_000) })
        return { ok: true, status: out === 'window' ? 'waiting for the maintenance window' : 'applying' }
      }
    }
    await finalPods(ctx)
    const keep = p.oldDb ? { oldDb: p.oldDb } : null
    await patchTenantCompute(tenantId, {
      applied,
      progress: keep,
      status: 'applied',
      rate_inr_hour: await rateFor(applied),
      attempts: 0,
      next_at: keep ? new Date(keep.oldDb.dropAfter) : null,
      last_error: null,
      applied_at: new Date(),
    })
    return { ok: true, status: 'applied' }
  } catch (e: any) {
    return fail(ctx, e?.message || 'compute change failed')
  }
}

async function fail(ctx: Ctx, msg: string): Promise<ComputeChangeResult> {
  const { tenantId, tenant, row, p } = ctx
  const attempts = (row.attempts ?? 0) + 1
  const giveUp = isTerminalError(msg) || attempts >= MAX_ATTEMPTS
  if (giveUp && p.launched && !p.podsApplied) await abandonLaunched(ctx).catch(() => {})
  await patchTenantCompute(tenantId, {
    applied: ctx.applied,
    progress: p,
    status: giveUp ? 'failed' : 'applying',
    attempts,
    last_error: msg,
    next_at: giveUp ? null : new Date(Date.now() + Math.min(60_000 * 2 ** attempts, 30 * 60_000)),
  }).catch(() => {})
  if (giveUp || row.last_error !== msg) {
    try {
      const { alertProvisioningFailure } = await import('./alerts')
      await alertProvisioningFailure(tenant.slug, 'compute_change', `${giveUp ? 'gave up: ' : ''}${msg}`, tenantId)
    } catch {
      /* alerting must never mask the failure */
    }
  }
  return { ok: false, status: giveUp ? 'failed' : 'applying', error: msg }
}

async function workloadInput(ctx: Ctx) {
  const { listCustomDomains } = await import('../tenant-registry/custom-domains')
  const customDomains = (await listCustomDomains(ctx.tenantId).catch(() => []))
    .filter(d => d.status === 'verified')
    .map(d => d.domain)
  return { slug: ctx.tenant.slug, plan: ctx.tenant.plan, hosts: tenantHostnames(ctx.tenant.slug, ctx.tenant.plan), customDomains }
}

const poolMaxFor = async (spec: ComputeSpec) => computeParams(spec, await catalogOrDefault()).dbPoolMax

// ── 1. Database moves between a shared host and its own instance ─────────────────────────────────

async function moveDatabase(ctx: Ctx): Promise<Outcome> {
  const { tenant, desired, applied, p, provider, tenantId } = ctx
  if (desired.db.mode === applied.db.mode) return 'done'
  const slug = tenant.slug
  const want = desired.db
  const m = (p.move ??= { step: 'create' })

  if (m.step === 'create') {
    if (want.mode === 'dedicated') {
      const { maxConnections } = computeParams(desired, await catalogOrDefault())
      await provider.ensureParamGroup(paramGroupName(slug), maxConnections)
      const created = await provider.createDbInstance({
        dbInstanceId: dbInstanceId(slug),
        paramGroup: paramGroupName(slug),
        maxConnections,
        instanceClass: want.class ?? undefined,
        storageGb: want.storageGb,
        multiAz: want.multiAz,
      })
      m.target = { kind: 'dedicated', id: created.dbInstanceId, dbName: TENANT_DB, role: null, class: created.instanceClass ?? want.class ?? undefined }
    } else {
      const { reserveSharedDbHost, tenantDbNames } = await import('@/lib/compute/shared-db')
      const host = await reserveSharedDbHost(provider)
      const n = tenantDbNames(slug)
      m.target = { kind: 'shared', id: host.id, dbName: n.db, role: n.role }
    }
    m.step = 'wait'
    m.since = Date.now()
    return 'wait'
  }

  const target = m.target!
  if (m.step === 'wait') {
    const endpoint = await provider.getDbEndpoint(target.id)
    if (!endpoint) {
      if (Date.now() - (m.since ?? Date.now()) < DB_DEADLINE_MS) return 'wait'
      await dropDatabase(provider, target).catch(() => {})
      delete p.move
      throw new Error('the new database did not become available within 40 min')
    }
    if (target.kind === 'shared') {
      const { markSharedDbHostAvailable } = await import('@/lib/compute/shared-db')
      await markSharedDbHostAvailable(target.id, endpoint)
      await provider.initSharedDbHost(endpoint)
      await provider.createTenantDatabase(endpoint, target.dbName, target.role!)
      await provider.loadSchema(endpoint, target.dbName, target.role!)
    } else await provider.loadSchema(endpoint, target.dbName)
    target.endpoint = endpoint
    m.step = 'freeze'
    return 'wait'
  }

  if (m.step === 'freeze') {
    // Recorded once: after the switch the registry points at the target, not the database left behind.
    if (!m.source) {
      const job = await getProvisioningJob(tenantId)
      m.source = tenant.shared_db_host
        ? { kind: 'shared', id: tenant.shared_db_host, endpoint: tenant.rds_endpoint!, dbName: tenant.rds_db!, role: tenant.rds_user }
        : {
            kind: 'dedicated',
            id: (job?.created_resources as any)?.dbInstanceId || dbInstanceId(slug),
            endpoint: tenant.rds_endpoint!,
            dbName: tenant.rds_db || TENANT_DB,
            role: null,
          }
    }
    // No request may write to the old database from here: the store resolves to nothing.
    await setTenantInstanceState(tenantId, 'migrating')
    clearTenantCache()
    m.frozenAt = Date.now()
    m.step = 'copy'
    return 'wait'
  }

  if (Date.now() - (m.frozenAt ?? 0) < DRAIN_MS) return 'wait'
  const source = m.source!
  // A switch whose write landed but reported an error: the store already runs on the target.
  if (tenant.rds_endpoint === target.endpoint && (tenant.rds_db || TENANT_DB) === target.dbName) m.switched = true
  if (!m.switched) {
    try {
      const archive = await provider.backupDb(source.endpoint!, source.dbName)
      await provider.restoreDb(target.endpoint!, target.dbName, archive) // one transaction
      await writeTenantInfra(tenantId, {
        rdsEndpoint: target.endpoint!,
        s3Bucket: tenant.s3_bucket!,
        ...(target.kind === 'shared' ? { rdsDb: target.dbName, rdsUser: target.role!, sharedDbHost: target.id } : {}),
      })
    } catch (e) {
      // Nothing switched: serve from the old database while waiting to retry, and copy afresh then.
      await setTenantInstanceState(tenantId, 'running')
      clearTenantCache()
      m.step = 'freeze'
      throw e
    }
    m.switched = true
    await ctx.save()
  }
  await setTenantInstanceState(tenantId, 'running')
  clearTenantCache()
  const job = await getProvisioningJob(tenantId)
  if (job && target.kind === 'dedicated') {
    await updateProvisioningJob(job.id, { created_resources: { ...(job.created_resources || {}), dbInstanceId: target.id, paramGroup: paramGroupName(slug) } })
  }
  // Pods re-resolve the store and pool to the new database anyway; the restart drops old connections sooner.
  const k8s = await import('@/lib/k8s/tenant-compute')
  await k8s.restartTenantWorkload(slug).catch(e => console.error(`[compute] ${slug}: pod restart after the database move failed: ${e?.message}`))
  p.oldDb = { ...source, dropAfter: Date.now() + OLD_DB_KEEP_MS }
  applied.db = { ...want, class: target.class ?? want.class }
  delete p.move
  return 'done'
}

/** A database the store no longer uses: its own instance, or its database on a shared host. */
async function dropDatabase(provider: ProvisioningProvider, db: DbRef): Promise<void> {
  if (db.kind === 'dedicated') return provider.deleteDbInstance(db.id)
  if (db.endpoint) await provider.dropTenantDatabase(db.endpoint, db.dbName, db.role)
  const { releaseSharedDbSeat } = await import('@/lib/compute/shared-db')
  await releaseSharedDbSeat(db.id)
}

// ── 2. Servers and pods ──────────────────────────────────────────────────────────────────────────

async function serversAndPods(ctx: Ctx): Promise<Outcome> {
  const { tenant, row, desired, applied, p, provider, tenantId } = ctx
  const target: ComputeSpec = { ...desired, db: applied.db }
  if (specKey(target) === specKey(applied)) return 'done'
  const slug = tenant.slug
  const a = applied.node
  const d = desired.node
  // More servers of the same type join the current generation; anything else starts the next one.
  const sameServers = a.placement === d.placement && a.type === d.type && d.count >= a.count
  const gen = (p.gen ??= sameServers || d.placement === 'pool' ? row.node_gen : row.node_gen + 1)
  p.since ??= Date.now()
  const k8s = await import('@/lib/k8s/tenant-compute')

  const placed = await k8s.ensureTenantNodes(slug, d, gen, { instances: p.launched, poolInstanceId: p.poolInstanceId }, async (id, kind, name) => {
    if (kind === 'dedicated') p.launched = { ...p.launched, [name]: id }
    else p.poolInstanceId = id
    await ctx.save()
  })
  if (!placed.ready) {
    if (Date.now() - p.since < SERVERS_DEADLINE_MS) return 'wait'
    await abandonLaunched(ctx)
    throw new Error('the new servers did not become ready within 20 min')
  }

  // Pods pooled for the database as it runs now and as it will, whichever allows fewer connections.
  const poolMax = Math.min(await poolMaxFor(target), await poolMaxFor(desired))
  if (!p.podsApplied) {
    await k8s.applyTenantWorkload({ ...(await workloadInput(ctx)), compute: target, dbPoolMax: poolMax, nodeGen: gen })
    p.podsApplied = true
    p.poolMax = poolMax
    await ctx.save()
  }
  if (!(await k8s.tenantRolloutComplete(slug))) {
    if (Date.now() - p.since < 2 * SERVERS_DEADLINE_MS) return 'wait'
    throw new Error('pods did not move onto the new servers within 40 min')
  }

  // The old servers go once every pod has moved.
  if (gen !== row.node_gen || (a.placement === 'dedicated' && d.placement === 'pool')) {
    const keep = d.placement === 'dedicated' ? Array.from({ length: d.count }, (_, i) => tenantNodeName(slug, gen, i)) : []
    for (const id of await k8s.removeTenantNodes(slug, keep)) {
      await k8s.terminateTenantInstance(slug, id, i => provider.deleteAppInstance(i))
    }
  }
  const job = await getProvisioningJob(tenantId)
  if (d.placement === 'dedicated') {
    const first = p.launched?.[tenantNodeName(slug, gen, 0)]
    if (first) await writeTenantEc2(tenantId, k8s.clusterIngressIp(), first)
    if (job && p.launched) {
      const res = (job.created_resources || {}) as Record<string, any>
      const nodeInstances = gen === row.node_gen ? { ...res.nodeInstances, ...p.launched } : p.launched
      await updateProvisioningJob(job.id, { created_resources: { ...res, nodeInstances, ...(first ? { ec2InstanceId: first } : {}) } })
    }
  } else {
    const { clearTenantEc2Instance } = await import('../tenant-registry/lifecycle')
    await clearTenantEc2Instance(tenantId)
    if (job) {
      const { ec2InstanceId: _e, nodeInstances: _n, ...res } = (job.created_resources || {}) as Record<string, any>
      await updateProvisioningJob(job.id, { created_resources: res })
    }
  }
  applied.node = d
  applied.services = desired.services
  await patchTenantCompute(tenantId, { node_gen: gen })
  for (const k of ['gen', 'since', 'launched', 'poolInstanceId', 'podsApplied'] as const) delete p[k]
  return 'done'
}

/** Terminate the servers this change launched (before any pod moved onto them). */
async function abandonLaunched(ctx: Ctx): Promise<void> {
  const k8s = await import('@/lib/k8s/tenant-compute')
  const { remove } = await import('@/lib/k8s/client')
  for (const [name, id] of Object.entries(ctx.p.launched ?? {})) {
    await remove('Node', name).catch(() => {})
    await k8s.terminateTenantInstance(ctx.tenant.slug, id, i => ctx.provider.deleteAppInstance(i)).catch(() => null)
  }
  for (const k of ['gen', 'since', 'launched', 'poolInstanceId', 'podsApplied'] as const) delete ctx.p[k]
}

// ── 3. Its own database: storage, standby, class ─────────────────────────────────────────────────

async function ownDatabase(ctx: Ctx): Promise<Outcome> {
  const { tenant, row, desired, applied, p, provider, tenantId } = ctx
  const want = desired.db
  const have = applied.db
  if (want.mode !== 'dedicated') return 'done'
  if (have.class === want.class && have.storageGb >= want.storageGb && have.multiAz === want.multiAz) return 'done'
  const job = await getProvisioningJob(tenantId)
  const id = (job?.created_resources as any)?.dbInstanceId || dbInstanceId(tenant.slug)
  const st = await provider.describeDbInstance(id)
  if (!st) throw new Error(`database ${id} not found`)
  const ready = (st.status === 'available' || st.status === 'storage-optimization') && !st.pending

  // Storage and standby first, at once: a later immediate change would also apply a queued class change.
  const grow = want.storageGb > st.storageGb
  if (grow || want.multiAz !== st.multiAz) {
    if (!p.dbOnline) {
      if (!ready) return 'wait'
      await provider.modifyDbInstance(id, {
        storageGb: grow ? want.storageGb : undefined,
        multiAz: want.multiAz !== st.multiAz ? want.multiAz : undefined,
        applyImmediately: true,
      })
      p.dbOnline = Date.now()
    }
    return 'wait'
  }
  applied.db = { ...applied.db, storageGb: want.storageGb, multiAz: want.multiAz }
  delete p.dbOnline

  // AWS may have fallen back to the same size on t3 when the database was created.
  const sameClass = st.instanceClass === want.class || st.instanceClass === want.class?.replace('.t4g.', '.t3.')
  if (!sameClass) {
    if (!p.dbClass) {
      if (!ready) return 'wait'
      // Pods first pool for the smaller of the two classes, so a smaller class never runs out of connections.
      const now = await poolMaxFor(applied)
      const lower = Math.min(now, await poolMaxFor(desired))
      if (lower < now && p.poolMax !== lower) {
        const k8s = await import('@/lib/k8s/tenant-compute')
        await k8s.applyTenantWorkload({ ...(await workloadInput(ctx)), compute: applied, dbPoolMax: lower, nodeGen: row.node_gen })
        p.poolMax = lower
        return 'wait'
      }
      // max_connections for the new class takes effect with the class change's restart.
      const { maxConnections } = computeParams(desired, await catalogOrDefault())
      await provider.ensureParamGroup((job?.created_resources as any)?.paramGroup || paramGroupName(tenant.slug), maxConnections)
      await provider.modifyDbInstance(id, { instanceClass: want.class!, applyImmediately: row.apply_mode === 'now' })
      p.dbClass = Date.now()
    }
    return row.apply_mode === 'now' ? 'wait' : 'window'
  }
  if (!ready) return 'wait'
  applied.db = { ...want, class: st.instanceClass }
  delete p.dbClass
  return 'done'
}

/** Once the database is as chosen, pods get its full connection budget. */
async function finalPods(ctx: Ctx): Promise<void> {
  const poolMax = await poolMaxFor(ctx.applied)
  if (ctx.p.poolMax === undefined || ctx.p.poolMax === poolMax) {
    delete ctx.p.poolMax
    return
  }
  const k8s = await import('@/lib/k8s/tenant-compute')
  const gen = (await getTenantCompute(ctx.tenantId))?.node_gen ?? ctx.row.node_gen
  await k8s.applyTenantWorkload({ ...(await workloadInput(ctx)), compute: ctx.applied, dbPoolMax: poolMax, nodeGen: gen })
  delete ctx.p.poolMax
}
