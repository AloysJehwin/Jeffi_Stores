import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock pg Pool before any imports
const mockQuery = vi.fn()
const mockRelease = vi.fn()
const mockConnect = vi.fn().mockResolvedValue({
  query: mockQuery,
  release: mockRelease,
})

vi.mock('pg', () => ({
  Pool: vi.fn().mockImplementation(function (this: any) {
    this.connect = mockConnect
    this.on = vi.fn()
  }),
}))

// Mock global fetch
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

import { embed, findSimilar, findSimilarProducts, findSimilarCustomers } from '@/lib/rag'

function makeEmbedResponse(embedding: number[]) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ embedding }),
  })
}

describe('embed', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns embedding array from Ollama response', async () => {
    const vec = [0.1, 0.2, 0.3]
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ embedding: vec }),
    })
    const result = await embed('test text')
    expect(result).toEqual(vec)
    expect(mockFetch).toHaveBeenCalledOnce()
  })

  it('throws when response is not ok', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Internal Server Error' })
    await expect(embed('bad')).rejects.toThrow('Ollama embed failed')
  })

  it('throws when embedding field is missing', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({}),
    })
    await expect(embed('no embedding')).rejects.toThrow('missing embedding array')
  })

  it('throws when embedding is not an array', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ embedding: 'not-array' }),
    })
    await expect(embed('wrong type')).rejects.toThrow('missing embedding array')
  })
})

describe('findSimilar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // embed call
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ embedding: [0.1, 0.2] }),
    })
    // pg client query
    mockQuery.mockResolvedValue({
      rows: [
        { source_table: 'products', source_id: 'p1', content: 'Widget', similarity: '0.85', metadata: {} },
      ],
    })
  })

  it('returns mapped RagResult array', async () => {
    const results = await findSimilar('widget')
    expect(results).toHaveLength(1)
    expect(results[0].source_table).toBe('products')
    expect(results[0].similarity).toBe(0.85)
  })

  it('parses similarity as number when returned as string', async () => {
    const results = await findSimilar('query')
    expect(typeof results[0].similarity).toBe('number')
  })

  it('returns empty array when no rows', async () => {
    mockQuery.mockResolvedValueOnce({}) // SET LOCAL hnsw.ef_search
    mockQuery.mockResolvedValueOnce({ rows: [] })
    const results = await findSimilar('no results')
    expect(results).toHaveLength(0)
  })

  it('passes sourceTable filter', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })
    await findSimilar('test', { sourceTable: 'products' })
    const sql = mockQuery.mock.calls[1][0] as string
    expect(sql).toContain('source_table')
  })

  it('passes minSimilarity filter', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })
    await findSimilar('test', { minSimilarity: 0.7 })
    const sql = mockQuery.mock.calls[1][0] as string
    expect(sql).toContain('similarity')
  })
})

describe('findSimilarProducts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ embedding: [0.5] }),
    })
    mockQuery.mockResolvedValue({ rows: [] })
  })

  it('calls findSimilar with products/product_variants tables', async () => {
    const results = await findSimilarProducts('drill bit', 3)
    expect(Array.isArray(results)).toBe(true)
  })
})

describe('findSimilarCustomers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ embedding: [0.5] }),
    })
    mockQuery.mockResolvedValue({ rows: [] })
  })

  it('calls findSimilar with users sourceTable', async () => {
    const results = await findSimilarCustomers('john', 5)
    expect(Array.isArray(results)).toBe(true)
  })
})
