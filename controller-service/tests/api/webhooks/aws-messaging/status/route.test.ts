import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const m = vi.hoisted(() => ({ verify: vi.fn(), confirm: vi.fn(), apply: vi.fn() }))
vi.mock('@controller/lib/shared/messaging/sns', () => ({ verifySns: m.verify, confirmSnsSubscription: m.confirm }))
vi.mock('@controller/lib/shared/messaging/delivery-status', () => ({ applyDeliveryStatus: m.apply }))
vi.mock('@/lib/tenant-registry/host-resolution', () => ({ lookupTenantContextById: vi.fn() }))
vi.mock('@/lib/tenancy/tenant-context', () => ({ runWithTenantContext: vi.fn() }))
vi.mock('@controller/lib/support/inbound', () => ({ handleInboundWhatsApp: vi.fn() }))
vi.mock('@/lib/support/agent', () => ({ onCustomerMessage: vi.fn() }))
vi.mock('@controller/lib/admin-agent/whatsapp', () => ({ routeAdminWhatsApp: vi.fn() }))
vi.mock('@controller/lib/messaging/inbound-number', () => ({ resolveInbound: vi.fn() }))

import { POST } from '@controller/app/api/(public)/webhooks/aws-messaging/status/route'

const req = (body: unknown) => new NextRequest('https://x.test/api/webhooks/aws-messaging/status', { method: 'POST', body: JSON.stringify(body) })

describe('POST /api/webhooks/aws-messaging/status', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    m.verify.mockResolvedValue(true)
  })

  it('403s a bad signature', async () => {
    m.verify.mockResolvedValue(false)
    expect((await POST(req({ Type: 'Notification', Message: '{}' }))).status).toBe(403)
    expect(m.apply).not.toHaveBeenCalled()
  })

  it('records a failed SMS delivery with the provider reason', async () => {
    const message = JSON.stringify({ eventType: 'TEXT_BLOCKED', messageId: 'sms-9', messageStatusDescription: 'Blocked by carrier' })
    const res = await POST(req({ Type: 'Notification', Message: message }))
    expect(res.status).toBe(204)
    expect(m.apply).toHaveBeenCalledWith({ providerSid: 'sms-9', status: 'failed', provider: 'aws', error: 'Blocked by carrier' })
  })

  it('ignores unrelated envelope types and unknown events', async () => {
    expect((await POST(req({ Type: 'UnsubscribeConfirmation' }))).status).toBe(204)
    expect((await POST(req({ Type: 'Notification', Message: JSON.stringify({ eventType: 'SOMETHING_ELSE' }) }))).status).toBe(204)
    expect(m.apply).not.toHaveBeenCalled()
  })
})
