import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const m = vi.hoisted(() => ({
  sid: { value: 'sid' as string | undefined },
  resolve: vi.fn(),
  tenants: vi.fn(),
  job: vi.fn(),
  outcome: vi.fn(),
  close: vi.fn(),
  trigger: vi.fn(),
  restoreKey: vi.fn(),
  query: vi.fn(),
}))

vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => (m.sid.value ? { value: m.sid.value } : undefined) }) }))
vi.mock('@/lib/auth/owner-session', () => ({ OWNER_COOKIE: 'owner', resolveOwnerSession: m.resolve }))
vi.mock('@/lib/auth/session-signals-request', () => ({ extractSessionSignals: () => ({}) }))
vi.mock('@/lib/tenant-registry', () => ({ controlPlanePool: () => ({ query: m.query }), getOwnerTenants: m.tenants, getProvisioningJob: m.job }))
vi.mock('@/lib/tenant-registry/provisioning', () => ({ loadSetupOutcome: m.outcome }))
vi.mock('@controller/lib/billing/subscription', () => ({ closeStoreLines: m.close }))
vi.mock('@controller/lib/provisioning/trigger', () => ({ triggerProvisioning: m.trigger, resolveRestoreKey: m.restoreKey }))
vi.mock('@controller/lib/provisioning/pipeline-view', () => ({ describePipeline: () => 'described', ownerPipelineView: (v: unknown) => ({ view: v }) }))

import { GET, POST } from '@controller/app/api/(ecom)/ecom/provisioning/route'

const TID = '11111111-1111-4111-8111-111111111111'
const TENANT = { id: TID, slug: 'acme', plan: 'growth', razorpay_subscription_id: 'sub_1' }
const post = (body: unknown) => new NextRequest('https://ecom.test/api/ecom/provisioning', { method: 'POST', body: JSON.stringify(body) })
const get = (q: string) => new NextRequest(`https://ecom.test/api/ecom/provisioning${q}`)

describe('ecom provisioning', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    m.resolve.mockResolvedValue({ id: 'o-1', email: 'o@x.in', name: 'Owner' })
    m.tenants.mockResolvedValue([TENANT])
  })

  it('401s without an owner session', async () => {
    m.resolve.mockResolvedValue(null)
    expect((await POST(post({ action: 'provision', tenantId: TID }))).status).toBe(401)
    expect((await GET(get(`?tenantId=${TID}`))).status).toBe(401)
    expect(m.trigger).not.toHaveBeenCalled()
  })

  it('400s bad input and 404s a tenant the owner does not own', async () => {
    expect((await POST(post({ action: 'nuke', tenantId: TID }))).status).toBe(400)
    expect((await GET(get('?tenantId=nope'))).status).toBe(400)
    m.tenants.mockResolvedValue([])
    expect((await POST(post({ action: 'provision', tenantId: TID }))).status).toBe(404)
  })

  it('provisions with a server-built payload', async () => {
    m.restoreKey.mockResolvedValue('key-1')
    m.trigger.mockResolvedValue({ ok: true, jobStatus: 'queued', added: ['a'], removed: [] })
    const res = await POST(post({ action: 'provision', tenantId: TID }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, action: 'provision', jobStatus: 'queued' })
    expect(m.trigger).toHaveBeenCalledWith({ action: 'provision', tenantId: TID, slug: 'acme', plan: 'growth', ownerId: 'o-1', restoreFromKey: 'key-1', reason: 'operator' })
  })

  it('500s when the engine fails', async () => {
    m.trigger.mockResolvedValue({ ok: false, error: 'boom', jobStatus: 'failed' })
    const res = await POST(post({ action: 'reprovision', tenantId: TID }))
    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({ ok: false, error: 'boom' })
    expect(m.trigger.mock.calls[0][0]).toMatchObject({ reason: 'plan_change', restoreFromKey: undefined })
  })

  it('deprovision schedules the cancellation or reports failure', async () => {
    m.close.mockResolvedValue({ status: 'cancelled', endsAt: '2026-12-01T00:00:00Z' })
    const ok = await POST(post({ action: 'deprovision', tenantId: TID }))
    expect(await ok.json()).toMatchObject({ status: 'cancellation_scheduled', subscriptionStatus: 'cancelled', endsAt: Date.parse('2026-12-01T00:00:00Z') / 1000 })
    expect(m.close).toHaveBeenCalledWith(TID, { email: 'o@x.in', name: 'Owner' })
    m.close.mockRejectedValue(new Error('rzp down'))
    const bad = await POST(post({ action: 'deprovision', tenantId: TID }))
    expect(bad.status).toBe(500)
    m.tenants.mockResolvedValue([{ ...TENANT, razorpay_subscription_id: null }])
    expect((await POST(post({ action: 'deprovision', tenantId: TID }))).status).toBe(400)
  })

  it('GET returns the outcome of a closed store, else the pipeline', async () => {
    m.outcome.mockResolvedValueOnce({ kind: 'stopped' })
    expect(await (await GET(get(`?tenantId=${TID}`))).json()).toEqual({ pipeline: null, outcome: { kind: 'stopped' } })
    m.outcome.mockResolvedValue(null)
    m.job.mockResolvedValueOnce(null)
    expect(await (await GET(get(`?tenantId=${TID}`))).json()).toEqual({ pipeline: null })
    m.job.mockResolvedValue({ id: 'j-1' })
    m.query.mockResolvedValue({ rows: [] })
    expect(await (await GET(get(`?tenantId=${TID}`))).json()).toEqual({ pipeline: { view: 'described' } })
    expect(m.query.mock.calls[0][1]).toEqual(['j-1'])
  })
})
