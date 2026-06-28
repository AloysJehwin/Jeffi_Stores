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

type RawScan = { activity?: string | null; scanType?: string | null }

/**
 * Derive our internal ShipmentStatus from Delhivery's raw statusType + scan history.
 * Walks scans newest-first (index 0 = latest) to find the most advanced real state.
 */
export function resolveShipmentStatus(
  rawStatusType: string | null,
  scans: RawScan[],
): ShipmentStatus {
  const type = rawStatusType?.toUpperCase() ?? ''

  // Direct mapping for unambiguous Delhivery status codes
  const direct = directMap(type)
  if (direct) return direct

  // For stale PP/MF or unrecognised codes, walk scan history to find the real state
  let best: ShipmentStatus = 'created'
  for (const scan of scans) {
    const scanType = scan.scanType?.toUpperCase() ?? ''
    const activity = (scan.activity ?? '').toLowerCase()

    const fromScanType = directMap(scanType)
    if (fromScanType && (RANK[fromScanType] ?? 0) > (RANK[best] ?? 0)) {
      best = fromScanType
    }

    const fromActivity = activityMap(activity)
    if (fromActivity && (RANK[fromActivity] ?? 0) > (RANK[best] ?? 0)) {
      best = fromActivity
    }
  }
  return best
}

function directMap(code: string): ShipmentStatus | null {
  switch (code) {
    case 'PP': return 'created'
    case 'MF': return 'created'
    case 'PU': return 'picked_up'
    case 'IT': return 'in_transit'
    case 'OT':
    case 'OD': return 'out_for_delivery'
    case 'UD':
    case 'NDR': return 'delivery_attempted'
    case 'DL': return 'delivered'
    case 'RTO': return 'rto_initiated'
    case 'RTO-IT': return 'rto_in_transit'
    case 'RTO-OT': return 'rto_out_for_return'
    case 'RTO-DL': return 'rto_delivered'
    default: return null
  }
}

function activityMap(activity: string): ShipmentStatus | null {
  if (activity.includes('rto delivered') || activity.includes('return delivered') || activity.includes('returned to origin')) return 'rto_delivered'
  if (activity.includes('out for return')) return 'rto_out_for_return'
  if (activity.includes('return in transit') || activity.includes('in return transit')) return 'rto_in_transit'
  if (activity.includes('rto initiated') || activity.includes('return initiated')) return 'rto_initiated'
  if (activity.includes('out for delivery')) return 'out_for_delivery'
  if (activity.includes('delivery attempt') || activity.includes('undelivered')) return 'delivery_attempted'
  if (activity.includes('delivered') && !activity.includes('out for')) return 'delivered'
  if (activity.includes('in transit') || activity === 'transit') return 'in_transit'
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
