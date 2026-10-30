import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/shared/db', () => ({ queryOne: vi.fn() }))
const rzp = { subscriptions: { cancel: vi.fn(async () => ({})), pause: vi.fn(async () => ({})) } }
vi.mock('@/lib/payments/razorpay', () => ({
  getRazorpayInstance: () => rzp,
  getRazorpayInstanceFor: vi.fn(),
}))
vi.mock('@/lib/tenancy/tenant-context', () => ({ resolveTenantId: vi.fn() }))
vi.mock('@/lib/orders/order-commit', () => ({ loadAddress: vi.fn() }))
vi.mock('@/lib/subscriptions/cycle', () => ({ applySubscriptionState: vi.fn(async () => ({ row: {} })) }))
vi.mock('@/lib/subscriptions/offer', () => ({ assertIndianAddress: vi.fn(), snapshotAddress: vi.fn() }))

import { queryOne } from '@/lib/shared/db'
import { assertCommitmentMet, cancelSubscription, pauseSubscription } from '@/lib/subscriptions/service'
import { SubscriptionError } from '@/lib/subscriptions/types'

const sub = (o: Record<string, unknown> = {}) => ({
  id: 's1',
  status: 'active',
  razorpay_subscription_id: 'sub_1',
  source: 'razorpay',
  collecting_account: 'platform',
  min_cycles: 6,
  current_cycle: 2,
  ...o,
})

describe('minimum commitment', () => {
  beforeEach(() => vi.clearAllMocks())

  it('blocks the customer until the minimum is paid, with a clear message', () => {
    expect(() => assertCommitmentMet(sub() as any, 'customer')).toThrow(
      'This subscription has a minimum of 6 charges; you can cancel after charge 6 (2 paid so far).'
    )
    try {
      assertCommitmentMet(sub() as any, 'customer')
    } catch (e) {
      expect(e).toBeInstanceOf(SubscriptionError)
      expect((e as SubscriptionError).status).toBe(409)
    }
  })

  it('allows the customer once met, and always allows admins', () => {
    expect(() => assertCommitmentMet(sub({ current_cycle: 6 }) as any, 'customer')).not.toThrow()
    expect(() => assertCommitmentMet(sub({ min_cycles: null }) as any, 'customer')).not.toThrow()
    expect(() => assertCommitmentMet(sub() as any, 'admin')).not.toThrow()
  })

  it('customer cancel and pause are refused before Razorpay is called', async () => {
    vi.mocked(queryOne).mockResolvedValue(sub() as any)
    await expect(cancelSubscription('s1', { atCycleEnd: true, actor: 'customer' })).rejects.toThrow('minimum of 6')
    await expect(pauseSubscription('s1', 'customer')).rejects.toThrow('minimum of 6')
    expect(rzp.subscriptions.cancel).not.toHaveBeenCalled()
    expect(rzp.subscriptions.pause).not.toHaveBeenCalled()
  })

  it('admin cancel and pause bypass the commitment', async () => {
    vi.mocked(queryOne).mockResolvedValue(sub() as any)
    await cancelSubscription('s1', { atCycleEnd: false, actor: 'admin' })
    await pauseSubscription('s1', 'admin')
    expect(rzp.subscriptions.cancel).toHaveBeenCalled()
    expect(rzp.subscriptions.pause).toHaveBeenCalled()
  })
})
