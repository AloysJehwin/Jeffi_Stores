/**
 * GET/POST /api/support/sessions — the customer's open chat.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import type { SessionRow } from '@/lib/support/sessions'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAnyUser: vi.fn(), authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ query: vi.fn(), queryOne: vi.fn(), queryMany: vi.fn(), withTransaction: vi.fn() }))
vi.mock('@/lib/shared/activity', () => ({ logActivity: vi.fn() }))
vi.mock('@/lib/support/sessions', () => ({
  openSessionFor: vi.fn(),
  createSession: vi.fn(),
  getSessionDto: vi.fn(),
  getSessionRow: vi.fn(),
}))

import { GET, POST } from '@storefront/app/api/(public)/support/sessions/route'
import { authenticateAnyUser } from '@/lib/auth/jwt'
import { logActivity } from '@/lib/shared/activity'
import { openSessionFor, createSession, getSessionDto } from '@/lib/support/sessions'

const mockAuth = vi.mocked(authenticateAnyUser)
const mockLog = vi.mocked(logActivity)
const mockOpen = vi.mocked(openSessionFor)
const mockCreate = vi.mocked(createSession)
const mockDto = vi.mocked(getSessionDto)

const USER = { userId: 'user-1', email: 'user@example.com' }

function row(over: Partial<SessionRow> = {}): SessionRow {
  return {
    id: 'sess-1',
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
    customer_lang: null,
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

const DTO = { id: 'sess-1', ticket: 'SUP-2610-0001', status: 'open', handler: 'ai' } as any

function makeGet(v2 = false) {
  return new NextRequest(`http://localhost/api/support/sessions${v2 ? '?v=2' : ''}`)
}

function makePost(body: unknown, opts: { v2?: boolean; ua?: string } = {}) {
  return new NextRequest(`http://localhost/api/support/sessions${opts.v2 ? '?v=2' : ''}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(opts.ua ? { 'user-agent': opts.ua } : {}) },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.resetAllMocks()
  mockLog.mockResolvedValue(undefined as any)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('GET /api/support/sessions', () => {
  it('401 when not signed in', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await GET(makeGet())
    expect(res.status).toBe(401)
    expect(mockOpen).not.toHaveBeenCalled()
  })

  it('legacy: null when the customer has no open chat', async () => {
    mockAuth.mockResolvedValue(USER)
    mockOpen.mockResolvedValue(null)
    const res = await GET(makeGet())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ session: null })
    expect(mockOpen).toHaveBeenCalledWith('user-1')
  })

  it('legacy: the pre-2.0 session shape', async () => {
    mockAuth.mockResolvedValue(USER)
    mockOpen.mockResolvedValue(row({ admin_name: 'Priya' }))
    const res = await GET(makeGet())
    expect(await res.json()).toEqual({
      session: { id: 'sess-1', status: 'open', created_at: '2026-10-01T10:00:00.000Z', admin_name: 'Priya' },
    })
    expect(mockDto).not.toHaveBeenCalled()
  })

  it('v2: the session DTO', async () => {
    mockAuth.mockResolvedValue(USER)
    mockOpen.mockResolvedValue(row())
    mockDto.mockResolvedValue(DTO)
    const res = await GET(makeGet(true))
    expect(await res.json()).toEqual({ session: DTO })
    expect(mockDto).toHaveBeenCalledWith('sess-1')
  })

  it('v2: null without looking up a DTO', async () => {
    mockAuth.mockResolvedValue(USER)
    mockOpen.mockResolvedValue(null)
    const res = await GET(makeGet(true))
    expect(await res.json()).toEqual({ session: null })
    expect(mockDto).not.toHaveBeenCalled()
  })

  it('500 when the lookup fails', async () => {
    mockAuth.mockResolvedValue(USER)
    mockOpen.mockRejectedValue(new Error('db down'))
    const res = await GET(makeGet())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('Failed')
  })
})

describe('POST /api/support/sessions', () => {
  it('401 when not signed in', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await POST(makePost({}))
    expect(res.status).toBe(401)
  })

  it('400 when lang is too long', async () => {
    mockAuth.mockResolvedValue(USER)
    const res = await POST(makePost({ lang: 'x'.repeat(11) }))
    expect(res.status).toBe(400)
    expect(mockOpen).not.toHaveBeenCalled()
  })

  it('400 when productId is not a string', async () => {
    mockAuth.mockResolvedValue(USER)
    const res = await POST(makePost({ productId: 42 }))
    expect(res.status).toBe(400)
  })

  it('returns the existing open chat without creating one', async () => {
    mockAuth.mockResolvedValue(USER)
    mockOpen.mockResolvedValue(row())
    const res = await POST(makePost({}))
    expect(res.status).toBe(200)
    expect((await res.json()).session).toEqual({ id: 'sess-1', status: 'open', created_at: '2026-10-01T10:00:00.000Z', admin_name: null })
    expect(mockCreate).not.toHaveBeenCalled()
    expect(mockLog).not.toHaveBeenCalled()
  })

  it('creates a web chat in a supported language and logs it', async () => {
    mockAuth.mockResolvedValue(USER)
    mockOpen.mockResolvedValue(null)
    mockCreate.mockResolvedValue(row({ id: 'sess-new', ticket_number: 'SUP-2610-0042', customer_lang: 'ta' }))
    const res = await POST(makePost({ lang: 'ta', productId: 'p-1' }))
    expect(res.status).toBe(200)
    expect((await res.json()).session.id).toBe('sess-new')
    expect(mockCreate).toHaveBeenCalledWith({ userId: 'user-1', channel: 'web', customerLang: 'ta' })
    expect(mockLog).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', kind: 'support_session_started', referenceId: 'sess-new', summary: expect.stringContaining('SUP-2610-0042') })
    )
  })

  it('drops an unsupported language and marks app clients', async () => {
    mockAuth.mockResolvedValue(USER)
    mockOpen.mockResolvedValue(null)
    mockCreate.mockResolvedValue(row())
    await POST(makePost({ lang: 'fr' }, { ua: 'JeffiStoresApp/2.1 (ios)' }))
    expect(mockCreate).toHaveBeenCalledWith({ userId: 'user-1', channel: 'app', customerLang: null })
  })

  it('treats an unreadable body as empty', async () => {
    mockAuth.mockResolvedValue(USER)
    mockOpen.mockResolvedValue(null)
    mockCreate.mockResolvedValue(row())
    const res = await POST(makePost('not json'))
    expect(res.status).toBe(200)
    expect(mockCreate).toHaveBeenCalledWith({ userId: 'user-1', channel: 'web', customerLang: null })
  })

  it('still answers when the activity log rejects', async () => {
    mockAuth.mockResolvedValue(USER)
    mockOpen.mockResolvedValue(null)
    mockCreate.mockResolvedValue(row())
    mockLog.mockRejectedValue(new Error('log down'))
    const res = await POST(makePost({}))
    expect(res.status).toBe(200)
  })

  it('v2: the session DTO', async () => {
    mockAuth.mockResolvedValue(USER)
    mockOpen.mockResolvedValue(null)
    mockCreate.mockResolvedValue(row({ id: 'sess-new' }))
    mockDto.mockResolvedValue({ ...DTO, id: 'sess-new' })
    const res = await POST(makePost({}, { v2: true }))
    expect((await res.json()).session).toEqual({ ...DTO, id: 'sess-new' })
    expect(mockDto).toHaveBeenCalledWith('sess-new')
  })

  it('500 without leaking the internal error when creating fails', async () => {
    mockAuth.mockResolvedValue(USER)
    mockOpen.mockResolvedValue(null)
    mockCreate.mockRejectedValue(new Error('support session insert failed'))
    const res = await POST(makePost({}))
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('Could not start the chat')
  })
})
