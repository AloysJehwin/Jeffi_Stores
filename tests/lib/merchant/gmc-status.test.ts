import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
const { mockQuery, mockQueryOne, mockQueryMany, mockListProductStatuses } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockQueryOne: vi.fn(),
  mockQueryMany: vi.fn(),
  mockListProductStatuses: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  query: mockQuery,
  queryOne: mockQueryOne,
  queryMany: mockQueryMany,
}))

vi.mock('@/lib/merchant/client', () => ({
  listProductStatuses: mockListProductStatuses,
}))

import { refreshGmcStatusSnapshot, getGmcSummary, getGmcStatusPage } from '@/lib/merchant/gmc-status'

beforeEach(() => {
  vi.clearAllMocks()
  mockQuery.mockResolvedValue({ rows: [] })
})

describe('refreshGmcStatusSnapshot', () => {
  it('returns { locked: true } when advisory lock cannot be acquired', async () => {
    mockQueryOne.mockResolvedValueOnce({ acquired: false }) // pg_try_advisory_lock
    const res = await refreshGmcStatusSnapshot()
    expect(res).toEqual({ locked: true })
    expect(mockListProductStatuses).not.toHaveBeenCalled()
  })

  it('returns { locked: true } when lock row is null', async () => {
    mockQueryOne.mockResolvedValueOnce(null)
    const res = await refreshGmcStatusSnapshot()
    expect(res).toEqual({ locked: true })
  })

  it('paginates, upserts, deletes stale, recomputes and returns summary', async () => {
    // lock
    mockQueryOne.mockResolvedValueOnce({ acquired: true })
    // two pages
    mockListProductStatuses
      .mockResolvedValueOnce({
        resources: [
          {
            productId: 'online:en:IN:SKU-1',
            title: 'Product 1',
            destinationStatuses: [{ status: 'approved' }],
            itemLevelIssues: [
              { code: 'c1', servability: 'disapproved', description: 'd', detail: 'dt', attributeName: 'attr' },
            ],
          },
        ],
        nextPageToken: 'page2',
      })
      .mockResolvedValueOnce({
        resources: [
          {
            productId: 'online:en:IN:SKU-2',
            title: 'Product 2',
            destinationStatuses: [{ status: 'pending' }],
          },
        ],
        nextPageToken: undefined,
      })
    // counts (queryOne)
    mockQueryOne.mockResolvedValueOnce({ total: 2, approved: 1, pending: 1, disapproved: 0 })
    // getGmcSummary (queryOne)
    mockQueryOne.mockResolvedValueOnce({
      last_refreshed_at: '2026-01-01T00:00:00Z',
      total: 2,
      approved: 1,
      pending: 1,
      disapproved: 0,
    })

    const res = await refreshGmcStatusSnapshot()
    expect(res).toEqual({
      last_refreshed_at: '2026-01-01T00:00:00Z',
      total: 2,
      approved: 1,
      pending: 1,
      disapproved: 0,
    })
    expect(mockListProductStatuses).toHaveBeenCalledTimes(2)
    // upsert per offer + delete stale + meta insert + unlock
    const upsertCalls = mockQuery.mock.calls.filter(c => String(c[0]).includes('INSERT INTO merchant_gmc_status'))
    expect(upsertCalls).toHaveLength(2)
    const deleteCall = mockQuery.mock.calls.find(c => String(c[0]).includes('DELETE FROM merchant_gmc_status'))
    expect(deleteCall).toBeTruthy()
    const unlockCall = mockQuery.mock.calls.find(c => String(c[0]).includes('pg_advisory_unlock'))
    expect(unlockCall).toBeTruthy()
  })

  it('skips rows with empty offerId and does not delete when nothing seen', async () => {
    mockQueryOne.mockResolvedValueOnce({ acquired: true })
    mockListProductStatuses.mockResolvedValueOnce({
      resources: [{ productId: '', destinationStatuses: [] }],
      nextPageToken: undefined,
    })
    mockQueryOne.mockResolvedValueOnce({ total: 0, approved: 0, pending: 0, disapproved: 0 })
    mockQueryOne.mockResolvedValueOnce(null) // getGmcSummary -> default

    const res = await refreshGmcStatusSnapshot()
    expect(res).toEqual({ last_refreshed_at: null, total: 0, approved: 0, pending: 0, disapproved: 0 })
    // no upsert (empty offerId skipped) and no DELETE (seen empty)
    expect(mockQuery.mock.calls.some(c => String(c[0]).includes('INSERT INTO merchant_gmc_status'))).toBe(false)
    expect(mockQuery.mock.calls.some(c => String(c[0]).includes('DELETE FROM merchant_gmc_status'))).toBe(false)
  })

  it('falls back to raw productId when it has no colon segments', async () => {
    mockQueryOne.mockResolvedValueOnce({ acquired: true })
    mockListProductStatuses.mockResolvedValueOnce({
      resources: [{ productId: 'RAWOFFER', destinationStatuses: [{ status: 'disapproved' }] }],
      nextPageToken: undefined,
    })
    mockQueryOne.mockResolvedValueOnce({ total: 1, approved: 0, pending: 0, disapproved: 1 })
    mockQueryOne.mockResolvedValueOnce({ last_refreshed_at: 't', total: 1, approved: 0, pending: 0, disapproved: 1 })

    await refreshGmcStatusSnapshot()
    const upsert = mockQuery.mock.calls.find(c => String(c[0]).includes('INSERT INTO merchant_gmc_status'))
    expect(upsert![1][0]).toBe('RAWOFFER')
    expect(upsert![1][2]).toBe('disapproved')
  })

  it('handles empty resources (defaults to [])', async () => {
    mockQueryOne.mockResolvedValueOnce({ acquired: true })
    mockListProductStatuses.mockResolvedValueOnce({ nextPageToken: undefined }) // no resources key
    mockQueryOne.mockResolvedValueOnce({ total: 0, approved: 0, pending: 0, disapproved: 0 })
    mockQueryOne.mockResolvedValueOnce({ last_refreshed_at: null, total: 0, approved: 0, pending: 0, disapproved: 0 })
    const res = await refreshGmcStatusSnapshot()
    expect(res).toBeTruthy()
  })

  it('defaults meta counts to 0 when counts row is null', async () => {
    mockQueryOne.mockResolvedValueOnce({ acquired: true })
    mockListProductStatuses.mockResolvedValueOnce({
      resources: [{ productId: 'online:en:IN:X', destinationStatuses: [{ status: 'approved' }] }],
      nextPageToken: undefined,
    })
    mockQueryOne.mockResolvedValueOnce(null) // counts null
    mockQueryOne.mockResolvedValueOnce({ last_refreshed_at: 't', total: 0, approved: 0, pending: 0, disapproved: 0 })

    await refreshGmcStatusSnapshot()
    const metaCall = mockQuery.mock.calls.find(c => String(c[0]).includes('merchant_gmc_refresh_meta'))
    expect(metaCall![1]).toEqual([0, 0, 0, 0])
  })

  it('derives status variants: mixed uses approvalStatus, empty -> unknown', async () => {
    mockQueryOne.mockResolvedValueOnce({ acquired: true })
    mockListProductStatuses.mockResolvedValueOnce({
      resources: [
        // uses approvalStatus fallback, all approved -> approved
        { productId: 'online:en:IN:A', destinationStatuses: [{ approvalStatus: 'approved' }] },
        // no destinationStatuses at all -> vals empty -> 'unknown'
        { productId: 'online:en:IN:B' },
        // first value used when not approved/pending/disapproved and not all approved
        { productId: 'online:en:IN:C', destinationStatuses: [{ status: 'weird' }, { status: 'approved' }] },
      ],
      nextPageToken: undefined,
    })
    mockQueryOne.mockResolvedValueOnce({ total: 3, approved: 1, pending: 0, disapproved: 0 })
    mockQueryOne.mockResolvedValueOnce({ last_refreshed_at: 't', total: 3, approved: 1, pending: 0, disapproved: 0 })

    await refreshGmcStatusSnapshot()
    const upserts = mockQuery.mock.calls.filter(c => String(c[0]).includes('INSERT INTO merchant_gmc_status'))
    const byOffer = Object.fromEntries(upserts.map(c => [c[1][0], c[1][2]]))
    expect(byOffer['A']).toBe('approved')
    expect(byOffer['B']).toBe('unknown')
    expect(byOffer['C']).toBe('weird') // vals[0]
  })

  it('unlocks even when a query inside the try throws', async () => {
    mockQueryOne.mockResolvedValueOnce({ acquired: true })
    mockListProductStatuses.mockRejectedValueOnce(new Error('boom'))
    await expect(refreshGmcStatusSnapshot()).rejects.toThrow('boom')
    const unlockCall = mockQuery.mock.calls.find(c => String(c[0]).includes('pg_advisory_unlock'))
    expect(unlockCall).toBeTruthy()
  })
})

describe('getGmcSummary', () => {
  it('returns the meta row when present', async () => {
    mockQueryOne.mockResolvedValueOnce({
      last_refreshed_at: '2026-02-02',
      total: 10,
      approved: 6,
      pending: 3,
      disapproved: 1,
    })
    const res = await getGmcSummary()
    expect(res.total).toBe(10)
    expect(res.approved).toBe(6)
  })

  it('returns defaults when meta row absent', async () => {
    mockQueryOne.mockResolvedValueOnce(null)
    const res = await getGmcSummary()
    expect(res).toEqual({ last_refreshed_at: null, total: 0, approved: 0, pending: 0, disapproved: 0 })
  })
})

describe('getGmcStatusPage', () => {
  it('returns rows and total with no filters (default page/pageSize)', async () => {
    mockQueryOne.mockResolvedValueOnce({ n: 5 })
    mockQueryMany.mockResolvedValueOnce([{ offer_id: 'o1' } as any])
    const res = await getGmcStatusPage({ page: 0, pageSize: 0 })
    expect(res.total).toBe(5)
    expect(res.rows).toHaveLength(1)
    // no WHERE clause since no filters
    const countSql = mockQueryOne.mock.calls[0][0] as string
    expect(countSql).not.toContain('WHERE')
    // page clamped to 1, pageSize clamped to 50 -> offset 0
    const listArgs = mockQueryMany.mock.calls[0][1] as any[]
    expect(listArgs).toEqual([50, 0])
  })

  it('applies search filter', async () => {
    mockQueryOne.mockResolvedValueOnce({ n: 2 })
    mockQueryMany.mockResolvedValueOnce([])
    await getGmcStatusPage({ page: 2, pageSize: 10, search: 'abc' })
    const countSql = mockQueryOne.mock.calls[0][0] as string
    expect(countSql).toContain('WHERE')
    expect(countSql).toContain('ILIKE')
    const countArgs = mockQueryOne.mock.calls[0][1] as any[]
    expect(countArgs[0]).toBe('%abc%')
    // list args include the search plus limit/offset (page 2, size 10 -> offset 10)
    const listArgs = mockQueryMany.mock.calls[0][1] as any[]
    expect(listArgs).toEqual(['%abc%', 10, 10])
  })

  it('applies status filter when not "all"', async () => {
    mockQueryOne.mockResolvedValueOnce({ n: 1 })
    mockQueryMany.mockResolvedValueOnce([])
    await getGmcStatusPage({ page: 1, pageSize: 50, status: 'disapproved' })
    const countSql = mockQueryOne.mock.calls[0][0] as string
    expect(countSql).toContain('status = $1')
    const countArgs = mockQueryOne.mock.calls[0][1] as any[]
    expect(countArgs).toEqual(['disapproved'])
  })

  it('ignores status filter when "all"', async () => {
    mockQueryOne.mockResolvedValueOnce({ n: 1 })
    mockQueryMany.mockResolvedValueOnce([])
    await getGmcStatusPage({ page: 1, pageSize: 50, status: 'all' })
    const countSql = mockQueryOne.mock.calls[0][0] as string
    expect(countSql).not.toContain('WHERE')
  })

  it('combines search and status filters', async () => {
    mockQueryOne.mockResolvedValueOnce({ n: 3 })
    mockQueryMany.mockResolvedValueOnce([])
    await getGmcStatusPage({ page: 1, pageSize: 300, search: 'x', status: 'pending' })
    const countSql = mockQueryOne.mock.calls[0][0] as string
    expect(countSql).toContain('AND')
    // pageSize clamped to 200
    const listArgs = mockQueryMany.mock.calls[0][1] as any[]
    expect(listArgs).toEqual(['%x%', 'pending', 200, 0])
  })

  it('defaults total to 0 when count row is null', async () => {
    mockQueryOne.mockResolvedValueOnce(null)
    mockQueryMany.mockResolvedValueOnce([])
    const res = await getGmcStatusPage({ page: 1, pageSize: 50 })
    expect(res.total).toBe(0)
  })
})
