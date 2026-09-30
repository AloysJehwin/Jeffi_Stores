import { NextRequest, NextResponse } from 'next/server'
import { authenticateAnyUser as authenticateUser } from '@/lib/jwt'
import { queryOne, query } from '@/lib/db'
import { resolveShipmentStatus, isAdvancement } from '@/lib/shipment-status'
import { resolveDelhiveryToken } from '@/lib/integrations/resolve'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const authUser = await authenticateUser(request)
    if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    console.log('[track] userId:', authUser.userId, 'isBusiness:', authUser.isBusiness)

    const isBusiness = authUser.isBusiness === true || request.headers.get('x-auth-portal') === 'business'

    let order: { awb_number: string | null; status: string; shipment_status: string | null } | null
    if (isBusiness) {
      const bizUser = await queryOne<{ email: string; phone: string | null }>(
        'SELECT email, phone FROM users WHERE id = $1',
        [authUser.userId]
      )
      const email = bizUser?.email || ''
      const phone = bizUser?.phone || null
      order = await queryOne(
        `SELECT awb_number, status, shipment_status FROM orders
         WHERE id = $1 AND status != 'draft' AND (
           user_id = $2 OR
           customer_email = $3 OR
           ($4::text IS NOT NULL AND customer_phone = $4)
         )`,
        [id, authUser.userId, email, phone]
      )
    } else {
      order = await queryOne(`SELECT awb_number, status, shipment_status FROM orders WHERE id = $1 AND user_id = $2`, [
        id,
        authUser.userId,
      ])
    }

    if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    if (!order.awb_number) return NextResponse.json({ tracking: null })

    const TOKEN = await resolveDelhiveryToken()
    if (!TOKEN) return NextResponse.json({ error: 'Tracking service not configured' }, { status: 503 })

    const res = await fetch(`https://track.delhivery.com/api/v1/packages/json/?waybill=${order.awb_number}`, {
      headers: { Authorization: `Token ${TOKEN}` },
      next: { revalidate: 60 },
    })

    if (!res.ok) return NextResponse.json({ error: 'Tracking unavailable' }, { status: 502 })

    const data = await res.json()
    const shipment = data?.ShipmentData?.[0]?.Shipment

    if (!shipment) return NextResponse.json({ tracking: null })

    const rawStatusType: string = (shipment.Status?.StatusType ?? '').toUpperCase()
    const scans = (shipment.Scans ?? []).map((s: any) => ({
      date: s.ScanDetail?.ScanDateTime ?? null,
      location: s.ScanDetail?.ScannedLocation ?? null,
      activity: s.ScanDetail?.Scan ?? null,
      instructions: s.ScanDetail?.Instructions ?? null,
      scanType: s.ScanDetail?.ScanType ?? null,
    }))

    const newShipmentStatus = resolveShipmentStatus(rawStatusType, scans)

    if (isAdvancement(order.shipment_status as any, newShipmentStatus)) {
      await query(`UPDATE orders SET shipment_status = $2, updated_at = NOW() WHERE id = $1`, [
        id,
        newShipmentStatus,
      ]).catch(() => {})
    }

    return NextResponse.json({
      tracking: {
        awb: shipment.AWB,
        status: shipment.Status?.Status ?? null,
        statusType: shipment.Status?.StatusType ?? null,
        shipmentStatus: newShipmentStatus,
        statusDateTime: shipment.Status?.StatusDateTime ?? null,
        instructions: shipment.Status?.Instructions ?? null,
        pickUpDate: shipment.PickUpDate ?? null,
        expectedDelivery: shipment.ExpectedDeliveryDate ?? null,
        origin: shipment.Origin ?? null,
        destination: shipment.Destination ?? null,
        scans,
      },
    })
  } catch (err) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
