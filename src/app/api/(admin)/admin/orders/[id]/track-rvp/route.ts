import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryOne } from '@/lib/shared/db'
import { resolveDelhiveryToken } from '@/lib/integrations/resolve'
import { resolveShipmentStatus } from '@/lib/shipping/shipment-status'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'orders:read'))
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const rr = await queryOne<{ rvp_awb_number: string | null }>(
      `SELECT rvp_awb_number FROM return_requests WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [id]
    )

    if (!rr?.rvp_awb_number) return NextResponse.json({ tracking: null })
    const TOKEN = await resolveDelhiveryToken()
    if (!TOKEN) return NextResponse.json({ error: 'Tracking service not configured' }, { status: 503 })

    const res = await fetch(`https://track.delhivery.com/api/v1/packages/json/?waybill=${rr.rvp_awb_number}`, {
      headers: { Authorization: `Token ${TOKEN}` },
      next: { revalidate: 60 },
    })

    if (!res.ok) return NextResponse.json({ error: 'Tracking unavailable' }, { status: 502 })

    const data = await res.json()
    const shipment = data?.ShipmentData?.[0]?.Shipment

    if (!shipment) return NextResponse.json({ tracking: null })

    const scans = (shipment.Scans ?? []).map((s: any) => ({
      date: s.ScanDetail?.ScanDateTime ?? null,
      location: s.ScanDetail?.ScannedLocation ?? null,
      activity: s.ScanDetail?.Scan ?? null,
      instructions: s.ScanDetail?.Instructions ?? null,
      scanType: s.ScanDetail?.ScanType ?? null,
    }))

    // Resolve to our internal ShipmentStatus (scan-walk) so the reverse tracker advances past
    // "Pickup Scheduled" — the raw Status.Status alone left shipmentStatus null and stuck at step 0.
    const shipmentStatus = resolveShipmentStatus(
      shipment.Status?.StatusType ?? null,
      scans,
      shipment.Status?.Status ?? null
    )

    return NextResponse.json({
      tracking: {
        awb: shipment.AWB,
        status: shipment.Status?.Status ?? null,
        statusType: shipment.Status?.StatusType ?? null,
        statusDateTime: shipment.Status?.StatusDateTime ?? null,
        shipmentStatus,
        instructions: shipment.Status?.Instructions ?? null,
        pickUpDate: shipment.PickUpDate ?? null,
        expectedDelivery: shipment.ExpectedDeliveryDate ?? null,
        origin: shipment.Origin ?? null,
        destination: shipment.Destination ?? null,
        orderType: shipment.OrderType ?? null,
        reverseInTransit: shipment.ReverseInTransit ?? false,
        destReceiveDate: shipment.DestRecieveDate ?? null,
        returnedDate: shipment.ReturnedDate ?? null,
        scans,
      },
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
