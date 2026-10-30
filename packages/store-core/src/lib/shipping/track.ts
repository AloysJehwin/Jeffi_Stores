import 'server-only'
import { query } from '@/lib/shared/db'
import { runWithAuditActor } from '@/lib/auth/audit-context'
import { resolveShipmentStatus, isAdvancement } from '@/lib/shipping/shipment-status'
import { resolveDelhiveryToken } from '@/lib/integrations/resolve'
import { applyCourierEdd, extractCourierEdd } from '@/lib/shipping/courier-edd'

// Live Delhivery tracking for one order's AWB. Advances orders.shipment_status and the courier EDD
// as a side effect (attributed to Delhivery in the change log).

export interface Tracking {
  awb: string
  status: string | null
  statusType: string | null
  shipmentStatus: string
  statusDateTime: string | null
  instructions: string | null
  pickUpDate: string | null
  expectedDelivery: string | null
  origin: string | null
  destination: string | null
  scans: Array<{ date: string | null; location: string | null; activity: string | null; instructions: string | null; scanType: string | null }>
}

export class TrackingError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

export async function trackOrder(order: { id: string; awb_number: string | null; shipment_status: string | null }): Promise<Tracking | null> {
  if (!order.awb_number) return null
  const token = await resolveDelhiveryToken()
  if (!token) throw new TrackingError('Tracking service not configured', 503)
  const res = await fetch(`https://track.delhivery.com/api/v1/packages/json/?waybill=${encodeURIComponent(order.awb_number)}`, {
    headers: { Authorization: `Token ${token}` },
    next: { revalidate: 60 },
  })
  if (!res.ok) throw new TrackingError('Tracking unavailable', 502)
  const data = await res.json()
  const shipment = data?.ShipmentData?.[0]?.Shipment
  if (!shipment) return null

  const rawStatusType: string = (shipment.Status?.StatusType ?? '').toUpperCase()
  const scans = (shipment.Scans ?? []).map((s: any) => ({
    date: s.ScanDetail?.ScanDateTime ?? null,
    location: s.ScanDetail?.ScannedLocation ?? null,
    activity: s.ScanDetail?.Scan ?? null,
    instructions: s.ScanDetail?.Instructions ?? null,
    scanType: s.ScanDetail?.ScanType ?? null,
  }))
  const shipmentStatus = resolveShipmentStatus(rawStatusType, scans)
  const courierEdd = extractCourierEdd(shipment)
  await runWithAuditActor('delhivery', async () => {
    if (isAdvancement(order.shipment_status as any, shipmentStatus)) {
      await query(`UPDATE orders SET shipment_status = $2, updated_at = NOW() WHERE id = $1`, [order.id, shipmentStatus]).catch(() => {})
    }
    await applyCourierEdd(order.id, courierEdd, shipmentStatus).catch(() => {})
  })

  return {
    awb: shipment.AWB,
    status: shipment.Status?.Status ?? null,
    statusType: shipment.Status?.StatusType ?? null,
    shipmentStatus,
    statusDateTime: shipment.Status?.StatusDateTime ?? null,
    instructions: shipment.Status?.Instructions ?? null,
    pickUpDate: shipment.PickUpDate ?? null,
    expectedDelivery: courierEdd,
    origin: shipment.Origin ?? null,
    destination: shipment.Destination ?? null,
    scans,
  }
}
