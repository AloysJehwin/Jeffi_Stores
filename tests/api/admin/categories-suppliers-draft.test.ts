import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/scopes', () => ({ hasScope: vi.fn().mockReturnValue(true) }))

const mockQuery = vi.fn()
const mockQueryOne = vi.fn()
vi.mock('@/lib/db', () => ({
  query: (...a: any[]) => mockQuery(...a),
  queryOne: (...a: any[]) => mockQueryOne(...a),
  withTransaction: vi.fn(),
}))

import { authenticateAdmin } from '@/lib/jwt'
import { POST, PATCH, DELETE } from '@/app/api/admin/categories/[id]/draft/route'
import { POST as catPublish } from '@/app/api/admin/categories/[id]/publish/route'
import {
  GET as suppGet,
  PATCH as suppPatch,
  POST as suppPost,
  DELETE as suppDelete,
} from '@/app/api/admin/suppliers/[id]/draft/route'

const admin = { id: 'a1', role: 'super_admin', scopes: [] }

function req(method: string, body?: unknown, id = 'cat-1') {
  return new NextRequest(`http://localhost/${id}`, {
    method,
    body: body ? JSON.stringify(body) : undefined,
    headers: { 'Content-Type': 'application/json' },
  })
}

const catParams = Promise.resolve({ id: 'cat-1' })
const suppParams = Promise.resolve({ id: 'sup-1' })

describe('categories draft route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAdmin).mockResolvedValue(admin as any)
  })

  it('POST creates draft', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'cat-1' }) // category exists
    mockQueryOne.mockResolvedValueOnce(null) // no existing draft
    mockQuery.mockResolvedValueOnce({}) // INSERT
    const res = await POST(req('POST'), { params: catParams })
    const data = await res.json()
    expect(data.success).toBe(true)
  })

  it('POST returns 409 when draft already exists', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'cat-1' })
    mockQueryOne.mockResolvedValueOnce({ category_id: 'cat-1' })
    const res = await POST(req('POST'), { params: catParams })
    expect(res.status).toBe(409)
  })

  it('PATCH upserts draft fields', async () => {
    mockQuery.mockResolvedValueOnce({})
    const res = await PATCH(req('PATCH', { fields: { name: 'New Name' } }), { params: catParams })
    const data = await res.json()
    expect(data.success).toBe(true)
  })

  it('DELETE discards draft', async () => {
    mockQuery.mockResolvedValueOnce({})
    const res = await DELETE(req('DELETE'), { params: catParams })
    const data = await res.json()
    expect(data.success).toBe(true)
  })

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    const res = await POST(req('POST'), { params: catParams })
    expect(res.status).toBe(401)
  })
})

describe('categories publish route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAdmin).mockResolvedValue(admin as any)
  })

  it('returns 404 when no draft', async () => {
    mockQueryOne.mockResolvedValueOnce(null)
    const res = await catPublish(req('POST'), { params: catParams })
    expect(res.status).toBe(404)
  })

  it('publishes draft', async () => {
    mockQueryOne.mockResolvedValueOnce({ category_id: 'cat-1', fields: { name: 'Updated', is_active: true } })
    mockQueryOne.mockResolvedValueOnce({ is_active: true }) // prevIsActive
    const { withTransaction } = await import('@/lib/db')
    vi.mocked(withTransaction).mockImplementation(async (fn: any) => fn({ query: mockQuery }))
    mockQuery.mockResolvedValue({ rows: [] })
    const res = await catPublish(req('POST'), { params: catParams })
    const data = await res.json()
    expect(data.success).toBe(true)
  })
})

describe('suppliers draft route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAdmin).mockResolvedValue(admin as any)
  })

  it('GET returns draft_fields', async () => {
    mockQueryOne.mockResolvedValueOnce({ supplier_id: 'sup-1', fields: { name: 'ACME' } })
    const res = await suppGet(req('GET'), { params: suppParams })
    const data = await res.json()
    expect(data.draft_fields).toEqual({ name: 'ACME' })
  })

  it('GET returns null when no draft', async () => {
    mockQueryOne.mockResolvedValueOnce(null)
    const res = await suppGet(req('GET'), { params: suppParams })
    const data = await res.json()
    expect(data.draft_fields).toBeNull()
  })

  it('PATCH saves draft', async () => {
    mockQuery.mockResolvedValueOnce({})
    const res = await suppPatch(req('PATCH', { name: 'ACME' }), { params: suppParams })
    const data = await res.json()
    expect(data.success).toBe(true)
  })

  it('POST publishes draft', async () => {
    mockQueryOne.mockResolvedValueOnce({ supplier_id: 'sup-1', fields: { name: 'ACME', payment_terms: '30' } })
    mockQuery.mockResolvedValueOnce({})
    mockQuery.mockResolvedValueOnce({})
    const res = await suppPost(req('POST'), { params: suppParams })
    const data = await res.json()
    expect(data.success).toBe(true)
  })

  it('POST returns 404 when no draft', async () => {
    mockQueryOne.mockResolvedValueOnce(null)
    const res = await suppPost(req('POST'), { params: suppParams })
    expect(res.status).toBe(404)
  })

  it('DELETE discards draft', async () => {
    mockQuery.mockResolvedValueOnce({})
    const res = await suppDelete(req('DELETE'), { params: suppParams })
    const data = await res.json()
    expect(data.success).toBe(true)
  })
})
