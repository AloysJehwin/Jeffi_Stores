import 'server-only'
import { controlPlanePool, getProvisioningJob, getTenant, getTenantOwners, setTenantInstanceState } from '@/lib/tenant-registry'
import { getWalletBalance } from '@/lib/payments/wallet'
import { sendInfraBalanceEmail, type InfraBalanceNotice } from '@/lib/shared/ecom-emails'
import { specKey } from '@/lib/compute/presets'
import { catalogOrDefault } from '@controller/lib/compute/resolve'
import { getTenantCompute, patchTenantCompute, type TenantCompute } from '@controller/lib/compute/store'
import type { ProvisioningProvider } from '@controller/lib/provisioning/provider'
import { dbInstanceId } from '@controller/lib/provisioning/steps'
import { syncComputePeriod } from './infra-billing'

// What happens when a store's wallet can't pay for its servers (run after the daily charge):
//   runway under a week   the owner is told every few days
//   below zero            the store keeps running for graceDays (compute_pricing), and the owner is told when it pauses
//   still below zero      paused: its pods scale to 0, its own servers and database stop; it is billed for storage only
//   topped up             the provisioning worker starts it again once the wallet covers a day (resumeFundedStores)

const DAY_MS = 86_400_000
const WARN_DAYS = 7
const WARN_EVERY_MS = 3 * DAY_MS
const RESTOP_DB_AFTER_MS = 6 * DAY_MS // AWS starts a stopped database again after 7 days

interface Pause {
  at: number
  instances?: string[]
  db?: string
  restoppedAt?: number
}

type Store = TenantCompute & { slug: string; display_name: string; rate: number }

async function notify(s: { tenant_id: string; slug: string; display_name: string }, balance: number, dailyInr: number, n: InfraBalanceNotice) {
  const owner = (await getTenantOwners(s.tenant_id).catch(() => []))[0]
  if (owner) await sendInfraBalanceEmail(owner, s, balance, dailyInr, n).catch(() => {})
}

const busy = (row: TenantCompute) => row.status === 'pending' || row.status === 'applying' || (row.progress?.layout && !row.progress.layout.failed)

/** After the daily charge: warn, start the grace period, pause, and keep a paused store's database stopped. */
export async function applyInfraBalancePolicy(provider: ProvisioningProvider, now = Date.now()): Promise<{ tenantId: string; action: string }[]> {
  const { settings } = await catalogOrDefault()
  const r = await controlPlanePool().query<Store>(
    `SELECT c.*, t.slug, t.display_name, c.rate_inr_hour::float AS rate
       FROM tenant_compute c JOIN tenants t ON t.id = c.tenant_id
      WHERE t.status = 'active' AND c.applied IS NOT NULL AND c.rate_inr_hour IS NOT NULL`
  )
  const out: { tenantId: string; action: string }[] = []
  for (const s of r.rows) {
    const id = s.tenant_id
    try {
      const { balance } = await getWalletBalance(id)
      const daily = Math.round(s.rate * 24 * 100) / 100
      if (s.status === 'paused') {
        const pause = s.progress?.pause as Pause | undefined
        if (pause?.db && now - (pause.restoppedAt ?? pause.at) > RESTOP_DB_AFTER_MS) {
          if ((await provider.describeDbInstance(pause.db))?.status === 'available') await provider.stopDbInstance(pause.db)
          await patchTenantCompute(id, { progress: { ...s.progress, pause: { ...pause, restoppedAt: now } } })
          out.push({ tenantId: id, action: 'database kept stopped' })
        }
        continue
      }
      if (balance < 0) {
        const since = s.low_balance_since ? new Date(s.low_balance_since).getTime() : null
        if (since == null) {
          await patchTenantCompute(id, { low_balance_since: new Date(now) })
          await notify(s, balance, daily, { kind: 'negative', pauseOn: new Date(now + settings.graceDays * DAY_MS) })
          out.push({ tenantId: id, action: 'grace' })
        } else if (now - since >= settings.graceDays * DAY_MS && !busy(s)) {
          await pauseStore(id, provider)
          await notify(s, balance, daily, { kind: 'paused' })
          out.push({ tenantId: id, action: 'paused' })
        }
        continue
      }
      if (s.low_balance_since) await patchTenantCompute(id, { low_balance_since: null })
      const warned = s.balance_warned_at ? new Date(s.balance_warned_at).getTime() : 0
      if (daily > 0 && balance < daily * WARN_DAYS && now - warned >= WARN_EVERY_MS) {
        await notify(s, balance, daily, { kind: 'low', daysLeft: Math.floor(balance / daily) })
        await patchTenantCompute(id, { balance_warned_at: new Date(now) })
        out.push({ tenantId: id, action: 'warned' })
      }
    } catch (e: any) {
      out.push({ tenantId: id, action: `error: ${e?.message}` })
    }
  }
  return out
}

const stoppedAlready = (e: any) => /InvalidDBInstanceState|IncorrectInstanceState/i.test(`${e?.name} ${e?.message}`)

/** Stop the store: no longer served, pods at 0, its own servers and database stopped. Safe to repeat. */
export async function pauseStore(tenantId: string, provider: ProvisioningProvider): Promise<void> {
  const [tenant, row] = await Promise.all([getTenant(tenantId), getTenantCompute(tenantId)])
  if (!tenant || !row?.applied) throw new Error('store not found')
  const k8s = await import('@/lib/k8s/tenant-compute')
  const pause: Pause = { ...(row.progress?.pause ?? {}), at: row.progress?.pause?.at ?? Date.now() }
  await setTenantInstanceState(tenantId, 'paused')
  await patchTenantCompute(tenantId, { status: 'paused', progress: { ...row.progress, pause } })
  await k8s.scaleTenantWorkloadToZero(tenant.slug)
  if (row.applied.node.placement === 'dedicated') {
    const { stopInstance } = await import('@/lib/shared/ec2-client')
    pause.instances ??= (await k8s.tenantNodeInstances(tenant.slug)).instances
    for (const i of pause.instances) await stopInstance(i).catch(e => { if (!stoppedAlready(e)) throw e })
  }
  if (row.applied.db.mode === 'dedicated') {
    pause.db ??= ((await getProvisioningJob(tenantId))?.created_resources as any)?.dbInstanceId || dbInstanceId(tenant.slug)
    await provider.stopDbInstance(pause.db!).catch(e => { if (!stoppedAlready(e)) throw e })
  }
  await patchTenantCompute(tenantId, { progress: { ...row.progress, pause } })
  await syncComputePeriod(tenantId)
}

/** Paused stores whose wallet now covers a day of servers: start each again, a step per worker tick. */
export async function resumeFundedStores(provider: ProvisioningProvider): Promise<{ tenantId: string; status: string }[]> {
  const r = await controlPlanePool().query<{ tenant_id: string; rate: number }>(
    `SELECT c.tenant_id, COALESCE(c.rate_inr_hour, 0)::float AS rate FROM tenant_compute c JOIN tenants t ON t.id = c.tenant_id
      WHERE c.status = 'paused' AND t.status = 'active'`
  )
  const out: { tenantId: string; status: string }[] = []
  for (const s of r.rows) {
    const { balance } = await getWalletBalance(s.tenant_id)
    if (balance < Math.max(0, s.rate * 24)) continue
    const status = await resumeStore(s.tenant_id, provider).catch((e: any) => `error: ${e?.message}`)
    out.push({ tenantId: s.tenant_id, status })
  }
  return out
}

async function resumeStore(tenantId: string, provider: ProvisioningProvider): Promise<string> {
  const [tenant, row] = await Promise.all([getTenant(tenantId), getTenantCompute(tenantId)])
  if (!tenant || !row?.applied) return 'store not found'
  const p: Record<string, any> = { ...row.progress }
  const pause = (p.pause ?? {}) as Pause
  if (!p.resume) {
    if (pause.db) await provider.startDbInstance(pause.db).catch(e => { if (!stoppedAlready(e)) throw e })
    if (pause.instances?.length) {
      const { startInstance } = await import('@/lib/shared/ec2-client')
      for (const i of pause.instances) await startInstance(i).catch(e => { if (!stoppedAlready(e)) throw e })
    }
    p.resume = { since: Date.now() }
    await patchTenantCompute(tenantId, { progress: p })
    return 'starting'
  }
  const k8s = await import('@/lib/k8s/tenant-compute')
  if (pause.db && !(await provider.getDbEndpoint(pause.db))) return 'waiting for the database'
  if (pause.instances?.length && !(await k8s.tenantNodeInstances(tenant.slug)).ready) return 'waiting for the servers'
  delete p.pause
  delete p.resume
  // As it was before the pause; a change chosen meanwhile is applied next.
  const status = specKey(row.desired) === specKey(row.applied) ? 'applied' : 'pending'
  await patchTenantCompute(tenantId, { status, progress: Object.keys(p).length ? p : null, low_balance_since: null })
  await setTenantInstanceState(tenantId, 'running')
  await syncComputePeriod(tenantId)
  // Its pods at the release images; a failure is retried by the worker as a pending plan change.
  const { reconcileK8sPlan } = await import('@controller/lib/provisioning/steps')
  const applied = await reconcileK8sPlan(tenantId, provider, { force: true })
  if (!applied.ok) return `resumed, pods pending: ${applied.error}`
  const { balance } = await getWalletBalance(tenantId)
  await notify({ tenant_id: tenantId, slug: tenant.slug, display_name: tenant.display_name ?? tenant.slug }, balance, Math.round(Number(row.rate_inr_hour ?? 0) * 24 * 100) / 100, { kind: 'resumed' })
  return 'resumed'
}
