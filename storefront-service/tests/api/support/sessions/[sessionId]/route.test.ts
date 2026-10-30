/**
 * GET/PATCH /api/support/sessions/[sessionId] — one chat; the customer closes it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import type { SessionRow } from '@/lib/support/sessions'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAnyUser: vi.fn(), authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ query: vi.fn(), queryOne: vi.fn(), queryMany: vi.fn(), withTransaction: vi.fn() }))
vi.mock('@/lib/shared/activity', () => ({ logActivity: vi.fn() }))
vi.mock('@/lib/support/sessions', () => ({
  getSessionRow: vi.fn(),
  getSessionDto: vi.fn(),
  closeSession: vi.fn(),
}))

import { GET, PATCH } from '@storefront/app/api/(public)/support/sessions/[sessionId]/route'
import { authenticateAnyUser } from '@/lib/auth/jwt'
import { logActivity } from '@/lib/shared/activity'
import { getSessionRow, getSessionDto, closeSession } from '@/lib/support/sessions'

const mockAuth = vi.mocked(authenticateAnyUser)
const mockLog = vi.mocked(logActivity)
const mockRow = vi.mocked(getSessionRow)
const mockDto = vi.mocked(getSessionDto)
const mockClose = vi.mocked(closeSession)

const SID = 'sess-1'
const USER = { userId: 'user-1', email: 'user@example.com' }
const PARAMS = { params: Promise.resolve({ sessionId: SID }) }

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

const makeGet = () => new NextRequest(`http://localhost/api/support/sessions/${SID}`)

function makePatch(body: unknown = {}) {
  return new NextRequest(`http://localhost/api/support/sessions/${SID}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.resetAllMocks()
  mockLog.mockResolvedValue(undefined as any)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('GET /api/support/sessions/[sessionId]', () => {
  it('401 when not signed in', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await GET(makeGet(), PARAMS)
    expect(res.status).toBe(401)
  })

  it('404 when the chat does not exist', async () => {
    mockAuth.mockResolvedValue(USER)
    mockRow.mockResolvedValue(null)
    const res = await GET(makeGet(), PARAMS)
    expect(res.status).toBe(404)
    expect((await res.json()).error).toMatch(/not found/i)
  })

  it("404 for someone else's chat", async () => {
    mockAuth.mockResolvedValue(USER)
    mockRow.mockResolvedValue(row({ user_id: 'user-2' }))
    const res = await GET(makeGet(), PARAMS)
    expect(res.status).toBe(404)
    expect(mockDto).not.toHaveBeenCalled()
  })

  it('404 when the lookup throws', async () => {
    mockAuth.mockResolvedValue(USER)
    mockRow.mockRejectedValue(new Error('db down'))
    const res = await GET(makeGet(), PARAMS)
    expect(res.status).toBe(404)
  })

  it('returns the session DTO', async () => {
    mockAuth.mockResolvedValue(USER)
    mockRow.mockResolvedValue(row())
    mockDto.mockResolvedValue({ id: SID, status: 'open' } as any)
    const res = await GET(makeGet(), PARAMS)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ session: { id: SID, status: 'open' } })
    expect(mockDto).toHaveBeenCalledWith(SID)
  })
})

describe('PATCH /api/support/sessions/[sessionId]', () => {
  it('401 when not signed in', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await PATCH(makePatch(), PARAMS)
    expect(res.status).toBe(401)
    expect(mockClose).not.toHaveBeenCalled()
  })

  it("404 for someone else's chat", async () => {
    mockAuth.mockResolvedValue(USER)
    mockRow.mockResolvedValue(row({ user_id: 'user-2' }))
    const res = await PATCH(makePatch(), PARAMS)
    expect(res.status).toBe(404)
    expect(mockClose).not.toHaveBeenCalled()
  })

  it('400 for any status other than closed', async () => {
    mockAuth.mockResolvedValue(USER)
    mockRow.mockResolvedValue(row())
    const res = await PATCH(makePatch({ status: 'open' }), PARAMS)
    expect(res.status).toBe(400)
    expect(mockClose).not.toHaveBeenCalled()
  })

  it('closes the chat and logs it', async () => {
    mockAuth.mockResolvedValue(USER)
    mockRow.mockResolvedValue(row())
    mockClose.mockResolvedValue(row({ status: 'closed' }))
    const res = await PATCH(makePatch({ status: 'closed' }), PARAMS)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true })
    expect(mockClose).toHaveBeenCalledWith(SID)
    expect(mockLog).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1', kind: 'support_message', referenceId: SID }))
  })

  it('succeeds without logging when the chat was already closed', async () => {
    mockAuth.mockResolvedValue(USER)
    mockRow.mockResolvedValue(row({ status: 'closed' }))
    mockClose.mockResolvedValue(null)
    const res = await PATCH(makePatch(), PARAMS)
    expect(res.status).toBe(200)
    expect(mockLog).not.toHaveBeenCalled()
  })

  it('500 when closing fails', async () => {
    mockAuth.mockResolvedValue(USER)
    mockRow.mockResolvedValue(row())
    mockClose.mockRejectedValue(new Error('db down'))
    const res = await PATCH(makePatch(), PARAMS)
    expect(res.status).toBe(500)
  })
})
