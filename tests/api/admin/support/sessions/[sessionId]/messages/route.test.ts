import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks (must precede imports) ───────────────────────────────────────────

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
}))
vi.mock('@/lib/email', () => ({
  sendAgentConnectedEmail: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/shared/activity', () => ({
  logActivity: vi.fn().mockResolvedValue(undefined),
}))

// ── Imports ────────────────────────────────────────────────────────────────

import { GET, POST } from '@/app/api/admin/support/sessions/[sessionId]/messages/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryMany, queryOne } from '@/lib/shared/db'
import { sendAgentConnectedEmail } from '@/lib/email'
import { logActivity } from '@/lib/shared/activity'

// ── Helpers ────────────────────────────────────────────────────────────────

const ADMIN = {
  adminId: 'admin-uuid-1',
  role: 'super_admin',
  scopes: ['customers'],
  username: 'jsmith',
  first_name: 'John',
  last_name: 'Smith',
}
const SESSION_ID = 'session-uuid-1'
const PARAMS = { params: Promise.resolve({ sessionId: SESSION_ID }) }

function makeGet() {
  return new NextRequest(`http://localhost/api/admin/support/sessions/${SESSION_ID}/messages`, {
    method: 'GET',
  })
}

function makePost(body: object) {
  return new NextRequest(`http://localhost/api/admin/support/sessions/${SESSION_ID}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQueryMany = vi.mocked(queryMany)
const mockQueryOne = vi.mocked(queryOne)
const mockSendAgentConnected = vi.mocked(sendAgentConnectedEmail)
const mockLogActivity = vi.mocked(logActivity)

const OPEN_SESSION = { id: SESSION_ID, admin_name: null, user_id: 'user-uuid-1' }

// ── Tests ──────────────────────────────────────────────────────────────────

describe('GET /api/admin/support/sessions/[sessionId]/messages', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    mockQueryMany.mockResolvedValue([])
  })

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await GET(makeGet(), PARAMS)
    expect(res.status).toBe(401)
  })

  it('returns 403 when customers scope missing', async () => {
    mockHasScope.mockReturnValue(false)
    const res = await GET(makeGet(), PARAMS)
    expect(res.status).toBe(403)
  })

  it('returns messages array', async () => {
    mockQueryMany.mockResolvedValue([
      { id: 'm1', sender: 'user', message: 'Hello', created_at: new Date().toISOString() },
    ] as any)
    const res = await GET(makeGet(), PARAMS)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.messages).toHaveLength(1)
    expect(body.messages[0].sender).toBe('user')
  })

  it('returns 500 on db error', async () => {
    mockQueryMany.mockRejectedValue(new Error('DB error'))
    const res = await GET(makeGet(), PARAMS)
    expect(res.status).toBe(500)
  })
})

describe('POST /api/admin/support/sessions/[sessionId]/messages', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    // sendAgentConnectedEmail and logActivity must return Promises so .catch() in the route doesn't throw
    mockSendAgentConnected.mockResolvedValue(undefined as any)
    mockLogActivity.mockResolvedValue(undefined as any)
    // First queryOne: session lookup; Second: UPDATE session; Third: INSERT message; Fourth (optional): customer lookup
    mockQueryOne
      .mockResolvedValueOnce(OPEN_SESSION as any) // session
      .mockResolvedValueOnce(undefined as any) // UPDATE admin_name (returns undefined — ok)
      .mockResolvedValueOnce({
        id: 'm1',
        sender: 'admin',
        message: 'Hi there',
        created_at: new Date().toISOString(),
      } as any) // INSERT
      .mockResolvedValueOnce({ first_name: 'Alice', last_name: 'M', email: 'alice@example.com' } as any) // customer
  })

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await POST(makePost({ message: 'Hello' }), PARAMS)
    expect(res.status).toBe(401)
  })

  it('returns 403 when customers scope missing', async () => {
    mockHasScope.mockReturnValue(false)
    const res = await POST(makePost({ message: 'Hello' }), PARAMS)
    expect(res.status).toBe(403)
  })

  it('returns 404 when session not found or closed', async () => {
    mockQueryOne.mockReset().mockResolvedValueOnce(null)
    const res = await POST(makePost({ message: 'Hello' }), PARAMS)
    expect(res.status).toBe(404)
    expect((await res.json()).error).toMatch(/not found or closed/i)
  })

  it('returns 400 when message is empty', async () => {
    const res = await POST(makePost({ message: '' }), PARAMS)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/message is required/i)
  })

  it('returns 400 when message is whitespace only', async () => {
    const res = await POST(makePost({ message: '   ' }), PARAMS)
    expect(res.status).toBe(400)
  })

  it('sends message and returns it with sender_name', async () => {
    const res = await POST(makePost({ message: 'Hi there' }), PARAMS)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.message.sender).toBe('admin')
    expect(body.message.sender_name).toBe('John Smith')
    expect(body.message.is_closing).toBe(false)
  })

  it('sends agent connected email on first admin message', async () => {
    // admin_name is null => first agent message
    mockSendAgentConnected.mockResolvedValue(undefined as any)
    const res = await POST(makePost({ message: 'Hello customer!' }), PARAMS)
    expect(res.status).toBe(200)
    expect(mockSendAgentConnected).toHaveBeenCalledOnce()
  })

  it('does NOT send agent connected email when admin already named', async () => {
    mockQueryOne
      .mockReset()
      .mockResolvedValueOnce({ ...OPEN_SESSION, admin_name: 'John Smith' } as any)
      .mockResolvedValueOnce(undefined as any)
      .mockResolvedValueOnce({
        id: 'm2',
        sender: 'admin',
        message: 'Reply',
        created_at: new Date().toISOString(),
      } as any)
    mockSendAgentConnected.mockResolvedValue(undefined as any)

    const res = await POST(makePost({ message: 'Reply' }), PARAMS)
    expect(res.status).toBe(200)
    expect(mockSendAgentConnected).not.toHaveBeenCalled()
  })

  it('falls back to email when admin has no first/last name', async () => {
    mockAuth.mockResolvedValue({
      ...ADMIN,
      first_name: undefined,
      last_name: undefined,
      email: 'jsmith@example.com',
    } as any)
    mockSendAgentConnected.mockResolvedValue(undefined as any)
    const res = await POST(makePost({ message: 'Hi' }), PARAMS)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.message.sender_name).toBe('jsmith@example.com')
  })

  it('falls back to "Support" when admin has no name or email', async () => {
    mockAuth.mockResolvedValue({ ...ADMIN, first_name: undefined, last_name: undefined, email: undefined } as any)
    mockSendAgentConnected.mockResolvedValue(undefined as any)
    const res = await POST(makePost({ message: 'Hi' }), PARAMS)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.message.sender_name).toBe('Support')
  })

  it('returns 500 on db error', async () => {
    mockQueryOne.mockReset().mockRejectedValue(new Error('DB error'))
    const res = await POST(makePost({ message: 'Hi' }), PARAMS)
    expect(res.status).toBe(500)
  })
})
