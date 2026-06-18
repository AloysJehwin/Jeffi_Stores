import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks (before imports) ────────────────────────────────────────────────────

vi.mock('@/lib/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/db', () => ({ queryOne: vi.fn(), queryMany: vi.fn(), query: vi.fn() }))

// ── Imports ───────────────────────────────────────────────────────────────────

import { GET, PATCH, DELETE } from '@/app/api/admin/review-forms/[id]/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne, queryMany } from '@/lib/db'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQueryOne = vi.mocked(queryOne)
const mockQueryMany = vi.mocked(queryMany)

// ── Helpers ───────────────────────────────────────────────────────────────────

const admin = { adminId: 'admin-1', username: 'testadmin', role: 'super_admin', scopes: ['review_forms'] }

function makeGet(id: string) {
  return new NextRequest(`http://localhost/api/admin/review-forms/${id}`)
}

function makePatch(id: string, body: unknown) {
  return new NextRequest(`http://localhost/api/admin/review-forms/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function makeDelete(id: string) {
  return new NextRequest(`http://localhost/api/admin/review-forms/${id}`, {
    method: 'DELETE',
  })
}

const sampleForm = {
  id: 'form-1',
  title: 'Product Review',
  slug: 'product-review',
  is_active: true,
  custom_fields: [],
}

// ── Tests: GET ────────────────────────────────────────────────────────────────

describe('GET /api/admin/review-forms/[id]', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await GET(makeGet('form-1'), { params: { id: 'form-1' } })
    expect(res.status).toBe(401)
    expect((await res.json()).error).toMatch(/unauthorized/i)
  })

  it('returns 403 when scope missing', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(false)
    const res = await GET(makeGet('form-1'), { params: { id: 'form-1' } })
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatch(/insufficient/i)
  })

  it('returns 404 when form not found', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue(null)
    const res = await GET(makeGet('form-999'), { params: { id: 'form-999' } })
    expect(res.status).toBe(404)
    expect((await res.json()).error).toMatch(/not found/i)
  })

  it('returns form on success', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue(sampleForm)
    const res = await GET(makeGet('form-1'), { params: { id: 'form-1' } })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.form.id).toBe('form-1')
    expect(body.form.title).toBe('Product Review')
  })

  it('queries by the provided id param', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue(sampleForm)
    await GET(makeGet('form-abc'), { params: { id: 'form-abc' } })
    expect(mockQueryOne).toHaveBeenCalledWith(
      expect.stringContaining('review_forms'),
      ['form-abc']
    )
  })
})

// ── Tests: PATCH ──────────────────────────────────────────────────────────────

describe('PATCH /api/admin/review-forms/[id]', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await PATCH(makePatch('form-1', { title: 'New' }), { params: { id: 'form-1' } })
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope missing', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(false)
    const res = await PATCH(makePatch('form-1', { title: 'New' }), { params: { id: 'form-1' } })
    expect(res.status).toBe(403)
  })

  it('returns 400 when no recognized fields in body', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    const res = await PATCH(makePatch('form-1', { unknown_field: 'value' }), { params: { id: 'form-1' } })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/no fields to update/i)
  })

  it('updates title field', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryMany.mockResolvedValue([{ ...sampleForm, title: 'Updated Title' }] as any)

    const res = await PATCH(makePatch('form-1', { title: 'Updated Title' }), { params: { id: 'form-1' } })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.form.title).toBe('Updated Title')
  })

  it('lowercases and trims slug field', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryMany.mockResolvedValue([{ ...sampleForm, slug: 'my-slug' }] as any)

    await PATCH(makePatch('form-1', { slug: '  My-Slug  ' }), { params: { id: 'form-1' } })
    const sql = mockQueryMany.mock.calls[0][0] as string
    const vals = mockQueryMany.mock.calls[0][1] as any[]
    expect(sql).toContain('slug =')
    expect(vals).toContain('my-slug')
  })

  it('JSON.stringifies custom_fields', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    const customFields = [{ name: 'rating', type: 'number' }]
    mockQueryMany.mockResolvedValue([{ ...sampleForm, custom_fields: customFields }] as any)

    await PATCH(makePatch('form-1', { custom_fields: customFields }), { params: { id: 'form-1' } })
    const vals = mockQueryMany.mock.calls[0][1] as any[]
    expect(vals).toContain(JSON.stringify(customFields))
  })

  it('updates multiple fields at once', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryMany.mockResolvedValue([sampleForm] as any)

    await PATCH(makePatch('form-1', { title: 'T', is_active: false, description: 'D' }), { params: { id: 'form-1' } })
    const sql = mockQueryMany.mock.calls[0][0] as string
    expect(sql).toContain('title =')
    expect(sql).toContain('is_active =')
    expect(sql).toContain('description =')
  })

  it('returns 404 when update affects no rows', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryMany.mockResolvedValue([]) // no rows returned from RETURNING *

    const res = await PATCH(makePatch('form-999', { title: 'Nope' }), { params: { id: 'form-999' } })
    expect(res.status).toBe(404)
    expect((await res.json()).error).toMatch(/not found/i)
  })

  it('passes id as last param in UPDATE', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryMany.mockResolvedValue([sampleForm] as any)

    await PATCH(makePatch('form-42', { title: 'New' }), { params: { id: 'form-42' } })
    const vals = mockQueryMany.mock.calls[0][1] as any[]
    expect(vals[vals.length - 1]).toBe('form-42')
  })

  it('updates google_review_url field', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryMany.mockResolvedValue([sampleForm] as any)

    await PATCH(makePatch('form-1', { google_review_url: 'https://g.co/review' }), { params: { id: 'form-1' } })
    const sql = mockQueryMany.mock.calls[0][0] as string
    expect(sql).toContain('google_review_url =')
  })
})

// ── Tests: DELETE ─────────────────────────────────────────────────────────────

describe('DELETE /api/admin/review-forms/[id]', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await DELETE(makeDelete('form-1'), { params: { id: 'form-1' } })
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope missing', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(false)
    const res = await DELETE(makeDelete('form-1'), { params: { id: 'form-1' } })
    expect(res.status).toBe(403)
  })

  it('deletes the form and returns success', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue(undefined as any)

    const res = await DELETE(makeDelete('form-1'), { params: { id: 'form-1' } })
    expect(res.status).toBe(200)
    expect((await res.json()).success).toBe(true)
    expect(mockQueryOne).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM review_forms'),
      ['form-1']
    )
  })
})
