import { NextRequest, NextResponse } from 'next/server'
import { queryOne, withTransaction } from '@/lib/db'
import { uploadGalleryImage } from '@/lib/s3'
import { PoolClient } from 'pg'
import nodemailer from 'nodemailer'
import { sendAuditedMail } from '@/lib/mail-audit'
import { currentBrandNameAsync } from '@/lib/brand'
import { mailShell } from '@/lib/mail-template'

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

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://jeffistores.in'

async function couponEmail(coupon: Coupon, email: string) {
  const brand = await currentBrandNameAsync()
  const discountText =
    coupon.discount_type === 'percentage' ? `${coupon.discount_value}% off` : `₹${coupon.discount_value} off`
  const validLine = coupon.valid_until
    ? `<p class="muted" style="margin:8px 0 0;">Valid until ${new Date(coupon.valid_until).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}</p>`
    : ''
  const html = mailShell({
    brand,
    kicker: 'Your reward coupon',
    title: 'Thank you for your Google review!',
    content: `
      <p>Hi there,</p>
      <p>Here&apos;s your reward coupon. Use it on your next order at ${brand}:</p>
      <div class="coupon">
        <p class="muted" style="margin:0 0 4px;">${discountText} on your next order</p>
        <p class="coupon-code">${coupon.code}</p>
        ${coupon.description ? `<p style="font-size:13px;color:#555;margin:8px 0 0;">${coupon.description}</p>` : ''}
        ${validLine}
      </div>
      <div class="cta"><a href="${BASE_URL}/products" class="button">Shop Now at ${brand}</a></div>
    `,
    footerLines: [
      `&copy; ${new Date().getFullYear()} ${brand} &bull; <a href="${BASE_URL}" style="color:#666;">jeffistores.in</a>`,
    ],
    extraCss: `
      .coupon { background-color: white; border: 2px dashed #2563eb; border-radius: 8px; padding: 20px 24px; text-align: center; margin: 20px 0; }
      .coupon-code { font-size: 28px; font-weight: 900; letter-spacing: 4px; color: #2563eb; margin: 0; }
    `,
  })
  return { subject: `Your reward coupon from ${brand} — ${coupon.code}`, html }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const form = await queryOne<ReviewForm>(
    'SELECT id, coupon_id, is_active, custom_fields FROM review_forms WHERE slug = $1',
    [slug]
  )
  if (!form) return NextResponse.json({ error: 'Form not found' }, { status: 404 })
  if (!form.is_active)
    return NextResponse.json({ error: 'This form is no longer accepting submissions' }, { status: 410 })

  let formData: FormData
  try {
    formData = await request.formData()
  } catch (err) {
    console.error('[route]', err)
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 })
  }

  const email = ((formData.get('email') as string) || '').trim().toLowerCase()
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

  const existing = await queryOne('SELECT id FROM review_form_submissions WHERE form_id = $1 AND email = $2', [
    form.id,
    email,
  ])
  if (existing)
    return NextResponse.json({ error: 'This email has already submitted a review for this form' }, { status: 409 })

  const screenshotBuffer = Buffer.from(await file.arrayBuffer())
  let screenshotUrl: string
  try {
    const uploaded = await uploadGalleryImage(screenshotBuffer, `review-${form.id}-${Date.now()}`)
    screenshotUrl = uploaded.url
  } catch (err) {
    console.error('[route]', err)
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
      } catch (err) {
        console.error('[route]', err)
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
    await client.query('UPDATE review_forms SET submissions_count = submissions_count + 1 WHERE id = $1', [form.id])
  })

  if (coupon) {
    try {
      const { subject, html } = await couponEmail(coupon, email)
      const from = `"${await currentBrandNameAsync()}" <${process.env.SES_FROM_EMAIL}>`
      await sendAuditedMail({ from, to: email, subject, html, kind: 'form_submission' })
    } catch (err) {
      console.error('[route]', err)
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
