import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  withTransaction: vi.fn(),
}))

vi.mock('@/lib/jwt', () => ({
  authenticateAdmin: vi.fn(),
}))

vi.mock('@/lib/scopes', () => ({
  hasScope: vi.fn(),
}))

import { POST } from '@/app/api/admin/catalog-enrichment/run-all/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import * as db from '@/lib/db'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQueryMany = vi.mocked(db.queryMany)
const mockQuery = vi.mocked(db.query)

const admin = {
  adminId: 'a1', username: 'admin', role: 'super_admin',
  scopes: ['catalog_enrichment'],
  first_name: 'Test', last_name: 'Admin',
}

function makeReq() {
  return new NextRequest('http://localhost/api/admin/catalog-enrichment/run-all', {
    method: 'POST',
  })
}

// A valid enrichment JSON that satisfies parseEnrichment validation
const VALID_ENRICHMENT = JSON.stringify({
  ai_description: 'A high-strength M6 hex bolt used in structural applications.',
  ai_use_cases: ['fasten metal panels', 'machine assembly', 'structural joining'],
  ai_keywords: ['hex bolt', 'hex screw', 'six-sided bolt', 'm6 bolt'],
  ai_who_uses_it: 'engineers, fabricators, contractors',
  ai_application: 'Used to join metal components in machinery and construction.',
  ai_product_type: 'Hex Bolt',
  ai_features: ['grade 8.8', 'zinc plated', 'full thread'],
  ai_search_tags: ['fastener', 'bolt', 'metric', 'hardware'],
})

// A single product candidate
const ONE_CANDIDATE = [
  { id: 'p1', name: 'Bolt M6', description: null, sku: 'B1', material: 'steel', size: 'M6', category_name: 'Fasteners', brand_name: 'Unbrako' },
]

beforeEach(() => { vi.clearAllMocks() })
afterEach(() => { vi.useRealTimers() })

describe('POST /api/admin/catalog-enrichment/run-all', () => {
  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await POST(makeReq())
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope missing', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(false)
    const res = await POST(makeReq())
    expect(res.status).toBe(403)
  })

  it('returns queued 0 when no candidates', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryMany.mockResolvedValue([])
    const res = await POST(makeReq())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.queued).toBe(0)
    expect(body.message).toMatch(/No products/)
  })

  it('returns queued count immediately and fires background loop', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    const candidates = [
      { id: 'p1', name: 'Bolt M6', description: null, sku: 'B1', material: null, size: null, category_name: 'Fasteners', brand_name: null },
      { id: 'p2', name: 'Screw', description: 'plain', sku: 'S1', material: 'steel', size: '3mm', category_name: null, brand_name: 'Unbrako' },
    ]
    mockQueryMany.mockResolvedValue(candidates)
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({}),
    } as any)
    const res = await POST(makeReq())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.queued).toBe(2)
    expect(body.message).toMatch(/Enriching 2 products/)
  })

  it('uses OLLAMA env vars when present', async () => {
    process.env.OLLAMA_BASE_URL = 'http://my-ollama:11434'
    process.env.OLLAMA_COPY_MODEL = 'llama3:8b'
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryMany.mockResolvedValue([
      { id: 'p1', name: 'Test', description: null, sku: null, material: null, size: null, category_name: null, brand_name: null },
    ])
    global.fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) } as any)
    const res = await POST(makeReq())
    expect(res.status).toBe(200)
    delete process.env.OLLAMA_BASE_URL
    delete process.env.OLLAMA_COPY_MODEL
  })

  // ── Background loop: parseEnrichment + cleanArr paths ─────────────────────
  // The first iteration has lastAt=0, so Date.now() - 0 > RATE_MS is negative
  // meaning no setTimeout delay — the loop runs immediately in the same microtask.
  // We flush it by awaiting a resolved promise after POST returns.

  it('executes background loop with valid enrichment JSON and inserts into DB', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryMany.mockResolvedValue(ONE_CANDIDATE)
    mockQuery.mockResolvedValue({ rows: [] } as any)

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ message: { content: VALID_ENRICHMENT } }),
    } as any)

    const res = await POST(makeReq())
    expect(res.status).toBe(200)

    // Flush the background IIFE (first item has no delay since lastAt=0)
    await new Promise(r => setTimeout(r, 0))
    await new Promise(r => setTimeout(r, 0))

    expect(mockQuery).toHaveBeenCalled()
    const [sql, params] = mockQuery.mock.calls[0]
    expect(sql).toContain('INSERT INTO product_ai_enrichment_log')
    expect(params[0]).toBe('p1')
    expect(params[3]).toContain('high-strength M6 hex bolt')
  })

  it('background loop skips DB insert when fetch returns ok=false', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryMany.mockResolvedValue(ONE_CANDIDATE)
    mockQuery.mockResolvedValue({ rows: [] } as any)

    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({}),
    } as any)

    const res = await POST(makeReq())
    expect(res.status).toBe(200)
    await new Promise(r => setTimeout(r, 0))

    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('background loop swallows error when parseEnrichment throws (no JSON)', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryMany.mockResolvedValue(ONE_CANDIDATE)

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ message: { content: 'not json at all' } }),
    } as any)

    const res = await POST(makeReq())
    expect(res.status).toBe(200)
    await new Promise(r => setTimeout(r, 0))
    // no DB insert — error was caught and swallowed
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('background loop swallows error when ai_description is too short', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryMany.mockResolvedValue(ONE_CANDIDATE)

    const shortDesc = JSON.stringify({
      ai_description: 'Too short.',  // < 20 chars
      ai_use_cases: ['use one', 'use two'],
      ai_keywords: [],
      ai_who_uses_it: '',
      ai_application: '',
      ai_product_type: '',
      ai_features: [],
      ai_search_tags: [],
    })

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ message: { content: shortDesc } }),
    } as any)

    const res = await POST(makeReq())
    expect(res.status).toBe(200)
    await new Promise(r => setTimeout(r, 0))
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('background loop swallows error when use_cases < 2', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryMany.mockResolvedValue(ONE_CANDIDATE)

    const fewUseCases = JSON.stringify({
      ai_description: 'A well-described product that is long enough to pass validation.',
      ai_use_cases: ['only one use case'],  // length < 2
      ai_keywords: [],
      ai_who_uses_it: '',
      ai_application: '',
      ai_product_type: '',
      ai_features: [],
      ai_search_tags: [],
    })

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ message: { content: fewUseCases } }),
    } as any)

    const res = await POST(makeReq())
    expect(res.status).toBe(200)
    await new Promise(r => setTimeout(r, 0))
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('background loop handles JSON embedded in prose (regex fallback path)', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryMany.mockResolvedValue(ONE_CANDIDATE)
    mockQuery.mockResolvedValue({ rows: [] } as any)

    // Content with prose around a JSON block — triggers regex fallback in parseEnrichment
    const embeddedJson = `Here is the enrichment:\n${VALID_ENRICHMENT}\nEnd of response.`

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ message: { content: embeddedJson } }),
    } as any)

    const res = await POST(makeReq())
    expect(res.status).toBe(200)
    await new Promise(r => setTimeout(r, 0))
    await new Promise(r => setTimeout(r, 0))
    expect(mockQuery).toHaveBeenCalled()
  })

  it('cleanArr deduplicates and filters items exceeding maxLen via enrichment', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryMany.mockResolvedValue(ONE_CANDIDATE)
    mockQuery.mockResolvedValue({ rows: [] } as any)

    // Provide duplicate keywords and one that is too long (>50 chars)
    const withDuplicates = JSON.stringify({
      ai_description: 'A high-strength M6 hex bolt used in structural applications.',
      ai_use_cases: ['fasten panels', 'join metal', 'machine assembly'],
      ai_keywords: ['bolt', 'bolt', 'hex bolt', 'a'.repeat(51)],  // dup + too-long item
      ai_who_uses_it: 'engineers',
      ai_application: 'Used in heavy machinery assembly.',
      ai_product_type: 'Hex Bolt',
      ai_features: ['grade 8.8', 'zinc plated'],
      ai_search_tags: ['fastener', 'metric'],
    })

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ message: { content: withDuplicates } }),
    } as any)

    const res = await POST(makeReq())
    expect(res.status).toBe(200)
    await new Promise(r => setTimeout(r, 0))
    await new Promise(r => setTimeout(r, 0))

    // DB insert was called — cleanArr ran without error
    expect(mockQuery).toHaveBeenCalled()
    const params = mockQuery.mock.calls[0][1] as any[]
    // ai_keywords param (index 5): deduped, long item filtered out
    const keywords = params[5] as string[]
    expect(keywords).toContain('bolt')
    expect(keywords).toContain('hex bolt')
    expect(keywords.filter(k => k === 'bolt')).toHaveLength(1) // deduped
    expect(keywords.every(k => k.length <= 50)).toBe(true)     // long item excluded
  })

  it('cleanArr returns empty array when input is not an array (non-array use_cases)', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryMany.mockResolvedValue(ONE_CANDIDATE)

    // use_cases is a string, not array — cleanArr returns [] → throws 'not enough use cases'
    const badUseCases = JSON.stringify({
      ai_description: 'A high-strength M6 hex bolt used in structural applications.',
      ai_use_cases: 'not an array',
      ai_keywords: [],
      ai_who_uses_it: '',
      ai_application: '',
      ai_product_type: '',
      ai_features: [],
      ai_search_tags: [],
    })

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ message: { content: badUseCases } }),
    } as any)

    const res = await POST(makeReq())
    expect(res.status).toBe(200)
    await new Promise(r => setTimeout(r, 0))
    // cleanArr returns [] for non-array → 'not enough use cases' thrown → swallowed
    expect(mockQuery).not.toHaveBeenCalled()
  })
})
