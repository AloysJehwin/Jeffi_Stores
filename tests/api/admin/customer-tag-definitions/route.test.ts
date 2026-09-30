import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks (before imports) ────────────────────────────────────────────────────

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({
  query: vi.fn(),
  queryMany: vi.fn(),
}))

// ── Imports ───────────────────────────────────────────────────────────────────

import { GET, POST, DELETE } from '@/app/api/(admin)/admin/customer-tag-definitions/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { query, queryMany } from '@/lib/shared/db'

// ── Helpers ───────────────────────────────────────────────────────────────────

const ADMIN = { adminId: 'a1', role: 'admin', scopes: ['customers'] }
const SUPER_ADMIN = { adminId: 'a2', role: 'super_admin', scopes: ['customers'] }

function makeGet(qs = '') {
  return new NextRequest(`http://localhost/api/admin/customer-tag-definitions${qs}`)
}

function makePost(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/admin/customer-tag-definitions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function makeDelete(id?: string) {
  return new NextRequest(`http://localhost/api/admin/customer-tag-definitions${id ? `?id=${id}` : ''}`, {
    method: 'DELETE',
  })
}

const TAG_DEFS = [{ id: 't1', tag: 'vip', color: 'gold', sort_order: 10 }]

// ── GET tests ─────────────────────────────────────────────────────────────────

describe('GET /api/admin/customer-tag-definitions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when not authenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    const res = await GET(makeGet())
    expect(res.status).toBe(401)
  })

  it('returns 403 when missing customers scope', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(false)
    const res = await GET(makeGet())
    expect(res.status).toBe(403)
  })

  it('returns definitions array', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(queryMany).mockResolvedValue(TAG_DEFS as any)
    const res = await GET(makeGet())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.definitions).toEqual(TAG_DEFS)
  })

  it('returns empty array when queryMany returns null', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(queryMany).mockResolvedValue(null as any)
    const res = await GET(makeGet())
    const body = await res.json()
    expect(body.definitions).toEqual([])
  })
})

// ── POST tests ────────────────────────────────────────────────────────────────

describe('POST /api/admin/customer-tag-definitions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when not authenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    const res = await POST(makePost({ tag: 'vip', color: 'gold' }))
    expect(res.status).toBe(401)
  })

  it('returns 403 when missing customers:write scope', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(false)
    const res = await POST(makePost({ tag: 'vip', color: 'gold' }))
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ error: 'Insufficient permissions' })
  })

  it('returns 400 when tag is empty', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(SUPER_ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(queryMany).mockResolvedValue([{ sort_order: 10 }] as any)
    const res = await POST(makePost({ tag: '  ', color: 'gold' }))
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'Tag is required' })
  })

  it('inserts tag and returns success', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(SUPER_ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(queryMany).mockResolvedValue([{ sort_order: 20 }] as any)
    vi.mocked(query).mockResolvedValue(undefined as any)
    const res = await POST(makePost({ tag: 'NEW CUSTOMER', color: 'blue' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ success: true })
    const callArgs = vi.mocked(query).mock.calls[0][1] as any[]
    expect(callArgs[0]).toBe('new-customer')
    expect(callArgs[1]).toBe('blue')
    expect(callArgs[2]).toBe(30)
  })

  it('uses default color accent when color not provided', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(SUPER_ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(queryMany).mockResolvedValue([])
    vi.mocked(query).mockResolvedValue(undefined as any)
    await POST(makePost({ tag: 'wholesale' }))
    const callArgs = vi.mocked(query).mock.calls[0][1] as any[]
    expect(callArgs[1]).toBe('accent')
  })

  it('uses sort_order 10 when no existing tags', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(SUPER_ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(queryMany).mockResolvedValue([])
    vi.mocked(query).mockResolvedValue(undefined as any)
    await POST(makePost({ tag: 'first' }))
    const callArgs = vi.mocked(query).mock.calls[0][1] as any[]
    expect(callArgs[2]).toBe(10)
  })

  it('returns 409 on duplicate tag (code 23505)', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(SUPER_ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(queryMany).mockResolvedValue([])
    const err = Object.assign(new Error('dup'), { code: '23505' })
    vi.mocked(query).mockRejectedValue(err)
    const res = await POST(makePost({ tag: 'vip' }))
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ error: 'Tag already exists' })
  })

  it('rethrows non-duplicate errors', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(SUPER_ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(queryMany).mockResolvedValue([])
    vi.mocked(query).mockRejectedValue(new Error('db crash'))
    await expect(POST(makePost({ tag: 'vip' }))).rejects.toThrow('db crash')
  })
})

// ── DELETE tests ──────────────────────────────────────────────────────────────

describe('DELETE /api/admin/customer-tag-definitions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when not authenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    const res = await DELETE(makeDelete('t1'))
    expect(res.status).toBe(401)
  })

  it('returns 403 when missing customers:write scope', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(false)
    const res = await DELETE(makeDelete('t1'))
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ error: 'Insufficient permissions' })
  })

  it('returns 400 when id missing', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(SUPER_ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    const res = await DELETE(makeDelete())
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'id required' })
  })

  it('deletes tag and returns success', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(SUPER_ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(query).mockResolvedValue(undefined as any)
    const res = await DELETE(makeDelete('t1'))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ success: true })
    expect(vi.mocked(query)).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM customer_tag_definitions'), [
      't1',
    ])
  })
})
