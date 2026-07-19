import { describe, it, expect } from 'vitest'
import { resolveShipmentStatus, shipmentStatusToSyncType, rankOf } from '@/lib/shipment-status'

// Delhivery returns scans OLDEST-first. Each scan: { scanType, activity, date }.
const s = (activity: string, date?: string, scanType = 'UD') => ({ scanType, activity, date: date ?? null })

describe('resolveShipmentStatus — order independence', () => {
  it('UD + [Manifested, picked up, received at origin] (oldest-first) → in_transit (the live bug)', () => {
    const scans = [
      s('Manifested', '2026-07-18T12:55:49'),
      s('Shipment picked up', '2026-07-18T14:57:15'),
      s('Shipment Recieved at Origin Center', '2026-07-19T03:54:42'),
    ]
    // In Transit activity → in_transit; must NOT stop at Manifested → created
    expect(resolveShipmentStatus('UD', [scans[0], { ...scans[1], activity: 'In Transit' }, { ...scans[2], activity: 'In Transit' }])).toBe('in_transit')
  })

  it('same scans reversed (newest-first) → still in_transit', () => {
    const scans = [
      { ...s('In Transit', '2026-07-19T03:54:42') },
      { ...s('Shipment picked up', '2026-07-18T14:57:15') },
      { ...s('Manifested', '2026-07-18T12:55:49') },
    ]
    expect(resolveShipmentStatus('UD', scans)).toBe('in_transit')
  })

  it('UD + only Manifested → created', () => {
    expect(resolveShipmentStatus('UD', [s('Manifested', '2026-07-18T12:00:00')])).toBe('created')
  })

  it('UD + no scans → created', () => {
    expect(resolveShipmentStatus('UD', [])).toBe('created')
  })

  it('DL statusType (unambiguous) → delivered regardless of scans', () => {
    expect(resolveShipmentStatus('DL', [s('Manifested')])).toBe('delivered')
  })

  it('PP + a picked-up scan → picked_up', () => {
    expect(resolveShipmentStatus('PP', [s('Shipment picked up', '2026-07-18T10:00:00')])).toBe('picked_up')
  })
})

describe('resolveShipmentStatus — NDR / recovery', () => {
  it('NDR then later In Transit (recovered) → in_transit', () => {
    expect(resolveShipmentStatus('UD', [
      s('Delivery attempted', '2026-07-18T10:00:00'),
      s('In Transit', '2026-07-19T09:00:00'),
    ])).toBe('in_transit')
  })

  it('In Transit then later NDR → delivery_attempted', () => {
    expect(resolveShipmentStatus('UD', [
      s('In Transit', '2026-07-18T09:00:00'),
      s('Undelivered', '2026-07-19T18:00:00'),
    ])).toBe('delivery_attempted')
  })

  it('NDR then Delivered → delivered', () => {
    expect(resolveShipmentStatus('UD', [
      s('Delivery attempt failed', '2026-07-18T18:00:00'),
      s('Delivered to consignee', '2026-07-19T11:00:00'),
    ])).toBe('delivered')
  })
})

describe('resolveShipmentStatus — RTO branch', () => {
  it('RTO scans present (beats forward chain) → rto_initiated', () => {
    expect(resolveShipmentStatus('UD', [
      s('In Transit', '2026-07-18T09:00:00'),
      s('RTO Initiated', '2026-07-19T09:00:00'),
    ])).toBe('rto_initiated')
  })

  it('RTO Delivered + RTO Initiated → rto_delivered (max RTO stage)', () => {
    expect(resolveShipmentStatus('UD', [
      s('RTO Initiated', '2026-07-18T09:00:00'),
      s('Returned to origin', '2026-07-20T09:00:00'),
    ])).toBe('rto_delivered')
  })
})

describe('shipmentStatusToSyncType', () => {
  it('maps forward + RTO statuses to canonical Delhivery codes', () => {
    expect(shipmentStatusToSyncType('in_transit')).toBe('IT')
    expect(shipmentStatusToSyncType('picked_up')).toBe('PU')
    expect(shipmentStatusToSyncType('out_for_delivery')).toBe('OD')
    expect(shipmentStatusToSyncType('delivered')).toBe('DL')
    expect(shipmentStatusToSyncType('rto_delivered')).toBe('RTO-DL')
  })
  it('created / delivery_attempted → null (no order-status transition)', () => {
    expect(shipmentStatusToSyncType('created')).toBeNull()
    expect(shipmentStatusToSyncType('delivery_attempted')).toBeNull()
  })
})

describe('rankOf', () => {
  it('picked_up onwards outranks created', () => {
    expect(rankOf('in_transit')).toBeGreaterThanOrEqual(rankOf('picked_up'))
    expect(rankOf('picked_up')).toBeGreaterThan(rankOf('created'))
    expect(rankOf(null)).toBe(0)
  })
})
