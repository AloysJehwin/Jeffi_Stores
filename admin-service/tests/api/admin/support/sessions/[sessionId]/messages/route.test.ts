import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import type { SessionRow } from '@/lib/support/sessions'
import type { SupportMessage } from '@/lib/support/types'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn(), authenticateAnyUser: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ query: vi.fn(), queryOne: vi.fn(), queryMany: vi.fn(), withTransaction: vi.fn() }))
vi.mock('@/lib/catalog/brand', () => ({ currentBrandNameAsync: vi.fn() }))
vi.mock('@/lib/support/sessions', () => ({ getSessionRow: vi.fn(), getSessionDto: vi.fn() }))
vi.mock('@/lib/support/messages', () => ({ listMessages: vi.fn(), localize: vi.fn() }))
vi.mock('@/lib/support/translate', () => ({ ensureTranslations: vi.fn() }))
vi.mock('@/lib/support/admin', () => ({ agentAttachments: vi.fn(), agentReply: vi.fn() }))

import { GET, POST } from '@admin/app/api/(admin)/admin/support/sessions/[sessionId]/messages/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryOne } from '@/lib/shared/db'
import { currentBrandNameAsync } from '@/lib/catalog/brand'
import { getSessionRow, getSessionDto } from '@/lib/support/sessions'
import { listMessages, localize } from '@/lib/support/messages'
import { ensureTranslations } from '@/lib/support/translate'
import { agentAttachments, agentReply } from '@/lib/support/admin'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQueryOne = vi.mocked(queryOne)
const mockBrand = vi.mocked(currentBrandNameAsync)
const mockRow = vi.mocked(getSessionRow)
const mockDto = vi.mocked(getSessionDto)
const mockList = vi.mocked(listMessages)
const mockLocalize = vi.mocked(localize)
const mockEnsure = vi.mocked(ensureTranslations)
const mockAttachments = vi.mocked(agentAttachments)
const mockReply = vi.mocked(agentReply)

const SID = 'session-uuid-1'
const ADMIN = { adminId: 'admin-1', email: 'priya@jeffi.in', role: 'admin', scopes: ['customers:write'] }
const PARAMS = { params: Promise.resolve({ sessionId: SID }) }
const F1 = '11111111-1111-4111-8111-111111111111'

function row(over: Partial<SessionRow> = {}): SessionRow {
  return {
    id: SID,
    user_id: 'user-1',
    tenant_id: null,
    status: 'open',
    admin_name: null,
    created_at: '2026-10-01T10:00:00.000Z',
    closed_at: null,
    ticket_number: 'SUP-2610-0001',
    channel: 'web',
    handler: 'ai',
    assigned_admin_id: null,
    handoff_reason: null,
    handoff_summary: null,
    handoff_at: null,
    customer_lang: 'ta',
    contact_phone: null,
    contact_name: null,
    customer_last_seen_at: null,
    admin_last_seen_at: null,
    last_message_at: null,
    customer_notified_at: null,
    wa_window_expires_at: null,
    contact_email: null,
    email_subject: null,
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

// adminLanguage() reads support_language; agentRef() reads the agent's name too.
function agentRow(name: string | null, lang: string | null) {
  mockQueryOne.mockImplementation(async (sql: string) => (sql.includes('concat_ws') ? { name, support_language: lang } : { support_language: lang }))
}

const makeGet = (query = '') => new NextRequest(`http://localhost/api/admin/support/sessions/${SID}/messages${query}`)

function makePost(body: object) {
  return new NextRequest(`http://localhost/api/admin/support/sessions/${SID}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.resetAllMocks()
  mockAuth.mockResolvedValue(ADMIN)
  mockHasScope.mockReturnValue(true)
  mockRow.mockResolvedValue(row())
  mockBrand.mockResolvedValue('Jeffi')
  mockEnsure.mockResolvedValue(0)
  mockLocalize.mockImplementation((m, t, lang) => (lang && t?.[lang] ? { ...m, text: t[lang], original: { text: m.text, lang: m.lang! } } : m))
  mockAttachments.mockResolvedValue([])
  agentRow('Priya Agent', 'hi')
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
})

describe('GET /api/admin/support/sessions/[sessionId]/messages', () => {
  it('401 when unauthenticated (passive auth)', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await GET(makeGet(), PARAMS)
    expect(res.status).toBe(401)
    expect(mockAuth).toHaveBeenCalledWith(expect.anything(), { passive: true })
  })

  it('403 without customers:read', async () => {
    mockHasScope.mockReturnValue(false)
    const res = await GET(makeGet(), PARAMS)
    expect(res.status).toBe(403)
    expect(mockHasScope).toHaveBeenCalledWith('admin', ['customers:write'], 'customers:read')
  })

  it('404 when the chat does not exist', async () => {
    mockRow.mockResolvedValue(null)
    const res = await GET(makeGet(), PARAMS)
    expect(res.status).toBe(404)
    expect(mockList).not.toHaveBeenCalled()
  })

  it("returns the conversation in the agent's language with the session", async () => {
    mockList.mockResolvedValue([
      { message: msg({ id: 'm1', sender: 'customer', text: 'வணக்கம்', lang: 'ta' }), translations: { hi: 'नमस्ते' } },
      { message: msg({ id: 'm2', sender: 'ai', text: 'Hello', lang: 'en' }), translations: {} },
    ])
    mockDto.mockResolvedValue({ id: SID } as any)
    const res = await GET(makeGet(), PARAMS)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.lang).toBe('hi')
    expect(body.session).toEqual({ id: SID })
    expect(body.messages.map((m: SupportMessage) => m.text)).toEqual(['नमस्ते', 'Hello'])
    expect(mockEnsure).toHaveBeenCalledWith(SID, 'hi', 40)
    expect(mockList).toHaveBeenCalledWith(SID, { after: null, brand: 'Jeffi' })
  })

  it('defaults to English when the agent has no support language', async () => {
    mockQueryOne.mockResolvedValue(null)
    mockList.mockResolvedValue([])
    const body = await (await GET(makeGet(), PARAMS)).json()
    expect(body.lang).toBe('en')
    expect(mockEnsure).toHaveBeenCalledWith(SID, 'en', 40)
  })

  it('?after pages without the session', async () => {
    mockList.mockResolvedValue([])
    const body = await (await GET(makeGet('?after=m9'), PARAMS)).json()
    expect(body.session).toBeUndefined()
    expect(mockList).toHaveBeenCalledWith(SID, { after: 'm9', brand: 'Jeffi' })
    expect(mockDto).not.toHaveBeenCalled()
  })

  it('a failed translation pass does not fail the request', async () => {
    mockEnsure.mockRejectedValue(new Error('model down'))
    mockList.mockResolvedValue([])
    const res = await GET(makeGet(), PARAMS)
    expect(res.status).toBe(200)
  })

  it('stops waiting for translations after 6s', async () => {
    vi.useFakeTimers()
    mockEnsure.mockReturnValue(new Promise(() => {}))
    mockList.mockResolvedValue([])
    const pending = GET(makeGet(), PARAMS)
    await vi.advanceTimersByTimeAsync(6000)
    const res = await pending
    expect(res.status).toBe(200)
    expect(mockList).toHaveBeenCalled()
  })

  it('500 when listing fails', async () => {
    mockList.mockRejectedValue(new Error('db down'))
    const res = await GET(makeGet(), PARAMS)
    expect(res.status).toBe(500)
  })
})

describe('POST /api/admin/support/sessions/[sessionId]/messages', () => {
  it('401 when unauthenticated (active auth)', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await POST(makePost({ message: 'hi' }), PARAMS)
    expect(res.status).toBe(401)
    expect(mockAuth).toHaveBeenCalledWith(expect.anything(), undefined)
  })

  it('403 without customers:write', async () => {
    mockHasScope.mockReturnValue(false)
    const res = await POST(makePost({ message: 'hi' }), PARAMS)
    expect(res.status).toBe(403)
    expect(mockHasScope).toHaveBeenCalledWith('admin', ['customers:write'], 'customers:write')
  })

  it('404 when the chat does not exist', async () => {
    mockRow.mockResolvedValue(null)
    const res = await POST(makePost({ message: 'hi' }), PARAMS)
    expect(res.status).toBe(404)
  })

  it('409 when the chat is closed', async () => {
    mockRow.mockResolvedValue(row({ status: 'closed' }))
    const res = await POST(makePost({ message: 'hi' }), PARAMS)
    expect(res.status).toBe(409)
    expect(mockReply).not.toHaveBeenCalled()
  })

  it('400 with neither text nor attachments', async () => {
    const res = await POST(makePost({ message: '  ' }), PARAMS)
    expect(res.status).toBe(400)
    expect(mockReply).not.toHaveBeenCalled()
  })

  it('400 when an attachment is not available to the agent', async () => {
    mockAttachments.mockResolvedValue(null)
    const res = await POST(makePost({ attachmentIds: [F1] }), PARAMS)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Attachment not found')
    expect(mockAttachments).toHaveBeenCalledWith({ adminId: 'admin-1', role: 'admin', scopes: ['customers:write'] }, [F1])
    expect(mockReply).not.toHaveBeenCalled()
  })

  it('replies as the agent and returns the message', async () => {
    agentRow('Priya Agent', 'en')
    const atts = [{ driveFileId: F1, kind: 'image' as const, mime: 'image/png', name: 'a.png', size: 10 }]
    mockAttachments.mockResolvedValue(atts)
    const m = msg({ id: 'm-new', sender: 'admin', senderName: 'Priya Agent', text: 'On it' })
    mockReply.mockResolvedValue(m)
    const session = row()
    mockRow.mockResolvedValue(session)
    const res = await POST(makePost({ message: '  On it ', clientId: 'c-1', attachmentIds: [F1] }), PARAMS)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ message: m })
    expect(mockReply).toHaveBeenCalledWith(session, { adminId: 'admin-1', name: 'Priya Agent', lang: 'en' }, { text: 'On it', clientId: 'c-1', attachments: atts })
  })

  it("names the agent by email when they have no name, and tolerates missing scopes", async () => {
    agentRow(null, null)
    mockAuth.mockResolvedValue({ ...ADMIN, scopes: undefined } as any)
    mockReply.mockResolvedValue(msg({ sender: 'admin' }))
    await POST(makePost({ message: 'hi' }), PARAMS)
    expect(mockAttachments).toHaveBeenCalledWith({ adminId: 'admin-1', role: 'admin', scopes: [] }, [])
    expect(mockReply).toHaveBeenCalledWith(expect.anything(), { adminId: 'admin-1', name: 'priya@jeffi.in', lang: 'en' }, { text: 'hi', clientId: null, attachments: [] })
  })

  it('500 when the reply fails', async () => {
    mockReply.mockRejectedValue(new Error('db down'))
    const res = await POST(makePost({ message: 'hi' }), PARAMS)
    expect(res.status).toBe(500)
  })
})
