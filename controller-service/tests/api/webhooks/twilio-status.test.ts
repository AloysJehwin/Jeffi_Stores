import { vi, describe, it, expect, beforeEach } from 'vitest'

const debitMessageCost = vi.hoisted(() => vi.fn())
const query = vi.hoisted(() => vi.fn())
const validateRequest = vi.hoisted(() => vi.fn(() => true))
vi.mock('twilio', () => ({ default: { validateRequest } }))
vi.mock('@/lib/shared/messaging/billing', () => ({ debitMessageCost }))
vi.mock('@/lib/shared/db', () => ({ query }))
vi.mock('@/lib/shared/messaging/delivery-status', () => ({ applyDeliveryStatus: vi.fn() }))
vi.mock('@/lib/tenant-registry/host-resolution', () => ({
  lookupTenantContextById: vi.fn(async () => ({ tenantId: 't1' })),
}))
vi.mock('@/lib/tenancy/tenant-context', () => ({ runWithTenantContext: (_c: any, fn: any) => fn() }))

import { POST } from '@controller/app/api/(public)/webhooks/twilio/status/route'

function req(params: Record<string, string>, t = 't1') {
  const body = new URLSearchParams(params)
  return new Request(`https://x/api/webhooks/twilio/status?t=${t}`, {
    method: 'POST',
    headers: { 'x-twilio-signature': 'sig', 'content-type': 'application/x-www-form-urlencoded' },
    body,
  }) as any
}

beforeEach(() => {
  vi.clearAllMocks()
  validateRequest.mockReturnValue(true)
  process.env.TWILIO_AUTH_TOKEN = 'tok'
})

describe('twilio status webhook', () => {
  it('debits the exact USD→INR price once for a priced SMS callback', async () => {
    const res = await POST(req({ MessageSid: 'SM1', MessageStatus: 'delivered', Price: '-0.0832', From: '+1' }))
    expect(res.status).toBe(204)
    expect(debitMessageCost).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 't1', channel: 'sms', providerSid: 'SM1' })
    )
    expect(debitMessageCost.mock.calls[0][0].priceInr).toBeCloseTo(0.0832 * 88, 2)
  })

  it('does not debit when the callback carries no price', async () => {
    const res = await POST(req({ MessageSid: 'SM2', MessageStatus: 'sent', From: 'whatsapp:+1' }))
    expect(res.status).toBe(204)
    expect(debitMessageCost).not.toHaveBeenCalled()
  })

  it('rejects a bad signature', async () => {
    validateRequest.mockReturnValue(false)
    const res = await POST(req({ MessageSid: 'SM3', Price: '-0.01' }))
    expect(res.status).toBe(403)
  })
})
