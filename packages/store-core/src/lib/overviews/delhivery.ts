import type { AttentionItem } from '@/lib/overview/attention'
import { EDD_ZONE_LABELS, eddZone, zoneTransitDays, type EddSettings, type EddZone } from '@/lib/shipping/edd'

export const IN_TRANSIT_STATUSES = [
  'created',
  'picked_up',
  'in_transit',
  'out_for_delivery',
  'delivery_attempted',
] as const
export const COD_STALE_DAYS = 7

const ZONE_ORDER: EddZone[] = ['same_city', 'same_region', 'metro', 'rest', 'remote', 'unknown']

export interface DeliveredRow {
  pin: string | null
  transitDays: number | null
}

export interface ZoneStat {
  zone: EddZone
  label: string
  delivered: number
  avgDays: number | null
  promisedDays: number
  /** Share delivered within the zone's transit days. */
  withinPromise: number | null
}

/** Delivery time per EDD zone, against the zone's configured transit days. */
export function zoneStats(rows: DeliveredRow[], originPin: string | undefined, settings: EddSettings): ZoneStat[] {
  const acc = new Map<EddZone, { n: number; sum: number; timed: number; within: number }>()
  for (const r of rows) {
    const z = eddZone(r.pin ?? '', originPin, settings)
    const a = acc.get(z) ?? { n: 0, sum: 0, timed: 0, within: 0 }
    a.n++
    if (r.transitDays != null && Number.isFinite(r.transitDays)) {
      a.timed++
      a.sum += r.transitDays
      if (r.transitDays <= zoneTransitDays(z, settings)) a.within++
    }
    acc.set(z, a)
  }
  return ZONE_ORDER.filter(z => acc.has(z)).map(z => {
    const a = acc.get(z)!
    return {
      zone: z,
      label: EDD_ZONE_LABELS[z],
      delivered: a.n,
      avgDays: a.timed ? a.sum / a.timed : null,
      promisedDays: zoneTransitDays(z, settings),
      withinPromise: a.timed ? a.within / a.timed : null,
    }
  })
}

export interface DelhiverySnapshot {
  inTransit: number
  ndr: number
  overdue: number
  awaitingPickupRequest: number
  awaitingPickupStale: number
  missedPickups: number
  failedPickups: number
  codUnremitted: number
  codUnremittedValue: number
  codStale: number
  weightDisputes: number
}

export function delhiveryAttention(s: DelhiverySnapshot): AttentionItem[] {
  const out: AttentionItem[] = []
  const pl = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`
  if (s.ndr)
    out.push({
      key: 'ndr',
      severity: 'critical',
      title: `${pl(s.ndr, 'shipment')} with a failed delivery attempt`,
      sub: 'Contact the customer before the courier returns it',
      href: '/admin/orders?tab=list&shipment_status=delivery_attempted',
    })
  if (s.failedPickups || s.missedPickups)
    out.push({
      key: 'pickups',
      severity: 'critical',
      title: `${pl(s.failedPickups + s.missedPickups, 'pickup request')} failed or missed`,
      sub: s.missedPickups ? `${s.missedPickups} still pending after the pickup date` : undefined,
      href: '/admin/delhivery?tab=pickups',
    })
  if (s.awaitingPickupStale)
    out.push({
      key: 'awaiting_pickup',
      severity: 'warning',
      title: `${pl(s.awaitingPickupStale, 'shipment')} with an AWB but no pickup request for over a day`,
      href: '/admin/delhivery?tab=pickups',
    })
  if (s.overdue)
    out.push({
      key: 'overdue',
      severity: 'warning',
      title: `${pl(s.overdue, 'shipment')} in transit past the promised date`,
      href: '/admin/orders?tab=list&shipment_status=in_transit',
    })
  if (s.codStale)
    out.push({
      key: 'cod_stale',
      severity: 'warning',
      title: `${pl(s.codStale, 'COD order')} collected over ${COD_STALE_DAYS} days ago and not remitted`,
      href: '/admin/orders?tab=list&cod_pending=true',
    })
  if (s.weightDisputes)
    out.push({
      key: 'weight',
      severity: 'info',
      title: `${pl(s.weightDisputes, 'shipment')} billed at a higher weight than quoted`,
      sub: 'In the selected period',
    })
  return out
}
