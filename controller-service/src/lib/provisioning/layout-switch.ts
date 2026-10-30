import 'server-only'
import { controlPlanePool, getTenant } from '@/lib/tenant-registry'
import { rateFor, resolveCompute } from '@controller/lib/compute/resolve'
import { getTenantCompute, patchTenantCompute } from '@controller/lib/compute/store'
import { tenantHostnames } from './steps'

// Moves a running store off the old all-in-one app onto its own storefront, admin and business services, a
// step per call so the release (switch-layout) and the provisioning worker can each drive and resume it:
//   both   the services start beside the old app, which drops to one pod and keeps the traffic
//   move   once every pod is Ready the routes move to the services, and the old app drains
//   drop   the old app goes
// A store that fails before its routes move goes back to the old app and waits for the next release.

const READY_DEADLINE_MS = 20 * 60_000
const DRAIN_MS = 60_000
const LOCK = 0x6c61796f // one driver per store at a time

export interface LayoutSwitch {
  step: 'both' | 'move' | 'drop'
  since: number
  at: number
  failed?: string
  error?: string
}

export interface LayoutResult {
  ok: boolean
  status: 'services' | 'switching' | 'waiting' | 'busy' | 'failed'
  detail?: string
}

/** Advance the store's move by one step. `retry` restarts a failed one. */
export async function reconcileLayout(tenantId: string, opts: { retry?: boolean } = {}): Promise<LayoutResult> {
  const conn = await controlPlanePool().connect()
  try {
    const got = await conn.query('SELECT pg_try_advisory_lock($1, hashtext($2)) AS ok', [LOCK, tenantId])
    if (!got.rows[0]?.ok) return { ok: true, status: 'busy' }
    try {
      return await advance(tenantId, opts.retry ?? false)
    } finally {
      await conn.query('SELECT pg_advisory_unlock($1, hashtext($2))', [LOCK, tenantId]).catch(() => {})
    }
  } finally {
    conn.release()
  }
}

async function advance(tenantId: string, retry: boolean): Promise<LayoutResult> {
  const [row, tenant] = await Promise.all([getTenantCompute(tenantId), getTenant(tenantId)])
  if (!row?.applied || !tenant) return { ok: true, status: 'services' }
  const p: Record<string, any> = { ...(row.progress ?? {}) }
  let sw = p.layout as LayoutSwitch | undefined
  if ((row.applied.layout ?? 'controller') === 'services' && !sw) return { ok: true, status: 'services' }
  if (sw?.failed && !retry) return { ok: false, status: 'failed', detail: sw.failed }
  if (tenant.status !== 'active') return { ok: true, status: 'waiting', detail: 'the store is not active' }
  if (row.status === 'pending' || row.status === 'applying') return { ok: true, status: 'waiting', detail: 'a compute change is running' }
  if (row.status === 'paused') return { ok: true, status: 'waiting', detail: 'the store is paused' }

  const now = Date.now()
  if (!sw || sw.failed) sw = { step: 'both', since: now, at: now }
  p.layout = sw
  const k8s = await import('@/lib/k8s/tenant-compute')
  const { listCustomDomains } = await import('@/lib/tenant-registry/custom-domains')
  const c = await resolveCompute(tenantId, tenant.plan, { which: 'applied' })
  const customDomains = (await listCustomDomains(tenantId).catch(() => [])).filter(d => d.status === 'verified').map(d => d.domain)
  const base = { slug: tenant.slug, plan: tenant.plan, hosts: tenantHostnames(tenant.slug, tenant.plan), customDomains, dbPoolMax: c.dbPoolMax, nodeGen: c.nodeGen }
  const input = { ...base, compute: { ...c.spec, layout: 'services' as const } }
  const applied = { ...row.applied, layout: 'services' as const }

  try {
    if (sw.step === 'both') {
      await k8s.applyTenantWorkload({ ...input, routeTo: 'controller' })
      if (!(await k8s.tenantRolloutComplete(tenant.slug))) {
        if (now - sw.since > READY_DEADLINE_MS) throw new Error('its services did not become Ready within 20 min')
        await patchTenantCompute(tenantId, { progress: p })
        return { ok: true, status: 'switching', detail: 'starting its services' }
      }
      sw.step = 'move'
    }
    if (sw.step === 'move') {
      await k8s.applyTenantWorkload(input, { keepApps: true })
      Object.assign(sw, { step: 'drop', at: Date.now(), error: undefined })
      // From here every apply renders the services.
      await patchTenantCompute(tenantId, { applied, progress: p })
      return { ok: true, status: 'switching', detail: 'draining the old app' }
    }
    if (now - sw.at < DRAIN_MS) return { ok: true, status: 'switching', detail: 'draining the old app' }
    await k8s.applyTenantWorkload(input)
    delete p.layout
    await patchTenantCompute(tenantId, { applied, progress: Object.keys(p).length ? p : null, rate_inr_hour: await rateFor(applied) })
    const { syncComputePeriod } = await import('@controller/lib/billing/infra-billing')
    await syncComputePeriod(tenantId).catch(e => console.error(`[layout] ${tenant.slug}: billing period not synced: ${e?.message}`))
    return { ok: true, status: 'services' }
  } catch (e: any) {
    const msg = e?.message || 'layout switch failed'
    const isNew = sw.error !== msg
    if (sw.step === 'both') {
      // The routes haven't moved: put the old app back as it ran.
      await k8s.applyTenantWorkload({ ...base, compute: { ...c.spec, layout: 'controller' } }).catch(() => {})
      sw.failed = msg
    } else sw.error = msg
    await patchTenantCompute(tenantId, { progress: p }).catch(() => {})
    if (sw.failed || isNew) {
      try {
        const { alertProvisioningFailure } = await import('./alerts')
        await alertProvisioningFailure(tenant.slug, 'layout_switch', `${sw.failed ? 'gave up: ' : ''}${msg}`, tenantId)
      } catch {
        /* alerting must never mask the failure */
      }
    }
    return { ok: false, status: sw.failed ? 'failed' : 'switching', detail: msg }
  }
}
