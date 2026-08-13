import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryMany: vi.fn(),
  queryOne: vi.fn(),
}))
vi.mock('@/lib/amazon/client', () => ({
  searchListingsItems: vi.fn(),
}))

import {
  refreshAmazonStatusSnapshot,
  getAmazonSummary,
  getAmazonStatusPage,
} from '@/lib/amazon/status'
import * as db from '@/lib/db'
import * as client from '@/lib/amazon/client'

const mockQuery = vi.mocked(db.query)
const mockQueryMany = vi.mocked(db.queryMany)
const mockQueryOne = vi.mocked(db.queryOne)
const mockSearch = vi.mocked(client.searchListingsItems)

describe('amazon/status', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)
    mockQueryMany.mockResolvedValue([])
    mockQueryOne.mockResolvedValue(null)
    mockSearch.mockResolvedValue({ items: [], pagination: {} } as any)
  })

  describe('refreshAmazonStatusSnapshot', () => {
    it('returns locked when advisory lock not acquired', async () => {
      mockQueryOne.mockResolvedValueOnce({ acquired: false })
      const r = await refreshAmazonStatusSnapshot()
      expect(r).toEqual({ locked: true })
    })

    it('upserts items, deletes stale, and returns summary', async () => {
      mockQueryOne
        .mockResolvedValueOnce({ acquired: true }) // lock
        .mockResolvedValueOnce({ total: 3, approved: 1, pending: 1, disapproved: 1 }) // counts
        .mockResolvedValueOnce({ last_refreshed_at: 'now', total: 3, approved: 1, pending: 1, disapproved: 1 }) // getAmazonSummary

      mockSearch.mockResolvedValueOnce({
        items: [
          // approved: BUYABLE, no error/warning
          { sku: 'A1', summaries: [{ itemName: 'Item A', asin: 'B0A', status: ['BUYABLE'] }], issues: [] },
          // disapproved: ERROR issue
          { sku: 'A2', summaries: [{ itemName: 'Item B', asin: 'B0B', status: ['DISCOVERABLE'] }], issues: [{ severity: 'ERROR', code: 'E', message: 'm' }] },
          // pending: WARNING issue
          { sku: 'A3', summaries: [{ status: 'DISCOVERABLE' }], issues: [{ severity: 'WARNING' }] },
          // item without sku skipped
          { sku: '', summaries: [], issues: [] },
        ],
        pagination: {},
      } as any)

      const r = await refreshAmazonStatusSnapshot()
      expect(r).toMatchObject({ total: 3 })
      // 3 upserts (skus non-empty)
      const upsertCalls = mockQuery.mock.calls.filter(c => String(c[0]).includes('INSERT INTO amazon_listing_status'))
      expect(upsertCalls).toHaveLength(3)
      // delete stale called since seen>0
      expect(mockQuery.mock.calls.some(c => String(c[0]).includes('DELETE FROM amazon_listing_status'))).toBe(true)
    })

    it('paginates via nextToken', async () => {
      mockQueryOne
        .mockResolvedValueOnce({ acquired: true })
        .mockResolvedValueOnce({ total: 2, approved: 2, pending: 0, disapproved: 0 })
        .mockResolvedValueOnce({ last_refreshed_at: 'now', total: 2, approved: 2, pending: 0, disapproved: 0 })

      mockSearch
        .mockResolvedValueOnce({ items: [{ sku: 'P1', summaries: [{ status: ['BUYABLE'] }], issues: [] }], pagination: { nextToken: 'tok2' } } as any)
        .mockResolvedValueOnce({ items: [{ sku: 'P2', summaries: [{ status: ['BUYABLE'] }], issues: [] }], pagination: {} } as any)

      await refreshAmazonStatusSnapshot()
      expect(mockSearch).toHaveBeenCalledTimes(2)
      expect(mockSearch).toHaveBeenNthCalledWith(2, 'tok2')
    })

    it('does not delete when no items seen', async () => {
      mockQueryOne
        .mockResolvedValueOnce({ acquired: true })
        .mockResolvedValueOnce({ total: 0, approved: 0, pending: 0, disapproved: 0 })
        .mockResolvedValueOnce({ last_refreshed_at: null, total: 0, approved: 0, pending: 0, disapproved: 0 })
      mockSearch.mockResolvedValueOnce({ items: [], pagination: {} } as any)

      await refreshAmazonStatusSnapshot()
      expect(mockQuery.mock.calls.some(c => String(c[0]).includes('DELETE FROM amazon_listing_status'))).toBe(false)
    })

    it('handles items with missing arrays -> unknown status', async () => {
      mockQueryOne
        .mockResolvedValueOnce({ acquired: true })
        .mockResolvedValueOnce({ total: 1, approved: 0, pending: 0, disapproved: 0 })
        .mockResolvedValueOnce({ last_refreshed_at: null, total: 1, approved: 0, pending: 0, disapproved: 0 })
      // no summaries, no issues -> unknown; title/asin null
      mockSearch.mockResolvedValueOnce({ items: [{ sku: 'U1' }], pagination: {} } as any)

      await refreshAmazonStatusSnapshot()
      const call = mockQuery.mock.calls.find(c => String(c[0]).includes('INSERT INTO amazon_listing_status'))
      // args: [sku, title, status, asin, summaries, issues]
      expect(call?.[1]?.[2]).toBe('unknown')
      expect(call?.[1]?.[1]).toBeNull()
    })

    it('counts null falls back to zeros', async () => {
      mockQueryOne
        .mockResolvedValueOnce({ acquired: true })
        .mockResolvedValueOnce(null) // counts null -> ?? 0 branches
        .mockResolvedValueOnce({ last_refreshed_at: null, total: 0, approved: 0, pending: 0, disapproved: 0 })
      mockSearch.mockResolvedValueOnce({ items: [{ sku: 'X', summaries: [{ status: ['BUYABLE'] }], issues: [] }], pagination: {} } as any)

      const r = await refreshAmazonStatusSnapshot()
      expect(r).toBeDefined()
      const updateCall = mockQuery.mock.calls.find(c => String(c[0]).includes('UPDATE amazon_refresh_meta'))
      expect(updateCall?.[1]).toEqual([0, 0, 0, 0])
    })
  })

  describe('getAmazonSummary', () => {
    it('returns row when present', async () => {
      mockQueryOne.mockResolvedValueOnce({ last_refreshed_at: 't', total: 5, approved: 2, pending: 2, disapproved: 1 })
      const r = await getAmazonSummary()
      expect(r.total).toBe(5)
    })

    it('returns default when null', async () => {
      mockQueryOne.mockResolvedValueOnce(null)
      const r = await getAmazonSummary()
      expect(r).toEqual({ last_refreshed_at: null, total: 0, approved: 0, pending: 0, disapproved: 0 })
    })
  })

  describe('getAmazonStatusPage', () => {
    it('returns rows + total with no filters', async () => {
      mockQueryOne.mockResolvedValueOnce({ n: 7 })
      mockQueryMany.mockResolvedValueOnce([{ sku: 'S1' }] as any)
      const r = await getAmazonStatusPage({ page: 1, pageSize: 50 })
      expect(r.total).toBe(7)
      expect(r.rows).toHaveLength(1)
      // no WHERE clause
      expect(String(mockQueryOne.mock.calls[0][0])).not.toContain('WHERE')
    })

    it('applies search + status filters', async () => {
      mockQueryOne.mockResolvedValueOnce({ n: 1 })
      mockQueryMany.mockResolvedValueOnce([] as any)
      await getAmazonStatusPage({ page: 2, pageSize: 10, search: 'foo', status: 'pending' })
      const countSql = String(mockQueryOne.mock.calls[0][0])
      expect(countSql).toContain('WHERE')
      expect(countSql).toContain('ILIKE')
      expect(countSql).toContain('status =')
    })

    it('ignores status="all"', async () => {
      mockQueryOne.mockResolvedValueOnce({ n: 0 })
      mockQueryMany.mockResolvedValueOnce([] as any)
      await getAmazonStatusPage({ page: 1, pageSize: 50, status: 'all' })
      expect(String(mockQueryOne.mock.calls[0][0])).not.toContain('status =')
    })

    it('clamps page/pageSize defaults and returns total 0 on null', async () => {
      mockQueryOne.mockResolvedValueOnce(null)
      mockQueryMany.mockResolvedValueOnce([] as any)
      const r = await getAmazonStatusPage({ page: 0, pageSize: 0 })
      expect(r.total).toBe(0)
      // pageSize clamps to 50 (max 200, min 1), page clamps to 1
      const args = mockQueryMany.mock.calls[0][1] as any[]
      expect(args[args.length - 2]).toBe(50) // limit
      expect(args[args.length - 1]).toBe(0) // offset
    })

    it('caps pageSize at 200', async () => {
      mockQueryOne.mockResolvedValueOnce({ n: 0 })
      mockQueryMany.mockResolvedValueOnce([] as any)
      await getAmazonStatusPage({ page: 3, pageSize: 999 })
      const args = mockQueryMany.mock.calls[0][1] as any[]
      expect(args[args.length - 2]).toBe(200)
      expect(args[args.length - 1]).toBe(400) // (3-1)*200
    })
  })
})
