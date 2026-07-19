/**
 * Stable internal shipment status enum.
 * Only moves forward — never regresses.
 * Stored in orders.shipment_status and used to drive the tracking timeline.
 */
export type ShipmentStatus =
  | 'created'
  | 'picked_up'
  | 'in_transit'
  | 'out_for_delivery'
  | 'delivery_attempted'
  | 'delivered'
  | 'rto_initiated'
  | 'rto_in_transit'
  | 'rto_out_for_return'
  | 'rto_delivered'

/** Numeric rank — higher always wins when deciding whether to advance the stored value */
const RANK: Record<ShipmentStatus, number> = {
  created:             1,
  picked_up:           2,
  in_transit:          3,
  out_for_delivery:    4,
  delivery_attempted:  5,
  delivered:           6,
  rto_initiated:       7,
  rto_in_transit:      8,
  rto_out_for_return:  9,
  rto_delivered:       10,
}

/** Returns true if next is strictly further along than current */
export function isAdvancement(current: ShipmentStatus | null, next: ShipmentStatus): boolean {
  if (!current) return true
  return (RANK[next] ?? 0) > (RANK[current] ?? 0)
}

/** Numeric rank of a status (for pickup/advancement comparisons by callers). */
export function rankOf(s: ShipmentStatus | null): number {
  return s ? (RANK[s] ?? 0) : 0
}

type RawScan = { activity?: string | null; scanType?: string | null; date?: string | null }

const RTO_STATUSES = new Set<ShipmentStatus>(['rto_initiated', 'rto_in_transit', 'rto_out_for_return', 'rto_delivered'])

/** Delhivery StatusType codes that are ambiguous — must be resolved from scan history, not taken at face value. */
const AMBIGUOUS_TOP = new Set(['UD', 'PP', 'MF', 'NDR', 'HOLD', 'LOST', 'MIS', 'OC', 'PKD'])


/**
 * Derive our internal ShipmentStatus from Delhivery's raw statusType + scan history.
 * Unambiguous codes (PU, IT, OD, DL, etc.) map directly. Ambiguous codes (UD, PP, MF,
 * NDR, HOLD, LOST, MIS) walk scan history newest-first to find the real state.
 */
export function resolveShipmentStatus(
  rawStatusType: string | null,
  scans: RawScan[],
  statusLabel?: string | null,
): ShipmentStatus {
  const type = rawStatusType?.toUpperCase() ?? ''

  // Collect EVERY status the payload evidences — never stop at the first scan.
  // Delhivery returns scans OLDEST-first, so a positional first-match would latch
  // "Manifested" (created) and ignore later "In Transit" scans. We instead gather
  // all candidates and pick the furthest-along, which is order-independent.
  type Candidate = { status: ShipmentStatus; date: string | null; idx: number }
  const candidates: Candidate[] = []

  // The top-level StatusType is authoritative only when unambiguous; ambiguous
  // codes (UD/PP/MF/NDR/HOLD/LOST/MIS/OC/PKD) are resolved from scans.
  if (!AMBIGUOUS_TOP.has(type)) {
    const d = directMap(type)
    if (d) candidates.push({ status: d, date: null, idx: -1 })
  }

  // Low-priority fallback: the human Status.Status label (e.g. "Out for Delivery",
  // "Delivered"). Used when scans are absent/unhelpful. idx -1 so any dated scan wins.
  const fromLabel = activityMap((statusLabel ?? '').toLowerCase())
  if (fromLabel) candidates.push({ status: fromLabel, date: null, idx: -1 })

  scans.forEach((scan, idx) => {
    const scanType = (scan.scanType ?? '').toUpperCase()
    // A per-scan ScanType is authoritative only when unambiguous; an ambiguous
    // scan code (e.g. NDR) with a clarifying activity ("out for delivery") should
    // resolve from the activity, not the code.
    const s = (!AMBIGUOUS_TOP.has(scanType) ? directMap(scanType) : null)
      ?? activityMap((scan.activity ?? '').toLowerCase())
    if (s) candidates.push({ status: s, date: scan.date ?? null, idx })
  })

  if (candidates.length === 0) return 'created'

  const maxByRank = (list: Candidate[]) =>
    list.reduce((best, c) => ((RANK[c.status] ?? 0) > (RANK[best.status] ?? 0) ? c : best))

  // RTO is a distinct lifecycle branch — presence wins over the forward chain.
  const rto = candidates.filter(c => RTO_STATUSES.has(c.status))
  if (rto.length) return maxByRank(rto).status

  const forward = candidates.filter(c => !RTO_STATUSES.has(c.status))
  const nonAttempt = forward.filter(c => c.status !== 'delivery_attempted')
  const best = nonAttempt.length ? maxByRank(nonAttempt) : null

  // A failed-delivery (NDR) only "wins" if it is the LATEST signal — a shipment
  // that had an NDR then recovered (in transit / delivered again) must not be
  // pinned at delivery_attempted. Compare by scan date when available, else index.
  const attempts = forward.filter(c => c.status === 'delivery_attempted')
  if (attempts.length) {
    const latestAttempt = attempts.reduce((a, b) => (isLater(b, a) ? b : a))
    if (!best) return 'delivery_attempted'
    return isLater(latestAttempt, best) ? 'delivery_attempted' : best.status
  }

  return best ? best.status : 'created'

  function isLater(a: Candidate, b: Candidate): boolean {
    const da = a.date ? Date.parse(a.date) : NaN
    const db = b.date ? Date.parse(b.date) : NaN
    if (!Number.isNaN(da) && !Number.isNaN(db)) return da > db
    return a.idx > b.idx // Delhivery is oldest-first → higher index = later
  }
}

/**
 * Map a resolved internal ShipmentStatus back to the canonical Delhivery status
 * code used to key the routes' STATUS_SYNC tables. Single source of truth so the
 * cron and the on-demand track route can never diverge. Returns null when there
 * is no order-status transition for the state (created / NDR).
 */
export function shipmentStatusToSyncType(s: ShipmentStatus): string | null {
  switch (s) {
    case 'picked_up':          return 'PU'
    case 'in_transit':         return 'IT'
    case 'out_for_delivery':   return 'OD'
    case 'delivered':          return 'DL'
    case 'rto_initiated':      return 'RTO'
    case 'rto_in_transit':     return 'RTO-IT'
    case 'rto_out_for_return': return 'RTO-OT'
    case 'rto_delivered':      return 'RTO-DL'
    case 'created':
    case 'delivery_attempted':
    default:                   return null
  }
}


function directMap(code: string): ShipmentStatus | null {
  switch (code) {
    // Pre-pickup / manifested
    case 'PP':       return 'created'       // Pre-pickup / label created
    case 'MF':       return 'created'       // Manifested
    case 'PKD':      return 'created'       // Packed (pre-dispatch)
    // Pickup
    case 'PU':       return 'picked_up'     // Picked up from seller
    // In transit
    case 'IT':       return 'in_transit'    // In transit at facility
    case 'RAD':      return 'in_transit'    // Reached at destination facility
    // UD/HOLD/MIS/LOST are ambiguous — handled by scan-walk in resolveShipmentStatus
    // Out for delivery
    case 'OT':           return 'out_for_delivery'  // Out for delivery (hub scan)
    case 'OD':           return 'out_for_delivery'  // Out for delivery (DE scan)
    case 'DISPATCHED':   return 'out_for_delivery'  // Delhivery "Dispatched" scanType
    // Delivery attempt failed
    case 'NDR':      return 'delivery_attempted' // Non Delivery Report
    // Delivered
    case 'DL':       return 'delivered'
    // RTO lifecycle
    case 'RTO':      return 'rto_initiated'
    case 'RTRN':     return 'rto_initiated'      // Return initiated (alias)
    case 'RTO-IT':   return 'rto_in_transit'
    case 'RTO-OT':   return 'rto_out_for_return'
    case 'RTO-OFD':  return 'rto_out_for_return' // RTO out for delivery back to hub
    case 'RTO-DL':   return 'rto_delivered'
    default:         return null
  }
}

function activityMap(activity: string): ShipmentStatus | null {
  if (activity.includes('rto delivered') || activity.includes('return delivered') || activity.includes('returned to origin')) return 'rto_delivered'
  if (activity.includes('out for return')) return 'rto_out_for_return'
  if (activity.includes('return in transit') || activity.includes('in return transit')) return 'rto_in_transit'
  if (activity.includes('rto initiated') || activity.includes('return initiated')) return 'rto_initiated'
  if (activity.includes('out for delivery') || activity === 'dispatched') return 'out_for_delivery'
  if (activity.includes('delivery attempt') || activity.includes('undelivered') || activity.includes('not delivered') || activity.includes('customer not available') || activity.includes('door locked') || activity.includes('refused delivery')) return 'delivery_attempted'
  if (activity.includes('delivered') && !activity.includes('out for') && !activity.includes('return')) return 'delivered'
  if (activity.includes('added to bag') || activity.includes('in transit') || activity === 'transit' || activity.includes('reached') || activity.includes('arrived at') || activity.includes('misrouted') || activity.includes('held at')) return 'in_transit'
  if (activity.includes('picked up') || activity.includes('shipment picked') || activity.includes('pickup')) return 'picked_up'
  if (activity === 'manifested' || activity.includes('manifest')) return 'created'
  return null
}

/** Map our internal ShipmentStatus to the 0-based timeline step index (forward shipment) */
export function shipmentStatusToStep(s: ShipmentStatus | null): number {
  switch (s) {
    case 'delivered':          return 4
    case 'delivery_attempted': return 3  // show as "out for delivery" step, badge shows the exception
    case 'out_for_delivery':   return 3
    case 'in_transit':         return 2
    case 'picked_up':          return 1
    default:                   return 0  // created / null
  }
}

/** Map our internal ShipmentStatus to the 0-based reverse (RVP) timeline step index */
export function shipmentStatusToReverseStep(s: ShipmentStatus | null): number {
  switch (s) {
    case 'rto_delivered':      return 4
    case 'rto_out_for_return': return 3
    case 'rto_in_transit':     return 2
    case 'rto_initiated':
    case 'picked_up':          return 1
    default:                   return 0
  }
}
