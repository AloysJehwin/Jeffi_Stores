import { NextRequest, NextResponse } from 'next/server'
import { queryOne, queryMany } from '@/lib/shared/db'
import { verifyReviewToken } from '@/lib/auth/jwt'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const token = searchParams.get('token')
  if (!token) return NextResponse.json({ error: 'Missing token' }, { status: 400 })

  const payload = await verifyReviewToken(token)
  if (!payload) return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 })

  const product = await queryOne<{ id: string; name: string; image_url: string | null }>(
    `SELECT id, name,
       COALESCE(
         (SELECT url FROM product_images WHERE product_id = products.id ORDER BY position ASC LIMIT 1),
         NULL
       ) AS image_url
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
}

export async function POST(request: NextRequest) {
  const body = await request.json()
  const { token, rating, title, comment, tags } = body

  if (!token || !rating || !comment) {
    return NextResponse.json({ error: 'token, rating, and comment are required' }, { status: 400 })
  }
  if (typeof rating !== 'number' || rating < 1 || rating > 5) {
    return NextResponse.json({ error: 'Rating must be 1–5' }, { status: 400 })
  }

  const payload = await verifyReviewToken(token)
  if (!payload) return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 })

  const { orderId, productId, userId } = payload

  const existing = await queryOne('SELECT id FROM product_reviews WHERE product_id = $1 AND user_id = $2', [
    productId,
    userId,
  ])
  if (existing) {
    return NextResponse.json({ error: 'You have already reviewed this product' }, { status: 400 })
  }

  const orderCheck = await queryOne(`SELECT id FROM orders WHERE id = $1 AND user_id = $2 AND status = 'delivered'`, [
    orderId,
    userId,
  ])
  if (!orderCheck) {
    return NextResponse.json({ error: 'Order not found or not delivered' }, { status: 400 })
  }

  const review = await queryOne(
    `INSERT INTO product_reviews (product_id, user_id, rating, title, comment, tags, is_verified_purchase, is_approved)
     VALUES ($1, $2, $3, $4, $5, $6, true, false)
     RETURNING *`,
    [productId, userId, rating, title?.trim() || null, comment.trim(), tags ?? []]
  )

  return NextResponse.json({ message: 'Review submitted successfully!', review })
}
