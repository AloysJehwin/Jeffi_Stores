import { NextRequest, NextResponse } from 'next/server'
import { query, queryOne, queryMany } from '@/lib/db'
import { authenticateUser } from '@/lib/jwt'
import { sendNewReviewNotification } from '@/lib/email'
import { uploadReviewImage } from '@/lib/s3'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const productId = searchParams.get('productId')

    if (!productId) {
      return NextResponse.json({ error: 'Product ID required' }, { status: 400 })
    }

    const reviews = await queryMany(`
      SELECT
        pr.*,
        json_build_object('first_name', u.first_name, 'last_name', u.last_name) AS users
      FROM product_reviews pr
      LEFT JOIN users u ON pr.user_id = u.id
      WHERE pr.product_id = $1 AND pr.is_approved = true
      ORDER BY pr.created_at DESC
    `, [productId])

    return NextResponse.json({ reviews: reviews || [] })
  } catch {
    return NextResponse.json({ error: 'Failed to fetch reviews' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await authenticateUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Please login to submit a review' }, { status: 401 })
    }

    const formData = await request.formData()
    const productId = formData.get('productId') as string
    const ratingRaw = formData.get('rating') as string
    const title = formData.get('title') as string | null
    const comment = formData.get('comment') as string
    const rating = parseInt(ratingRaw, 10)

    if (!productId || !rating || !comment) {
      return NextResponse.json({ error: 'Product ID, rating, and comment are required' }, { status: 400 })
    }

    if (rating < 1 || rating > 5) {
      return NextResponse.json({ error: 'Rating must be between 1 and 5' }, { status: 400 })
    }

    const existingReview = await queryOne(
      'SELECT id FROM product_reviews WHERE product_id = $1 AND user_id = $2',
      [productId, user.userId]
    )

    if (existingReview) {
      return NextResponse.json({ error: 'You have already reviewed this product' }, { status: 400 })
    }

    const hasPurchased = await queryOne(`
      SELECT oi.id FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      WHERE oi.product_id = $1 AND o.user_id = $2 AND o.status = 'delivered'
      LIMIT 1
    `, [productId, user.userId])

    const review = await queryOne(
      `INSERT INTO product_reviews (product_id, user_id, rating, title, comment, is_verified_purchase, is_approved)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [productId, user.userId, rating, title?.trim() || null, comment.trim(), !!hasPurchased, false]
    )

    const imageFiles = formData.getAll('images') as File[]
    const validImages = imageFiles.filter(f => f && f.size > 0).slice(0, 3)
    if (validImages.length > 0) {
      const urls: string[] = []
      for (const file of validImages) {
        const url = await uploadReviewImage(file, review.id)
        urls.push(url)
      }
      await query(
        'UPDATE product_reviews SET image_urls = $1 WHERE id = $2',
        [urls, review.id]
      )
      review.image_urls = urls
    }

    const userDetails = await queryOne(
      'SELECT first_name, last_name, email FROM users WHERE id = $1',
      [user.userId]
    )

    const product = await queryOne(
      'SELECT name, slug FROM products WHERE id = $1',
      [productId]
    )

    if (userDetails && product) {
      try {
        await sendNewReviewNotification(review, userDetails, product)
      } catch {
      }
    }

    return NextResponse.json({
      message: 'Review submitted successfully! It will be visible after admin approval.',
      review
    })
  } catch {
    return NextResponse.json({ error: 'Failed to submit review' }, { status: 500 })
  }
}
