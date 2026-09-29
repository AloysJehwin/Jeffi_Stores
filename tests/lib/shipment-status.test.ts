import { describe, it, expect } from 'vitest'
import {
  resolveShipmentStatus,
  shipmentStatusToSyncType,
  isAdvancement,
  rankOf,
  shipmentStatusToStep,
  shipmentStatusToReverseStep,
} from '@/lib/shipment-status'

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

// ── isAdvancement ──────────────────────────────────────────────────────────

describe('isAdvancement', () => {
  it('null current → always an advancement', () => {
    expect(isAdvancement(null, 'created')).toBe(true)
    expect(isAdvancement(null, 'delivered')).toBe(true)
  })

  it('strictly higher rank → advancement', () => {
    expect(isAdvancement('created', 'picked_up')).toBe(true)
    expect(isAdvancement('picked_up', 'in_transit')).toBe(true)
    expect(isAdvancement('in_transit', 'out_for_delivery')).toBe(true)
    expect(isAdvancement('out_for_delivery', 'delivered')).toBe(true)
    expect(isAdvancement('delivered', 'rto_initiated')).toBe(true)
    expect(isAdvancement('rto_initiated', 'rto_in_transit')).toBe(true)
    expect(isAdvancement('rto_in_transit', 'rto_out_for_return')).toBe(true)
    expect(isAdvancement('rto_out_for_return', 'rto_delivered')).toBe(true)
  })

  it('same rank → not an advancement', () => {
    expect(isAdvancement('in_transit', 'in_transit')).toBe(false)
    expect(isAdvancement('delivered', 'delivered')).toBe(false)
  })

  it('lower rank → not an advancement (regression guard)', () => {
    expect(isAdvancement('delivered', 'in_transit')).toBe(false)
    expect(isAdvancement('out_for_delivery', 'picked_up')).toBe(false)
  })
})

// ── resolveShipmentStatus — direct-map unambiguous top-level codes ─────────

describe('resolveShipmentStatus — direct top-level codes', () => {
  it('PU → picked_up', () => {
    expect(resolveShipmentStatus('PU', [])).toBe('picked_up')
  })

  it('IT → in_transit', () => {
    expect(resolveShipmentStatus('IT', [])).toBe('in_transit')
  })

  it('RAD → in_transit', () => {
    expect(resolveShipmentStatus('RAD', [])).toBe('in_transit')
  })

  it('OT → out_for_delivery', () => {
    expect(resolveShipmentStatus('OT', [])).toBe('out_for_delivery')
  })

  it('OD → out_for_delivery', () => {
    expect(resolveShipmentStatus('OD', [])).toBe('out_for_delivery')
  })

  it('DISPATCHED → out_for_delivery', () => {
    expect(resolveShipmentStatus('DISPATCHED', [])).toBe('out_for_delivery')
  })

  it('NDR with empty scans → created (NDR is in AMBIGUOUS_TOP; scan-walk finds nothing)', () => {
    expect(resolveShipmentStatus('NDR', [])).toBe('created')
  })

  it('NDR with undelivered activity scan → delivery_attempted', () => {
    expect(resolveShipmentStatus('NDR', [{ scanType: 'NDR', activity: 'Undelivered', date: null }])).toBe('delivery_attempted')
  })

  it('DL → delivered', () => {
    expect(resolveShipmentStatus('DL', [])).toBe('delivered')
  })

  it('RTO → rto_initiated', () => {
    expect(resolveShipmentStatus('RTO', [])).toBe('rto_initiated')
  })

  it('RTRN → rto_initiated', () => {
    expect(resolveShipmentStatus('RTRN', [])).toBe('rto_initiated')
  })

  it('RTO-IT → rto_in_transit', () => {
    expect(resolveShipmentStatus('RTO-IT', [])).toBe('rto_in_transit')
  })

  it('RTO-OT → rto_out_for_return', () => {
    expect(resolveShipmentStatus('RTO-OT', [])).toBe('rto_out_for_return')
  })

  it('RTO-OFD → rto_out_for_return', () => {
    expect(resolveShipmentStatus('RTO-OFD', [])).toBe('rto_out_for_return')
  })

  it('RTO-DL → rto_delivered', () => {
    expect(resolveShipmentStatus('RTO-DL', [])).toBe('rto_delivered')
  })

  it('null statusType + no scans → created', () => {
    expect(resolveShipmentStatus(null, [])).toBe('created')
  })

  it('unknown statusType + no scans → created', () => {
    expect(resolveShipmentStatus('UNKNOWN_CODE', [])).toBe('created')
  })

  it('case-insensitive — lowercase "dl" → delivered', () => {
    expect(resolveShipmentStatus('dl', [])).toBe('delivered')
  })
})

// ── resolveShipmentStatus — statusLabel fallback ───────────────────────────

describe('resolveShipmentStatus — statusLabel fallback', () => {
  it('label "Out for Delivery" with ambiguous code and no scans → out_for_delivery', () => {
    expect(resolveShipmentStatus('UD', [], 'Out for Delivery')).toBe('out_for_delivery')
  })

  it('label "Delivered" → delivered when no scans', () => {
    expect(resolveShipmentStatus('UD', [], 'Delivered')).toBe('delivered')
  })

  it('label "In Transit" → in_transit when no scans', () => {
    expect(resolveShipmentStatus('UD', [], 'In Transit')).toBe('in_transit')
  })

  it('scan result beats label fallback when scan is further along', () => {
    const scans = [{ scanType: 'DL', activity: 'Delivered to consignee', date: '2026-07-20T10:00:00' }]
    expect(resolveShipmentStatus('UD', scans, 'In Transit')).toBe('delivered')
  })
})

// ── resolveShipmentStatus — activityMap edge codes ─────────────────────────

describe('resolveShipmentStatus — activityMap edge activity strings', () => {
  const sc = (activity: string, date?: string, scanType = 'UD') =>
    ({ scanType, activity, date: date ?? null })

  it('rto delivered activity → rto_delivered', () => {
    expect(resolveShipmentStatus('UD', [sc('RTO Delivered', '2026-07-20')])).toBe('rto_delivered')
  })

  it('return delivered activity → rto_delivered', () => {
    expect(resolveShipmentStatus('UD', [sc('return delivered', '2026-07-20')])).toBe('rto_delivered')
  })

  it('returned to origin activity → rto_delivered', () => {
    expect(resolveShipmentStatus('UD', [sc('Returned to origin', '2026-07-20')])).toBe('rto_delivered')
  })

  it('out for return activity → rto_out_for_return', () => {
    expect(resolveShipmentStatus('UD', [sc('out for return', '2026-07-19')])).toBe('rto_out_for_return')
  })

  it('return in transit activity → rto_in_transit', () => {
    expect(resolveShipmentStatus('UD', [sc('return in transit', '2026-07-18')])).toBe('rto_in_transit')
  })

  it('in return transit activity → rto_in_transit', () => {
    expect(resolveShipmentStatus('UD', [sc('in return transit', '2026-07-18')])).toBe('rto_in_transit')
  })

  it('rto initiated activity → rto_initiated', () => {
    expect(resolveShipmentStatus('UD', [sc('RTO Initiated', '2026-07-17')])).toBe('rto_initiated')
  })

  it('return initiated activity → rto_initiated', () => {
    expect(resolveShipmentStatus('UD', [sc('return initiated', '2026-07-17')])).toBe('rto_initiated')
  })

  it('"dispatched" exact activity → out_for_delivery', () => {
    expect(resolveShipmentStatus('UD', [sc('dispatched', '2026-07-17')])).toBe('out_for_delivery')
  })

  it('customer not available → delivery_attempted', () => {
    expect(resolveShipmentStatus('UD', [sc('Customer not available', '2026-07-18')])).toBe('delivery_attempted')
  })

  it('door locked → delivery_attempted', () => {
    expect(resolveShipmentStatus('UD', [sc('Door locked', '2026-07-18')])).toBe('delivery_attempted')
  })

  it('refused delivery → delivery_attempted', () => {
    expect(resolveShipmentStatus('UD', [sc('refused delivery', '2026-07-18')])).toBe('delivery_attempted')
  })

  it('not delivered → delivery_attempted', () => {
    expect(resolveShipmentStatus('UD', [sc('Not delivered - no one home', '2026-07-18')])).toBe('delivery_attempted')
  })

  it('added to bag → in_transit', () => {
    expect(resolveShipmentStatus('UD', [sc('added to bag', '2026-07-17')])).toBe('in_transit')
  })

  it('transit (exact) → in_transit', () => {
    expect(resolveShipmentStatus('UD', [sc('transit', '2026-07-17')])).toBe('in_transit')
  })

  it('reached at → in_transit', () => {
    expect(resolveShipmentStatus('UD', [sc('Reached at destination', '2026-07-17')])).toBe('in_transit')
  })

  it('arrived at → in_transit', () => {
    expect(resolveShipmentStatus('UD', [sc('arrived at facility', '2026-07-17')])).toBe('in_transit')
  })

  it('misrouted → in_transit', () => {
    expect(resolveShipmentStatus('UD', [sc('misrouted to wrong hub', '2026-07-17')])).toBe('in_transit')
  })

  it('held at → in_transit', () => {
    expect(resolveShipmentStatus('UD', [sc('held at facility', '2026-07-17')])).toBe('in_transit')
  })

  it('shipment picked activity → picked_up', () => {
    expect(resolveShipmentStatus('UD', [sc('Shipment picked from seller', '2026-07-16')])).toBe('picked_up')
  })

  it('pickup activity → picked_up', () => {
    expect(resolveShipmentStatus('UD', [sc('successful pickup', '2026-07-16')])).toBe('picked_up')
  })

  it('manifest activity → created', () => {
    expect(resolveShipmentStatus('UD', [sc('manifest generated', '2026-07-15')])).toBe('created')
  })

  it('"manifested" exact activity → created', () => {
    expect(resolveShipmentStatus('UD', [sc('manifested', '2026-07-15')])).toBe('created')
  })
})

// ── resolveShipmentStatus — ambiguous top-level PP/MF/PKD/OC/HOLD/LOST/MIS ─

describe('resolveShipmentStatus — ambiguous top-level codes', () => {
  const sc = (activity: string, date?: string, scanType = 'UD') =>
    ({ scanType, activity, date: date ?? null })

  it('PP + picked-up scan → picked_up (scan beats ambiguous top)', () => {
    expect(resolveShipmentStatus('PP', [sc('Shipment picked up', '2026-07-18')])).toBe('picked_up')
  })

  it('MF + no scans → created', () => {
    expect(resolveShipmentStatus('MF', [])).toBe('created')
  })

  it('PKD + in-transit scan → in_transit', () => {
    expect(resolveShipmentStatus('PKD', [sc('In Transit', '2026-07-18')])).toBe('in_transit')
  })

  it('OC (ambiguous) + delivered scan → delivered', () => {
    expect(resolveShipmentStatus('OC', [sc('Delivered to consignee', '2026-07-20')])).toBe('delivered')
  })

  it('HOLD (ambiguous) + in-transit scan → in_transit', () => {
    expect(resolveShipmentStatus('HOLD', [sc('In Transit', '2026-07-18')])).toBe('in_transit')
  })

  it('LOST (ambiguous) + in-transit scan → in_transit', () => {
    expect(resolveShipmentStatus('LOST', [sc('In Transit', '2026-07-18')])).toBe('in_transit')
  })

  it('MIS (ambiguous) + in-transit scan → in_transit', () => {
    expect(resolveShipmentStatus('MIS', [sc('In Transit', '2026-07-18')])).toBe('in_transit')
  })
})

// ── resolveShipmentStatus — scan ordering without dates ───────────────────

describe('resolveShipmentStatus — scan ordering without dates', () => {
  it('later index wins when no dates available', () => {
    expect(resolveShipmentStatus('UD', [
      { scanType: 'UD', activity: 'In Transit', date: null },
      { scanType: 'UD', activity: 'Out for delivery', date: null },
    ])).toBe('out_for_delivery')
  })

  it('NDR at later index (no dates) beats earlier in_transit', () => {
    expect(resolveShipmentStatus('UD', [
      { scanType: 'UD', activity: 'In Transit', date: null },
      { scanType: 'UD', activity: 'Undelivered', date: null },
    ])).toBe('delivery_attempted')
  })

  it('in_transit at later index beats earlier NDR (no dates)', () => {
    expect(resolveShipmentStatus('UD', [
      { scanType: 'UD', activity: 'Undelivered', date: null },
      { scanType: 'UD', activity: 'In Transit', date: null },
    ])).toBe('in_transit')
  })
})

// ── resolveShipmentStatus — per-scan unambiguous scanType ─────────────────

describe('resolveShipmentStatus — per-scan unambiguous scanType', () => {
  it('scan scanType=DL overrides ambiguous activity', () => {
    expect(resolveShipmentStatus('UD', [
      { scanType: 'DL', activity: 'Some unknown text', date: '2026-07-20' },
    ])).toBe('delivered')
  })

  it('scan scanType=PU → picked_up', () => {
    expect(resolveShipmentStatus('UD', [
      { scanType: 'PU', activity: '', date: '2026-07-16' },
    ])).toBe('picked_up')
  })

  it('ambiguous scan scanType=NDR resolved from activity', () => {
    expect(resolveShipmentStatus('UD', [
      { scanType: 'NDR', activity: 'out for delivery', date: '2026-07-18' },
    ])).toBe('out_for_delivery')
  })
})

// ── shipmentStatusToSyncType — additional branches ────────────────────────

describe('shipmentStatusToSyncType — all branches', () => {
  it('rto_in_transit → RTO-IT', () => {
    expect(shipmentStatusToSyncType('rto_in_transit')).toBe('RTO-IT')
  })
  it('rto_out_for_return → RTO-OT', () => {
    expect(shipmentStatusToSyncType('rto_out_for_return')).toBe('RTO-OT')
  })
})

// ── shipmentStatusToStep ──────────────────────────────────────────────────

describe('shipmentStatusToStep', () => {
  it('delivered → step 4', () => {
    expect(shipmentStatusToStep('delivered')).toBe(4)
  })

  it('delivery_attempted → step 3', () => {
    expect(shipmentStatusToStep('delivery_attempted')).toBe(3)
  })

  it('out_for_delivery → step 3', () => {
    expect(shipmentStatusToStep('out_for_delivery')).toBe(3)
  })

  it('in_transit → step 2', () => {
    expect(shipmentStatusToStep('in_transit')).toBe(2)
  })

  it('picked_up → step 1', () => {
    expect(shipmentStatusToStep('picked_up')).toBe(1)
  })

  it('created → step 0', () => {
    expect(shipmentStatusToStep('created')).toBe(0)
  })

  it('null → step 0', () => {
    expect(shipmentStatusToStep(null)).toBe(0)
  })

  it('RTO statuses → step 0 (not on forward timeline)', () => {
    expect(shipmentStatusToStep('rto_initiated')).toBe(0)
    expect(shipmentStatusToStep('rto_delivered')).toBe(0)
  })
})

// ── shipmentStatusToReverseStep ───────────────────────────────────────────

describe('shipmentStatusToReverseStep', () => {
  it('rto_delivered → step 4', () => {
    expect(shipmentStatusToReverseStep('rto_delivered')).toBe(4)
  })

  it('rto_out_for_return → step 3', () => {
    expect(shipmentStatusToReverseStep('rto_out_for_return')).toBe(3)
  })

  it('rto_in_transit → step 2', () => {
    expect(shipmentStatusToReverseStep('rto_in_transit')).toBe(2)
  })

  it('rto_initiated → step 1', () => {
    expect(shipmentStatusToReverseStep('rto_initiated')).toBe(1)
  })

  it('picked_up → step 1 (also maps to 1 in reverse/RVP)', () => {
    expect(shipmentStatusToReverseStep('picked_up')).toBe(1)
  })

  it('null → step 0', () => {
    expect(shipmentStatusToReverseStep(null)).toBe(0)
  })

  // An RVP (customer return pickup) travels a forward-shaped journey, so Delhivery reports it with
  // forward statuses; the reverse stepper must advance on those, not sit at step 0.
  it('forward statuses advance the reverse timeline (RVP journey)', () => {
    expect(shipmentStatusToReverseStep('in_transit')).toBe(2)
    expect(shipmentStatusToReverseStep('out_for_delivery')).toBe(3)
    expect(shipmentStatusToReverseStep('delivered')).toBe(4)
    expect(shipmentStatusToReverseStep('created')).toBe(0)
  })
})
