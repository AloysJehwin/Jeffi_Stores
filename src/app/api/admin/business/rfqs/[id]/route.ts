import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/jwt'
import { queryOne, queryMany, query } from '@/lib/db'

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const admin = await requireAdminScope(request, 'business_rfqs')
  if (admin instanceof NextResponse) return admin

  const rfq = await queryOne<any>(
    `SELECT r.*, u.first_name, u.last_name, u.email, u.phone, bp.company_name, bp.gst_number
     FROM business_rfqs r
     JOIN users u ON u.id = r.user_id AND u.user_type = 'business'
     LEFT JOIN business_profiles bp ON bp.user_id = r.user_id
     WHERE r.id = $1`,
    [params.id]
  )
  if (!rfq) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const items = await queryMany<any>(
    `SELECT ri.*,
            p.name AS product_name,
            p.sku AS product_sku,
            p.base_price,
            p.mrp AS product_mrp,
            p.price_ex_gst AS product_price_ex_gst,
            p.gst_percentage AS product_gst,
            pv.variant_name,
            pv.sku AS variant_sku,
            pv.price AS variant_price,
            pv.mrp AS variant_mrp,
            pv.price_ex_gst AS variant_price_ex_gst,
            psv.sub_variant_name,
            psv.sku AS sub_variant_sku,
            psv.price AS sub_variant_price,
            psv.mrp AS sub_variant_mrp,
            psv.price_ex_gst AS sub_variant_price_ex_gst,
            (SELECT pi.image_url FROM product_images pi
             WHERE pi.product_id = p.id
             ORDER BY pi.is_primary DESC, pi.display_order ASC
             LIMIT 1) AS product_image_url
     FROM business_rfq_items ri
     LEFT JOIN products p ON p.id = ri.product_id
     LEFT JOIN product_variants pv ON pv.id = ri.variant_id
     LEFT JOIN product_sub_variants psv ON psv.id = ri.sub_variant_id
     WHERE ri.rfq_id = $1
     ORDER BY ri.position, ri.created_at`,
    [params.id]
  )

  return NextResponse.json({ rfq, items })
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const admin = await requireAdminScope(request, 'business_rfqs')
  if (admin instanceof NextResponse) return admin

  const { status, adminNote } = await request.json()
  if (!['reviewed', 'rejected'].includes(status)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
  }

  await query(
    `UPDATE business_rfqs SET status=$1, admin_note=$2, reviewed_at=NOW() WHERE id=$3`,
    [status, adminNote || null, params.id]
  )

  return NextResponse.json({ ok: true })
}
