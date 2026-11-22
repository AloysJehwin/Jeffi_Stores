import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/payments/rzp-downtime', () => ({ recordDowntime: vi.fn(() => Promise.resolve()) }))

import { onDowntime } from '@/lib/payments/razorpay-events/downtime'
import { recordDowntime } from '@/lib/payments/rzp-downtime'

const store = { tenantId: 't1', slug: 'acme', ctx: null }
const ctx = (over: Record<string, unknown> = {}) => ({ source: 'platform', store: null, eventId: 'e', accountId: null, ...over }) as any

beforeEach(() => {
  vi.clearAllMocks()
})

describe('onDowntime', () => {
  it('records for the platform source', async () => {
    await onDowntime('payment.downtime.started', { id: 'd' }, ctx({ source: 'platform' }))
    expect(recordDowntime).toHaveBeenCalledWith('payment.downtime.started', { id: 'd' }, 'platform')
  })

  it("records with the store slug for an own-account source", async () => {
    await onDowntime('payment.downtime.resolved', { id: 'd' }, ctx({ source: 'own', store }))
    expect(recordDowntime).toHaveBeenCalledWith('payment.downtime.resolved', { id: 'd' }, 'acme')
  })

  it("falls back to 'own' when an own source has no slug", async () => {
    await onDowntime('payment.downtime.updated', { id: 'd' }, ctx({ source: 'own', store: null }))
    expect(recordDowntime).toHaveBeenCalledWith('payment.downtime.updated', { id: 'd' }, 'own')
  })

  it('swallows a recordDowntime failure', async () => {
    vi.mocked(recordDowntime).mockRejectedValue(new Error('db'))
    await expect(onDowntime('payment.downtime.started', { id: 'd' }, ctx())).resolves.toBeUndefined()
  })
})
