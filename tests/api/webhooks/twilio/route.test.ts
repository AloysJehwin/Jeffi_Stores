import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

const validateRequest = vi.hoisted(() => vi.fn())
vi.mock('twilio', () => ({ default: { validateRequest } }))
vi.mock('@/lib/shared/db', () => ({ query: vi.fn(), queryOne: vi.fn(), queryMany: vi.fn(), withTransaction: vi.fn() }))
vi.mock('@/lib/shared/message-log', () => ({ logMessage: vi.fn() }))
vi.mock('@/lib/tenant-registry/host-resolution', () => ({ lookupTenantContextById: vi.fn() }))
vi.mock('@/lib/tenancy/tenant-context', () => ({ runWithTenantContext: vi.fn() }))
vi.mock('@/lib/support/inbound', () => ({ handleInboundWhatsApp: vi.fn() }))
vi.mock('@/lib/support/agent', () => ({ onCustomerMessage: vi.fn() }))

import { POST } from '@controller/app/api/(public)/webhooks/twilio/route'
import { query, queryOne } from '@/lib/shared/db'
import { logMessage } from '@/lib/shared/message-log'
import { lookupTenantContextById } from '@/lib/tenant-registry/host-resolution'
import { runWithTenantContext } from '@/lib/tenancy/tenant-context'
import { handleInboundWhatsApp } from '@/lib/support/inbound'
import { onCustomerMessage } from '@/lib/support/agent'

const mockQuery = vi.mocked(query)
const mockQueryOne = vi.mocked(queryOne)
const mockLog = vi.mocked(logMessage)
const mockLookup = vi.mocked(lookupTenantContextById)
const mockRunWith = vi.mocked(runWithTenantContext)
const mockInbound = vi.mocked(handleInboundWhatsApp)
const mockOnCustomer = vi.mocked(onCustomerMessage)

const WA_FROM = 'whatsapp:+919876543210'
const WA_TO = 'whatsapp:+18722179910'
const SESSION = { id: 'sess-1', handler: 'ai' } as any
const MESSAGE = { id: 'm1', sender: 'customer', text: 'hi' } as any

function makeReq(fields: Record<string, string>, query = '') {
  return new NextRequest(`http://localhost/api/webhooks/twilio${query}`, {
    method: 'POST',
    headers: { 'x-twilio-signature': 'sig' },
    body: new URLSearchParams(fields),
  })
}

async function expectEmptyTwiml(res: Response) {
  expect(res.status).toBe(200)
  expect(res.headers.get('content-type')).toContain('text/xml')
  expect(await res.text()).toBe('<Response></Response>')
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv('TWILIO_AUTH_TOKEN', 'tok')
  vi.stubEnv('TWILIO_WEBHOOK_URL', '')
  vi.stubEnv('PUBLIC_WEBHOOK_BASE_URL', '')
  vi.stubEnv('APP_URL', '')
  validateRequest.mockReturnValue(true)
  mockQuery.mockResolvedValue({ rows: [] } as any)
  mockRunWith.mockImplementation((_ctx, fn) => fn())
  mockInbound.mockResolvedValue({ session: SESSION, message: MESSAGE })
  mockOnCustomer.mockResolvedValue(undefined)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('POST /api/webhooks/twilio — guard rails', () => {
  it('500 when TWILIO_AUTH_TOKEN is unset', async () => {
    vi.stubEnv('TWILIO_AUTH_TOKEN', '')
    const res = await POST(makeReq({ From: WA_FROM, Body: 'hi' }))
    expect(res.status).toBe(500)
    expect(mockInbound).not.toHaveBeenCalled()
  })

  it('403 on a bad signature, checked against the configured public URL', async () => {
    validateRequest.mockReturnValue(false)
    const fields = { From: WA_FROM, To: WA_TO, Body: 'hi', MessageSid: 'SM1' }
    const res = await POST(makeReq(fields))
    expect(res.status).toBe(403)
    expect(validateRequest).toHaveBeenCalledWith('tok', 'sig', 'https://jeffistores.in/api/webhooks/twilio', fields)
    expect(mockInbound).not.toHaveBeenCalled()
  })

  it('signs against TWILIO_WEBHOOK_URL when set', async () => {
    vi.stubEnv('TWILIO_WEBHOOK_URL', 'https://example.test/api/webhooks/twilio')
    await POST(makeReq({ From: WA_FROM, Body: 'hi' }))
    expect(validateRequest).toHaveBeenCalledWith('tok', 'sig', 'https://example.test/api/webhooks/twilio', expect.any(Object))
  })

  it("a store's number (?t=) is signed against the public base URL and runs in that store", async () => {
    vi.stubEnv('PUBLIC_WEBHOOK_BASE_URL', 'https://hooks.example.test/')
    const ctx = { tenantId: 'ten-1' } as any
    mockLookup.mockResolvedValue(ctx)
    const res = await POST(makeReq({ From: WA_FROM, To: WA_TO, Body: 'hi', MessageSid: 'SM1' }, '?t=ten-1'))
    await expectEmptyTwiml(res)
    expect(validateRequest).toHaveBeenCalledWith('tok', 'sig', 'https://hooks.example.test/api/webhooks/twilio?t=ten-1', expect.any(Object))
    expect(mockLookup).toHaveBeenCalledWith('ten-1')
    expect(mockRunWith).toHaveBeenCalledWith(ctx, expect.any(Function))
    expect(mockInbound).toHaveBeenCalled()
  })

  it('an unknown store is acknowledged and dropped', async () => {
    mockLookup.mockResolvedValue(null)
    const res = await POST(makeReq({ From: WA_FROM, Body: 'hi' }, '?t=ghost'))
    await expectEmptyTwiml(res)
    expect(mockInbound).not.toHaveBeenCalled()
    expect(mockRunWith).not.toHaveBeenCalled()
  })

  it('a failing store lookup is treated as unknown', async () => {
    mockLookup.mockRejectedValue(new Error('control plane down'))
    const res = await POST(makeReq({ From: WA_FROM, Body: 'hi' }, '?t=ten-1'))
    await expectEmptyTwiml(res)
    expect(mockInbound).not.toHaveBeenCalled()
  })

  it('answers empty TwiML even when handling throws', async () => {
    mockInbound.mockRejectedValue(new Error('db boom'))
    const res = await POST(makeReq({ From: WA_FROM, Body: 'hi' }))
    await expectEmptyTwiml(res)
  })
})

describe('POST /api/webhooks/twilio — WhatsApp', () => {
  it('hands the message to the support chat and the assistant', async () => {
    const res = await POST(makeReq({ From: WA_FROM, To: WA_TO, Body: 'my order is late', MessageSid: 'SM1', ProfileName: 'Ravi' }))
    await expectEmptyTwiml(res)
    expect(mockInbound).toHaveBeenCalledWith({ provider: 'twilio', providerSid: 'SM1', from: WA_FROM, to: WA_TO, text: 'my order is late', profileName: 'Ravi', media: [] })
    expect(mockOnCustomer).toHaveBeenCalledWith(SESSION, MESSAGE, { phone: WA_FROM, repliedToSid: null })
    expect(mockRunWith).not.toHaveBeenCalled()
    expect(mockLog).not.toHaveBeenCalled()
  })

  it('collects media, skipping slots without a URL', async () => {
    await POST(
      makeReq({
        From: WA_FROM,
        To: WA_TO,
        MessageSid: 'SM2',
        NumMedia: '3',
        MediaUrl0: 'https://api.twilio.com/m0',
        MediaContentType0: 'image/jpeg',
        MediaUrl2: 'https://api.twilio.com/m2',
      })
    )
    expect(mockInbound).toHaveBeenCalledWith(
      expect.objectContaining({
        text: '',
        profileName: null,
        media: [
          { ref: 'https://api.twilio.com/m0', mime: 'image/jpeg' },
          { ref: 'https://api.twilio.com/m2', mime: '' },
        ],
      })
    )
  })

  it('reads at most 10 media items', async () => {
    const fields: Record<string, string> = { From: WA_FROM, NumMedia: '12' }
    for (let i = 0; i < 12; i++) fields[`MediaUrl${i}`] = `https://api.twilio.com/m${i}`
    await POST(makeReq(fields))
    expect(mockInbound.mock.calls[0][0].media).toHaveLength(10)
  })

  it('no assistant turn when the inbound handler consumed it (duplicate or STOP)', async () => {
    mockInbound.mockResolvedValue(null)
    const res = await POST(makeReq({ From: WA_FROM, Body: 'STOP', MessageSid: 'SM1' }))
    await expectEmptyTwiml(res)
    expect(mockOnCustomer).not.toHaveBeenCalled()
  })
})

describe('POST /api/webhooks/twilio — SMS', () => {
  it('logs the inbound SMS against the matched customer and opens no chat', async () => {
    mockQueryOne.mockResolvedValue({ id: 'u1' })
    const res = await POST(makeReq({ From: '+91 98765-43210', To: '+18722179910', Body: 'hello', MessageSid: 'SM1' }))
    await expectEmptyTwiml(res)
    expect(mockQueryOne).toHaveBeenCalledWith(expect.stringContaining('FROM users'), ['9876543210'])
    expect(mockLog).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'sms', direction: 'inbound', kind: 'inbound', status: 'received', providerSid: 'SM1', userId: 'u1', body: 'hello' })
    )
    expect(mockInbound).not.toHaveBeenCalled()
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('STOP records the opt-out', async () => {
    mockQueryOne.mockResolvedValue({ id: 'u1' })
    await POST(makeReq({ From: '+919876543210', Body: 'STOP' }))
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('marketing_opt_out = TRUE'), ['u1'])
  })

  it('start (any case, padded) clears the opt-out', async () => {
    mockQueryOne.mockResolvedValue({ id: 'u1' })
    await POST(makeReq({ From: '+919876543210', Body: '  start ' }))
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('marketing_opt_out = FALSE'), ['u1'])
  })

  it('STOP from an unknown number changes nothing', async () => {
    mockQueryOne.mockResolvedValue(null)
    await POST(makeReq({ From: '+919876543210', Body: 'STOP' }))
    expect(mockQuery).not.toHaveBeenCalled()
    expect(mockLog).toHaveBeenCalledWith(expect.objectContaining({ userId: null }))
  })

  it('missing fields fall back to defaults without a user lookup', async () => {
    const res = await POST(makeReq({}))
    await expectEmptyTwiml(res)
    expect(mockQueryOne).not.toHaveBeenCalled()
    expect(mockLog).toHaveBeenCalledWith(expect.objectContaining({ channel: 'sms', from: '', to: '', body: '', providerSid: null, userId: null }))
  })
})
