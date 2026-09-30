import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const validateRequest = vi.hoisted(() => vi.fn())
vi.mock('twilio', () => ({
  default: { validateRequest },
}))

vi.mock('@/lib/shared/db', () => ({
  query: vi.fn().mockResolvedValue({ rows: [] }),
  queryOne: vi.fn(),
}))

vi.mock('@/lib/shared/message-log', () => ({
  logMessage: vi.fn(),
}))

vi.mock('@/lib/shared/activity', () => ({
  logActivity: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/shared/whatsapp', () => ({
  sendFreeTextWhatsApp: vi.fn().mockResolvedValue(true),
  sendSupportAckWhatsApp: vi.fn().mockResolvedValue(true),
}))

import { POST } from '@/app/api/webhooks/twilio/route'
import { query, queryOne } from '@/lib/shared/db'
import { logMessage } from '@/lib/shared/message-log'
import { logActivity } from '@/lib/shared/activity'
import { sendFreeTextWhatsApp, sendSupportAckWhatsApp } from '@/lib/shared/whatsapp'

const mockQuery = vi.mocked(query)
const mockQueryOne = vi.mocked(queryOne)
const mockLog = vi.mocked(logMessage)
const mockFreeText = vi.mocked(sendFreeTextWhatsApp)
const mockAck = vi.mocked(sendSupportAckWhatsApp)

function makeReq(fields: Record<string, string>) {
  return new Request('http://localhost/api/webhooks/twilio', {
    method: 'POST',
    headers: { 'x-twilio-signature': 'sig' },
    body: new URLSearchParams(fields),
  }) as any
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('TWILIO_AUTH_TOKEN', 'tok')
  validateRequest.mockReturnValue(true)
  mockQuery.mockResolvedValue({ rows: [] } as any)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('POST /api/webhooks/twilio', () => {
  it('returns 500 when auth token missing', async () => {
    vi.stubEnv('TWILIO_AUTH_TOKEN', '')
    const res = await POST(
      makeReq({ From: 'whatsapp:+919876543210', To: 'whatsapp:+18722179910', Body: 'hi', MessageSid: 'SM1' })
    )
    expect(res.status).toBe(500)
  })

  it('returns 403 on invalid signature', async () => {
    validateRequest.mockReturnValue(false)
    const res = await POST(
      makeReq({ From: 'whatsapp:+919876543210', To: 'whatsapp:+18722179910', Body: 'hi', MessageSid: 'SM1' })
    )
    expect(res.status).toBe(403)
  })

  it('logs the inbound message', async () => {
    mockQueryOne.mockResolvedValue(null)
    await POST(makeReq({ From: 'whatsapp:+919876543210', To: 'whatsapp:+18722179910', Body: 'hi', MessageSid: 'SM1' }))
    expect(mockLog).toHaveBeenCalledWith(
      expect.objectContaining({ direction: 'inbound', status: 'received', kind: 'inbound' })
    )
  })

  it('STOP command sets marketing_opt_out TRUE and replies on WhatsApp', async () => {
    mockQueryOne.mockResolvedValue({ id: 'u1', marketing_opt_out: false })
    const res = await POST(
      makeReq({ From: 'whatsapp:+919876543210', To: 'whatsapp:+18722179910', Body: 'STOP', MessageSid: 'SM1' })
    )
    expect(res.status).toBe(200)
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('marketing_opt_out = TRUE'), ['u1'])
    expect(mockFreeText).toHaveBeenCalled()
  })

  it('START command sets marketing_opt_out FALSE', async () => {
    mockQueryOne.mockResolvedValue({ id: 'u1', marketing_opt_out: true })
    const res = await POST(
      makeReq({ From: 'whatsapp:+919876543210', To: 'whatsapp:+18722179910', Body: 'START', MessageSid: 'SM1' })
    )
    expect(res.status).toBe(200)
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('marketing_opt_out = FALSE'), ['u1'])
    expect(mockFreeText).toHaveBeenCalled()
  })

  it('normal support message opens a session, inserts message and auto-acks new session', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ id: 'u1', marketing_opt_out: false }) // matched user
      .mockResolvedValueOnce(null) // no open session
      .mockResolvedValueOnce({ id: 'sess-1' }) // INSERT session returns id
    const res = await POST(
      makeReq({
        From: 'whatsapp:+919876543210',
        To: 'whatsapp:+18722179910',
        Body: 'my order is late',
        MessageSid: 'SM1',
      })
    )
    expect(res.status).toBe(200)
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO support_messages'), [
      'sess-1',
      'my order is late',
    ])
    expect(mockAck).toHaveBeenCalledWith(expect.objectContaining({ phone: '+919876543210' }))
  })

  it('does not auto-ack when an open session already exists', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ id: 'u1', marketing_opt_out: false }) // matched user
      .mockResolvedValueOnce({ id: 'sess-existing' }) // open session found
    await POST(
      makeReq({ From: 'whatsapp:+919876543210', To: 'whatsapp:+18722179910', Body: 'follow up', MessageSid: 'SM1' })
    )
    expect(mockAck).not.toHaveBeenCalled()
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO support_messages'), [
      'sess-existing',
      'follow up',
    ])
  })

  it('SMS support message (non-whatsapp) does not open a session', async () => {
    mockQueryOne.mockResolvedValue({ id: 'u1', marketing_opt_out: false })
    await POST(makeReq({ From: '+919876543210', To: '+18722179910', Body: 'hello', MessageSid: 'SM1' }))
    expect(mockAck).not.toHaveBeenCalled()
  })

  it('STOP over SMS channel updates opt-out but sends no WhatsApp reply', async () => {
    mockQueryOne.mockResolvedValue({ id: 'u1', marketing_opt_out: false })
    const res = await POST(makeReq({ From: '+919876543210', To: '+18722179910', Body: 'STOP', MessageSid: 'SM1' }))
    expect(res.status).toBe(200)
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('marketing_opt_out = TRUE'), ['u1'])
    expect(mockFreeText).not.toHaveBeenCalled()
  })

  it('STOP with no matched user skips the DB update', async () => {
    mockQueryOne.mockResolvedValue(null)
    await POST(
      makeReq({ From: 'whatsapp:+919876543210', To: 'whatsapp:+18722179910', Body: 'STOP', MessageSid: 'SM1' })
    )
    expect(mockQuery).not.toHaveBeenCalledWith(expect.stringContaining('marketing_opt_out = TRUE'), expect.anything())
    // still replies on whatsapp
    expect(mockFreeText).toHaveBeenCalled()
  })

  it('START with no matched user skips the DB update but still replies', async () => {
    mockQueryOne.mockResolvedValue(null)
    await POST(
      makeReq({ From: 'whatsapp:+919876543210', To: 'whatsapp:+18722179910', Body: 'START', MessageSid: 'SM1' })
    )
    expect(mockQuery).not.toHaveBeenCalledWith(expect.stringContaining('marketing_opt_out = FALSE'), expect.anything())
    expect(mockFreeText).toHaveBeenCalled()
  })

  it('WhatsApp support message from unmatched user does not open a session', async () => {
    mockQueryOne.mockResolvedValue(null)
    await POST(
      makeReq({ From: 'whatsapp:+919876543210', To: 'whatsapp:+18722179910', Body: 'help me', MessageSid: 'SM1' })
    )
    expect(mockAck).not.toHaveBeenCalled()
    expect(mockQuery).not.toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO support_messages'),
      expect.anything()
    )
  })

  it('handles session INSERT returning null (no message inserted, no ack)', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ id: 'u1', marketing_opt_out: false }) // matched user
      .mockResolvedValueOnce(null) // no open session
      .mockResolvedValueOnce(null) // INSERT returns null
    const res = await POST(
      makeReq({ From: 'whatsapp:+919876543210', To: 'whatsapp:+18722179910', Body: 'x', MessageSid: 'SM1' })
    )
    expect(res.status).toBe(200)
    expect(mockQuery).not.toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO support_messages'),
      expect.anything()
    )
    expect(mockAck).not.toHaveBeenCalled()
  })

  it('swallows a rejected logActivity in the support path', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ id: 'u1', marketing_opt_out: false })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'sess-1' })
    vi.mocked(logActivity).mockRejectedValueOnce(new Error('audit down'))
    const res = await POST(
      makeReq({ From: 'whatsapp:+919876543210', To: 'whatsapp:+18722179910', Body: 'x', MessageSid: 'SM1' })
    )
    expect(res.status).toBe(200)
  })

  it('handles missing form fields via defaults (empty From/To/Body/Sid)', async () => {
    mockQueryOne.mockResolvedValue(null)
    const res = await POST(makeReq({}))
    expect(res.status).toBe(200)
    // empty From → no last10 → logMessage still called with defaults
    expect(mockLog).toHaveBeenCalledWith(expect.objectContaining({ channel: 'sms', userId: null }))
  })

  it('returns 200 TwiML on unexpected error', async () => {
    mockQueryOne.mockRejectedValue(new Error('db boom'))
    const res = await POST(
      makeReq({ From: 'whatsapp:+919876543210', To: 'whatsapp:+18722179910', Body: 'hi', MessageSid: 'SM1' })
    )
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toContain('<Response>')
  })
})
