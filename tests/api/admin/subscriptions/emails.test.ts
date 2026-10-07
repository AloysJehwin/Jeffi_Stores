import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/shared/db', () => ({ queryOne: vi.fn() }))
vi.mock('@/lib/shared/customer-links', () => ({ customerBaseUrl: vi.fn().mockResolvedValue('https://shop.test') }))
vi.mock('@/lib/email/shared', () => ({
  sendAuditedMail: vi.fn().mockResolvedValue({}),
  mailShell: vi.fn((o: { content: string }) => o.content),
  escapeHtml: (s: string) => s,
  customerMailFromAsync: vi.fn().mockResolvedValue('shop@test'),
  currentBrandNameAsync: vi.fn().mockResolvedValue('Shop'),
  storeContactLine: vi.fn().mockResolvedValue(''),
  storeAddressLine: vi.fn().mockResolvedValue(''),
}))

import {
  sendSubscriptionStartedEmail,
  sendSubscriptionPaymentFailedEmail,
  sendSubscriptionCancelledEmail,
} from '@/lib/email/subscription'
import { queryOne } from '@/lib/shared/db'
import { sendAuditedMail } from '@/lib/email/shared'

const mockOne = queryOne as ReturnType<typeof vi.fn>
const mockSend = sendAuditedMail as ReturnType<typeof vi.fn>

const sub = {
  id: 's1',
  user_id: 'u1',
  status: 'active',
  interval: 'monthly',
  quantity: '2',
  unit_price_paise: '50000',
  shipping_paise: '4000',
  current_end: '2026-11-07T00:00:00Z',
  access_expires_at: null,
  cancel_at_cycle_end: false,
  is_digital: false,
  email: 'a@x.in',
  first_name: 'Asha',
  product_name: 'Coffee',
}

describe('subscription emails', () => {
  beforeEach(() => vi.clearAllMocks())

  it('sends the started email with the per-cycle amount and manage link', async () => {
    mockOne.mockResolvedValue(sub)
    await sendSubscriptionStartedEmail('s1')
    const arg = mockSend.mock.calls[0][0]
    expect(arg).toMatchObject({ to: 'a@x.in', templateName: 'subscription_started', entityId: 's1', userId: 'u1' })
    expect(arg.html).toContain('₹1,040.00')
    expect(arg.html).toContain('https://shop.test/account/subscriptions')
  })

  it('sends payment-failed and cancelled emails', async () => {
    mockOne.mockResolvedValue({ ...sub, status: 'cancelled' })
    await sendSubscriptionPaymentFailedEmail('s1')
    await sendSubscriptionCancelledEmail('s1')
    expect(mockSend.mock.calls.map(c => c[0].templateName)).toEqual([
      'subscription_payment_failed',
      'subscription_cancelled',
    ])
  })

  it('skips when the subscription or email is missing', async () => {
    mockOne.mockResolvedValue(null)
    await sendSubscriptionStartedEmail('s1')
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('never throws', async () => {
    mockOne.mockRejectedValue(new Error('db down'))
    await expect(sendSubscriptionCancelledEmail('s1')).resolves.toBeUndefined()
    mockOne.mockResolvedValue(sub)
    mockSend.mockRejectedValue(new Error('ses down'))
    await expect(sendSubscriptionStartedEmail('s1')).resolves.toBeUndefined()
  })
})
