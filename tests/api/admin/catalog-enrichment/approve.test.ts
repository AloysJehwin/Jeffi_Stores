import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks (before imports) ────────────────────────────────────────────────────

vi.mock('@/lib/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
}))
// Mock dynamic imports used inside reEmbedProduct
vi.mock('@/lib/rag', () => ({ embed: vi.fn() }))
vi.mock('pg', () => ({
  Pool: vi.fn(),
}))

// ── Imports ───────────────────────────────────────────────────────────────────

import { POST } from '@/app/api/admin/catalog-enrichment/[id]/approve/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { query, queryOne } from '@/lib/db'
import { Pool } from 'pg'

// ── Helpers ───────────────────────────────────────────────────────────────────

const ADMIN = { adminId: 'admin-uuid-1', role: 'admin', scopes: ['catalog_enrichment'] }
const PARAMS = { params: Promise.resolve({ id: 'enrich-1' }) }

function makePost() {
  return new NextRequest('http://localhost/api/admin/catalog-enrichment/enrich-1/approve', {
    method: 'POST',
  })
}

/** Re-arms the Pool mock (needed after vi.clearAllMocks clears call records). */
function armPoolMock() {
  const mockPool = {
    query: vi.fn().mockResolvedValue({ rows: [] }),
    end: vi.fn().mockResolvedValue(undefined),
  }
  vi.mocked(Pool).mockImplementation(function() { return mockPool } as any)
}

const ENRICHMENT_ROW = {
  id: 'enrich-1',
  product_id: 'prod-1',
  ai_description: 'A high-quality bolt',
  ai_use_cases: ['fastening', 'construction'],
  ai_keywords: ['bolt', 'm8'],
  ai_who_uses_it: 'Construction workers',
  ai_application: 'Industrial fastening',
  ai_product_type: 'Fastener',
  ai_features: ['stainless steel', 'corrosion resistant'],
  ai_search_tags: ['bolt', 'fastener'],
  status: 'proposed',
}

const PRODUCT_ROW = {
  name: 'Bolt M8',
  sku: 'BOLT-M8',
  ai_description: null,
  description: 'Standard bolt',
  ai_use_cases: null,
  ai_keywords: null,
  ai_who_uses_it: null,
  ai_application: null,
  ai_product_type: null,
  ai_features: null,
  ai_search_tags: null,
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/admin/catalog-enrichment/[id]/approve', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // vi.clearAllMocks does NOT flush mockResolvedValueOnce queues; reset
    // individual mocks so unconsumed Once values cannot leak across tests
    // when Vitest runs them in shuffled order.
    vi.mocked(queryOne).mockReset()
    vi.mocked(query).mockReset()
  })

  it('returns 401 when not authenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    const res = await POST(makePost(), PARAMS)
    expect(res.status).toBe(401)
  })

  it('returns 403 when missing catalog_enrichment scope', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(false)
    const res = await POST(makePost(), PARAMS)
    expect(res.status).toBe(403)
  })

  it('returns 404 when enrichment row not found', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(queryOne).mockResolvedValue(null as any)
    const res = await POST(makePost(), PARAMS)
    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ error: 'Enrichment not found' })
  })

  it('returns 400 when enrichment is not in proposed status', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(queryOne).mockResolvedValueOnce({ ...ENRICHMENT_ROW, status: 'approved' } as any)
    const res = await POST(makePost(), PARAMS)
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'Already approved' })
  })

  it('returns 400 when enrichment is rejected', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(queryOne).mockResolvedValueOnce({ ...ENRICHMENT_ROW, status: 'rejected' } as any)
    const res = await POST(makePost(), PARAMS)
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'Already rejected' })
  })

  it('marks reEmbedded false and embedError non-null when embed fails', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(query).mockResolvedValue(undefined as any)
    armPoolMock()

    // queryOne: first = enrichment row (top-level), second = product row (inside reEmbedProduct)
    // embed will throw so reEmbedProduct catch fires → { ok: false }
    vi.mocked(queryOne)
      .mockResolvedValueOnce(ENRICHMENT_ROW as any)
      .mockResolvedValueOnce(PRODUCT_ROW as any)

    const ragMod = await import('@/lib/rag')
    vi.mocked(ragMod.embed).mockRejectedValueOnce(new Error('embed service unavailable'))

    const res = await POST(makePost(), PARAMS)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.reEmbedded).toBe(false)
    expect(body.embedError).toBeTruthy()
  })

  it('approves enrichment, updates product, attempts re-embed and returns ok', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(query).mockResolvedValue(undefined as any)
    armPoolMock()

    // Mock dynamic import of @/lib/rag
    const ragMod = await import('@/lib/rag')
    vi.mocked(ragMod.embed).mockResolvedValue(Array(384).fill(0.1))

    // queryOne: first = enrichment row, second = product fetch inside reEmbedProduct
    vi.mocked(queryOne)
      .mockResolvedValueOnce(ENRICHMENT_ROW as any)
      .mockResolvedValueOnce(PRODUCT_ROW as any)

    const res = await POST(makePost(), PARAMS)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.promoted).toBe(true)
    // Two UPDATE queries for enrichment log + one for products
    expect(vi.mocked(query)).toHaveBeenCalledTimes(3)
  })

  it('calls approve and product update queries with correct args', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(queryOne)
      .mockResolvedValueOnce(ENRICHMENT_ROW as any)
      .mockResolvedValueOnce(null as any)
    vi.mocked(query).mockResolvedValue(undefined as any)

    await POST(makePost(), PARAMS)
    const queryCalls = vi.mocked(query).mock.calls
    // First call: mark approved
    expect(queryCalls[0][0]).toContain("status = 'approved'")
    expect(queryCalls[0][1]).toContain('admin-uuid-1')
    // Second call: update products
    expect(queryCalls[1][0]).toContain('UPDATE products')
    expect(queryCalls[1][1]).toContain('A high-quality bolt')
  })
})
