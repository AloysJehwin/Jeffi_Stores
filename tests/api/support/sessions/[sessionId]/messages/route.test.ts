/**
 * Tests for GET/POST /api/support/sessions/[sessionId]/messages
 * src/app/api/support/sessions/[sessionId]/messages/route.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── hoisted mocks ─────────────────────────────────────────────────────────────
const mockAuthenticateAnyUser = vi.hoisted(() => vi.fn())
const mockQueryOne = vi.hoisted(() => vi.fn())
const mockQueryMany = vi.hoisted(() => vi.fn())
const mockLogActivity = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))

vi.mock('@/lib/jwt', () => ({
  authenticateAnyUser: mockAuthenticateAnyUser,
}))

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: mockQueryOne,
  queryMany: mockQueryMany,
  withTransaction: vi.fn(),
}))

vi.mock('@/lib/activity', () => ({
  logActivity: mockLogActivity,
}))

import { GET, POST } from '@/app/api/support/sessions/[sessionId]/messages/route'

// ── helpers ───────────────────────────────────────────────────────────────────
const SESSION_ID = 'sess-abc'
const AUTH_USER = { userId: 'user-1', email: 'user@example.com' }
const OPEN_SESSION = { id: SESSION_ID, admin_name: 'Alice' }

function makeGet(sessionId: string) {
  return new Request(`http://localhost/api/support/sessions/${sessionId}/messages`, { method: 'GET' })
}

function makePost(sessionId: string, body: object) {
  return new Request(`http://localhost/api/support/sessions/${sessionId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

// ── GET ───────────────────────────────────────────────────────────────────────
describe('GET /api/support/sessions/[sessionId]/messages', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockLogActivity.mockResolvedValue(undefined)
  })

  it('returns 401 when not authenticated', async () => {
    mockAuthenticateAnyUser.mockResolvedValue(null)
    const res = await GET(makeGet(SESSION_ID) as any, { params: { sessionId: SESSION_ID } })
    expect(res.status).toBe(401)
  })

  it('returns 404 when session not found', async () => {
    mockAuthenticateAnyUser.mockResolvedValue(AUTH_USER)
    mockQueryOne.mockResolvedValue(null)
    const res = await GET(makeGet(SESSION_ID) as any, { params: { sessionId: SESSION_ID } })
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toMatch(/not found/i)
  })

  it('returns messages with metadata on success', async () => {
    mockAuthenticateAnyUser.mockResolvedValue(AUTH_USER)
    mockQueryOne.mockResolvedValue(OPEN_SESSION)
    mockQueryMany.mockResolvedValue([
      { id: 'msg-1', sender: 'user', message: 'hello', created_at: new Date().toISOString() },
      { id: 'msg-2', sender: 'admin', message: 'Hi, how can I help?', created_at: new Date().toISOString() },
    ])
    const res = await GET(makeGet(SESSION_ID) as any, { params: { sessionId: SESSION_ID } })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.messages).toHaveLength(2)
    expect(body.admin_name).toBe('Alice')
    // admin messages get sender_name
    expect(body.messages[1].sender_name).toBe('Alice')
    // user messages don't
    expect(body.messages[0].sender_name).toBeUndefined()
  })

  it('marks closing phrase messages as is_closing=true', async () => {
    mockAuthenticateAnyUser.mockResolvedValue(AUTH_USER)
    mockQueryOne.mockResolvedValue(OPEN_SESSION)
    mockQueryMany.mockResolvedValue([
      { id: 'msg-1', sender: 'admin', message: 'Thank you for contacting us!', created_at: new Date().toISOString() },
    ])
    const res = await GET(makeGet(SESSION_ID) as any, { params: { sessionId: SESSION_ID } })
    const body = await res.json()
    expect(body.messages[0].is_closing).toBe(true)
  })

  it('marks non-closing admin messages as is_closing=false', async () => {
    mockAuthenticateAnyUser.mockResolvedValue(AUTH_USER)
    mockQueryOne.mockResolvedValue(OPEN_SESSION)
    mockQueryMany.mockResolvedValue([
      { id: 'msg-1', sender: 'admin', message: 'Sure, let me check that for you.', created_at: new Date().toISOString() },
    ])
    const res = await GET(makeGet(SESSION_ID) as any, { params: { sessionId: SESSION_ID } })
    const body = await res.json()
    expect(body.messages[0].is_closing).toBe(false)
  })

  it('returns 500 on db error', async () => {
    mockAuthenticateAnyUser.mockResolvedValue(AUTH_USER)
    mockQueryOne.mockRejectedValue(new Error('boom'))
    const res = await GET(makeGet(SESSION_ID) as any, { params: { sessionId: SESSION_ID } })
    expect(res.status).toBe(500)
  })
})

// ── POST ──────────────────────────────────────────────────────────────────────
describe('POST /api/support/sessions/[sessionId]/messages', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockLogActivity.mockResolvedValue(undefined)
  })

  it('returns 401 when not authenticated', async () => {
    mockAuthenticateAnyUser.mockResolvedValue(null)
    const res = await POST(makePost(SESSION_ID, { message: 'hi' }) as any, { params: { sessionId: SESSION_ID } })
    expect(res.status).toBe(401)
  })

  it('returns 404 when session not found or closed', async () => {
    mockAuthenticateAnyUser.mockResolvedValue(AUTH_USER)
    mockQueryOne.mockResolvedValue(null)
    const res = await POST(makePost(SESSION_ID, { message: 'hi' }) as any, { params: { sessionId: SESSION_ID } })
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toMatch(/not found|closed/i)
  })

  it('returns 400 when message is empty', async () => {
    mockAuthenticateAnyUser.mockResolvedValue(AUTH_USER)
    mockQueryOne.mockResolvedValue(OPEN_SESSION)
    const res = await POST(makePost(SESSION_ID, { message: '   ' }) as any, { params: { sessionId: SESSION_ID } })
    expect(res.status).toBe(400)
  })

  it('returns 400 when message is missing', async () => {
    mockAuthenticateAnyUser.mockResolvedValue(AUTH_USER)
    mockQueryOne.mockResolvedValue(OPEN_SESSION)
    const res = await POST(makePost(SESSION_ID, {}) as any, { params: { sessionId: SESSION_ID } })
    expect(res.status).toBe(400)
  })

  it('inserts message and returns it on success', async () => {
    mockAuthenticateAnyUser.mockResolvedValue(AUTH_USER)
    const savedMsg = { id: 'msg-new', sender: 'user', message: 'Need help', created_at: new Date().toISOString() }
    mockQueryOne
      .mockResolvedValueOnce(OPEN_SESSION)  // session check
      .mockResolvedValueOnce(savedMsg)      // insert
    const res = await POST(makePost(SESSION_ID, { message: 'Need help' }) as any, { params: { sessionId: SESSION_ID } })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.message).toMatchObject({ id: 'msg-new', sender: 'user' })
    expect(mockLogActivity).toHaveBeenCalled()
  })

  it('returns 400 for message exceeding 2000 chars', async () => {
    mockAuthenticateAnyUser.mockResolvedValue(AUTH_USER)
    mockQueryOne.mockResolvedValue(OPEN_SESSION)
    const longMsg = 'x'.repeat(2001)
    const res = await POST(makePost(SESSION_ID, { message: longMsg }) as any, { params: { sessionId: SESSION_ID } })
    expect(res.status).toBe(400)
  })

  it('returns 500 on db error', async () => {
    mockAuthenticateAnyUser.mockResolvedValue(AUTH_USER)
    mockQueryOne.mockRejectedValue(new Error('db error'))
    const res = await POST(makePost(SESSION_ID, { message: 'help' }) as any, { params: { sessionId: SESSION_ID } })
    expect(res.status).toBe(500)
  })
})
