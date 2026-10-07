import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/shared/db', () => ({ query: vi.fn(), queryOne: vi.fn() }))
vi.mock('@/lib/catalog/site-controls', () => ({ getStoreIdentity: vi.fn(async () => ({ name: 'Acme' })) }))
const cpQuery = vi.fn()
vi.mock('@/lib/tenant-registry', () => ({ controlPlanePool: () => ({ query: cpQuery }) }))
vi.mock('@/lib/subscriptions/cycle', () => ({ NIL_TENANT_ID: '00000000-0000-0000-0000-000000000000' }))
vi.mock('@/lib/subscriptions/plans', () => ({ getOrCreatePlan: vi.fn(async () => 'plan_1') }))
vi.mock('@/lib/subscriptions/offer', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/subscriptions/offer')>()),
  deriveSubscriptionOffer: vi.fn(),
}))

import { query, queryOne } from '@/lib/shared/db'
import { deriveSubscriptionOffer } from '@/lib/subscriptions/offer'
import { createCustomerSubscription } from '@/lib/subscriptions/create'

const rz = { subscriptions: { create: vi.fn(), cancel: vi.fn() } }

function offer(collectingAccount: 'platform' | 'own', tenantId: string | null = 't1') {
  return {
    product: { id: 'p1', name: 'Coffee', hsn_code: '0901' },
    variantId: null,
    subVariantId: null,
    interval: 'monthly',
    intervalLabel: 'Monthly',
    quantity: 1,
    unitPrice: 450,
    unitPriceExGst: 381.36,
    gstRate: 18,
    shipping: 0,
    amount: 450,
    amountPaise: 45000,
    isDigital: false,
    address: { id: 'a1', full_name: 'A', postal_code: '600001', state: 'TN', country: 'India' },
    collectingAccount,
    merchantLabel: 'Jeffi',
    tenantId,
    rzp: { instance: rz, creds: { key_id: 'rzp_test_k', key_secret: 's', isOwn: collectingAccount === 'own' } },
  } as any
}

const input = { userId: 'u1', productId: 'p1', interval: 'monthly', quantity: 1, addressId: 'a1' }

describe('createCustomerSubscription', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(queryOne).mockResolvedValue({ email: 'u@e.com', phone: '9999999999', first_name: 'A', last_name: 'B' })
    vi.mocked(query).mockResolvedValue({ rows: [], rowCount: 1 } as any)
    rz.subscriptions.create.mockResolvedValue({ id: 'sub_1' })
    cpQuery.mockResolvedValue({ rows: [{ linked_account_id: 'acc_1' }] })
  })

  it('platform-collect: inserts the local row and a control-plane index row', async () => {
    vi.mocked(deriveSubscriptionOffer).mockResolvedValue(offer('platform'))
    const r = await createCustomerSubscription(input)

    expect(r).toMatchObject({ razorpaySubscriptionId: 'sub_1', keyId: 'rzp_test_k', amount: 450 })
    const createArgs = rz.subscriptions.create.mock.calls[0][0]
    expect(createArgs).toMatchObject({ plan_id: 'plan_1', total_count: 120, quantity: 1 })
    expect(createArgs.notes.local_subscription_id).toBe(r.localId)

    const insert = vi.mocked(query).mock.calls.find(c => String(c[0]).includes('INSERT INTO subscriptions'))!
    expect(insert[1]).toContain('sub_1')
    expect(insert[1]).toContain('acc_1') // linked account snapshot
    expect(insert[1]).toContain('v1') // consent version

    const idx = cpQuery.mock.calls.find(c => String(c[0]).includes('razorpay_subscription_index'))
    expect(idx?.[1]).toEqual(['sub_1', 't1', 'p1', r.localId])
  })

  it('flagship store indexes under the NIL tenant id', async () => {
    vi.mocked(deriveSubscriptionOffer).mockResolvedValue(offer('platform', null))
    await createCustomerSubscription(input)
    const idx = cpQuery.mock.calls.find(c => String(c[0]).includes('razorpay_subscription_index'))
    expect(idx?.[1][1]).toBe('00000000-0000-0000-0000-000000000000')
  })

  it('own-key: no index row and no linked account', async () => {
    vi.mocked(deriveSubscriptionOffer).mockResolvedValue(offer('own'))
    await createCustomerSubscription(input)
    expect(cpQuery).not.toHaveBeenCalled()
  })

  it('cancels the Razorpay sub and the local row when indexing fails', async () => {
    vi.mocked(deriveSubscriptionOffer).mockResolvedValue(offer('platform'))
    cpQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('razorpay_subscription_index')) throw new Error('cp down')
      return { rows: [{ linked_account_id: null }] }
    })
    rz.subscriptions.cancel.mockResolvedValue({})
    await expect(createCustomerSubscription(input)).rejects.toThrow('cp down')
    expect(rz.subscriptions.cancel).toHaveBeenCalledWith('sub_1', false)
    expect(vi.mocked(query).mock.calls.some(c => String(c[0]).includes("status = 'cancelled'"))).toBe(true)
  })
})
