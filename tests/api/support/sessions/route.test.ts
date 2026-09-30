/**
 * Tests for GET/POST /api/support/sessions
 * src/app/api/support/sessions/route.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── hoisted mocks ─────────────────────────────────────────────────────────────
const mockAuthenticateAnyUser = vi.hoisted(() => vi.fn())
const mockQueryOne = vi.hoisted(() => vi.fn())
const mockQueryMany = vi.hoisted(() => vi.fn())
const mockQuery = vi.hoisted(() => vi.fn())
const mockSendSupportEscalationEmail = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockLogActivity = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))

vi.mock('@/lib/jwt', () => ({
  authenticateAnyUser: mockAuthenticateAnyUser,
}))

vi.mock('@/lib/db', () => ({
  query: mockQuery,
  queryOne: mockQueryOne,
  queryMany: mockQueryMany,
  withTransaction: vi.fn(),
}))

vi.mock('@/lib/email', () => ({
  sendSupportEscalationEmail: mockSendSupportEscalationEmail,
}))

vi.mock('@/lib/activity', () => ({
  logActivity: mockLogActivity,
}))

import { GET, POST } from '@/app/api/support/sessions/route'

// ── helpers ───────────────────────────────────────────────────────────────────
function makeGet() {
  return new Request('http://localhost/api/support/sessions', { method: 'GET' })
}

function makePost(body: object = {}) {
  return new Request('http://localhost/api/support/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const AUTH_USER = { userId: 'user-1', email: 'user@example.com' }
const EXISTING_SESSION = { id: 'sess-1', status: 'open', created_at: new Date().toISOString(), admin_name: null }
const DB_USER = { first_name: 'John', last_name: 'Doe', email: 'user@example.com' }

// ── GET ───────────────────────────────────────────────────────────────────────
describe('GET /api/support/sessions', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockSendSupportEscalationEmail.mockResolvedValue(undefined)
    mockLogActivity.mockResolvedValue(undefined)
  })

  it('returns 401 when not authenticated', async () => {
    mockAuthenticateAnyUser.mockResolvedValue(null)
    const res = await GET(makeGet() as any)
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toMatch(/unauthorized/i)
  })

  it('returns null session when none exists', async () => {
    mockAuthenticateAnyUser.mockResolvedValue(AUTH_USER)
    mockQueryOne.mockResolvedValue(null)
    const res = await GET(makeGet() as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.session).toBeNull()
  })

  it('returns open session when one exists', async () => {
    mockAuthenticateAnyUser.mockResolvedValue(AUTH_USER)
    mockQueryOne.mockResolvedValue(EXISTING_SESSION)
    const res = await GET(makeGet() as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.session).toMatchObject({ id: 'sess-1', status: 'open' })
  })

  it('returns 500 on db error', async () => {
    mockAuthenticateAnyUser.mockResolvedValue(AUTH_USER)
    mockQueryOne.mockRejectedValue(new Error('db down'))
    const res = await GET(makeGet() as any)
    expect(res.status).toBe(500)
  })
})

// ── POST ──────────────────────────────────────────────────────────────────────
describe('POST /api/support/sessions', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockSendSupportEscalationEmail.mockResolvedValue(undefined)
    mockLogActivity.mockResolvedValue(undefined)
  })

  it('returns 401 when not authenticated', async () => {
    mockAuthenticateAnyUser.mockResolvedValue(null)
    const res = await POST(makePost() as any)
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toMatch(/unauthorized/i)
  })

  it('returns existing open session without creating new one', async () => {
    mockAuthenticateAnyUser.mockResolvedValue(AUTH_USER)
    // first queryOne = existing session check
    mockQueryOne.mockResolvedValue(EXISTING_SESSION)
    const res = await POST(makePost() as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.session).toMatchObject({ id: 'sess-1' })
  })

  it('creates new session when none exists and notifies admins', async () => {
    mockAuthenticateAnyUser.mockResolvedValue(AUTH_USER)
    const newSession = { id: 'sess-new', status: 'open', created_at: new Date().toISOString() }
    // Call sequence: existing check → null, insert → session, user lookup → user, admin emails → []
    mockQueryOne
      .mockResolvedValueOnce(null) // no existing
      .mockResolvedValueOnce(newSession) // inserted session
      .mockResolvedValueOnce(DB_USER) // user lookup
    mockQueryMany.mockResolvedValue([{ email: 'admin@example.com' }])
    const res = await POST(makePost() as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.session).toMatchObject({ id: 'sess-new' })
    expect(mockSendSupportEscalationEmail).toHaveBeenCalled()
  })

  it('creates session with productId (optional uuid field)', async () => {
    mockAuthenticateAnyUser.mockResolvedValue(AUTH_USER)
    const newSession = { id: 'sess-2', status: 'open', created_at: new Date().toISOString() }
    mockQueryOne.mockResolvedValueOnce(null).mockResolvedValueOnce(newSession).mockResolvedValueOnce(DB_USER)
    mockQueryMany.mockResolvedValue([])
    const res = await POST(makePost({ productId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' }) as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.session.id).toBe('sess-2')
  })

  it('returns 400 for invalid productId (not a uuid)', async () => {
    mockAuthenticateAnyUser.mockResolvedValue(AUTH_USER)
    const res = await POST(makePost({ productId: 'not-a-uuid' }) as any)
    expect(res.status).toBe(400)
  })

  it('handles case where user lookup returns null (skips email)', async () => {
    mockAuthenticateAnyUser.mockResolvedValue(AUTH_USER)
    const newSession = { id: 'sess-3', status: 'open', created_at: new Date().toISOString() }
    mockQueryOne.mockResolvedValueOnce(null).mockResolvedValueOnce(newSession).mockResolvedValueOnce(null) // user not found
    const res = await POST(makePost() as any)
    expect(res.status).toBe(200)
    expect(mockSendSupportEscalationEmail).not.toHaveBeenCalled()
  })

  it('appends ADMIN_EMAIL fallback when not in admin list', async () => {
    process.env.ADMIN_EMAIL = 'fallback@admin.com'
    mockAuthenticateAnyUser.mockResolvedValue(AUTH_USER)
    const newSession = { id: 'sess-4', status: 'open', created_at: new Date().toISOString() }
    mockQueryOne.mockResolvedValueOnce(null).mockResolvedValueOnce(newSession).mockResolvedValueOnce(DB_USER)
    mockQueryMany.mockResolvedValue([]) // no admin emails from DB
    const res = await POST(makePost() as any)
    expect(res.status).toBe(200)
    expect(mockSendSupportEscalationEmail).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.arrayContaining(['fallback@admin.com'])
    )
    delete process.env.ADMIN_EMAIL
  })

  it('returns 500 on unexpected db error', async () => {
    mockAuthenticateAnyUser.mockResolvedValue(AUTH_USER)
    mockQueryOne.mockRejectedValue(new Error('unexpected'))
    const res = await POST(makePost() as any)
    expect(res.status).toBe(500)
  })
})
