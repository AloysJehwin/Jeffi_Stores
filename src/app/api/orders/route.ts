import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { jwtVerify } from 'jose'
import { queryMany } from '@/lib/db'

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET || 'your-secret-key')

export async function GET(request: NextRequest) {
  try {
    const token = cookies().get('auth_token')?.value

    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    let userId: string
    try {
      const { payload } = await jwtVerify(token, JWT_SECRET)
      userId = payload.userId as string
    } catch {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
    }

    const orders = await queryMany(`
      SELECT
        o.id, o.order_number, o.created_at, o.status, o.payment_status,
        o.total_amount, o.subtotal, o.shipping_address_id,
        (SELECT row_to_json(a) FROM (
          SELECT address_line1, address_line2, city, state, postal_code
          FROM addresses WHERE id = o.shipping_address_id
        ) a) AS addresses,
        COALESCE(
          (SELECT json_agg(
            json_build_object(
              'id', oi.id, 'product_id', oi.product_id, 'product_name', oi.product_name,
              'quantity', oi.quantity, 'unit_price', oi.unit_price, 'total_price', oi.total_price,
              'buy_mode', oi.buy_mode, 'buy_unit', oi.buy_unit,
              'products', json_build_object(
                'slug', pr.slug,
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
      WHERE o.user_id = $1
      ORDER BY o.created_at DESC
    `, [userId])

    return NextResponse.json({ orders })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
