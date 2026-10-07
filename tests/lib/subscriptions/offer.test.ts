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
  subscription_price: null,
  subscription_price_ex_gst: null,
  subscription_total_cycles: null,
  subscription_min_cycles: null,
  gst_percentage: '18',
  hsn_code: '0901',
  ...o,
})

type Sellable = {
  has_variants?: boolean
  variant_has_subs?: boolean
  variant_sub_price?: string | null
  sub_variant_sub_price?: string | null
}

function setup(
  p = product(),
  opts: { isOwn?: boolean; price?: number; flags?: Record<string, boolean>; sellable?: Sellable } = {}
) {
  vi.mocked(getFeatureFlags).mockResolvedValue({
    subscriptionsEnabled: true,
    digitalProductsEnabled: true,
    gstEnabled: true,
    ...(opts.flags ?? {}),
  } as any)
  vi.mocked(queryOne).mockImplementation(async (sql: string) =>
    (/has_variants/.test(sql)
      ? { has_variants: false, variant_has_subs: false, variant_sub_price: null, sub_variant_sub_price: null, ...opts.sellable }
      : p) as any
  )
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

  it('prices from the live one-time price when no subscription price is set, never the client', async () => {
    setup(product(), { price: 450 })
    const o = await deriveSubscriptionOffer({ ...base, addressId: 'a1', price: 1 } as any)
    expect(o.unitPrice).toBe(450)
    expect(o.shipping).toBe(60)
    expect(o.amount).toBe(960)
    expect(o.amountPaise).toBe(96000)
    expect(o.collectingAccount).toBe('platform')
    expect(o.merchantLabel).toBe(platformBrandName())
  })

  it('skips shipping without an address', async () => {
    setup(product({ subscription_price: null }), { price: 300 })
    const o = await deriveSubscriptionOffer(base)
    expect(o.unitPrice).toBe(300)
    expect(o.shipping).toBe(0) // no address → no shipping quote
  })

  it('rejects a cycle above the ₹15,000 cap', async () => {
    setup(product(), { price: 7600 })
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

  it('charges the product subscription_price and reports the one-time price', async () => {
    setup(product({ subscription_price: '400.00' }), { price: 500 })
    const o = await deriveSubscriptionOffer(base)
    expect(o.unitPrice).toBe(400)
    expect(o.oneTimePrice).toBe(500)
  })

  it('derives the ex-GST subscription price when GST is off', async () => {
    setup(product({ subscription_price: '118.00' }), { price: 200, flags: { gstEnabled: false } })
    const o = await deriveSubscriptionOffer(base)
    expect(o.unitPrice).toBe(100)
    expect(o.unitPriceExGst).toBe(100)
  })

  it('requires a variant when the product has variants', async () => {
    setup(product(), { sellable: { has_variants: true } })
    await expect(deriveSubscriptionOffer(base)).rejects.toThrow('Choose an option to subscribe')
    expect(resolveBuyNowItem).not.toHaveBeenCalled()
  })

  it('requires a sub-variant when the variant has sub-variants (never the parent variant)', async () => {
    setup(product(), { sellable: { has_variants: true, variant_has_subs: true } })
    await expect(deriveSubscriptionOffer({ ...base, variantId: 'v1' })).rejects.toThrow('Choose an option')
  })

  it("uses the variant's subscription price", async () => {
    setup(product({ subscription_price: '1.00' }), {
      price: 600,
      sellable: { has_variants: true, variant_sub_price: '550.00', sub_variant_sub_price: null },
    })
    const o = await deriveSubscriptionOffer({ ...base, variantId: 'v1' })
    expect(o.unitPrice).toBe(550)
    expect(o.oneTimePrice).toBe(600)
  })

  it("uses the sub-variant's subscription price, falling back to one-time when unset", async () => {
    setup(product(), {
      price: 700,
      sellable: { has_variants: true, variant_has_subs: true, variant_sub_price: '10.00', sub_variant_sub_price: '650.00' },
    })
    const o = await deriveSubscriptionOffer({ ...base, variantId: 'v1', subVariantId: 'sv1' })
    expect(o.unitPrice).toBe(650)
    setup(product(), {
      price: 700,
      sellable: { has_variants: true, variant_has_subs: true, variant_sub_price: '10.00', sub_variant_sub_price: null },
    })
    const o2 = await deriveSubscriptionOffer({ ...base, variantId: 'v1', subVariantId: 'sv1' })
    expect(o2.unitPrice).toBe(700)
  })

  it('defaults to the interval cap and no minimum', async () => {
    setup()
    const o = await deriveSubscriptionOffer(base)
    expect(o.totalCycles).toBeNull()
    expect(o.totalCount).toBe(120)
    expect(o.minCycles).toBeNull()
  })

  it('uses the admin-set number of cycles and minimum commitment', async () => {
    setup(product({ subscription_total_cycles: 12, subscription_min_cycles: 3 }))
    const o = await deriveSubscriptionOffer(base)
    expect(o.totalCycles).toBe(12)
    expect(o.totalCount).toBe(12)
    expect(o.minCycles).toBe(3)
  })

  it("caps the cycle count at the interval's limit", async () => {
    setup(product({ subscription_intervals: ['yearly'], subscription_total_cycles: 50, subscription_min_cycles: 40 }))
    const o = await deriveSubscriptionOffer({ ...base, interval: 'yearly' })
    expect(o.totalCount).toBe(10)
    expect(o.minCycles).toBe(10)
  })
})
