import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks (before imports) ────────────────────────────────────────────────────

vi.mock('@/lib/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/db', () => ({ query: vi.fn(), queryMany: vi.fn(), queryOne: vi.fn() }))
// reEmbed imports these dynamically — mock them
vi.mock('@/lib/rag', () => ({ embed: vi.fn() }))
vi.mock('pg', () => ({
  Pool: vi.fn().mockImplementation(() => ({
    query: vi.fn().mockResolvedValue({}),
    end: vi.fn().mockResolvedValue(undefined),
  })),
}))

// ── Imports ───────────────────────────────────────────────────────────────────

import { POST } from '@/app/api/admin/catalog-enrichment/bulk-approve/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { query, queryMany } from '@/lib/db'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQuery = vi.mocked(query)
const mockQueryMany = vi.mocked(queryMany)

// ── Helpers ───────────────────────────────────────────────────────────────────

const admin = { adminId: 'admin-uuid-1', role: 'super_admin', scopes: ['catalog_enrichment'] }

function makeRequest(body: unknown) {
  return new NextRequest('http://localhost/api/admin/catalog-enrichment/bulk-approve', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const sampleRows = [
  {
    id: 'log-1',
    product_id: 'prod-1',
    ai_description: 'A great bolt',
    ai_use_cases: ['fastening'],
    ai_keywords: ['bolt', 'fastener'],
    ai_who_uses_it: 'Engineers',
    ai_application: 'Construction',
    ai_product_type: 'Fastener',
    ai_features: ['stainless'],
    ai_search_tags: ['bolt'],
  },
  {
    id: 'log-2',
    product_id: 'prod-2',
    ai_description: 'A nut',
    ai_use_cases: ['assembly'],
    ai_keywords: null,
    ai_who_uses_it: null,
    ai_application: null,
    ai_product_type: null,
    ai_features: null,
    ai_search_tags: null,
  },
]

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/admin/catalog-enrichment/bulk-approve', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await POST(makeRequest({ ids: ['id-1'] }))
    expect(res.status).toBe(401)
    expect((await res.json()).error).toMatch(/unauthorized/i)
  })

  it('returns 403 when scope missing', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(false)
    const res = await POST(makeRequest({ ids: ['id-1'] }))
    expect(res.status).toBe(403)
  })

  it('returns 400 when ids is empty', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    const res = await POST(makeRequest({ ids: [] }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/no ids/i)
  })

  it('returns 400 when ids count exceeds 200', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    const ids = Array.from({ length: 201 }, (_, i) => `id-${i}`)
    const res = await POST(makeRequest({ ids }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/max 200/i)
  })

  it('returns processed:0 when no proposed rows match', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryMany.mockResolvedValue([])

    const res = await POST(makeRequest({ ids: ['id-1', 'id-2'] }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.processed).toBe(0)
  })

  it('rejects (marks rejected) rows when action=reject', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryMany.mockResolvedValue(sampleRows as any)
    mockQuery.mockResolvedValue(undefined as any)

    const res = await POST(makeRequest({ ids: ['log-1', 'log-2'], action: 'reject' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.processed).toBe(2)
    expect(body.action).toBe('rejected')
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("status = 'rejected'"),
      expect.arrayContaining([admin.adminId])
    )
  })

  it('approves rows: updates log, updates products, triggers reEmbed', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryMany.mockResolvedValue(sampleRows as any)
    mockQuery.mockResolvedValue(undefined as any)

    // reEmbed calls queryOne from @/lib/db via dynamic import.
    // Since that module is mocked, the dynamic import re-uses the mock.
    // We need queryOne to be called from within reEmbed — it returns null
    // meaning reEmbed returns false (can't embed), which is fine.
    const { queryOne } = await import('@/lib/db')
    vi.mocked(queryOne).mockResolvedValue(null)

    const res = await POST(makeRequest({ ids: ['log-1', 'log-2'] }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.processed).toBe(2)
    expect(body.action).toBe('approved')
    // Should have approved in log
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("status = 'approved'"),
      expect.any(Array)
    )
    // Should have updated products for each row
    const productUpdateCalls = mockQuery.mock.calls.filter(c =>
      typeof c[0] === 'string' && (c[0] as string).includes('UPDATE products')
    )
    expect(productUpdateCalls.length).toBe(2)
  })

  it('treats missing action as approve', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryMany.mockResolvedValue([sampleRows[0]] as any)
    mockQuery.mockResolvedValue(undefined as any)
    const { queryOne } = await import('@/lib/db')
    vi.mocked(queryOne).mockResolvedValue(null)

    const res = await POST(makeRequest({ ids: ['log-1'] })) // no action field
    const body = await res.json()
    expect(body.action).toBe('approved')
  })

  it('defaults ids to empty array when not an array', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)

    const res = await POST(makeRequest({ ids: 'not-an-array' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/no ids/i)
  })
})
