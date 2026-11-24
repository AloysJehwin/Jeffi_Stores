import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { z } from 'zod'

const m = vi.hoisted(() => ({
  owner: vi.fn(),
  getOwnerTenants: vi.fn(),
  listPlans: vi.fn(),
  setPendingPlan: vi.fn(),
  updateTenantPlan: vi.fn(),
  query: vi.fn(),
  invalidate: vi.fn(),
  changeStorePlan: vi.fn(),
  trigger: vi.fn(),
  check: vi.fn(),
  saveDesired: vi.fn(),
  patchCompute: vi.fn(),
  price: vi.fn(),
  paymentRequired: vi.fn(),
}))

vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: 'sid' }) }) }))
vi.mock('@/lib/auth/owner-session', () => ({ OWNER_COOKIE: 'owner_sid', resolveOwnerSession: m.owner }))
vi.mock('@/lib/auth/session-signals-request', () => ({ extractSessionSignals: () => ({}) }))
vi.mock('@/lib/tenant-registry', () => ({
  controlPlanePool: () => ({ query: m.query }),
  getOwnerTenants: m.getOwnerTenants,
  listPlans: m.listPlans,
  setPendingPlan: m.setPendingPlan,
  updateTenantPlan: m.updateTenantPlan,
}))
vi.mock('@/lib/auth/plan-gate', () => ({ invalidatePlanCache: m.invalidate }))
vi.mock('@controller/lib/billing/subscription', () => ({ changeStorePlan: m.changeStorePlan }))
vi.mock('@controller/lib/provisioning/trigger', () => ({ triggerProvisioning: m.trigger }))
vi.mock('@controller/lib/compute/schema', () => ({ ComputeSpecSchema: z.object({ cpu: z.number() }).passthrough() }))
vi.mock('@controller/lib/compute/change', () => ({ checkComputeChange: m.check }))
vi.mock('@controller/lib/compute/store', () => ({ saveDesiredCompute: m.saveDesired, patchTenantCompute: m.patchCompute }))
vi.mock('@controller/lib/compute/pricing-month', () => ({ priceInrMonthForPlan: m.price }))
vi.mock('@/lib/compute/presets', () => ({ specKey: (s: unknown) => JSON.stringify(s) }))
vi.mock('@/lib/billing/payment-required', () => ({ paymentRequired: m.paymentRequired }))

import { POST } from '@controller/app/api/(ecom)/ecom/plan/route'

const TID = '11111111-1111-4111-8111-111111111111'
const SPEC = { cpu: 2 }
const req = (body: unknown) =>
  new NextRequest('https://ecom.jeffistores.in/api/ecom/plan', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
const BODY = { tenantId: TID, planSlug: 'growth', spec: SPEC }
const tenant = (over: Record<string, unknown> = {}) => ({ id: TID, slug: 'acme', plan: 'starter', billing_interval: 'monthly', razorpay_subscription_id: 'sub_1', ...over })

describe('POST /api/ecom/plan', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    m.owner.mockResolvedValue({ id: 'o-1', email: 'o@acme.test', name: 'Olu' })
    m.getOwnerTenants.mockResolvedValue([tenant()])
    m.listPlans.mockResolvedValue([{ slug: 'starter' }, { slug: 'growth' }])
    m.check.mockResolvedValue({ status: 200, current: { cpu: 1 } })
    m.price.mockResolvedValue(2500)
    m.paymentRequired.mockReturnValue(true)
    m.trigger.mockResolvedValue({ ok: true })
  })

  it('401s without a session', async () => {
    m.owner.mockResolvedValue(null)
    expect((await POST(req(BODY))).status).toBe(401)
  })

  it('rejects bad input: body, foreign store, no subscription, unknown plan', async () => {
    expect((await POST(req({ ...BODY, tenantId: 'x' }))).status).toBe(400)
    m.getOwnerTenants.mockResolvedValueOnce([])
    expect((await POST(req(BODY))).status).toBe(404)
    m.getOwnerTenants.mockResolvedValueOnce([tenant({ razorpay_subscription_id: null })])
    expect((await POST(req(BODY))).status).toBe(400)
    expect((await POST(req({ ...BODY, planSlug: 'nope' }))).status).toBe(400)
    expect(m.changeStorePlan).not.toHaveBeenCalled()
  })

  it('returns the compute check failure with its quote, and 400s an unpriceable spec', async () => {
    m.check.mockResolvedValueOnce({ status: 409, error: 'Too small', quote: { q: 1 } })
    const res = await POST(req(BODY))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'Too small', quote: { q: 1 } })
    m.price.mockResolvedValueOnce(0)
    expect((await POST(req(BODY))).status).toBe(400)
  })

  it('applies an unbilled store change now, reprovisions and saves the spec', async () => {
    m.paymentRequired.mockReturnValue(false)
    m.getOwnerTenants.mockResolvedValue([tenant({ razorpay_subscription_id: null })])
    const res = await POST(req({ ...BODY, applyMode: 'now', billingInterval: 'yearly' }))
    expect(await res.json()).toEqual({ status: 'applied', priceInrMonth: 2500, effectiveAt: 'now', provisioning: { ok: true, error: null } })
    expect(m.updateTenantPlan).toHaveBeenCalledWith(TID, { planSlug: 'growth', billingInterval: 'yearly' })
    expect(m.setPendingPlan).toHaveBeenCalledWith(TID, null)
    expect(m.invalidate).toHaveBeenCalledWith(TID)
    expect(m.saveDesired).toHaveBeenCalledWith(TID, SPEC, 'now')
    expect(m.trigger).toHaveBeenCalledWith(expect.objectContaining({ action: 'reprovision', tenantId: TID, plan: 'growth', reason: 'plan_change' }))
    expect(m.changeStorePlan).not.toHaveBeenCalled()
  })

  it('reports a reprovision failure without failing the change', async () => {
    m.paymentRequired.mockReturnValue(false)
    m.trigger.mockRejectedValue(new Error('queue down'))
    const body = await (await POST(req(BODY))).json()
    expect(body.provisioning).toEqual({ ok: false, error: 'queue down' })
  })

  it('returns a checkout for an upgrade and moves nothing yet', async () => {
    m.changeStorePlan.mockResolvedValue({ status: 'checkout', checkoutUrl: 'https://rzp.test/c', quote: { upfrontPaise: 12345 } })
    const res = await POST(req(BODY))
    expect(await res.json()).toEqual({ status: 'upgrade', checkoutUrl: 'https://rzp.test/c', priceInrMonth: 2500, upfrontInr: 123, effectiveAt: 'on_approval' })
    expect(m.changeStorePlan).toHaveBeenCalledWith(TID, expect.objectContaining({ planSlug: 'growth', interval: 'monthly', priceInrMonth: 2500, ownerId: 'o-1' }), { email: 'o@acme.test', name: 'Olu' })
    expect(m.updateTenantPlan).not.toHaveBeenCalled()
  })

  it('schedules a downgrade for cycle end', async () => {
    const at = '2027-01-01T00:00:00.000Z'
    m.changeStorePlan.mockResolvedValue({ status: 'scheduled', effectiveAt: at, checkoutUrl: null })
    const body = await (await POST(req(BODY))).json()
    expect(body).toMatchObject({ status: 'downgrade_scheduled', scheduledAt: Math.floor(Date.parse(at) / 1000), effectiveAt: 'cycle_end' })
    expect(m.setPendingPlan).toHaveBeenCalledWith(TID, { planSlug: 'growth', billingInterval: 'monthly' })
    expect(m.patchCompute).toHaveBeenCalledWith(TID, { status: 'scheduled', next_at: new Date(at) })
    expect(m.query.mock.calls[0][1]).toEqual([TID, JSON.stringify(SPEC)])
  })

  it('502s when the subscription change throws', async () => {
    m.changeStorePlan.mockRejectedValue(new Error('razorpay 500'))
    expect((await POST(req(BODY))).status).toBe(502)
    expect(m.trigger).not.toHaveBeenCalled()
  })

  it('applies a same-price change now', async () => {
    m.changeStorePlan.mockResolvedValue({ status: 'same' })
    const body = await (await POST(req(BODY))).json()
    expect(body.status).toBe('applied')
    expect(m.updateTenantPlan).toHaveBeenCalledWith(TID, { planSlug: 'growth', billingInterval: 'monthly' })
    expect(m.saveDesired).toHaveBeenCalledWith(TID, SPEC, 'window')
  })
})
