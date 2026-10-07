import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAnyUser: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ queryOne: vi.fn() }))
vi.mock('@/lib/subscriptions/offer', () => ({ deriveSubscriptionOffer: vi.fn() }))
vi.mock('@/lib/subscriptions/create', () => ({ createCustomerSubscription: vi.fn() }))
vi.mock('@/lib/subscriptions/verify', () => ({ verifySubscriptionPayment: vi.fn() }))
vi.mock('@/lib/subscriptions/customer', () => ({ loadCustomerSubscriptions: vi.fn(async () => [{ id: 'L1' }]) }))
vi.mock('@/lib/subscriptions/service', async () => {
  const { SubscriptionError } = await import('@/lib/subscriptions/types')
  return {
    SubscriptionError,
    cancelSubscription: vi.fn(),
    pauseSubscription: vi.fn(),
    resumeSubscription: vi.fn(),
    changeSubscriptionAddress: vi.fn(),
  }
})

import { authenticateAnyUser } from '@/lib/auth/jwt'
import { queryOne } from '@/lib/shared/db'
import { deriveSubscriptionOffer } from '@/lib/subscriptions/offer'
import { createCustomerSubscription } from '@/lib/subscriptions/create'
import { cancelSubscription } from '@/lib/subscriptions/service'
import { SubscriptionError } from '@/lib/subscriptions/types'
import { POST as quote } from '@/app/api/(public)/subscriptions/quote/route'
import { POST as create } from '@/app/api/(public)/subscriptions/route'
import { POST as action } from '@/app/api/(public)/user/subscriptions/[id]/route'

const PID = '11111111-1111-4111-8111-111111111111'
const AID = '22222222-2222-4222-8222-222222222222'
const SID = '33333333-3333-4333-8333-333333333333'
const post = (body: unknown) => new Request('http://localhost/x', { method: 'POST', body: JSON.stringify(body) }) as any

describe('customer subscription routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAnyUser).mockResolvedValue({ userId: 'u1', email: 'u@e.com' })
  })

  it('quote 401s anonymous callers', async () => {
    vi.mocked(authenticateAnyUser).mockResolvedValue(null)
    expect((await quote(post({ productId: PID, interval: 'monthly', quantity: 1 }))).status).toBe(401)
  })

  it('quote maps SubscriptionError to its status', async () => {
    vi.mocked(deriveSubscriptionOffer).mockRejectedValue(new SubscriptionError('Subscriptions are limited to ₹15,000 per cycle'))
    const res = await quote(post({ productId: PID, interval: 'monthly', quantity: 1 }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('₹15,000')
  })

  it('quote returns the one-time comparison and term', async () => {
    vi.mocked(deriveSubscriptionOffer).mockResolvedValue({
      product: { name: 'Coffee' },
      unitPrice: 450,
      intervalPrices: { monthly: 450, yearly: 4800 },
      oneTimePrice: 500,
      totalCycles: 12,
      minCycles: 3,
      quantity: 1,
      shipping: 0,
      amount: 450,
    } as any)
    const res = await quote(post({ productId: PID, interval: 'monthly', quantity: 1, unitPrice: 1 }))
    expect(await res.json()).toMatchObject({
      unitPrice: 450,
      intervalPrices: { monthly: 450, yearly: 4800 },
      oneTimePrice: 500,
      totalCycles: 12,
      minCycles: 3,
    })
  })

  it('create requires explicit consent', async () => {
    const res = await create(post({ productId: PID, interval: 'monthly', quantity: 1, addressId: AID }))
    expect(res.status).toBe(400)
    expect(createCustomerSubscription).not.toHaveBeenCalled()
  })

  it('create ignores any client-supplied price', async () => {
    vi.mocked(createCustomerSubscription).mockResolvedValue({ localId: 'L1' } as any)
    await create(post({ productId: PID, interval: 'monthly', quantity: 1, addressId: AID, consent: true, amount: 1 }))
    expect(createCustomerSubscription).toHaveBeenCalledWith(expect.not.objectContaining({ amount: expect.anything() }))
  })

  it('self-service action 404s a subscription the caller does not own', async () => {
    vi.mocked(queryOne).mockResolvedValue(null)
    const res = await action(post({ action: 'cancel' }), { params: Promise.resolve({ id: SID }) })
    expect(res.status).toBe(404)
    expect(cancelSubscription).not.toHaveBeenCalled()
  })

  it('customer cancel is always at cycle end', async () => {
    vi.mocked(queryOne).mockResolvedValue({ id: SID })
    const res = await action(post({ action: 'cancel' }), { params: Promise.resolve({ id: SID }) })
    expect(res.status).toBe(200)
    expect(cancelSubscription).toHaveBeenCalledWith(SID, { atCycleEnd: true, actor: 'customer' })
    expect((await res.json()).subscription).toEqual({ id: 'L1' })
  })
})
