import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const m = vi.hoisted(() => ({
  verify: vi.fn(),
  confirm: vi.fn(),
  send: vi.fn(),
  lookup: vi.fn(),
  runWith: vi.fn(),
  parseReply: vi.fn(),
  parseAlert: vi.fn(),
  upg: vi.fn(),
  inbound: vi.fn(),
  onCustomer: vi.fn(),
}))

vi.mock('@aws-sdk/client-s3', () => ({ S3Client: class { send = m.send }, GetObjectCommand: class { constructor(public input: unknown) {} } }))
vi.mock('@controller/lib/shared/messaging/sns', () => ({ verifySns: m.verify, confirmSnsSubscription: m.confirm }))
vi.mock('@/lib/tenant-registry/host-resolution', () => ({ lookupTenantContextBySlug: m.lookup }))
vi.mock('@/lib/tenancy/tenant-context', () => ({ runWithTenantContext: m.runWith }))
vi.mock('@/lib/replies/context', () => ({ parseReplyAddress: m.parseReply }))
vi.mock('@/lib/payments/upi/alert-parse', () => ({ parseAlertAddress: m.parseAlert, PLATFORM_ALERT_SLUG: 'platform' }))
vi.mock('@/lib/payments/upi/alerts', () => ({ handleUpgAlertEmail: m.upg }))
vi.mock('@controller/lib/support/email-inbound', () => ({ handleInboundEmail: m.inbound }))
vi.mock('@/lib/support/agent', () => ({ onCustomerMessage: m.onCustomer }))

import { POST } from '@controller/app/api/(public)/webhooks/ses-inbound/route'

const RAW = 'From: Priya <priya@x.in>\r\nTo: reply@r.test\r\nSubject: Re: order\r\nMessage-ID: <abc@x.in>\r\nIn-Reply-To: <ref@x.in>\r\n\r\nThanks, got it.\r\n'
const note = (over: Record<string, unknown> = {}) => ({
  notificationType: 'Received',
  mail: { messageId: 'ses-1', destination: ['reply+acme.tok@r.test'] },
  receipt: { recipients: ['reply+acme.tok@r.test'], dmarcVerdict: { status: 'PASS' }, action: { type: 'S3', bucketName: 'b', objectKey: 'k' }, ...over },
})
const env = (n: unknown, over: Record<string, unknown> = {}) => ({ Type: 'Notification', Message: JSON.stringify(n), ...over })
const req = (body: unknown) => new NextRequest('https://x.test/api/webhooks/ses-inbound', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) })

describe('POST /api/webhooks/ses-inbound', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    m.verify.mockResolvedValue(true)
    m.confirm.mockResolvedValue(true)
    m.parseAlert.mockReturnValue(null)
    m.parseReply.mockReturnValue({ slug: 'acme', token: 'tok' })
    m.lookup.mockResolvedValue({ tenantId: 't-1' })
    m.runWith.mockImplementation((_c: unknown, fn: () => unknown) => fn())
    m.send.mockResolvedValue({ Body: { transformToByteArray: async () => new Uint8Array(Buffer.from(RAW)) } })
    m.inbound.mockResolvedValue({ session: { id: 's-1' }, message: { id: 'm-1' } })
  })

  it('400s malformed JSON and 403s a bad signature', async () => {
    expect((await POST(req('{nope'))).status).toBe(400)
    m.verify.mockResolvedValue(false)
    expect((await POST(req(env(note())))).status).toBe(403)
    expect(m.send).not.toHaveBeenCalled()
  })

  it('confirms an SNS subscription, 502 when confirmation fails', async () => {
    expect((await POST(req({ Type: 'SubscriptionConfirmation' }))).status).toBe(204)
    m.confirm.mockResolvedValue(false)
    expect((await POST(req({ Type: 'SubscriptionConfirmation' }))).status).toBe(502)
  })

  it('drops spam-verdict mail and unknown reply addresses', async () => {
    expect((await POST(req(env(note({ spamVerdict: { status: 'FAIL' } }))))).status).toBe(204)
    m.parseReply.mockReturnValue(null)
    expect((await POST(req(env(note())))).status).toBe(204)
    expect(m.send).not.toHaveBeenCalled()
  })

  it('joins a customer reply to the support chat in the store context', async () => {
    const res = await POST(req(env(note())))
    expect(res.status).toBe(204)
    expect(m.lookup).toHaveBeenCalledWith('acme')
    expect(m.inbound).toHaveBeenCalledWith(expect.objectContaining({ sesId: 'ses-1', messageId: 'abc@x.in', from: 'priya@x.in', fromName: 'Priya', token: 'tok', subject: 'Re: order' }))
    expect(m.onCustomer).toHaveBeenCalledWith({ id: 's-1' }, { id: 'm-1' }, expect.objectContaining({ token: 'tok', email: 'priya@x.in', verified: true, emailRefs: ['<ref@x.in>'] }))
  })

  it('does not act on out-of-office mail', async () => {
    m.send.mockResolvedValue({ Body: { transformToByteArray: async () => new Uint8Array(Buffer.from(RAW.replace('Subject', 'Auto-Submitted: auto-replied\r\nSubject'))) } })
    expect((await POST(req(env(note())))).status).toBe(204)
    expect(m.inbound).not.toHaveBeenCalled()
  })

  it('hands a forwarded bank alert to the UPI alert handler', async () => {
    m.parseAlert.mockReturnValue({ slug: 'platform' })
    const res = await POST(req(env(note())))
    expect(res.status).toBe(204)
    expect(m.upg).toHaveBeenCalledWith({ raw: expect.any(Buffer), sesMessageId: 'ses-1' })
    expect(m.inbound).not.toHaveBeenCalled()
  })

  it('503s so SNS retries when fetching or handling fails', async () => {
    m.send.mockRejectedValue(new Error('s3 down'))
    expect((await POST(req(env(note())))).status).toBe(503)
    m.parseAlert.mockReturnValue({ slug: 'platform' })
    expect((await POST(req(env(note())))).status).toBe(503)
  })
})
