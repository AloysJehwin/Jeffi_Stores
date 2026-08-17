import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne, queryMany } from '@/lib/db'
import { z } from 'zod'
import { parseBody, zNonEmpty } from '@/lib/validate'
import { sendAuditedMail } from '@/lib/mail-audit'
import { restoreOrderStock } from '@/lib/order-stock'

export const dynamic = 'force-dynamic'

const patchSchema = z
  .object({
    status: zNonEmpty.optional(),
    awb_number: z.string().optional(),
    notes: z.string().optional(),
    estimated_delivery_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD').optional(),
    // COD remittance: true = mark cash received from Delhivery now, false = clear it.
    cod_remitted: z.boolean().optional(),
  })
  .refine((d) => Object.values(d).some((v) => v !== undefined), {
    message: 'At least one field is required',
  })

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'orders:read')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const order = await queryOne<any>(`
      SELECT o.*,
        row_to_json(a) AS shipping_address
      FROM orders o
      LEFT JOIN addresses a ON a.id = o.shipping_address_id
      WHERE o.id = $1
    `, [id])

    if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

    const items = await queryMany<any>(`
      SELECT oi.id, oi.product_id, oi.product_name, oi.product_sku, oi.variant_id, oi.variant_name,
             oi.sub_variant_id, oi.hsn_code, oi.gst_rate, oi.quantity, oi.unit_price, oi.mrp,
             oi.discount_pct, oi.discount_amount, oi.total_price,
             oi.taxable_amount, oi.cgst_amount, oi.sgst_amount, oi.igst_amount, oi.tax_amount,
             oi.buy_mode, oi.buy_unit, oi.sold_unit_factor, oi.base_quantity,
             CASE WHEN psv.id IS NOT NULL THEN json_build_object(
               'id', psv.id,
               'sub_variant_name', psv.sub_variant_name,
               'sku', psv.sku,
               'inventory_quantity', psv.inventory_quantity
             ) ELSE NULL END AS sub_variant,
             CASE WHEN pv.id IS NOT NULL THEN json_build_object(
               'id', pv.id,
               'variant_name', pv.variant_name,
               'sku', pv.sku,
               'inventory_quantity', pv.inventory_quantity
             ) ELSE NULL END AS variant,
             CASE WHEN psv.id IS NULL AND pv.id IS NULL AND p.id IS NOT NULL THEN p.inventory_quantity ELSE NULL END AS inventory_quantity,
             p.fragile, p.hazardous, p.flammable
      FROM order_items oi
      LEFT JOIN product_sub_variants psv ON psv.id = oi.sub_variant_id
      LEFT JOIN product_variants pv ON pv.id = oi.variant_id
      LEFT JOIN products p ON p.id = oi.product_id
      WHERE oi.order_id = $1
    `, [id])

    return NextResponse.json({ order, items: items || [] })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Failed' }, { status: 500 })
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'orders:write')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const raw = await request.json()
    const parsed = parseBody(patchSchema, raw)
    if (!parsed.ok) return parsed.response

    const d = parsed.data

    // Plan-gated status transition validation.
    // Returns module (returns:read) is Growth+ — Basic plan cannot manually set return statuses.
    // Delhivery (delhivery:read) is available on all plans — delivery flow is always supported.
    if (d.status !== undefined) {
      const needsReturns = ['returned', 'return_received', 'return_in_transit'].includes(d.status)
      if (needsReturns && !hasScope(admin.role, admin.scopes, 'returns:read')) {
        return NextResponse.json({
          error: `Setting status "${d.status}" requires the Returns module (Growth plan and above).`,
        }, { status: 403 })
      }
    }
    if (d.estimated_delivery_date !== undefined) {
      const current = await queryOne<any>(`SELECT status FROM orders WHERE id = $1`, [id])
      if (current?.status === 'delivered') {
        return NextResponse.json({ error: 'Cannot change EDD on a delivered order' }, { status: 400 })
      }
    }

    const setClauses: string[] = []
    const values: any[] = []

    if (d.status !== undefined) { setClauses.push(`status = $${values.length + 1}`); values.push(d.status) }
    if (d.awb_number !== undefined) {
      setClauses.push(`awb_number = $${values.length + 1}`); values.push(d.awb_number)
      // Initialize the shipment tracking stage when an AWB is first attached, so the
      // tracking widget starts at "Shipment Created" (COALESCE never clobbers a
      // status the Delhivery sync already advanced).
      if (d.awb_number) setClauses.push(`shipment_status = COALESCE(shipment_status, 'created')`)
    }
    if (d.notes !== undefined) { setClauses.push(`notes = $${values.length + 1}`); values.push(d.notes) }
    if (d.estimated_delivery_date !== undefined) { setClauses.push(`estimated_delivery_date = $${values.length + 1}`); values.push(d.estimated_delivery_date) }
    if (d.cod_remitted !== undefined) {
      // true → stamp now; false → clear. No param needed (NOW()/NULL are literals).
      setClauses.push(d.cod_remitted ? `cod_remitted_at = NOW()` : `cod_remitted_at = NULL`)
    }

    values.push(id)
    await queryOne(`UPDATE orders SET ${setClauses.join(', ')} WHERE id = $${values.length}`, values)

    if (d.status === 'returned' || d.status === 'return_received') {
      // Only restore stock if the tenant's plan includes inventory management.
      // Basic plan tenants don't have inventory:read — skip the deduction reversal.
      if (hasScope(admin.role, admin.scopes, 'inventory:read')) {
        restoreOrderStock(id).catch(() => {})
      }
    }

    if (d.estimated_delivery_date !== undefined) {
      const order = await queryOne<any>(
        `SELECT o.order_number, o.id, u.email, u.first_name FROM orders o LEFT JOIN users u ON u.id = o.user_id WHERE o.id = $1`,
        [id]
      )
      if (order?.email) {
        const readableDate = new Date(d.estimated_delivery_date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
        const from = `"Jeffi Store's" <${process.env.SES_FROM_EMAIL}>`
        const subject = `Your delivery date has been updated — Order #${order.order_number}`
        const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f4f6f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f4f6f8;padding:32px 0;">
    <tr><td align="center">
      <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;">
        <tr><td style="background:#1a3a4a;padding:20px 28px;">
          <div style="font-size:22px;font-weight:700;color:#f97316;letter-spacing:0.5px;">Jeffi Stores</div>
        </td></tr>
        <tr><td style="padding:28px;font-size:15px;line-height:1.6;">
          <p style="margin:0 0 16px;">Hi ${order.first_name || 'there'},</p>
          <p style="margin:0 0 16px;">We have updated the expected delivery date for your order <strong>#${order.order_number}</strong>.</p>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:20px 0;background:#f0fdf4;border-left:4px solid #16a34a;border-radius:4px;">
            <tr><td style="padding:16px;">
              <p style="margin:0;font-size:14px;color:#374151;">New expected delivery date</p>
              <p style="margin:6px 0 0;font-size:22px;font-weight:700;color:#15803d;">${readableDate}</p>
            </td></tr>
          </table>
          <p style="margin:0 0 16px;">Our team is working hard to deliver your order as soon as possible. We appreciate your patience.</p>
          <p style="margin:24px 0 0;color:#475569;">Thank you for shopping with us,<br>The Jeffi Stores team</p>
        </td></tr>
        <tr><td style="padding:18px 28px;font-size:12px;color:#64748b;border-top:1px solid #e2e8f0;">
          Jeffi Stores | SANJAY GANTHI CHOWK, STATION ROAD, RAIPUR, CHHATTISGARH-490092<br>
          Phone: +91 96853 54099 | Email: jeffistoress@gmail.com
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`

        await sendAuditedMail({
          from,
          to: order.email,
          subject,
          html,
          kind: 'order',
          templateName: 'edd_update',
          entityType: 'orders',
          entityId: id,
        }).catch(() => {})
      }
    }

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Failed' }, { status: 500 })
  }
}
