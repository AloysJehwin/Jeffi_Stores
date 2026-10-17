import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/shared/db', () => ({ queryOne: vi.fn(), queryMany: vi.fn() }))

import { boundArgs, bucketSql, byPeriod, ordersAttention, seriesFromRows } from '@/lib/overviews/orders'
import { delhiveryAttention, zoneStats } from '@/lib/overviews/delhivery'
import { returnRate, returnsAttention, reasonLabel } from '@/lib/overviews/returns'
import { packingAttention } from '@/lib/overviews/packing-slips'
import { labelsAttention } from '@/lib/overviews/labels'
import { scanAttention } from '@/lib/overviews/scan'
import { EDD_DEFAULTS } from '@/lib/shipping/edd'

describe('orders overview helpers', () => {
  it('binds previous start, current start, current end', () => {
    expect(boundArgs({ from: '2026-10-01', to: '2026-10-10' })).toEqual(['2026-09-21', '2026-10-01', '2026-10-10'])
  })
  it('buckets by IST day, else date_trunc', () => {
    expect(bucketSql('o.created_at', 'day')).toContain("AT TIME ZONE 'Asia/Kolkata')::date")
    expect(bucketSql('o.created_at', 'week')).toContain("date_trunc('week'")
  })
  it('splits rows by period and fills series values', () => {
    const r = byPeriod([{ period: 'cur', x: 1 }], v => v?.x ?? 0)
    expect(r).toEqual({ current: 1, previous: 0 })
    expect(seriesFromRows([{ bucket: '2026-10-01', orders: '3' }], ['orders', 'value'])).toEqual([{ label: '2026-10-01', orders: 3, value: 0 }])
  })
  it('flags late dispatch first and skips zero counts', () => {
    const items = ordersAttention(
      { toConfirm: 0, toConfirmStale: 0, oldestPending: null, toShip: 3, lateToShip: 2, cancelRequests: 1, returnRequests: 0, overdueDelivery: 0, unpaidPrepaid: 0 },
      2
    )
    expect(items.map(i => i.key)).toEqual(['late_to_ship', 'cancel_requests'])
    expect(items[0]).toMatchObject({ severity: 'critical', title: '2 orders past the 2-day dispatch window' })
  })
})

describe('delhivery overview helpers', () => {
  it('groups delivery time by zone against promised days', () => {
    const z = zoneStats(
      [
        { pin: '492010', transitDays: 2 },
        { pin: '492011', transitDays: 9 },
        { pin: '110001', transitDays: 4 },
        { pin: null, transitDays: null },
      ],
      '492001',
      EDD_DEFAULTS
    )
    const city = z.find(r => r.zone === 'same_city')!
    expect(city).toMatchObject({ delivered: 2, avgDays: 5.5, promisedDays: EDD_DEFAULTS.sameCityDays, withinPromise: 0.5 })
    expect(z.find(r => r.zone === 'metro')?.delivered).toBe(1)
    expect(z.at(-1)).toMatchObject({ zone: 'unknown', avgDays: null, withinPromise: null })
  })
  it('raises NDR and pickup problems', () => {
    const items = delhiveryAttention({
      inTransit: 4,
      ndr: 1,
      overdue: 0,
      awaitingPickupRequest: 0,
      awaitingPickupStale: 0,
      missedPickups: 1,
      failedPickups: 1,
      codUnremitted: 0,
      codUnremittedValue: 0,
      codStale: 0,
      weightDisputes: 0,
    })
    expect(items.map(i => [i.key, i.severity])).toEqual([
      ['ndr', 'critical'],
      ['pickups', 'critical'],
    ])
    expect(items[1].title).toBe('2 pickup requests failed or missed')
  })
})

describe('returns helpers', () => {
  it('computes the rate per delivered order', () => {
    expect(returnRate(2, 10)).toBe(0.2)
    expect(returnRate(2, 0)).toBeNull()
  })
  it('labels reasons', () => {
    expect(reasonLabel('wrong_item')).toBe('Wrong item')
    expect(reasonLabel('late_arrival')).toBe('late arrival')
  })
  it('escalates stale approvals and links to the right list', () => {
    const s = { pendingApproval: 3, pendingApprovalStale: 1, awaitingPickup: 0, inTransitBack: 0, pendingInspection: 2, inspectedNotClosed: 0 }
    const r = returnsAttention(s, 'refund')
    expect(r.map(i => i.key)).toEqual(['approval_stale', 'inspection'])
    expect(r[0].href).toBe('/admin/returns?tab=list')
    expect(returnsAttention(s, 'replacement')[1].title).toBe('2 replacements received and waiting for inspection')
  })
})

describe('fulfilment strip helpers', () => {
  it('packing flags late orders', () => {
    expect(packingAttention({ toPack: 1, late: 1, oldest: null, shippedToday: 0 }, 2).map(i => i.key)).toEqual(['late', 'to_pack'])
    expect(packingAttention({ toPack: 0, late: 0, oldest: null, shippedToday: 0 }, 2)).toEqual([])
  })
  it('labels flags expiring batches and missing barcodes', () => {
    expect(labelsAttention({ noBarcode: 1, expiringBatches: 2 }).map(i => i.title)).toEqual([
      '2 batches expire within 30 days',
      '1 active product has no barcode or GTIN',
    ])
  })
  it('scan flags unscannable products only when there are some', () => {
    expect(scanAttention({ active: 5, scannable: 5, serialsInStock: 0 })).toEqual([])
    expect(scanAttention({ active: 5, scannable: 3, serialsInStock: 0 })[0].title).toBe('2 active products have no barcode or GTIN')
  })
})
