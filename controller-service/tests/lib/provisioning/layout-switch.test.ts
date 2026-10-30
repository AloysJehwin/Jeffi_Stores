// A store moves off the old all-in-one app: its services start beside it, the routes move once they are
// Ready, the old app drains and goes. A store that can't start its services goes back to the old app.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { presetSpec } from '@/lib/compute/presets'

vi.mock('server-only', () => ({}))

const lock = vi.hoisted(() => ({ got: true, query: vi.fn(), release: vi.fn() }))
const reg = vi.hoisted(() => ({ getTenant: vi.fn(), controlPlanePool: vi.fn() }))
vi.mock('@/lib/tenant-registry', () => reg)
vi.mock('@/lib/tenant-registry/custom-domains', () => ({ listCustomDomains: vi.fn().mockResolvedValue([]) }))
const alerts = vi.hoisted(() => ({ alertProvisioningFailure: vi.fn() }))
vi.mock('@controller/lib/provisioning/alerts', () => alerts)
vi.mock('@controller/lib/provisioning/steps', () => ({ tenantHostnames: (slug: string) => [`${slug}.jeffistores.in`] }))
const store = vi.hoisted(() => ({ getTenantCompute: vi.fn(), patchTenantCompute: vi.fn() }))
vi.mock('@controller/lib/compute/store', () => store)
vi.mock('@controller/lib/compute/resolve', () => ({
  resolveCompute: vi.fn(async () => ({ spec: { ...presetSpec('small'), layout: 'controller' }, dbPoolMax: 5, maxConnections: 100, nodeGen: 2 })),
  rateFor: vi.fn(async () => 1.5),
}))
const k8s = vi.hoisted(() => ({ applyTenantWorkload: vi.fn(), tenantRolloutComplete: vi.fn() }))
vi.mock('@/lib/k8s/tenant-compute', () => k8s)

import { reconcileLayout } from '@controller/lib/provisioning/layout-switch'

let row: any
const given = (progress: any = null, layout = 'controller') => {
  row = { tenant_id: 't-1', applied: { ...presetSpec('small'), layout }, desired: presetSpec('small'), status: 'applied', progress }
}
const saved = () => store.patchTenantCompute.mock.calls.at(-1)![1]
const appliedWith = (i: number) => k8s.applyTenantWorkload.mock.calls[i]

beforeEach(() => {
  vi.clearAllMocks()
  lock.got = true
  lock.query.mockImplementation(async (sql: string) => ({ rows: [{ ok: sql.includes('try') ? lock.got : true }] }))
  reg.controlPlanePool.mockReturnValue({ connect: async () => lock })
  reg.getTenant.mockResolvedValue({ id: 't-1', slug: 'acme', plan: 'basic', status: 'active' })
  store.getTenantCompute.mockImplementation(async () => row)
  store.patchTenantCompute.mockResolvedValue(undefined)
  k8s.applyTenantWorkload.mockResolvedValue(undefined)
})

describe('reconcileLayout', () => {
  it('starts the services beside the old app, which keeps the traffic', async () => {
    given()
    k8s.tenantRolloutComplete.mockResolvedValue(false)
    const r = await reconcileLayout('t-1')
    expect(r).toMatchObject({ ok: true, status: 'switching' })
    expect(appliedWith(0)[0]).toMatchObject({ slug: 'acme', routeTo: 'controller', compute: { layout: 'services' }, nodeGen: 2 })
    expect(saved()).toEqual({ progress: { layout: expect.objectContaining({ step: 'both' }) } })
    expect(lock.release).toHaveBeenCalled()
  })

  it('moves the routes once every pod is Ready and keeps the old app to drain', async () => {
    given({ layout: { step: 'both', since: Date.now() - 60_000, at: Date.now() - 60_000 } })
    k8s.tenantRolloutComplete.mockResolvedValue(true)
    const r = await reconcileLayout('t-1')
    expect(r).toMatchObject({ ok: true, status: 'switching', detail: 'draining the old app' })
    expect(appliedWith(1)).toEqual([expect.objectContaining({ compute: expect.objectContaining({ layout: 'services' }) }), { keepApps: true }])
    expect(appliedWith(1)[0].routeTo).toBeUndefined()
    expect(saved()).toMatchObject({ applied: { layout: 'services' }, progress: { layout: { step: 'drop' } } })
  })

  it('waits out the drain, then drops the old app and keeps other progress', async () => {
    given({ oldDb: { id: 'x' }, layout: { step: 'drop', since: 0, at: Date.now() - 10_000 } })
    expect(await reconcileLayout('t-1')).toMatchObject({ status: 'switching' })
    expect(k8s.applyTenantWorkload).not.toHaveBeenCalled()

    given({ oldDb: { id: 'x' }, layout: { step: 'drop', since: 0, at: Date.now() - 61_000 } })
    expect(await reconcileLayout('t-1')).toEqual({ ok: true, status: 'services' })
    expect(appliedWith(0)).toEqual([expect.objectContaining({ compute: expect.objectContaining({ layout: 'services' }) })])
    expect(saved()).toEqual({ applied: expect.objectContaining({ layout: 'services' }), progress: { oldDb: { id: 'x' } }, rate_inr_hour: 1.5 })
  })

  it('puts a store back on the old app when its services never become Ready', async () => {
    given({ layout: { step: 'both', since: Date.now() - 21 * 60_000, at: 0 } })
    k8s.tenantRolloutComplete.mockResolvedValue(false)
    const r = await reconcileLayout('t-1')
    expect(r).toMatchObject({ ok: false, status: 'failed' })
    expect(appliedWith(1)[0]).toMatchObject({ compute: { layout: 'controller' } })
    expect(appliedWith(1)[0].routeTo).toBeUndefined()
    expect(saved().progress.layout.failed).toMatch(/20 min/)
    expect(alerts.alertProvisioningFailure).toHaveBeenCalledWith('acme', 'layout_switch', expect.stringMatching(/^gave up/), 't-1')

    vi.clearAllMocks()
    given({ layout: { step: 'both', since: 0, at: 0, failed: 'x' } })
    expect(await reconcileLayout('t-1')).toEqual({ ok: false, status: 'failed', detail: 'x' })
    expect(k8s.applyTenantWorkload).not.toHaveBeenCalled()
    k8s.tenantRolloutComplete.mockResolvedValue(false)
    expect(await reconcileLayout('t-1', { retry: true })).toMatchObject({ status: 'switching' })
    expect(saved().progress.layout.failed).toBeUndefined()
  })

  it('leaves stores already on their services, inactive stores and running compute changes alone', async () => {
    given(null, 'services')
    expect(await reconcileLayout('t-1')).toEqual({ ok: true, status: 'services' })
    given()
    reg.getTenant.mockResolvedValue({ id: 't-1', slug: 'acme', plan: 'basic', status: 'suspended' })
    expect(await reconcileLayout('t-1')).toMatchObject({ status: 'waiting' })
    reg.getTenant.mockResolvedValue({ id: 't-1', slug: 'acme', plan: 'basic', status: 'active' })
    given(null)
    row.status = 'applying'
    expect(await reconcileLayout('t-1')).toMatchObject({ status: 'waiting' })
    expect(k8s.applyTenantWorkload).not.toHaveBeenCalled()
  })

  it('lets one driver at a time work a store', async () => {
    given()
    lock.got = false
    expect(await reconcileLayout('t-1')).toEqual({ ok: true, status: 'busy' })
    expect(k8s.applyTenantWorkload).not.toHaveBeenCalled()
    expect(lock.release).toHaveBeenCalled()
  })
})
