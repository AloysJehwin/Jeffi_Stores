import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { queryOne } from '@/lib/db'

const TOKEN = process.env.DELHIVERY_API_KEY

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const order = await queryOne<{ awb_number: string | null }>(
      `SELECT awb_number FROM orders WHERE id = $1`,
      [params.id]
    )

    if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    if (!order.awb_number) return NextResponse.json({ tracking: null })

    if (!TOKEN) return NextResponse.json({ error: 'Tracking service not configured' }, { status: 503 })

    const res = await fetch(
      `https://track.delhivery.com/api/v1/packages/json/?waybill=${order.awb_number}`,
      {
        headers: { Authorization: `Token ${TOKEN}` },
        next: { revalidate: 60 },
      }
    )

    if (!res.ok) return NextResponse.json({ error: 'Tracking unavailable' }, { status: 502 })

    const data = await res.json()
    const shipment = data?.ShipmentData?.[0]?.Shipment

    if (!shipment) return NextResponse.json({ tracking: null })

    return NextResponse.json({
      tracking: {
        awb: shipment.AWB,
        status: shipment.Status?.Status ?? null,
        statusType: shipment.Status?.StatusType ?? null,
        statusDateTime: shipment.Status?.StatusDateTime ?? null,
        instructions: shipment.Status?.Instructions ?? null,
        pickUpDate: shipment.PickUpDate ?? null,
        expectedDelivery: shipment.ExpectedDeliveryDate ?? null,
        origin: shipment.Origin ?? null,
        destination: shipment.Destination ?? null,
        scans: (shipment.Scans ?? []).map((s: any) => ({
          date: s.ScanDetail?.ScanDateTime ?? null,
          location: s.ScanDetail?.ScannedLocation ?? null,
          activity: s.ScanDetail?.Scan ?? null,
          instructions: s.ScanDetail?.Instructions ?? null,
        })),
      },
    })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
