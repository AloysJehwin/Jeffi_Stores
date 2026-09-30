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
vi.mock('@/lib/shared/activity', () => ({ logActivity: vi.fn().mockResolvedValue(undefined) }))

// ── Imports ────────────────────────────────────────────────────────────────

import { GET, POST, DELETE } from '@/app/api/admin/customers/[id]/tags/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { query, queryMany } from '@/lib/shared/db'
import { logActivity } from '@/lib/shared/activity'

// ── Helpers ────────────────────────────────────────────────────────────────

const ADMIN = { adminId: 'admin-uuid-1', role: 'super_admin', scopes: ['customers'] }
const CUSTOMER_ID = 'cust-uuid-1'
const PARAMS = { params: Promise.resolve({ id: CUSTOMER_ID }) }

function makeGet() {
  return new NextRequest(`http://localhost/api/admin/customers/${CUSTOMER_ID}/tags`, {
    method: 'GET',
  })
}

function makePost(body: object) {
  return new NextRequest(`http://localhost/api/admin/customers/${CUSTOMER_ID}/tags`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function makeDelete(tag?: string) {
  const url = tag
    ? `http://localhost/api/admin/customers/${CUSTOMER_ID}/tags?tag=${encodeURIComponent(tag)}`
    : `http://localhost/api/admin/customers/${CUSTOMER_ID}/tags`
  return new NextRequest(url, { method: 'DELETE' })
}

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQuery = vi.mocked(query)
const mockQueryMany = vi.mocked(queryMany)

// ── Tests ──────────────────────────────────────────────────────────────────

describe('GET /api/admin/customers/[id]/tags', () => {
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

  it('returns tags array', async () => {
    mockQueryMany.mockResolvedValue([{ id: 't1', tag: 'vip' }] as any)
    const res = await GET(makeGet(), PARAMS)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.tags).toHaveLength(1)
    expect(body.tags[0].tag).toBe('vip')
  })
})

describe('POST /api/admin/customers/[id]/tags', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    mockQuery.mockResolvedValue({ rowCount: 1 } as any)
  })

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await POST(makePost({ tag: 'vip' }), PARAMS)
    expect(res.status).toBe(401)
  })

  it('returns 403 when customers scope missing', async () => {
    mockHasScope.mockReturnValue(false)
    const res = await POST(makePost({ tag: 'vip' }), PARAMS)
    expect(res.status).toBe(403)
  })

  it('returns 400 when tag is empty', async () => {
    const res = await POST(makePost({ tag: '' }), PARAMS)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/required/i)
  })

  it('returns 400 when tag is only whitespace', async () => {
    const res = await POST(makePost({ tag: '   ' }), PARAMS)
    expect(res.status).toBe(400)
  })

  it('adds tag and logs activity', async () => {
    const res = await POST(makePost({ tag: 'Premium Customer' }), PARAMS)
    expect(res.status).toBe(200)
    expect((await res.json()).success).toBe(true)
    expect(mockQuery).toHaveBeenCalledOnce()
    expect(vi.mocked(logActivity)).toHaveBeenCalledOnce()
  })

  it('lowercases and trims tag before storing', async () => {
    await POST(makePost({ tag: '  VIP  ' }), PARAMS)
    const logCall = vi.mocked(logActivity).mock.calls[0][0]
    expect(logCall.metadata?.tag).toBe('vip')
  })
})

describe('DELETE /api/admin/customers/[id]/tags', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    mockQuery.mockResolvedValue({ rowCount: 1 } as any)
  })

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await DELETE(makeDelete('vip'), PARAMS)
    expect(res.status).toBe(401)
  })

  it('returns 403 when customers scope missing', async () => {
    mockHasScope.mockReturnValue(false)
    const res = await DELETE(makeDelete('vip'), PARAMS)
    expect(res.status).toBe(403)
  })

  it('returns 400 when tag query param is missing', async () => {
    const res = await DELETE(makeDelete(), PARAMS)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/tag query param/i)
  })

  it('deletes tag, logs activity and returns success', async () => {
    const res = await DELETE(makeDelete('vip'), PARAMS)
    expect(res.status).toBe(200)
    expect((await res.json()).success).toBe(true)
    expect(mockQuery).toHaveBeenCalledOnce()
    expect(vi.mocked(logActivity)).toHaveBeenCalledOnce()
  })
})
