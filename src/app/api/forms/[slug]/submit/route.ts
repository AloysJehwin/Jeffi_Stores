import { NextRequest, NextResponse } from 'next/server'
import { queryOne, withTransaction } from '@/lib/db'
import { uploadGalleryImage } from '@/lib/s3'
import { PoolClient } from 'pg'

interface ReviewForm {
  id: string
  coupon_id: string | null
  is_active: boolean
}
interface Coupon {
  code: string
  description: string | null
  valid_until: string | null
  discount_type: string
  discount_value: number
}

export async function POST(request: NextRequest, { params }: { params: { slug: string } }) {
  const form = await queryOne<ReviewForm>(
    'SELECT id, coupon_id, is_active FROM review_forms WHERE slug = $1',
    [params.slug]
  )
  if (!form) return NextResponse.json({ error: 'Form not found' }, { status: 404 })
  if (!form.is_active) return NextResponse.json({ error: 'This form is no longer accepting submissions' }, { status: 410 })

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 })
  }

  const phone = (formData.get('phone') as string || '').replace(/\D/g, '')
  const file = formData.get('screenshot') as File | null

  if (!phone || phone.length !== 10) {
    return NextResponse.json({ error: 'Valid 10-digit phone number is required' }, { status: 400 })
  }
  if (!file || !file.type.startsWith('image/')) {
    return NextResponse.json({ error: 'A screenshot image is required' }, { status: 400 })
  }
  if (file.size > 5 * 1024 * 1024) {
    return NextResponse.json({ error: 'Screenshot must be under 5MB' }, { status: 400 })
  }

  const existing = await queryOne(
    'SELECT id FROM review_form_submissions WHERE form_id = $1 AND phone = $2',
    [form.id, phone]
  )
  if (existing) return NextResponse.json({ error: 'This phone number has already submitted a review for this form' }, { status: 409 })

  const imageBuffer = Buffer.from(await file.arrayBuffer())
  const fileName = `review-${form.id}-${phone}`
  let screenshotUrl: string
  try {
    const uploaded = await uploadGalleryImage(imageBuffer, fileName)
    screenshotUrl = uploaded.url
  } catch {
    return NextResponse.json({ error: 'Failed to upload screenshot, please try again' }, { status: 500 })
  }

  let coupon: Coupon | null = null
  if (form.coupon_id) {
    coupon = await queryOne<Coupon>(
      'SELECT code, description, valid_until, discount_type, discount_value FROM coupons WHERE id = $1',
      [form.coupon_id]
    )
  }

  await withTransaction(async (client: PoolClient) => {
    await client.query(
      `INSERT INTO review_form_submissions (form_id, phone, screenshot_url, coupon_code, status)
       VALUES ($1,$2,$3,$4,'pending')`,
      [form.id, phone, screenshotUrl, coupon?.code || null]
    )
    await client.query(
      'UPDATE review_forms SET submissions_count = submissions_count + 1 WHERE id = $1',
      [form.id]
    )
  })

  return NextResponse.json({
    success: true,
    couponCode: coupon?.code || null,
    couponDescription: coupon?.description || null,
    validUntil: coupon?.valid_until || null,
    discountType: coupon?.discount_type || null,
    discountValue: coupon?.discount_value || null,
  })
}
