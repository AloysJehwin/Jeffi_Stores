import { NextRequest, NextResponse } from 'next/server'
import { queryMany, queryCount, queryOne } from '@/lib/db'
import { authenticateAnyUser as authenticateUser } from '@/lib/jwt'

const PAGE_SIZE = 10

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateUser(request)
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const userId = auth.userId
    const isBusiness = auth.isBusiness === true || request.headers.get('x-auth-portal') === 'business'

    const { searchParams } = new URL(request.url)
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10))
    const limit = PAGE_SIZE
    const offset = (page - 1) * limit

    let whereClause: string
    let countClause: string
    let queryParams: any[]
    let countParams: any[]

    if (isBusiness) {
      // Include orders placed via the storefront (user_id) AND orders converted from business quotations (matched by email/phone)
      const bizUser = await queryOne<{ email: string; phone: string | null }>(
        'SELECT email, phone FROM users WHERE id = $1',
        [userId]
      )
      const email = bizUser?.email || ''
      const phone = bizUser?.phone || null

      whereClause = `WHERE (o.user_id = $1 OR (o.source = 'business' AND (o.customer_email = $2 OR ($3::text IS NOT NULL AND o.customer_phone = $3)))) AND o.status != 'draft'`
      countClause = `SELECT COUNT(*) FROM orders o WHERE (o.user_id = $1 OR (o.source = 'business' AND (o.customer_email = $2 OR ($3::text IS NOT NULL AND o.customer_phone = $3)))) AND o.status != 'draft'`
      queryParams = [userId, email, phone, limit, offset]
      countParams = [userId, email, phone]
    } else {
      whereClause = `WHERE o.user_id = $1 AND o.status != 'draft'`
      countClause = `SELECT COUNT(*) FROM orders WHERE user_id = $1 AND status != 'draft'`
      queryParams = [userId, limit, offset]
      countParams = [userId]
    }

    const limitIdx = queryParams.length - 1
    const offsetIdx = queryParams.length

    const [orders, total] = await Promise.all([
      queryMany(
        `
        SELECT
          o.id, o.order_number, o.created_at, o.status, o.payment_status, o.payment_mode,
          o.total_amount, o.subtotal, o.shipping_address_id,
          o.razorpay_qr_image_url, o.awb_number,
          CASE WHEN o.estimated_delivery_date IS NOT NULL
            THEN to_char(o.estimated_delivery_date, 'YYYY-MM-DD')
            ELSE NULL
          END AS estimated_delivery_date,
          COALESCE(
            o.shipping_address_snapshot,
            (SELECT to_jsonb(a) FROM (
              SELECT address_line1, address_line2, city, state, postal_code
              FROM addresses WHERE id = o.shipping_address_id
            ) a)
          ) AS addresses,
          COALESCE(
            (SELECT json_agg(
              json_build_object(
                'id', oi.id, 'product_id', oi.product_id, 'product_name', oi.product_name,
                'quantity', oi.quantity, 'unit_price', oi.unit_price, 'total_price', oi.total_price,
                'buy_mode', oi.buy_mode, 'buy_unit', oi.buy_unit,
                'products', json_build_object(
                  'slug', pr.slug,
                  'extra_delivery_days', pr.extra_delivery_days,
                  'product_images', COALESCE(
                    (SELECT json_agg(json_build_object('thumbnail_url', pi.thumbnail_url, 'is_primary', pi.is_primary))
                     FROM product_images pi WHERE pi.product_id = pr.id),
                    '[]'::json
                  )
                )
              )
            )
            FROM order_items oi
            LEFT JOIN products pr ON oi.product_id = pr.id
            WHERE oi.order_id = o.id),
            '[]'::json
          ) AS order_items
        FROM orders o
        ${whereClause}
        ORDER BY o.created_at DESC
        LIMIT $${limitIdx} OFFSET $${offsetIdx}
      `,
        queryParams
      ),
      queryCount(countClause, countParams),
    ])

    return NextResponse.json({ orders, total, page, pageSize: PAGE_SIZE })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
