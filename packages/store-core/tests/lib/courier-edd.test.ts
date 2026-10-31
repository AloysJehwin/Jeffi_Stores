import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/shared/db', () => ({ query: vi.fn() }))

import { query } from '@/lib/shared/db'
import { parseCourierDate, extractCourierEdd, applyCourierEdd } from '@/lib/shipping/courier-edd'

const mockQuery = vi.mocked(query)

describe('parseCourierDate', () => {
  it.each([
    ['2026-10-23', '2026-10-23'],
    ['2026-10-23T23:59:59', '2026-10-23'],
    ['2026-10-23T23:59:59.000', '2026-10-23'],
    ['2026-10-23 10:00:00', '2026-10-23'],
    ['23-10-2026', '2026-10-23'],
    ['23/10/2026', '2026-10-23'],
    ['3/1/2026 14:05', '2026-01-03'],
    ['23 Oct 2026', '2026-10-23'],
    // UTC instant late in the evening is already the next day in IST
    ['2026-10-23T20:00:00Z', '2026-10-24'],
    ['2026-10-23T23:59:59+05:30', '2026-10-23'],
    ['2026-10-23T23:59:59+0530', '2026-10-23'],
  ])('%s → %s', (input, out) => expect(parseCourierDate(input)).toBe(out))

  it.each([null, undefined, '', '   ', 'NA', '31-02-2026', '0001-01-01T00:00:00', 'tomorrow'])('rejects %s', v =>
    expect(parseCourierDate(v)).toBeNull()
  )
})

describe('extractCourierEdd', () => {
  it('prefers ExpectedDeliveryDate over PromisedDeliveryDate', () => {
    expect(
      extractCourierEdd({ ExpectedDeliveryDate: '2026-10-25T23:59:59', PromisedDeliveryDate: '2026-10-21T23:59:59' })
    ).toBe('2026-10-25')
  })
  it('falls back to PromisedDeliveryDate', () => {
    expect(extractCourierEdd({ ExpectedDeliveryDate: null, PromisedDeliveryDate: '2026-10-21T23:59:59' })).toBe(
      '2026-10-21'
    )
  })
  it('accepts snake/camel-case variants', () => {
    expect(extractCourierEdd({ expected_date: '2026-10-22' })).toBe('2026-10-22')
  })
  it('null when absent', () => {
    expect(extractCourierEdd({ AWB: 'x' })).toBeNull()
    expect(extractCourierEdd(null)).toBeNull()
  })
})

describe('applyCourierEdd', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)
  })
  it('writes courier_edd and the shown EDD only when the courier date changed and not delivered', async () => {
    expect(await applyCourierEdd('o1', '2026-10-23', 'in_transit')).toBe(true)
    const [sql, params] = mockQuery.mock.calls[0]
    expect(sql).toMatch(/courier_edd IS DISTINCT FROM \$2::date/)
    expect(sql).toMatch(/delivered_at IS NULL/)
    expect(params![0]).toBe('o1')
    expect(params![1]).toBe('2026-10-23')
    expect(params![2]).toContain('delivered')
  })
  it('skips delivered and RTO shipments, and empty dates', async () => {
    expect(await applyCourierEdd('o1', '2026-10-23', 'delivered')).toBe(false)
    expect(await applyCourierEdd('o1', '2026-10-23', 'rto_in_transit')).toBe(false)
    expect(await applyCourierEdd('o1', null, 'in_transit')).toBe(false)
    expect(mockQuery).not.toHaveBeenCalled()
  })
  it('false when no row changed (same courier date, or a manual override that Delhivery has not revised)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any)
    expect(await applyCourierEdd('o1', '2026-10-23', 'in_transit')).toBe(false)
  })
})
