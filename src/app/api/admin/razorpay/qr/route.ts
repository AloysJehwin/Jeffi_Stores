import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { query, queryOne, resolveRequestTenant } from '@/lib/db'
import { getRazorpayInstanceFor } from '@/lib/razorpay'
import { currentBrandNameAsync } from '@/lib/brand'
import sharp from 'sharp'

export const dynamic = 'force-dynamic'

// Razorpay QR poster is 674×1644. The QR code square sits at these proportional bounds.
const RZP_QR_LEFT_RATIO = 136 / 674
const RZP_QR_TOP_RATIO = 648 / 1644
const RZP_QR_SIZE_RATIO = 399 / 674

async function cropRazorpayQr(imageUrl: string): Promise<string> {
  const imgRes = await fetch(imageUrl)
  const buf = Buffer.from(await imgRes.arrayBuffer())
  const meta = await sharp(buf).metadata()
  const w = meta.width!
  const h = meta.height!
  const left = Math.round(w * RZP_QR_LEFT_RATIO)
  const top = Math.round(h * RZP_QR_TOP_RATIO)
  const size = Math.round(w * RZP_QR_SIZE_RATIO)
  const cropped = await sharp(buf).extract({ left, top, width: size, height: size }).resize(300, 300).png().toBuffer()
  return `data:image/png;base64,${cropped.toString('base64')}`
}

export async function POST(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'quotations:write'))
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const { orderId, amountPaise, description } = await request.json()
    if (!orderId || !amountPaise)
      return NextResponse.json({ error: 'orderId and amountPaise required' }, { status: 400 })

    const order = await queryOne<{ id: string; order_number: string }>(
      'SELECT id, order_number FROM orders WHERE id = $1',
      [orderId]
    )
    if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

    // Collect on the tenant's own Razorpay when they use one, else platform; notes carry the tenant
    // so the host-less webhook can attribute the QR credit for billing.
    const tenant = await resolveRequestTenant()
    const { instance } = await getRazorpayInstanceFor(tenant?.tenantId)
    const rzp = instance as any
    const closeBy = Math.floor(Date.now() / 1000) + 24 * 60 * 60

    const qr = await rzp.qrCode.create({
      type: 'upi_qr',
      name: description || 'Invoice Payment',
      usage: 'single_use',
      fixed_amount: true,
      payment_amount: amountPaise,
      description: description || `${await currentBrandNameAsync()} Invoice`,
      close_by: closeBy,
      notes: {
        order_id: order.id,
        order_number: order.order_number,
        ...(tenant?.tenantId ? { tenant_id: tenant.tenantId } : {}),
        ...(tenant?.slug ? { tenant_slug: tenant.slug } : {}),
      },
    })

    const qrImageUrl = await cropRazorpayQr(qr.image_url)

    await query(
      `UPDATE orders SET razorpay_qr_id = $1, razorpay_qr_image_url = $2, payment_mode = 'upi_qr', updated_at = NOW() WHERE id = $3`,
      [qr.id, qrImageUrl, orderId]
    )

    return NextResponse.json({ qrId: qr.id, qrImageUrl })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
