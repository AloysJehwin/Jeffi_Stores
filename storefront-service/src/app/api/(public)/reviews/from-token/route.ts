import { NextRequest, NextResponse } from 'next/server'
import { queryOne, queryMany } from '@/lib/shared/db'
import { verifyReviewToken } from '@/lib/auth/jwt'
import { fulfilledSql } from '@/lib/orders/fulfilled-status'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const token = searchParams.get('token')
  if (!token) return NextResponse.json({ error: 'Missing token' }, { status: 400 })

  const payload = await verifyReviewToken(token)
  if (!payload) return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 })

  try {
    const product = await queryOne<{ id: string; name: string; image_url: string | null }>(
      `SELECT id, name,
         (SELECT image_url FROM product_images WHERE product_id = products.id ORDER BY display_order ASC LIMIT 1) AS image_url
       FROM products WHERE id = $1`,
      [payload.productId]
    )
    if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 })

    const existing = await queryOne('SELECT id FROM product_reviews WHERE product_id = $1 AND user_id = $2', [
      payload.productId,
      payload.userId,
    ])

    return NextResponse.json({
      productId: product.id,
      productName: product.name,
      productImage: product.image_url,
      alreadyReviewed: !!existing,
    })
  } catch {
    return NextResponse.json({ error: 'Could not load this review link. Please try again.' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const { token, rating, title, comment } = body ?? {}
  // tags is a jsonb column: send JSON text, since a raw JS array is sent as a Postgres array literal.
  const tags = Array.isArray(body?.tags) ? body.tags.filter((tag: unknown) => typeof tag === 'string').slice(0, 20) : []

  if (!token || !rating || typeof comment !== 'string' || !comment.trim()) {
    return NextResponse.json({ error: 'token, rating, and comment are required' }, { status: 400 })
  }
  if (typeof rating !== 'number' || rating < 1 || rating > 5) {
    return NextResponse.json({ error: 'Rating must be 1–5' }, { status: 400 })
  }

  const payload = await verifyReviewToken(token)
  if (!payload) return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 })

  const { orderId, productId, userId } = payload

  try {
    const existing = await queryOne('SELECT id FROM product_reviews WHERE product_id = $1 AND user_id = $2', [
      productId,
      userId,
    ])
    if (existing) {
      return NextResponse.json({ error: 'You have already reviewed this product' }, { status: 400 })
    }

    const orderCheck = await queryOne(`SELECT id FROM orders WHERE id = $1 AND user_id = $2 AND ${fulfilledSql('')}`, [
      orderId,
      userId,
    ])
    if (!orderCheck) {
      return NextResponse.json({ error: 'Order not found or not delivered' }, { status: 400 })
    }

    const review = await queryOne(
      `INSERT INTO product_reviews
         (product_id, user_id, order_id, rating, title, comment, tags, is_verified_purchase, is_approved)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true, false)
       RETURNING *`,
      [
        productId,
        userId,
        orderId,
        rating,
        typeof title === 'string' && title.trim() ? title.trim() : null,
        comment.trim(),
        JSON.stringify(tags),
      ]
    )

    return NextResponse.json({ message: 'Review submitted successfully!', review })
  } catch {
    return NextResponse.json({ error: 'Could not save your review. Please try again.' }, { status: 500 })
  }
}
