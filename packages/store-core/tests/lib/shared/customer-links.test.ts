import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/shared/db', () => ({ queryOne: vi.fn() }))
vi.mock('@/lib/catalog/brand', () => ({
  storeBaseUrlAsync: vi.fn(),
  businessBaseUrlAsync: vi.fn(),
  resolveCurrentTenant: vi.fn(),
}))

import { apiBaseUrl, customerBaseUrl, documentUrl, orderUrl, orderUrlByNumber, productUrl } from '@/lib/shared/customer-links'
import { queryOne } from '@/lib/shared/db'
import { businessBaseUrlAsync, resolveCurrentTenant, storeBaseUrlAsync } from '@/lib/catalog/brand'

const STORE = 'https://acme.jeffistores.in'
const BUSINESS = 'https://acme.business.jeffistores.in'

describe('customer links', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(storeBaseUrlAsync).mockResolvedValue(STORE)
    vi.mocked(businessBaseUrlAsync).mockResolvedValue(BUSINESS)
    vi.mocked(resolveCurrentTenant).mockResolvedValue({ slug: 'acme', displayName: 'Acme', plan: 'pro' })
    vi.mocked(queryOne).mockResolvedValue(null)
  })

  it('sends a retail customer to the store and an approved business customer to the portal', async () => {
    expect(await customerBaseUrl('retail-1')).toBe(STORE)
    vi.mocked(queryOne).mockResolvedValueOnce({ approved: true })
    expect(await customerBaseUrl('biz-1')).toBe(BUSINESS)
    expect(String(vi.mocked(queryOne).mock.calls[1][0])).toContain("approval_status = 'approved'")
  })

  it('uses the store for a guest without a user, and when the lookup fails', async () => {
    expect(await customerBaseUrl(null)).toBe(STORE)
    vi.mocked(queryOne).mockRejectedValueOnce(new Error('db down'))
    expect(await customerBaseUrl('u1')).toBe(STORE)
  })

  it('builds the exact order and product pages on that base', async () => {
    expect(await orderUrl('ord-1', 'retail-1')).toBe(`${STORE}/account/orders/ord-1`)
    vi.mocked(queryOne).mockResolvedValueOnce({ approved: true })
    expect(await orderUrl('ord-2', 'biz-1')).toBe(`${BUSINESS}/account/orders/ord-2`)
    expect(await productUrl('m12 screw/x', 'retail-1')).toBe(`${STORE}/products/m12%20screw%2Fx`)
  })

  it('finds an order by its number, and gives nothing for an unknown number', async () => {
    vi.mocked(queryOne)
      .mockResolvedValueOnce({ id: 'ord-9', user_id: 'u9' }) // the order
      .mockResolvedValueOnce(null) // u9 is not a business customer
    expect(await orderUrlByNumber('ORD-9')).toBe(`${STORE}/account/orders/ord-9`)
    expect(await orderUrlByNumber('NOPE')).toBeNull()
  })

  it('keeps API links on the store host even for business customers', async () => {
    expect(await apiBaseUrl()).toBe(STORE)
    expect(businessBaseUrlAsync).not.toHaveBeenCalled()
  })

  it("puts documents on the tenant's own document host, and the platform's off-tenant", async () => {
    expect(await documentUrl('invoice', 'tok 1')).toBe('https://invoice-acme.jeffistores.in/tok%201')
    expect(await documentUrl('quotation', 't')).toBe('https://quotation-acme.jeffistores.in/t')
    vi.mocked(resolveCurrentTenant).mockResolvedValueOnce(null)
    expect(await documentUrl('purchaseorder', 't')).toBe('https://purchaseorder.jeffistores.in/t')
  })
})
