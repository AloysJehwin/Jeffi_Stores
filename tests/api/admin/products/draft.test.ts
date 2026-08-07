import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/jwt', () => ({
  authenticateAdmin: vi.fn(),
}))

vi.mock('@/lib/scopes', () => ({
  hasScope: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  queryOne: vi.fn(),
}))

vi.mock('@/lib/validate', () => ({
  parseBody: vi.fn(),
  zNonEmpty: 'zNonEmpty',
}))

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { POST } from '@/app/api/admin/products/draft/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne } from '@/lib/db'
import { parseBody } from '@/lib/validate'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQueryOne = vi.mocked(queryOne)
const mockParseBody = vi.mocked(parseBody)

// ── Helpers ───────────────────────────────────────────────────────────────────

const adminPayload = {
  adminId: 'admin-1',
  username: 'testadmin',
  role: 'admin',
  scopes: ['products'],
}

function makeRequest(body: unknown) {
  return new NextRequest('http://localhost/api/admin/products/draft', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: 'admin_sid=valid-token' },
    body: JSON.stringify(body),
  })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/admin/products/draft', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await POST(makeRequest({ name: 'New Product' }))
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toMatch(/unauthorized/i)
  })

  it('returns 403 when products scope is missing', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(false)
    const res = await POST(makeRequest({ name: 'New Product' }))
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toMatch(/insufficient/i)
  })

  it('returns validation error when parseBody fails', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    const errorResponse = new Response(JSON.stringify({ error: 'name is required' }), { status: 422 })
    mockParseBody.mockReturnValue({ ok: false, response: errorResponse } as any)
    const res = await POST(makeRequest({}))
    expect(res.status).toBe(422)
  })

  it('returns 400 when name is empty string after parseBody passes', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockParseBody.mockReturnValue({ ok: true } as any)
    const res = await POST(makeRequest({ name: '   ' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/name required/i)
  })

  it('creates draft product and returns id, name, sku on success', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockParseBody.mockReturnValue({ ok: true } as any)
    mockQueryOne.mockResolvedValue({ id: 'prod-draft-1' })

    const res = await POST(makeRequest({ name: 'My New Product' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.id).toBe('prod-draft-1')
    expect(body.name).toBe('My New Product')
    expect(body.sku).toMatch(/^MY-NEW-PRODUCT/)
  })

  it('generates slug with timestamp suffix', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockParseBody.mockReturnValue({ ok: true } as any)
    mockQueryOne.mockResolvedValue({ id: 'prod-draft-2' })

    await POST(makeRequest({ name: 'Test Slug Product' }))
    const callArgs = mockQueryOne.mock.calls[0]!
    // slug should be lowercase with dashes + timestamp
    expect(callArgs[1]![1]).toMatch(/^test-slug-product-[a-z0-9]+$/)
  })

  it('strips name to 16 chars for the SKU prefix', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockParseBody.mockReturnValue({ ok: true } as any)
    mockQueryOne.mockResolvedValue({ id: 'prod-draft-3' })

    await POST(makeRequest({ name: 'A Very Long Product Name That Exceeds Limit' }))
    const callArgs = mockQueryOne.mock.calls[0]!
    const sku: string = callArgs[1]![2]
    // SKU prefix is max 16 chars + dash + 4 char suffix
    const prefix = sku.split('-').slice(0, -1).join('-')
    expect(prefix.length).toBeLessThanOrEqual(16 + 5) // a bit of slack for dashes
  })

  it('uses DRAFT as SKU prefix when name produces empty slug', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockParseBody.mockReturnValue({ ok: true } as any)
    mockQueryOne.mockResolvedValue({ id: 'prod-draft-4' })

    // Name with only special characters -> nameSlug becomes empty
    await POST(makeRequest({ name: '---' }))
    const callArgs = mockQueryOne.mock.calls[0]!
    const sku: string = callArgs[1]![2]
    expect(sku).toMatch(/^DRAFT-/)
  })

  it('returns 500 when DB insert fails', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockParseBody.mockReturnValue({ ok: true } as any)
    mockQueryOne.mockResolvedValue(null) // insert returns null -> throws 'Insert failed'

    const res = await POST(makeRequest({ name: 'Product X' }))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('Insert failed')
  })

  it('returns 500 on unexpected DB error', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockParseBody.mockReturnValue({ ok: true } as any)
    mockQueryOne.mockRejectedValue(new Error('Connection lost'))

    const res = await POST(makeRequest({ name: 'Product Y' }))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('Connection lost')
  })
})
