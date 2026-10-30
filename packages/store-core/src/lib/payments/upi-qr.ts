import 'server-only'
import sharp from 'sharp'
import { query, resolveRequestTenant } from '@/lib/shared/db'
import { getRazorpayInstanceFor } from '@/lib/payments/razorpay'

// Razorpay's QR poster is 674×1644; the QR square sits at these proportional bounds.
const RZP_QR_LEFT_RATIO = 136 / 674
const RZP_QR_TOP_RATIO = 648 / 1644
const RZP_QR_SIZE_RATIO = 399 / 674

async function cropRazorpayQr(imageUrl: string): Promise<string> {
  const imgRes = await fetch(imageUrl)
  const buf = Buffer.from(await imgRes.arrayBuffer())
  const meta = await sharp(buf).metadata()
  const w = meta.width!
  const h = meta.height!
  const cropped = await sharp(buf)
    .extract({
      left: Math.round(w * RZP_QR_LEFT_RATIO),
      top: Math.round(h * RZP_QR_TOP_RATIO),
      width: Math.round(w * RZP_QR_SIZE_RATIO),
      height: Math.round(w * RZP_QR_SIZE_RATIO),
    })
    .resize(300, 300)
    .png()
    .toBuffer()
  return `data:image/png;base64,${cropped.toString('base64')}`
}

/**
 * A single-use UPI QR for an order, valid 24 hours, on the store's own Razorpay account when it has one.
 * Its notes name the store and order, so the host-less webhook can mark the right order paid.
 */
export async function createOrderUpiQr(opts: {
  order: { id: string; order_number: string }
  amountPaise: number
  name: string
  description: string
}): Promise<{ qrId: string; qrImageUrl: string }> {
  const tenant = await resolveRequestTenant()
  const { instance } = await getRazorpayInstanceFor(tenant?.tenantId)
  const qr = await (instance as any).qrCode.create({
    type: 'upi_qr',
    name: opts.name,
    usage: 'single_use',
    fixed_amount: true,
    payment_amount: opts.amountPaise,
    description: opts.description,
    close_by: Math.floor(Date.now() / 1000) + 24 * 60 * 60,
    notes: {
      order_id: opts.order.id,
      order_number: opts.order.order_number,
      ...(tenant?.tenantId ? { tenant_id: tenant.tenantId } : {}),
      ...(tenant?.slug ? { tenant_slug: tenant.slug } : {}),
    },
  })
  const qrImageUrl = await cropRazorpayQr(qr.image_url).catch(() => qr.image_url as string)
  await query(
    `UPDATE orders SET razorpay_qr_id = $1, razorpay_qr_image_url = $2, payment_mode = 'upi_qr', updated_at = NOW() WHERE id = $3`,
    [qr.id, qrImageUrl, opts.order.id]
  )
  return { qrId: qr.id, qrImageUrl }
}
