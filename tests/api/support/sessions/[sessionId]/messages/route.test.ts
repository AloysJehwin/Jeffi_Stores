/**
 * GET/POST /api/support/sessions/[sessionId]/messages — the customer's side of the chat.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import type { SessionRow } from '@/lib/support/sessions'
import type { SupportMessage } from '@/lib/support/types'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAnyUser: vi.fn(), authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ query: vi.fn(), queryOne: vi.fn(), queryMany: vi.fn(), withTransaction: vi.fn() }))
vi.mock('@/lib/shared/activity', () => ({ logActivity: vi.fn() }))
vi.mock('@/lib/catalog/brand', () => ({ currentBrandNameAsync: vi.fn() }))
vi.mock('@/lib/support/sessions', () => ({ getSessionRow: vi.fn(), getSessionDto: vi.fn() }))
vi.mock('@/lib/support/messages', () => ({
  listMessages: vi.fn(),
  localize: vi.fn(),
  markReceipts: vi.fn(),
  postMessage: vi.fn(),
}))
vi.mock('@/lib/support/translate', () => ({ settleCustomerLang: vi.fn() }))
vi.mock('@/lib/support/agent', () => ({ onCustomerMessage: vi.fn() }))

import { GET, POST } from '@/app/api/(public)/support/sessions/[sessionId]/messages/route'
import { authenticateAnyUser } from '@/lib/auth/jwt'
import { queryMany } from '@/lib/shared/db'
import { logActivity } from '@/lib/shared/activity'
import { currentBrandNameAsync } from '@/lib/catalog/brand'
import { getSessionRow, getSessionDto } from '@/lib/support/sessions'
import { listMessages, localize, markReceipts, postMessage } from '@/lib/support/messages'
import { settleCustomerLang } from '@/lib/support/translate'
import { onCustomerMessage } from '@/lib/support/agent'

const mockAuth = vi.mocked(authenticateAnyUser)
const mockQueryMany = vi.mocked(queryMany)
const mockLog = vi.mocked(logActivity)
const mockBrand = vi.mocked(currentBrandNameAsync)
const mockRow = vi.mocked(getSessionRow)
const mockDto = vi.mocked(getSessionDto)
const mockList = vi.mocked(listMessages)
const mockLocalize = vi.mocked(localize)
const mockReceipts = vi.mocked(markReceipts)
const mockPost = vi.mocked(postMessage)
const mockSettle = vi.mocked(settleCustomerLang)
const mockOnCustomer = vi.mocked(onCustomerMessage)

const SID = 'sess-abc'
const USER = { userId: 'user-1', email: 'user@example.com' }
const PARAMS = { params: Promise.resolve({ sessionId: SID }) }
const F1 = '11111111-1111-4111-8111-111111111111'
const F2 = '22222222-2222-4222-8222-222222222222'

function row(over: Partial<SessionRow> = {}): SessionRow {
  return {
    id: SID,
    user_id: 'user-1',
    tenant_id: null,
    status: 'open',
    admin_name: 'Alice',
    created_at: '2026-10-01T10:00:00.000Z',
    closed_at: null,
    ticket_number: 'SUP-2610-0001',
    channel: 'web',
    handler: 'ai',
    assigned_admin_id: null,
    handoff_reason: null,
    handoff_summary: null,
    handoff_at: null,
    customer_lang: null,
    contact_phone: null,
    contact_name: null,
    customer_last_seen_at: null,
    admin_last_seen_at: null,
    last_message_at: null,
    customer_notified_at: null,
    wa_window_expires_at: null,
    ...over,
  }
}

function msg(over: Partial<SupportMessage> = {}): SupportMessage {
  return {
    id: 'm1',
    sessionId: SID,
    sender: 'customer',
    senderName: null,
    text: 'hello',
    original: null,
    lang: 'en',
    at: '2026-10-01T10:01:00.000Z',
    status: 'sent',
    channel: 'web',
    payloads: [],
    attachments: [],
    clientId: null,
    ...over,
  }
}

// Same rule as the real localize: show the viewer's translation when one exists.
function fakeLocalize(m: SupportMessage, t: Record<string, string> | null | undefined, lang: string | null): SupportMessage {
  const x = lang ? t?.[lang] : undefined
  return x && m.lang !== lang ? { ...m, text: x, original: { text: m.text, lang: m.lang! } } : m
}

function makeGet(query = '') {
  return new NextRequest(`http://localhost/api/support/sessions/${SID}/messages${query}`)
}

function makePost(body: unknown, opts: { v2?: boolean; ua?: string } = {}) {
  return new NextRequest(`http://localhost/api/support/sessions/${SID}/messages${opts.v2 ? '?v=2' : ''}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(opts.ua ? { 'user-agent': opts.ua } : {}) },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.resetAllMocks()
  mockAuth.mockResolvedValue(USER)
  mockRow.mockResolvedValue(row())
  mockBrand.mockResolvedValue('Jeffi')
  mockLocalize.mockImplementation(fakeLocalize)
  mockReceipts.mockResolvedValue(1)
  mockLog.mockResolvedValue(undefined as any)
  mockSettle.mockImplementation(async (s: SessionRow) => ({ lang: 'en', session: s }))
  mockOnCustomer.mockResolvedValue(undefined)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('GET /api/support/sessions/[sessionId]/messages', () => {
  it('401 when not signed in', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await GET(makeGet(), PARAMS)
    expect(res.status).toBe(401)
    expect(mockList).not.toHaveBeenCalled()
  })

  it("404 for someone else's chat", async () => {
    mockRow.mockResolvedValue(row({ user_id: 'user-2' }))
    const res = await GET(makeGet(), PARAMS)
    expect(res.status).toBe(404)
    expect((await res.json()).error).toMatch(/not found/i)
  })

  it('legacy: pre-2.0 shape, sender mapping, and a read receipt up to the last message', async () => {
    mockList.mockResolvedValue([
      { message: msg({ id: 'm1', sender: 'customer', text: 'hi' }), translations: {} },
      { message: msg({ id: 'm2', sender: 'ai', senderName: 'Jeffi Assistant', text: 'How can I help?' }), translations: {} },
      { message: msg({ id: 'm3', sender: 'admin', senderName: 'Alice', text: 'Checking now' }), translations: {} },
      { message: msg({ id: 'm4', sender: 'system', text: 'Alice joined the chat' }), translations: {} },
    ])
    const res = await GET(makeGet(), PARAMS)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.admin_name).toBe('Alice')
    expect(body.messages.map((m: any) => m.sender)).toEqual(['user', 'bot', 'admin', 'bot'])
    expect(body.messages[2]).toEqual({ id: 'm3', sender: 'admin', message: 'Checking now', created_at: '2026-10-01T10:01:00.000Z', sender_name: 'Alice', is_closing: false })
    expect(body.messages[0].sender_name).toBeUndefined()
    expect(mockList).toHaveBeenCalledWith(SID, { after: null, brand: 'Jeffi' })
    expect(mockReceipts).toHaveBeenCalledWith(SID, 'customer', 'read', 'm4')
    expect(mockDto).not.toHaveBeenCalled()
  })

  it('legacy: no receipt when there are no messages', async () => {
    mockList.mockResolvedValue([])
    const res = await GET(makeGet(), PARAMS)
    expect((await res.json()).messages).toEqual([])
    expect(mockReceipts).not.toHaveBeenCalled()
  })

  it('legacy: a failed receipt does not fail the request', async () => {
    mockList.mockResolvedValue([{ message: msg(), translations: {} }])
    mockReceipts.mockRejectedValue(new Error('db down'))
    const res = await GET(makeGet(), PARAMS)
    expect(res.status).toBe(200)
  })

  it("shows replies in the customer's language, their own words untouched", async () => {
    mockRow.mockResolvedValue(row({ customer_lang: 'ta' }))
    mockList.mockResolvedValue([
      { message: msg({ id: 'm1', sender: 'customer', text: 'வணக்கம்', lang: 'ta' }), translations: { en: 'Hello' } },
      { message: msg({ id: 'm2', sender: 'admin', text: 'Hello there', lang: 'en' }), translations: { ta: 'வணக்கம் நண்பரே' } },
    ])
    const body = await (await GET(makeGet('?v=2'), PARAMS)).json()
    expect(body.messages[0].text).toBe('வணக்கம்')
    expect(body.messages[1].text).toBe('வணக்கம் நண்பரே')
    expect(body.messages[1].original).toEqual({ text: 'Hello there', lang: 'en' })
    expect(mockLocalize).toHaveBeenCalledTimes(1)
  })

  it('v2: full messages plus the session, no receipt', async () => {
    const m = msg()
    mockList.mockResolvedValue([{ message: m, translations: {} }])
    mockDto.mockResolvedValue({ id: SID } as any)
    const res = await GET(makeGet('?v=2'), PARAMS)
    expect(await res.json()).toEqual({ messages: [m], session: { id: SID } })
    expect(mockReceipts).not.toHaveBeenCalled()
  })

  it('v2: ?after pages without the session', async () => {
    mockList.mockResolvedValue([])
    const body = await (await GET(makeGet('?v=2&after=m9'), PARAMS)).json()
    expect(body).toEqual({ messages: [] })
    expect(mockList).toHaveBeenCalledWith(SID, { after: 'm9', brand: 'Jeffi' })
    expect(mockDto).not.toHaveBeenCalled()
  })

  it('500 when listing fails', async () => {
    mockList.mockRejectedValue(new Error('boom'))
    const res = await GET(makeGet(), PARAMS)
    expect(res.status).toBe(500)
  })
})

describe('POST /api/support/sessions/[sessionId]/messages', () => {
  it('401 when not signed in', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await POST(makePost({ message: 'hi' }), PARAMS)
    expect(res.status).toBe(401)
  })

  it("404 for someone else's chat", async () => {
    mockRow.mockResolvedValue(row({ user_id: 'user-2' }))
    const res = await POST(makePost({ message: 'hi' }), PARAMS)
    expect(res.status).toBe(404)
  })

  it('409 when the chat is closed', async () => {
    mockRow.mockResolvedValue(row({ status: 'closed' }))
    const res = await POST(makePost({ message: 'hi' }), PARAMS)
    expect(res.status).toBe(409)
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('400 with neither text nor attachments', async () => {
    const res = await POST(makePost({ message: '   ' }), PARAMS)
    expect(res.status).toBe(400)
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('400 when the message is over 4000 chars', async () => {
    const res = await POST(makePost({ message: 'a'.repeat(4001) }), PARAMS)
    expect(res.status).toBe(400)
  })

  it('400 when an attachment id is not a uuid', async () => {
    const res = await POST(makePost({ attachmentIds: ['nope'] }), PARAMS)
    expect(res.status).toBe(400)
  })

  it('400 when an attachment is not the customer\'s', async () => {
    mockQueryMany.mockResolvedValue([{ id: F1 }])
    const res = await POST(makePost({ attachmentIds: [F1, F2] }), PARAMS)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Attachment not found')
    expect(mockQueryMany).toHaveBeenCalledWith(expect.stringContaining('FROM drive_files'), [[F1, F2], 'user-1'])
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('legacy: stores the message, hands it to the assistant, logs it', async () => {
    const settled = row({ customer_lang: 'en' })
    mockSettle.mockResolvedValue({ lang: 'en', session: settled })
    const m = msg({ id: 'm-new', text: 'where is my order', clientId: 'c-1' })
    mockPost.mockResolvedValue(m)
    const res = await POST(makePost({ message: '  where is my order  ', clientId: 'c-1' }), PARAMS)
    expect(res.status).toBe(200)
    expect((await res.json()).message).toEqual({ id: 'm-new', sender: 'user', message: 'where is my order', created_at: m.at, is_closing: false })
    expect(mockSettle).toHaveBeenCalledWith(expect.objectContaining({ id: SID }), 'where is my order')
    expect(mockPost).toHaveBeenCalledWith({ session: settled, sender: 'customer', text: 'where is my order', channel: 'web', clientId: 'c-1', attachments: [], lang: 'en' })
    expect(mockOnCustomer).toHaveBeenCalledWith(settled, m)
    expect(mockLog).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1', referenceId: SID, summary: 'Customer: where is my order' }))
  })

  it('v2: returns the full message; app clients are tagged', async () => {
    const m = msg({ channel: 'app' })
    mockPost.mockResolvedValue(m)
    const res = await POST(makePost({ message: 'hi' }, { v2: true, ua: 'JeffiStoresApp/2.0' }), PARAMS)
    expect((await res.json()).message).toEqual(m)
    expect(mockPost).toHaveBeenCalledWith(expect.objectContaining({ channel: 'app', clientId: null }))
  })

  it('attaches files in the order sent', async () => {
    mockQueryMany.mockResolvedValue([
      { id: F2, kind: 'pdf', mime_type: 'application/pdf', name: 'b.pdf', size_bytes: '2048', width: null, height: null, duration_seconds: null },
      { id: F1, kind: 'audio', mime_type: 'audio/ogg', name: 'a.ogg', size_bytes: '512', width: null, height: null, duration_seconds: '3.5' },
    ])
    mockPost.mockResolvedValue(msg({ text: '' }))
    const res = await POST(makePost({ attachmentIds: [F1, F2] }), PARAMS)
    expect(res.status).toBe(200)
    expect(mockPost.mock.calls[0][0].attachments).toEqual([
      { driveFileId: F1, kind: 'audio', mime: 'audio/ogg', name: 'a.ogg', size: 512, width: null, height: null, duration: 3.5 },
      { driveFileId: F2, kind: 'pdf', mime: 'application/pdf', name: 'b.pdf', size: 2048, width: null, height: null, duration: null },
    ])
    expect(mockLog).toHaveBeenCalledWith(expect.objectContaining({ summary: 'Customer: 2 attachment(s)' }))
  })

  it('truncates long text in the activity summary', async () => {
    mockPost.mockResolvedValue(msg())
    await POST(makePost({ message: 'x'.repeat(100) }), PARAMS)
    expect(mockLog).toHaveBeenCalledWith(expect.objectContaining({ summary: `Customer: ${'x'.repeat(80)}…` }))
  })

  it('500 when storing fails', async () => {
    mockPost.mockRejectedValue(new Error('db down'))
    const res = await POST(makePost({ message: 'hi' }), PARAMS)
    expect(res.status).toBe(500)
    expect(mockOnCustomer).not.toHaveBeenCalled()
  })
})
