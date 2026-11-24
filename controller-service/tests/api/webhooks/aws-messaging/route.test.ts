import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const m = vi.hoisted(() => ({
  verify: vi.fn(),
  confirm: vi.fn(),
  apply: vi.fn(),
  lookup: vi.fn(),
  runWith: vi.fn(),
  inbound: vi.fn(),
  onCustomer: vi.fn(),
  adminRoute: vi.fn(),
  resolveInbound: vi.fn(),
  outreach: vi.fn(),
}))

vi.mock('@controller/lib/shared/messaging/sns', () => ({ verifySns: m.verify, confirmSnsSubscription: m.confirm }))
vi.mock('@controller/lib/shared/messaging/delivery-status', () => ({ applyDeliveryStatus: m.apply }))
vi.mock('@/lib/tenant-registry/host-resolution', () => ({ lookupTenantContextById: m.lookup }))
vi.mock('@/lib/tenancy/tenant-context', () => ({ runWithTenantContext: m.runWith }))
vi.mock('@controller/lib/support/inbound', () => ({ handleInboundWhatsApp: m.inbound }))
vi.mock('@/lib/support/agent', () => ({ onCustomerMessage: m.onCustomer }))
vi.mock('@controller/lib/admin-agent/whatsapp', () => ({ routeAdminWhatsApp: m.adminRoute }))
vi.mock('@controller/lib/messaging/inbound-number', () => ({ resolveInbound: m.resolveInbound }))
vi.mock('@controller/lib/outreach/inbound', () => ({ routeOutreachWhatsApp: m.outreach }))

import { POST } from '@controller/app/api/(public)/webhooks/aws-messaging/route'
import { POST as STATUS_POST } from '@controller/app/api/(public)/webhooks/aws-messaging/status/route'

const env = (message: unknown, over: Record<string, unknown> = {}) => ({ Type: 'Notification', Message: typeof message === 'string' ? message : JSON.stringify(message), ...over })
const req = (body: unknown, q = '') => new NextRequest(`https://x.test/api/webhooks/aws-messaging${q}`, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) })
const waEvent = (value: Record<string, unknown>) => ({ whatsAppWebhookEntry: JSON.stringify({ id: 'waba', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { display_phone_number: '18722704479' }, ...value } }] }) })
const TEXT_MSG = { id: 'wamid.1', from: '919876543210', type: 'text', text: { body: 'hello' }, timestamp: '1' }

describe('POST /api/webhooks/aws-messaging', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    m.verify.mockResolvedValue(true)
    m.confirm.mockResolvedValue(true)
    m.runWith.mockImplementation((_ctx: unknown, fn: () => unknown) => fn())
    m.resolveInbound.mockResolvedValue({ tenantId: null, audience: 'customer', separateAdminNumber: false })
    m.adminRoute.mockResolvedValue(false)
    m.outreach.mockResolvedValue(false)
    m.inbound.mockResolvedValue({ session: { id: 's-1' }, message: { id: 'm-1' } })
  })

  it('400s malformed JSON and 403s a bad signature', async () => {
    expect((await POST(req('{nope'))).status).toBe(400)
    m.verify.mockResolvedValue(false)
    expect((await POST(req(env({})))).status).toBe(403)
    expect(m.apply).not.toHaveBeenCalled()
  })

  it('confirms an SNS subscription, 502 when confirmation fails', async () => {
    expect((await POST(req({ Type: 'SubscriptionConfirmation', SubscribeURL: 'u' }))).status).toBe(204)
    expect(m.confirm).toHaveBeenCalled()
    m.confirm.mockResolvedValue(false)
    expect((await POST(req({ Type: 'SubscriptionConfirmation' }))).status).toBe(502)
  })

  it('applies an SMS delivery status in the hinted tenant context', async () => {
    const ctx = { tenantId: 't-1' }
    m.lookup.mockResolvedValue(ctx)
    const res = await POST(req(env({ eventType: 'TEXT_DELIVERED', messageId: 'sms-1' }), '?t=t-1'))
    expect(res.status).toBe(204)
    expect(m.runWith).toHaveBeenCalledWith(ctx, expect.any(Function))
    expect(m.apply).toHaveBeenCalledWith({ providerSid: 'sms-1', status: 'delivered', provider: 'aws', error: null })
  })

  it('204s an unknown ?t= tenant without handling the event', async () => {
    m.lookup.mockResolvedValue(null)
    expect((await POST(req(env({ eventType: 'TEXT_DELIVERED', messageId: 'sms-1' }), '?t=ghost'))).status).toBe(204)
    expect(m.apply).not.toHaveBeenCalled()
  })

  it('applies WhatsApp statuses and routes an inbound text to support chat', async () => {
    const event = waEvent({ statuses: [{ id: 'wamid.0', status: 'read' }], messages: [TEXT_MSG], contacts: [{ wa_id: '919876543210', profile: { name: 'Priya' } }] })
    const res = await POST(req(env(event)))
    expect(res.status).toBe(204)
    expect(m.apply).toHaveBeenCalledWith({ providerSid: 'wamid.0', status: 'read', provider: 'aws', error: null })
    expect(m.inbound).toHaveBeenCalledWith(expect.objectContaining({ provider: 'aws', providerSid: 'wamid.1', from: '+919876543210', to: '+18722704479', text: 'hello', profileName: 'Priya' }))
    expect(m.onCustomer).toHaveBeenCalledWith({ id: 's-1' }, { id: 'm-1' }, expect.objectContaining({ phone: '919876543210' }))
  })

  it('sends messages to the admin agent first and stops when it handles them', async () => {
    m.adminRoute.mockResolvedValue(true)
    await POST(req(env(waEvent({ messages: [TEXT_MSG] }))))
    expect(m.adminRoute).toHaveBeenCalled()
    expect(m.inbound).not.toHaveBeenCalled()
  })

  it('an active outreach contact on the flagship number is handled there, before the admin agent and the shopper bot', async () => {
    m.outreach.mockResolvedValue(true)
    await POST(req(env(waEvent({ messages: [TEXT_MSG] }))))
    expect(m.outreach).toHaveBeenCalledWith({ from: '+919876543210', text: 'hello', providerMessageId: 'wamid.1', hasMedia: false })
    expect(m.adminRoute).not.toHaveBeenCalled()
    expect(m.inbound).not.toHaveBeenCalled()
    expect(m.onCustomer).not.toHaveBeenCalled()
  })

  it('a sender outreach does not know goes on to support chat', async () => {
    await POST(req(env(waEvent({ messages: [TEXT_MSG] }))))
    expect(m.outreach).toHaveBeenCalled()
    expect(m.inbound).toHaveBeenCalled()
  })

  it("never consults outreach for a store's number or the ecom number", async () => {
    m.lookup.mockResolvedValue({ tenantId: 't-1' })
    m.resolveInbound.mockResolvedValue({ tenantId: 't-1', audience: 'customer', separateAdminNumber: false })
    await POST(req(env(waEvent({ messages: [TEXT_MSG] }))))
    m.resolveInbound.mockResolvedValue({ tenantId: null, audience: 'ecom', separateAdminNumber: false })
    await POST(req(env(waEvent({ messages: [TEXT_MSG] }))))
    expect(m.outreach).not.toHaveBeenCalled()
    expect(m.inbound).toHaveBeenCalledTimes(2)
  })

  it('503s so SNS retries when handling throws', async () => {
    m.apply.mockRejectedValue(new Error('db down'))
    const res = await POST(req(env({ eventType: 'TEXT_DELIVERED', messageId: 'sms-1' })))
    expect(res.status).toBe(503)
  })

  it('the /status alias is the same handler', async () => {
    expect(STATUS_POST).toBe(POST)
  })
})
