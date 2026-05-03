import { NextRequest, NextResponse } from 'next/server'
import { queryOne, withTransaction } from '@/lib/db'
import { uploadGalleryImage } from '@/lib/s3'
import { PoolClient } from 'pg'
import nodemailer from 'nodemailer'

interface CustomField {
  id: string
  label: string
  type: 'text' | 'textarea' | 'image' | 'rating'
  required: boolean
}

interface ReviewForm {
  id: string
  coupon_id: string | null
  is_active: boolean
  custom_fields: CustomField[]
}

interface Coupon {
  id: string
  code: string
  description: string | null
  valid_until: string | null
  discount_type: string
  discount_value: number
}

const transporter = nodemailer.createTransport({
  host: 'email-smtp.us-east-1.amazonaws.com',
  port: 465,
  secure: true,
  auth: { user: process.env.SES_SMTP_USER, pass: process.env.SES_SMTP_PASSWORD },
})

const FROM = `"Jeffi Store's" <${process.env.SES_FROM_EMAIL}>`
const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://jeffistores.in'

function couponEmail(coupon: Coupon, email: string) {
  const discountText = coupon.discount_type === 'percentage'
    ? `${coupon.discount_value}% off`
    : `₹${coupon.discount_value} off`
  const validLine = coupon.valid_until
    ? `<p style="color:#999;font-size:13px;margin:8px 0 0;">Valid until ${new Date(coupon.valid_until).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}</p>`
    : ''
  const body = `
    <p style="font-size:16px;color:#333;margin:0 0 12px;">Hi there,</p>
    <h2 style="font-size:22px;color:#1a3a4a;margin:0 0 16px;">Thank you for your Google review!</h2>
    <p style="color:#555;line-height:1.6;margin:0 0 20px;">Here&apos;s your reward coupon. Use it on your next order at Jeffi Stores:</p>
    <div style="background:#f5f5f5;border:2px dashed #e07b3f;border-radius:8px;padding:20px 24px;text-align:center;margin:0 0 20px;">
      <p style="font-size:13px;color:#777;margin:0 0 4px;">${discountText} on your next order</p>
      <p style="font-size:28px;font-weight:900;letter-spacing:4px;color:#1a3a4a;margin:0;">${coupon.code}</p>
      ${coupon.description ? `<p style="font-size:13px;color:#555;margin:8px 0 0;">${coupon.description}</p>` : ''}
      ${validLine}
    </div>
    <a href="${BASE_URL}/products" style="display:inline-block;background:#e07b3f;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:6px;font-weight:600;font-size:15px;margin:0 0 16px;">Shop Now at Jeffi Stores</a>
  `
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:32px 16px;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
      <tr><td style="background:#1a3a4a;padding:20px 32px;border-radius:8px 8px 0 0;">
        <a href="${BASE_URL}" style="text-decoration:none;color:#ffffff;font-size:20px;font-weight:700;">Jeffi Store&apos;s</a>
      </td></tr>
      <tr><td style="background:#ffffff;padding:32px;border-radius:0 0 8px 8px;">${body}</td></tr>
      <tr><td style="padding:16px 0;text-align:center;font-size:12px;color:#999;">
        &copy; ${new Date().getFullYear()} Jeffi Store&apos;s &bull; <a href="${BASE_URL}" style="color:#999;">jeffistores.in</a>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`
  return { subject: `Your reward coupon from Jeffi Store's — ${coupon.code}`, html }
}

export async function POST(request: NextRequest, { params }: { params: { slug: string } }) {
  const form = await queryOne<ReviewForm>(
    'SELECT id, coupon_id, is_active, custom_fields FROM review_forms WHERE slug = $1',
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

  const email = (formData.get('email') as string || '').trim().toLowerCase()
  const file = formData.get('screenshot') as File | null
  const customFields: CustomField[] = form.custom_fields || []

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'A valid email address is required' }, { status: 400 })
  }
  if (!file || !file.type.startsWith('image/')) {
    return NextResponse.json({ error: 'A screenshot image is required' }, { status: 400 })
  }
  if (file.size > 5 * 1024 * 1024) {
    return NextResponse.json({ error: 'Screenshot must be under 5MB' }, { status: 400 })
  }

  for (const field of customFields) {
    if (field.required) {
      const val = formData.get(`field_${field.id}`)
      if (!val || (typeof val === 'string' && !val.trim())) {
        return NextResponse.json({ error: `"${field.label}" is required` }, { status: 400 })
      }
    }
  }

  const existing = await queryOne(
    'SELECT id FROM review_form_submissions WHERE form_id = $1 AND email = $2',
    [form.id, email]
  )
  if (existing) return NextResponse.json({ error: 'This email has already submitted a review for this form' }, { status: 409 })

  const screenshotBuffer = Buffer.from(await file.arrayBuffer())
  let screenshotUrl: string
  try {
    const uploaded = await uploadGalleryImage(screenshotBuffer, `review-${form.id}-${Date.now()}`)
    screenshotUrl = uploaded.url
  } catch {
    return NextResponse.json({ error: 'Failed to upload screenshot, please try again' }, { status: 500 })
  }

  const extraFields: Record<string, string> = {}
  for (const field of customFields) {
    const raw = formData.get(`field_${field.id}`)
    if (!raw) continue
    if (field.type === 'image' && raw instanceof File && raw.size > 0) {
      try {
        const buf = Buffer.from(await raw.arrayBuffer())
        const up = await uploadGalleryImage(buf, `review-field-${form.id}-${field.id}-${Date.now()}`)
        extraFields[field.id] = up.url
      } catch {
        extraFields[field.id] = ''
      }
    } else if (typeof raw === 'string') {
      extraFields[field.id] = raw
    }
  }

  let coupon: Coupon | null = null
  if (form.coupon_id) {
    coupon = await queryOne<Coupon>(
      'SELECT id, code, description, valid_until, discount_type, discount_value FROM coupons WHERE id = $1',
      [form.coupon_id]
    )
  }

  await withTransaction(async (client: PoolClient) => {
    await client.query(
      `INSERT INTO review_form_submissions (form_id, email, screenshot_url, coupon_code, extra_fields, status)
       VALUES ($1,$2,$3,$4,$5,'pending')`,
      [form.id, email, screenshotUrl, coupon?.code || null, JSON.stringify(extraFields)]
    )
    await client.query(
      'UPDATE review_forms SET submissions_count = submissions_count + 1 WHERE id = $1',
      [form.id]
    )
  })

  if (coupon) {
    try {
      const { subject, html } = couponEmail(coupon, email)
      await transporter.sendMail({ from: FROM, to: email, subject, html })
    } catch {
    }
  }

  return NextResponse.json({
    success: true,
    couponCode: coupon?.code || null,
    couponDescription: coupon?.description || null,
    validUntil: coupon?.valid_until || null,
    discountType: coupon?.discount_type || null,
    discountValue: coupon?.discount_value || null,
  })
}
