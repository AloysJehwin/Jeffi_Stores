import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/db', () => ({ queryMany: vi.fn() }))
vi.mock('@/lib/rag', () => ({
  embed: vi.fn(),
  runWithHnswTuning: vi.fn(),
}))

import { GET } from '@/app/api/products/search/route'
import { queryMany } from '@/lib/db'
import { embed, runWithHnswTuning } from '@/lib/rag'

const mockQueryMany = vi.mocked(queryMany)
const mockEmbed = vi.mocked(embed)
const mockRunWithHnswTuning = vi.mocked(runWithHnswTuning)

const PRODUCTS = [
  { id: 'p1', name: 'Widget A', slug: 'widget-a' },
  { id: 'p2', name: 'Widget B', slug: 'widget-b' },
  { id: 'p3', name: 'Widget C', slug: 'widget-c' },
]

function makeReq(params: Record<string, string> = {}) {
  const url = new URL('http://localhost/api/products/search')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return new NextRequest(url.toString())
}

describe('GET /api/products/search', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('returns empty array when q is too short (< 2 chars)', async () => {
    const res = await GET(makeReq({ q: 'a' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
  })

  it('returns empty array when q is empty', async () => {
    const res = await GET(makeReq())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
  })

  it('returns rows directly when >= 3 ILIKE results (no semantic fallback)', async () => {
    mockQueryMany.mockResolvedValueOnce(PRODUCTS as any)
    const res = await GET(makeReq({ q: 'widget' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveLength(3)
    expect(mockEmbed).not.toHaveBeenCalled()
  })

  it('calls semantic fallback when ILIKE finds < 3 results', async () => {
    const fewRows = [PRODUCTS[0]]
    mockQueryMany.mockResolvedValueOnce(fewRows as any)
    // semantic: embed + runWithHnswTuning returns empty rows
    mockEmbed.mockResolvedValueOnce([0.1, 0.2] as any)
    mockRunWithHnswTuning.mockResolvedValueOnce({ rows: [] } as any)

    const res = await GET(makeReq({ q: 'wid' }))
    expect(res.status).toBe(200)
    expect(mockEmbed).toHaveBeenCalled()
  })

  it('merges ILIKE and semantic results, ILIKE first', async () => {
    const ilikeRow = [PRODUCTS[0]]
    const semanticRows = [PRODUCTS[1], PRODUCTS[2]]
    mockQueryMany
      .mockResolvedValueOnce(ilikeRow as any)       // ILIKE query
      .mockResolvedValueOnce(semanticRows as any)   // semantic product fetch
    mockEmbed.mockResolvedValueOnce([0.1, 0.2] as any)
    mockRunWithHnswTuning.mockResolvedValueOnce({
      rows: [
        { source_table: 'products', source_id: 'p2' },
        { source_table: 'products', source_id: 'p3' },
      ],
    } as any)

    const res = await GET(makeReq({ q: 'wid' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    // p1 (ilike) should come first, deduplicated
    expect(body[0].id).toBe('p1')
  })

  it('returns only ILIKE rows when semantic returns empty', async () => {
    const ilikeRow = [PRODUCTS[0]]
    mockQueryMany.mockResolvedValueOnce(ilikeRow as any)
    mockEmbed.mockResolvedValueOnce([0.1] as any)
    mockRunWithHnswTuning.mockResolvedValueOnce({ rows: [] } as any)

    const res = await GET(makeReq({ q: 'wid' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual(ilikeRow)
  })

  it('uses categoryId branch when provided', async () => {
    mockQueryMany.mockResolvedValueOnce(PRODUCTS as any)
    const res = await GET(makeReq({ q: 'widget', categoryId: 'cat-1' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveLength(3)
    // categoryId path passes 4 params
    expect(mockQueryMany).toHaveBeenCalledWith(
      expect.stringContaining('UNION ALL'),
      expect.arrayContaining(['cat-1'])
    )
  })

  it('uses excludeId when provided', async () => {
    mockQueryMany.mockResolvedValueOnce(PRODUCTS as any)
    const res = await GET(makeReq({ q: 'widget', excludeId: 'p1' }))
    expect(res.status).toBe(200)
    expect(mockQueryMany).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining(['p1'])
    )
  })

  it('caps limit at 20', async () => {
    mockQueryMany.mockResolvedValueOnce([] as any)
    mockEmbed.mockResolvedValueOnce([] as any)
    mockRunWithHnswTuning.mockResolvedValueOnce({ rows: [] } as any)
    const res = await GET(makeReq({ q: 'bolt', limit: '99' }))
    expect(res.status).toBe(200)
    // limit capped to 20 — passed as 3rd param
    expect(mockQueryMany).toHaveBeenCalledWith(expect.any(String), [expect.any(String), null, 20])
  })

  it('handles semantic fallback with variant product_ids', async () => {
    const ilikeRow: any[] = []
    const variantProducts = [{ product_id: 'p2' }]
    const productRows = [PRODUCTS[1]]

    mockQueryMany
      .mockResolvedValueOnce(ilikeRow)       // ILIKE
      .mockResolvedValueOnce(variantProducts as any) // variant → product lookup
      .mockResolvedValueOnce(productRows as any)     // final product fetch

    mockEmbed.mockResolvedValueOnce([0.5] as any)
    mockRunWithHnswTuning.mockResolvedValueOnce({
      rows: [{ source_table: 'product_variants', source_id: 'v1' }],
    } as any)

    const res = await GET(makeReq({ q: 'bolt' }))
    expect(res.status).toBe(200)
  })

  it('returns empty when semantic throws', async () => {
    mockQueryMany.mockResolvedValueOnce([] as any)
    mockEmbed.mockRejectedValueOnce(new Error('embedding failed'))

    const res = await GET(makeReq({ q: 'bolt' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
  })
})
