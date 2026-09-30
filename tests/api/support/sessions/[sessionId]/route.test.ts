/**
 * Tests for PATCH /api/support/sessions/[sessionId]
 * src/app/api/support/sessions/[sessionId]/route.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── hoisted mocks ─────────────────────────────────────────────────────────────
const mockAuthenticateAnyUser = vi.hoisted(() => vi.fn())
const mockQueryOne = vi.hoisted(() => vi.fn())
const mockQuery = vi.hoisted(() => vi.fn())

vi.mock('@/lib/auth/jwt', () => ({
  authenticateAnyUser: mockAuthenticateAnyUser,
}))

vi.mock('@/lib/shared/db', () => ({
  query: mockQuery,
  queryOne: mockQueryOne,
  queryMany: vi.fn(),
  withTransaction: vi.fn(),
}))

import { PATCH } from '@/app/api/support/sessions/[sessionId]/route'

// ── helpers ───────────────────────────────────────────────────────────────────
function makePatch(sessionId: string) {
  return new Request(`http://localhost/api/support/sessions/${sessionId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
}

const AUTH_USER = { userId: 'user-1', email: 'user@example.com' }

// ── tests ─────────────────────────────────────────────────────────────────────
describe('PATCH /api/support/sessions/[sessionId]', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('returns 401 when not authenticated', async () => {
    mockAuthenticateAnyUser.mockResolvedValue(null)
    const res = await PATCH(makePatch('sess-1') as any, { params: Promise.resolve({ sessionId: 'sess-1' }) })
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toMatch(/unauthorized/i)
  })

  it('returns 404 when session does not belong to user', async () => {
    mockAuthenticateAnyUser.mockResolvedValue(AUTH_USER)
    mockQueryOne.mockResolvedValue(null)
    const res = await PATCH(makePatch('sess-x') as any, { params: Promise.resolve({ sessionId: 'sess-x' }) })
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toMatch(/not found/i)
  })

  it('closes session and deletes websocket connections on success', async () => {
    mockAuthenticateAnyUser.mockResolvedValue(AUTH_USER)
    mockQueryOne.mockResolvedValue({ id: 'sess-1' })
    mockQuery.mockResolvedValue({ rows: [] })
    const res = await PATCH(makePatch('sess-1') as any, { params: Promise.resolve({ sessionId: 'sess-1' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    // Should have made two query calls: UPDATE + DELETE
    expect(mockQuery).toHaveBeenCalledTimes(2)
    expect(mockQuery).toHaveBeenCalledWith(expect.stringMatching(/UPDATE support_sessions/), expect.any(Array))
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringMatching(/DELETE FROM websocket_connections/),
      expect.any(Array)
    )
  })

  it('returns 500 on db error', async () => {
    mockAuthenticateAnyUser.mockResolvedValue(AUTH_USER)
    mockQueryOne.mockRejectedValue(new Error('db error'))
    const res = await PATCH(makePatch('sess-1') as any, { params: Promise.resolve({ sessionId: 'sess-1' }) })
    expect(res.status).toBe(500)
  })
})
