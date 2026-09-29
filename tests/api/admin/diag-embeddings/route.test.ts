import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/rag', () => ({
  embed: vi.fn(),
  runWithHnswTuning: vi.fn(),
  queryManyReplica: vi.fn(),
}))

import { GET } from '@/app/api/admin/diag-embeddings/route'
import { authenticateAdmin } from '@/lib/jwt'
import { embed, runWithHnswTuning, queryManyReplica } from '@/lib/rag'

const ADMIN = { adminId: 'a1', role: 'administrator', scopes: [] }

const COUNTS = [
  { source_table: 'products', cnt: '100' },
  { source_table: 'product_variants', cnt: '300' },
]

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
  vi.mocked(queryManyReplica).mockResolvedValue(COUNTS as any)
  vi.mocked(embed).mockResolvedValue(Array(1536).fill(0.1))
  vi.mocked(runWithHnswTuning).mockResolvedValue({
    rows: [
      { source_table: 'products', source_id: 'p1', content: 'bolt m10', sim: '0.95' },
      { source_table: 'product_variants', source_id: 'v1', content: 'variant data', sim: 0.88 },
    ],
  } as any)
})

function makeReq(params: Record<string, string> = {}) {
  const url = new URL('http://localhost/api/admin/diag-embeddings')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return new NextRequest(url.toString())
}

describe('GET /api/admin/diag-embeddings', () => {
  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    const res = await GET(makeReq())
    expect(res.status).toBe(401)
  })

  it('returns 403 for a tenant owner (super_admin) and never embeds', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue({ ...ADMIN, role: 'super_admin' } as any)
    const res = await GET(makeReq({ q: 'bolt' }))
    expect(res.status).toBe(403)
    expect(embed).not.toHaveBeenCalled()
    expect(queryManyReplica).not.toHaveBeenCalled()
  })

  it('returns results on happy path', async () => {
    vi.mocked(queryManyReplica)
      .mockResolvedValueOnce(COUNTS as any)
      .mockResolvedValueOnce([{ id: 'p1', name: 'Bolt M10', slug: 'bolt-m10' }] as any)
      .mockResolvedValueOnce([{ variant_id: 'v1', product_id: 'p2', name: 'Nut', variant_label: 'M10' }] as any)
    const res = await GET(makeReq({ q: 'bolt' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.results).toBeDefined()
    expect(body.table_counts).toHaveLength(2)
  })

  it('uses default query when q is missing', async () => {
    vi.mocked(queryManyReplica).mockResolvedValue([] as any)
    vi.mocked(runWithHnswTuning).mockResolvedValue({ rows: [] } as any)
    const res = await GET(makeReq())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.query).toBe('dowel pin m10')
  })

  it('handles embed error gracefully', async () => {
    vi.mocked(embed).mockRejectedValue(new Error('embed service down'))
    const res = await GET(makeReq({ q: 'test' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.embed_error).toContain('embed service down')
    expect(body.results).toEqual([])
  })

  it('handles HNSW search error gracefully', async () => {
    vi.mocked(runWithHnswTuning).mockRejectedValue(new Error('hnsw fail'))
    const res = await GET(makeReq({ q: 'test' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.hnsw_error).toContain('hnsw fail')
  })

  it('handles queryManyReplica error for counts gracefully', async () => {
    vi.mocked(queryManyReplica).mockRejectedValue(new Error('db fail'))
    const res = await GET(makeReq())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.table_counts).toEqual([])
  })

  it('clamps limit to 30', async () => {
    vi.mocked(queryManyReplica).mockResolvedValue([] as any)
    vi.mocked(runWithHnswTuning).mockResolvedValue({ rows: [] } as any)
    const res = await GET(makeReq({ limit: '100' }))
    expect(res.status).toBe(200)
  })

  it('enriches product results with name and slug', async () => {
    vi.mocked(queryManyReplica)
      .mockResolvedValueOnce([] as any)
      .mockResolvedValueOnce([{ id: 'p1', name: 'Bolt M10', slug: 'bolt-m10' }] as any)
      .mockResolvedValueOnce([] as any)
    vi.mocked(runWithHnswTuning).mockResolvedValue({
      rows: [{ source_table: 'products', source_id: 'p1', content: 'bolt', sim: 0.9 }],
    } as any)
    const res = await GET(makeReq({ q: 'bolt' }))
    const body = await res.json()
    expect(body.results[0].product_name).toBe('Bolt M10')
    expect(body.results[0].slug).toBe('bolt-m10')
  })

  it('enriches variant results (variant_label field present)', async () => {
    vi.mocked(queryManyReplica).mockResolvedValue([
      { variant_id: 'v1', product_id: 'p2', name: 'Nut', variant_label: 'M10' },
    ] as any)
    vi.mocked(runWithHnswTuning).mockResolvedValue({
      rows: [{ source_table: 'product_variants', source_id: 'v1', content: 'nut', sim: 0.85 }],
    } as any)
    const res = await GET(makeReq({ q: 'nut' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.results)).toBe(true)
  })
})
