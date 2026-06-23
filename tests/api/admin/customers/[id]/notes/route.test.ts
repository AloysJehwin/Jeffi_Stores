import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks (must precede imports) ───────────────────────────────────────────

vi.mock('@/lib/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
}))
vi.mock('@/lib/activity', () => ({ logActivity: vi.fn().mockResolvedValue(undefined) }))

// ── Imports ────────────────────────────────────────────────────────────────

import { GET, POST, DELETE } from '@/app/api/admin/customers/[id]/notes/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { query, queryMany } from '@/lib/db'
import { logActivity } from '@/lib/activity'

// ── Helpers ────────────────────────────────────────────────────────────────

const ADMIN = { adminId: 'admin-uuid-1', role: 'super_admin', scopes: ['customers'] }
const CUSTOMER_ID = 'cust-uuid-1'
const PARAMS = { params: Promise.resolve({ id: CUSTOMER_ID }) }

function makeGet() {
  return new NextRequest(`http://localhost/api/admin/customers/${CUSTOMER_ID}/notes`, {
    method: 'GET',
  })
}

function makePost(body: object) {
  return new NextRequest(`http://localhost/api/admin/customers/${CUSTOMER_ID}/notes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function makeDelete(noteId?: string) {
  const url = noteId
    ? `http://localhost/api/admin/customers/${CUSTOMER_ID}/notes?noteId=${noteId}`
    : `http://localhost/api/admin/customers/${CUSTOMER_ID}/notes`
  return new NextRequest(url, { method: 'DELETE' })
}

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQuery = vi.mocked(query)
const mockQueryMany = vi.mocked(queryMany)

// ── Tests ──────────────────────────────────────────────────────────────────

describe('GET /api/admin/customers/[id]/notes', () => {
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

  it('returns notes array', async () => {
    mockQueryMany.mockResolvedValue([{ id: 'n1', body: 'Called customer' }] as any)
    const res = await GET(makeGet(), PARAMS)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.notes).toHaveLength(1)
    expect(body.notes[0].id).toBe('n1')
  })
})

describe('POST /api/admin/customers/[id]/notes', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    mockQuery.mockResolvedValue({ rowCount: 1 } as any)
  })

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await POST(makePost({ body: 'Note text' }), PARAMS)
    expect(res.status).toBe(401)
  })

  it('returns 403 when customers scope missing', async () => {
    mockHasScope.mockReturnValue(false)
    const res = await POST(makePost({ body: 'Note text' }), PARAMS)
    expect(res.status).toBe(403)
  })

  it('returns 400 when body is empty', async () => {
    const res = await POST(makePost({ body: '' }), PARAMS)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/required/i)
  })

  it('returns 400 when body is only whitespace', async () => {
    const res = await POST(makePost({ body: '   ' }), PARAMS)
    expect(res.status).toBe(400)
  })

  it('returns 400 when body exceeds 2000 chars', async () => {
    const res = await POST(makePost({ body: 'x'.repeat(2001) }), PARAMS)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/too long/i)
  })

  it('creates note and logs activity', async () => {
    const res = await POST(makePost({ body: 'Important customer note' }), PARAMS)
    expect(res.status).toBe(200)
    expect((await res.json()).success).toBe(true)
    expect(mockQuery).toHaveBeenCalledOnce()
    expect(vi.mocked(logActivity)).toHaveBeenCalledOnce()
  })

  it('truncates summary at 120 chars for long notes', async () => {
    const longNote = 'a'.repeat(200)
    const res = await POST(makePost({ body: longNote }), PARAMS)
    expect(res.status).toBe(200)
    const logCall = vi.mocked(logActivity).mock.calls[0][0]
    expect(logCall.summary.endsWith('…')).toBe(true)
    expect(logCall.summary.length).toBeLessThanOrEqual(121)
  })
})

describe('DELETE /api/admin/customers/[id]/notes', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    mockQuery.mockResolvedValue({ rowCount: 1 } as any)
  })

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await DELETE(makeDelete('note-1'), PARAMS)
    expect(res.status).toBe(401)
  })

  it('returns 403 when customers scope missing', async () => {
    mockHasScope.mockReturnValue(false)
    const res = await DELETE(makeDelete('note-1'), PARAMS)
    expect(res.status).toBe(403)
  })

  it('returns 400 when noteId query param is missing', async () => {
    const res = await DELETE(makeDelete(), PARAMS)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/noteId/i)
  })

  it('deletes note and returns success', async () => {
    const res = await DELETE(makeDelete('note-uuid-1'), PARAMS)
    expect(res.status).toBe(200)
    expect((await res.json()).success).toBe(true)
    expect(mockQuery).toHaveBeenCalledOnce()
  })
})
