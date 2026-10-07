import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/shared/db', () => ({ queryOne: vi.fn() }))
vi.mock('@/lib/catalog/site-controls', () => ({ getFeatureFlags: vi.fn(), getStoreIdentity: vi.fn() }))
vi.mock('@/lib/orders/order-commit', () => ({
  resolveBuyNowItem: vi.fn(),
  quoteShipping: vi.fn(),
  loadAddress: vi.fn(),
}))
vi.mock('@/lib/payments/razorpay', () => ({ getRazorpayInstanceFor: vi.fn() }))
vi.mock('@/lib/tenancy/tenant-context', () => ({ resolveTenantId: vi.fn() }))

import { queryOne } from '@/lib/shared/db'
import { getFeatureFlags, getStoreIdentity } from '@/lib/catalog/site-controls'
import { resolveBuyNowItem, quoteShipping, loadAddress } from '@/lib/orders/order-commit'
import { getRazorpayInstanceFor } from '@/lib/payments/razorpay'
import { resolveTenantId } from '@/lib/tenancy/tenant-context'
import { deriveSubscriptionOffer } from '@/lib/subscriptions/offer'
import { SubscriptionError } from '@/lib/subscriptions/types'
import { platformBrandName } from '@/lib/catalog/brand'

const PID = '11111111-1111-1111-1111-111111111111'
const product = (o: Record<string, unknown> = {}) => ({
  id: PID,
  name: 'Coffee',
  slug: 'coffee',
  is_active: true,
  is_digital: false,
  is_subscription: true,
  subscription_intervals: ['monthly', 'quarterly'],
  subscription_price: '450.00',
  subscription_price_ex_gst: null,
  gst_percentage: '18',
  hsn_code: '0901',
  ...o,
})

function setup(p = product(), opts: { isOwn?: boolean; price?: number; flags?: Record<string, boolean> } = {}) {
  vi.mocked(getFeatureFlags).mockResolvedValue({
    subscriptionsEnabled: true,
    digitalProductsEnabled: true,
    gstEnabled: true,
    ...(opts.flags ?? {}),
  } as any)
  vi.mocked(queryOne).mockResolvedValue(p as any)
  vi.mocked(resolveBuyNowItem).mockResolvedValue({
    ok: true,
    item: { productId: PID, variantId: null, subVariantId: null, qty: 1, buyMode: 'unit', buyUnit: null, price: opts.price ?? 500, isDigital: !!p.is_digital },
  })
  vi.mocked(loadAddress).mockResolvedValue({ id: 'a1', postal_code: '600001', state: 'Tamil Nadu', country: 'India' })
  vi.mocked(quoteShipping).mockResolvedValue({ shipping: 60, codFee: 0 })
  vi.mocked(resolveTenantId).mockResolvedValue('t1')
  vi.mocked(getRazorpayInstanceFor).mockResolvedValue({
    instance: {} as any,
    creds: { key_id: 'rzp_test', key_secret: 's', isOwn: !!opts.isOwn },
  })
  vi.mocked(getStoreIdentity).mockResolvedValue({ name: 'Acme Store' } as any)
}

const base = { userId: 'u1', productId: PID, interval: 'monthly', quantity: 2 }

describe('deriveSubscriptionOffer', () => {
  beforeEach(() => vi.clearAllMocks())

  it('prices from the product subscription_price, never the client', async () => {
    setup()
    const o = await deriveSubscriptionOffer({ ...base, addressId: 'a1', price: 1 } as any)
    expect(o.unitPrice).toBe(450)
    expect(o.shipping).toBe(60)
    expect(o.amount).toBe(960)
    expect(o.amountPaise).toBe(96000)
    expect(o.collectingAccount).toBe('platform')
    expect(o.merchantLabel).toBe(platformBrandName())
  })

  it('falls back to the normal resolved price when subscription_price is null', async () => {
    setup(product({ subscription_price: null }), { price: 300 })
    const o = await deriveSubscriptionOffer(base)
    expect(o.unitPrice).toBe(300)
    expect(o.shipping).toBe(0) // no address → no shipping quote
  })

  it('rejects a cycle above the ₹15,000 cap', async () => {
    setup(product({ subscription_price: '7600' }))
    await expect(deriveSubscriptionOffer(base)).rejects.toThrow('Subscriptions are limited to ₹15,000 per cycle')
  })

  it('rejects an interval the product does not allow', async () => {
    setup()
    await expect(deriveSubscriptionOffer({ ...base, interval: 'weekly' })).rejects.toBeInstanceOf(SubscriptionError)
    await expect(deriveSubscriptionOffer({ ...base, interval: 'daily' })).rejects.toBeInstanceOf(SubscriptionError)
  })

  it('rejects when the subscriptions master is off', async () => {
    setup(product(), { flags: { subscriptionsEnabled: false } })
    await expect(deriveSubscriptionOffer(base)).rejects.toThrow('Subscriptions are not available')
  })

  it('rejects a product that is not a subscription product', async () => {
    setup(product({ is_subscription: false }))
    await expect(deriveSubscriptionOffer(base)).rejects.toBeInstanceOf(SubscriptionError)
  })

  it('forces digital quantity to 1 and skips shipping', async () => {
    setup(product({ is_digital: true }))
    const o = await deriveSubscriptionOffer({ ...base, quantity: 5, addressId: 'a1' })
    expect(o.quantity).toBe(1)
    expect(o.shipping).toBe(0)
    expect(quoteShipping).not.toHaveBeenCalled()
  })

  it('rejects an out-of-range quantity', async () => {
    setup()
    await expect(deriveSubscriptionOffer({ ...base, quantity: 11 })).rejects.toBeInstanceOf(SubscriptionError)
    await expect(deriveSubscriptionOffer({ ...base, quantity: 1.5 })).rejects.toBeInstanceOf(SubscriptionError)
  })

  it('labels an own-key store with its own name', async () => {
    setup(product(), { isOwn: true })
    const o = await deriveSubscriptionOffer(base)
    expect(o.collectingAccount).toBe('own')
    expect(o.merchantLabel).toBe('Acme Store')
  })
})
