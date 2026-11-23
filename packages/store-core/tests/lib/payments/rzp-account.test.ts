import { describe, it, expect, vi, beforeEach } from 'vitest'

const resolveRequestTenant = vi.fn()
const storedRazorpayKeys = vi.fn()
const query = vi.fn()
const controlPlanePool = vi.fn(() => ({ query }))
const isFlagship = vi.fn()
const pinnedTenantSlug = vi.fn<(...a: any[]) => string | null>(() => null)

vi.mock('@/lib/shared/db', () => ({ resolveRequestTenant: (...a: any[]) => resolveRequestTenant(...a) }))
vi.mock('@/lib/integrations/resolve', () => ({ storedRazorpayKeys: (...a: any[]) => storedRazorpayKeys(...a) }))
vi.mock('@/lib/tenant-registry', () => ({ controlPlanePool: () => controlPlanePool() }))
vi.mock('@/lib/payments/webhook-tenant', () => ({ isFlagship: (...a: any[]) => isFlagship(...a) }))
vi.mock('@/lib/service-routing', () => ({ pinnedTenantSlug: () => pinnedTenantSlug() }))

import { razorpayAccountFor } from '@/lib/payments/rzp-account'

beforeEach(() => {
  resolveRequestTenant.mockReset()
  storedRazorpayKeys.mockReset()
  query.mockReset()
  isFlagship.mockReset().mockReturnValue(false)
  pinnedTenantSlug.mockReset().mockReturnValue(null)
})

describe('razorpayAccountFor', () => {
  it('platform when no tenant resolved and not pinned', async () => {
    resolveRequestTenant.mockResolvedValue(null)
    expect(await razorpayAccountFor()).toEqual({ kind: 'platform', tenantId: null, slug: null, ownFlag: false })
  })
  it('throws when a store pod cannot resolve its tenant', async () => {
    resolveRequestTenant.mockResolvedValue(null)
    pinnedTenantSlug.mockReturnValue('myslug')
    await expect(razorpayAccountFor()).rejects.toThrow(/Store myslug/)
  })
  it('platform for the flagship tenant', async () => {
    resolveRequestTenant.mockResolvedValue({ tenantId: 'flag' })
    isFlagship.mockReturnValue(true)
    expect(await razorpayAccountFor()).toMatchObject({ kind: 'platform', tenantId: null })
  })
  it('route when store has no own keys (own_razorpay false)', async () => {
    resolveRequestTenant.mockResolvedValue({ tenantId: 't1', slug: 's1' })
    query.mockResolvedValue({ rows: [{ own_razorpay: false }] })
    const r = await razorpayAccountFor()
    expect(r).toEqual({ kind: 'route', tenantId: 't1', slug: 's1', ownFlag: false })
    expect(storedRazorpayKeys).not.toHaveBeenCalled()
  })
  it('own when flag set and keys present', async () => {
    resolveRequestTenant.mockResolvedValue({ tenantId: 't1', slug: 's1' })
    query.mockResolvedValue({ rows: [{ own_razorpay: true }] })
    storedRazorpayKeys.mockResolvedValue({ keyId: 'k' })
    const r = await razorpayAccountFor()
    expect(r).toEqual({ kind: 'own', tenantId: 't1', slug: 's1', ownFlag: true })
  })
  it('route when flag set but keys fetch fails/null', async () => {
    resolveRequestTenant.mockResolvedValue({ tenantId: 't1', slug: null })
    query.mockResolvedValue({ rows: [{ own_razorpay: true }] })
    storedRazorpayKeys.mockRejectedValue(new Error('no keys'))
    const r = await razorpayAccountFor()
    expect(r).toEqual({ kind: 'route', tenantId: 't1', slug: null, ownFlag: true })
  })
  it('ownFlag false when the tenants query fails', async () => {
    resolveRequestTenant.mockResolvedValue({ tenantId: 't1', slug: 's1' })
    query.mockRejectedValue(new Error('db'))
    const r = await razorpayAccountFor()
    expect(r).toEqual({ kind: 'route', tenantId: 't1', slug: 's1', ownFlag: false })
  })
})
