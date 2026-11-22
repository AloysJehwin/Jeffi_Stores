import { describe, it, expect, vi, beforeEach } from 'vitest'

const cpQuery = vi.fn()
const lookupById = vi.fn()
const lookupBySlug = vi.fn()
const runWithCtx = vi.fn(async (...a: any[]) => a[1]())
const getRzp = vi.fn()

vi.mock('@/lib/tenant-registry', () => ({ controlPlanePool: () => ({ query: cpQuery }) }))
vi.mock('@/lib/tenant-registry/host-resolution', () => ({
  lookupTenantContextById: (...a: any[]) => lookupById(...a),
  lookupTenantContextBySlug: (...a: any[]) => lookupBySlug(...a),
}))
vi.mock('@/lib/tenancy/tenant-context', () => ({ runWithTenantContext: (...a: any[]) => runWithCtx(...a) }))
vi.mock('@/lib/payments/razorpay', () => ({ getRazorpayInstance: () => getRzp() }))

import {
  isFlagship,
  flagshipScope,
  scopeForTenantId,
  storeNamedIn,
  resolveSubscriptionTenant,
  storeForRazorpayOrder,
  scopeForEntity,
  runInTenant,
} from '@/lib/payments/webhook-tenant'

const NIL = '00000000-0000-0000-0000-000000000000'
const TID = '11111111-1111-4111-8111-111111111111'

beforeEach(() => {
  vi.clearAllMocks()
  lookupById.mockResolvedValue({ tenantId: TID, slug: 'acme', pool: {} })
  lookupBySlug.mockResolvedValue({ tenantId: TID, slug: 'acme', pool: {} })
})

describe('isFlagship', () => {
  it('is true for null, undefined, missing id and the NIL id', () => {
    expect(isFlagship(null)).toBe(true)
    expect(isFlagship(undefined)).toBe(true)
    expect(isFlagship({ tenantId: '' })).toBe(true)
    expect(isFlagship({ tenantId: NIL })).toBe(true)
  })
  it('is false for a real tenant id', () => {
    expect(isFlagship({ tenantId: TID })).toBe(false)
  })
})

describe('flagshipScope', () => {
  it('returns the NIL/platform scope with no ctx', () => {
    expect(flagshipScope()).toEqual({ tenantId: NIL, slug: 'platform', ctx: null })
  })
})

describe('scopeForTenantId', () => {
  it('returns null for empty / nullish', async () => {
    expect(await scopeForTenantId(null)).toBeNull()
    expect(await scopeForTenantId('   ')).toBeNull()
  })
  it('resolves a real id to a tenant scope', async () => {
    const r = await scopeForTenantId(TID)
    expect(r).toEqual({ tenantId: TID, slug: 'acme', ctx: { tenantId: TID, slug: 'acme', pool: {} } })
    expect(lookupById).toHaveBeenCalledWith(TID)
  })
  it('maps the NIL id to the flagship (no lookup)', async () => {
    const r = await scopeForTenantId(NIL)
    expect(r).toEqual(flagshipScope())
    expect(lookupById).not.toHaveBeenCalled()
  })
  it('returns null when the id resolves to no context', async () => {
    lookupById.mockResolvedValueOnce(null)
    expect(await scopeForTenantId(TID)).toBeNull()
  })
})

describe('storeNamedIn', () => {
  it('resolves by notes.tenant_id', async () => {
    const r = await storeNamedIn({ tenant_id: TID })
    expect(r).toMatchObject({ tenantId: TID, slug: 'acme' })
  })
  it('resolves by notes.tenant_slug when no id', async () => {
    const r = await storeNamedIn({ tenant_slug: 'acme' })
    expect(r).toMatchObject({ tenantId: TID, slug: 'acme' })
    expect(lookupBySlug).toHaveBeenCalledWith('acme')
  })
  it('returns undefined when no store is named', async () => {
    expect(await storeNamedIn({})).toBeUndefined()
    expect(await storeNamedIn(null)).toBeUndefined()
  })
  it('returns null when the slug cannot be found', async () => {
    lookupBySlug.mockResolvedValueOnce(null)
    expect(await storeNamedIn({ tenant_slug: 'ghost' })).toBeNull()
  })
  it('returns null when the slug lookup throws', async () => {
    lookupBySlug.mockRejectedValueOnce(new Error('cp down'))
    expect(await storeNamedIn({ tenant_slug: 'acme' })).toBeNull()
  })
})

describe('resolveSubscriptionTenant', () => {
  it('returns null when the entity has no id', async () => {
    expect(await resolveSubscriptionTenant({})).toBeNull()
    expect(await resolveSubscriptionTenant({ id: '  ' })).toBeNull()
    expect(cpQuery).not.toHaveBeenCalled()
  })
  it('returns null when the subscription has no index row (unknown)', async () => {
    cpQuery.mockResolvedValueOnce({ rows: [] })
    expect(await resolveSubscriptionTenant({ id: 'sub_1' })).toBeNull()
  })
  it('resolves via the index row', async () => {
    cpQuery.mockResolvedValueOnce({ rows: [{ tenant_id: TID }] })
    const r = await resolveSubscriptionTenant({ id: 'sub_1' })
    expect(r).toMatchObject({ tenantId: TID, slug: 'acme' })
  })
  it('refuses when notes.tenant_id disagrees with the index', async () => {
    cpQuery.mockResolvedValueOnce({ rows: [{ tenant_id: TID }] })
    const r = await resolveSubscriptionTenant({ id: 'sub_1', notes: { tenant_id: 'other' } })
    expect(r).toBeNull()
  })
  it('allows matching notes', async () => {
    cpQuery.mockResolvedValueOnce({ rows: [{ tenant_id: TID }] })
    const r = await resolveSubscriptionTenant({ id: 'sub_1', notes: { tenant_id: TID } })
    expect(r).toMatchObject({ tenantId: TID })
  })
  it('propagates a control-plane error (caller retries)', async () => {
    cpQuery.mockRejectedValueOnce(new Error('index down'))
    await expect(resolveSubscriptionTenant({ id: 'sub_1' })).rejects.toThrow('index down')
  })
})

describe('storeForRazorpayOrder', () => {
  it('returns undefined with no order id', async () => {
    expect(await storeForRazorpayOrder(null)).toBeUndefined()
  })
  it('reads the order notes from the platform account', async () => {
    getRzp.mockReturnValue({ orders: { fetch: vi.fn(async () => ({ notes: { tenant_id: TID } })) } })
    const r = await storeForRazorpayOrder('order_1')
    expect(r).toMatchObject({ tenantId: TID })
  })
  it('returns undefined when the fetch throws (platformFetch swallows)', async () => {
    getRzp.mockImplementation(() => {
      throw new Error('no keys')
    })
    expect(await storeForRazorpayOrder('order_1')).toBeUndefined()
  })
})

describe('scopeForEntity', () => {
  it('uses the entity notes first', async () => {
    const r = await scopeForEntity({ notes: { tenant_id: TID } })
    expect(r).toMatchObject({ tenantId: TID })
  })
  it('falls back to the opts.payment notes', async () => {
    const r = await scopeForEntity({ notes: {} }, { payment: { notes: { tenant_id: TID } } })
    expect(r).toMatchObject({ tenantId: TID })
  })
  it('fetches the payment then its order when notes name nothing', async () => {
    const payFetch = vi.fn(async () => ({ notes: {}, order_id: 'order_1' }))
    const orderFetch = vi.fn(async () => ({ notes: { tenant_id: TID } }))
    getRzp.mockReturnValue({ payments: { fetch: payFetch }, orders: { fetch: orderFetch } })
    const r = await scopeForEntity({ notes: {} }, { paymentId: 'pay_1' })
    expect(r).toMatchObject({ tenantId: TID })
    expect(payFetch).toHaveBeenCalledWith('pay_1')
    expect(orderFetch).toHaveBeenCalledWith('order_1')
  })
  it('falls back to the flagship when nothing names a store', async () => {
    getRzp.mockReturnValue({ payments: { fetch: vi.fn(async () => ({ notes: {}, order_id: null })) } })
    const r = await scopeForEntity({ notes: {} }, { paymentId: 'pay_1' })
    expect(r).toEqual(flagshipScope())
  })
  it('returns the flagship directly when there is no paymentId and no notes', async () => {
    const r = await scopeForEntity({ notes: {} })
    expect(r).toEqual(flagshipScope())
  })
})

describe('runInTenant', () => {
  it('runs inside the tenant context when ctx is set', async () => {
    const t = { tenantId: TID, slug: 'acme', ctx: { tenantId: TID } as any }
    const r = await runInTenant(t, async () => 'ok')
    expect(r).toBe('ok')
    expect(runWithCtx).toHaveBeenCalledWith(t.ctx, expect.any(Function))
  })
  it('runs directly for the flagship (no ctx)', async () => {
    const r = await runInTenant(flagshipScope(), async () => 'direct')
    expect(r).toBe('direct')
    expect(runWithCtx).not.toHaveBeenCalled()
  })
})
