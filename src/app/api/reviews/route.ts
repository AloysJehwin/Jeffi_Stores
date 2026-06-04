import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { query, queryOne, queryMany } from '@/lib/db'
import { authenticateUser } from '@/lib/jwt'
import { sendNewReviewNotification } from '@/lib/email'
import { uploadReviewImage } from '@/lib/s3'
import { logActivity } from '@/lib/activity'
import { createAutoTask } from '@/lib/auto-tasks'
import { parseBody, zUuid } from '@/lib/validate'

const CreateReviewSchema = z.object({
  productId: zUuid,
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(2000).optional(),
})

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
      WHERE pr.product_id = $1
      ORDER BY pr.created_at DESC
    `, [productId])

    return NextResponse.json({ reviews: reviews || [] })
  } catch {
    return NextResponse.json({ error: 'Failed to fetch reviews' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const user = await authenticateUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const formData = await request.formData()
    const reviewId = formData.get('reviewId') as string
    const ratingRaw = formData.get('rating') as string
    const title = formData.get('title') as string | null
    const comment = formData.get('comment') as string
    const rating = parseInt(ratingRaw, 10)
    const existingImageUrlsRaw = formData.get('existingImageUrls') as string | null
    const existingImageThumbUrlsRaw = formData.get('existingImageThumbUrls') as string | null

    if (!reviewId || !rating || !comment) {
      return NextResponse.json({ error: 'Review ID, rating, and comment are required' }, { status: 400 })
    }
    if (rating < 1 || rating > 5) {
      return NextResponse.json({ error: 'Rating must be between 1 and 5' }, { status: 400 })
    }

    const existing = await queryOne(
      'SELECT id FROM product_reviews WHERE id = $1 AND user_id = $2',
      [reviewId, user.userId]
    )
    if (!existing) {
      return NextResponse.json({ error: 'Review not found' }, { status: 404 })
    }

    let imageUrls: string[] = existingImageUrlsRaw ? JSON.parse(existingImageUrlsRaw) : []
    let imageThumbnailUrls: string[] = existingImageThumbUrlsRaw ? JSON.parse(existingImageThumbUrlsRaw) : []

    const newImageFiles = formData.getAll('images') as File[]
    const validNewImages = newImageFiles.filter(f => f && f.size > 0).slice(0, Math.max(0, 3 - imageUrls.length))
    if (validNewImages.length > 0) {
      for (const file of validNewImages) {
        const { url, thumbnailUrl } = await uploadReviewImage(file, reviewId)
        imageUrls.push(url)
        imageThumbnailUrls.push(thumbnailUrl)
      }
    }

    const updated = await queryOne(
      `UPDATE product_reviews SET rating = $1, title = $2, comment = $3, image_urls = $4, image_thumbnail_urls = $5, is_approved = false, updated_at = now()
       WHERE id = $6 AND user_id = $7 RETURNING *`,
      [rating, title?.trim() || null, comment.trim(), imageUrls, imageThumbnailUrls, reviewId, user.userId]
    )

    return NextResponse.json({ message: 'Review updated. Changes will be visible after re-approval.', review: updated })
  } catch {
    return NextResponse.json({ error: 'Failed to update review' }, { status: 500 })
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

    const parsedReview = parseBody(CreateReviewSchema, { productId, rating, comment: comment || undefined })
    if (!parsedReview.ok) return parsedReview.response

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

    const reviewedProduct = await queryOne<{ name: string }>('SELECT name FROM products WHERE id = $1', [productId])
    logActivity({
      userId: user.userId,
      kind: 'review_submitted',
      referenceId: review.id,
      referenceType: 'product_reviews',
      summary: `Submitted ${rating}-star review for "${reviewedProduct?.name || 'a product'}"`,
      metadata: { rating, productId, verified: !!hasPurchased },
    }).catch(() => {})

    const imageFiles = formData.getAll('images') as File[]
    const validImages = imageFiles.filter(f => f && f.size > 0).slice(0, 3)
    if (validImages.length > 0) {
      const urls: string[] = []
      const thumbnailUrls: string[] = []
      for (const file of validImages) {
        const { url, thumbnailUrl } = await uploadReviewImage(file, review.id)
        urls.push(url)
        thumbnailUrls.push(thumbnailUrl)
      }
      await query(
        'UPDATE product_reviews SET image_urls = $1, image_thumbnail_urls = $2 WHERE id = $3',
        [urls, thumbnailUrls, review.id]
      )
      review.image_urls = urls
      review.image_thumbnail_urls = thumbnailUrls
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

    if (rating <= 2) {
      createAutoTask({
        userId: user.userId,
        sourceKind: 'respond_review',
        sourceRefId: review.id,
        title: `Respond to ${rating}-star review on ${product?.name || 'product'}`,
        description: comment.trim().slice(0, 500),
        priority: 'high',
        dueInDays: 1,
      }).catch(() => {})
    }

    return NextResponse.json({
      message: 'Review submitted successfully!',
      review
    })
  } catch {
    return NextResponse.json({ error: 'Failed to submit review' }, { status: 500 })
  }
}
