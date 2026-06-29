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
 * The top-level StatusType is always the most current state — use it directly when
 * it has a direct mapping. Only fall back to scan history for ambiguous codes (PP/MF)
 * where the top-level type is stale and the scans tell the real story.
 */
export function resolveShipmentStatus(
  rawStatusType: string | null,
  scans: RawScan[],
): ShipmentStatus {
  const type = rawStatusType?.toUpperCase() ?? ''

  // Direct mapping for unambiguous Delhivery status codes — StatusType is authoritative
  const direct = directMap(type)
  if (direct) return direct

  // Only for PP/MF (stale pre-pickup codes) walk scan history to find the real state.
  // Walk newest-first and take the first scan that resolves to a known status.
  for (const scan of scans) {
    const scanType = scan.scanType?.toUpperCase() ?? ''
    const fromScanType = directMap(scanType)
    if (fromScanType) return fromScanType

    const activity = (scan.activity ?? '').toLowerCase()
    const fromActivity = activityMap(activity)
    if (fromActivity) return fromActivity
  }
  return 'created'
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
    case 'UD':       return 'in_transit'    // Update — generic bag/transit scan (NOT a failed delivery)
    case 'RAD':      return 'in_transit'    // Reached at destination facility
    case 'HOLD':     return 'in_transit'    // Held at facility (address issue etc.) — still in transit
    case 'MIS':      return 'in_transit'    // Misrouted — being corrected, still in network
    case 'LOST':     return 'in_transit'    // Lost (map to in_transit; order status handled separately)
    // Out for delivery
    case 'OT':       return 'out_for_delivery'  // Out for delivery (hub scan)
    case 'OD':       return 'out_for_delivery'  // Out for delivery (DE scan)
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
  if (activity.includes('out for delivery')) return 'out_for_delivery'
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
