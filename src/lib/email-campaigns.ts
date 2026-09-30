import nodemailer from 'nodemailer'
import { query, queryMany, queryOne } from './db'
import { sendAuditedMail } from './mail-audit'
import { buildVarMap, substituteVars } from './template-vars'
import { getStoreIdentity } from './site-controls'
import { mailShell } from './mail-template'

const transporter = nodemailer.createTransport({
  host: 'email-smtp.us-east-1.amazonaws.com',
  port: 465,
  secure: true,
  auth: {
    user: process.env.SES_SMTP_USER,
    pass: process.env.SES_SMTP_PASSWORD,
  },
})

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://jeffistores.in'

type TemplateData = Record<string, string>

function baseLayout(title: string, body: string, baseUrl: string = BASE_URL) {
  return mailShell({
    brand: '{store_name}',
    documentTitle: title,
    content: body,
    footerLines: [
      `&copy; ${new Date().getFullYear()} {store_name} &bull; <a href="${baseUrl}" style="color:#666;">{store_web}</a>`,
    ],
  })
}

function ctaButton(text: string, url: string) {
  return `<a href="${url}" style="display:inline-block;background:#e07b3f;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:6px;font-weight:600;font-size:15px;margin:16px 0;">${text}</a>`
}

export { baseLayout, ctaButton }

export function renderCampaignEmail(
  templateKey: string,
  data: TemplateData,
  recipientName?: string,
  baseUrl?: string
): { subject: string; html: string; ampHtml?: string } {
  const greeting = recipientName ? `Hi ${recipientName},` : 'Hi there,'
  const url = baseUrl || BASE_URL

  switch (templateKey) {
    case 'review_request': {
      const subject = data.subject || 'How was your order? Share your thoughts ⭐'
      const items: Array<{ name: string; imageUrl: string | null; starLinks: string[]; productUrl?: string }> =
        JSON.parse(data.itemsJson || '[]')
      const appUrl = url
      const ampBaseUrl = url

      // Fallback HTML: one link per product to its detail page (non-Gmail clients)
      const fallbackLinks = items
        .map(item => {
          const url = item.productUrl || item.starLinks[4] || `${appUrl}/products`
          const img = item.imageUrl
            ? `<img src="${item.imageUrl}" width="48" height="48" style="object-fit:cover;border-radius:6px;display:inline-block;vertical-align:middle;margin-right:10px;" alt="">`
            : ''
          return `<tr><td style="padding:10px 0;border-bottom:1px solid #f0f0f0;">
          <a href="${url}" style="color:#1a3a4a;text-decoration:none;font-size:14px;font-weight:600;display:flex;align-items:center;">
            ${img}<span>${item.name}</span>
          </a>
        </td></tr>`
        })
        .join('')

      const couponBlock = data.couponCode
        ? `
        <p style="margin:20px 0 8px;font-size:14px;color:#555;">As a thank-you, use this code on your next order:</p>
        <p style="font-size:18px;font-weight:700;color:#e07b3f;letter-spacing:2px;">${data.couponCode}</p>
        ${data.discountPercent ? `<p style="font-size:13px;color:#888;">${data.discountPercent}% off your next purchase</p>` : ''}`
        : ''

      const html = baseLayout(
        subject,
        `
        <p style="font-size:16px;color:#333;margin:0 0 12px;">Hi ${data.firstName || 'there'},</p>
        <h2 style="font-size:22px;color:#1a3a4a;margin:0 0 8px;">How did we do?</h2>
        <p style="color:#555;line-height:1.6;margin:0 0 20px;">We hope you love your recent purchase! Tap a product below to leave a quick review.</p>
        <table cellpadding="0" cellspacing="0" width="100%">${fallbackLinks}</table>
        ${couponBlock}
      `,
        url
      )

      // AMP HTML: inline form per product (Gmail only)
      const ampProductForms = items
        .map((item, idx) => {
          const token = item.starLinks[0]?.match(/token=([^&]+)/)?.[1] ?? ''
          const img = item.imageUrl
            ? `<img src="${item.imageUrl}" width="56" height="56" style="object-fit:cover;border-radius:6px;display:block;" alt="">`
            : ''
          return `
        <div style="padding:16px 0;border-bottom:1px solid #f0f0f0;">
          <table cellpadding="0" cellspacing="0" width="100%"><tr>
            ${img ? `<td width="68" style="vertical-align:top;padding-right:12px;">${img}</td>` : ''}
            <td style="vertical-align:top;">
              <p style="margin:0 0 10px;font-size:14px;font-weight:600;color:#1a3a4a;">${item.name}</p>
              <form method="POST"
                action-xhr="https://jeffistores.in/api/reviews/amp"
                id="review-form-${idx}">
                <input type="hidden" name="token" value="${token}">
                <div style="margin-bottom:10px;">
                  <amp-selector name="rating" layout="container">
                    <span option="1">★</span>
                    <span option="2">★</span>
                    <span option="3">★</span>
                    <span option="4">★</span>
                    <span option="5">★</span>
                  </amp-selector>
                </div>
                <textarea name="comment" placeholder="Tell us what you think…" rows="3"
                  style="width:100%;padding:8px;border:1px solid #ddd;border-radius:6px;font-size:13px;resize:none;box-sizing:border-box;"
                  required></textarea>
                <div style="margin-top:8px;">
                  <input type="submit" value="Submit Review"
                    style="background:#e07b3f;color:#fff;border:none;padding:10px 20px;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;">
                </div>
                <div submit-success>
                  <template type="amp-mustache"><p style="color:#22863a;font-size:14px;font-weight:600;margin:8px 0;">Thanks for your review!</p></template>
                </div>
                <div submit-error>
                  <template type="amp-mustache">Something went wrong. <a href="${item.productUrl || ampBaseUrl + '/products'}">Open in browser</a></template>
                </div>
              </form>
            </td>
          </tr></table>
        </div>`
        })
        .join('')

      const ampCoupon = data.couponCode
        ? `
        <p style="margin:20px 0 8px;font-size:14px;color:#555;">As a thank-you, use this code on your next order:</p>
        <p style="font-size:18px;font-weight:700;color:#e07b3f;letter-spacing:2px;">${data.couponCode}</p>
        ${data.discountPercent ? `<p style="font-size:13px;color:#888;">${data.discountPercent}% off your next purchase</p>` : ''}`
        : ''

      const ampHtml = `<!doctype html>
<html amp4email data-css-strict>
<head>
  <meta charset="utf-8">
  <script async src="https://cdn.ampproject.org/v0.js"></script>
  <script async custom-element="amp-form" src="https://cdn.ampproject.org/v0/amp-form-0.1.js"></script>
  <script async custom-element="amp-selector" src="https://cdn.ampproject.org/v0/amp-selector-0.1.js"></script>
  <script async custom-template="amp-mustache" src="https://cdn.ampproject.org/v0/amp-mustache-0.2.js"></script>
  <style amp4email-boilerplate>body{visibility:hidden}</style>
  <style amp-custom>
    body { margin:0; padding:0; background:#f5f5f5; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; }
    .wrap { max-width:600px; margin:0 auto; background:#fff; }
    .header { background:#1a3a4a; padding:20px 32px; }
    .header a { color:#fff; font-size:20px; font-weight:700; text-decoration:none; }
    .body { padding:28px 32px; }
    amp-selector [option] { cursor:pointer; color:#ddd; font-size:28px; }
    amp-selector [selected] { color:#e07b3f; }
    amp-selector [option]:focus { outline:none; }
  </style>
</head>
<body>
<div class="wrap">
  <div class="header"><a href="${ampBaseUrl}">{store_name}</a></div>
  <div class="body">
    <p style="font-size:16px;color:#333;margin:0 0 12px;">Hi ${data.firstName || 'there'},</p>
    <h2 style="font-size:22px;color:#1a3a4a;margin:0 0 8px;">How did we do?</h2>
    <p style="color:#555;line-height:1.6;margin:0 0 20px;">We hope you love your recent purchase! Leave a quick review right here.</p>
    ${ampProductForms}
    ${ampCoupon}
  </div>
  <div style="padding:16px;text-align:center;font-size:12px;color:#999;">&copy; ${new Date().getFullYear()} {store_name}</div>
</div>
</body>
</html>`

      return { subject, html, ampHtml }
    }

    case 'review_form_share': {
      const subject = data.subject || `Share your experience — get ${data.couponCode ? data.couponCode : 'a reward'}!`
      const html = baseLayout(
        subject,
        `
        <p style="font-size:16px;color:#333;margin:0 0 12px;">${greeting}</p>
        <h2 style="font-size:22px;color:#1a3a4a;margin:0 0 16px;">${data.formTitle || 'Leave Us a Google Review'}</h2>
        <p style="color:#555;line-height:1.6;margin:0 0 20px;">
          We'd love to hear what you think! Leave us a Google review and we'll send you a special discount as a thank-you.
        </p>
        ${ctaButton('Leave a Review & Claim Reward', data.formUrl || url)}
        <p style="color:#999;font-size:13px;margin:20px 0 0;">Or paste this link: <a href="${data.formUrl}" style="color:#e07b3f;">${data.formUrl}</a></p>
      `,
        url
      )
      return { subject, html }
    }

    case 'promotion': {
      const subject = data.subject || data.headline || 'Special offer just for you'
      const html = baseLayout(
        subject,
        `
        <p style="font-size:16px;color:#333;margin:0 0 12px;">${greeting}</p>
        <h2 style="font-size:24px;color:#1a3a4a;margin:0 0 16px;">${data.headline}</h2>
        <p style="color:#555;line-height:1.6;margin:0 0 20px;">${(data.body || '').replace(/\n/g, '<br>')}</p>
        ${data.ctaUrl ? ctaButton(data.ctaText || 'Shop Now', data.ctaUrl) : ''}
      `,
        url
      )
      return { subject, html }
    }

    case 'event': {
      const subject = data.subject || `You're invited: ${data.eventName}`
      const html = baseLayout(
        subject,
        `
        <p style="font-size:16px;color:#333;margin:0 0 12px;">${greeting}</p>
        <h2 style="font-size:24px;color:#1a3a4a;margin:0 0 8px;">${data.eventName}</h2>
        ${data.eventDate ? `<p style="color:#e07b3f;font-weight:600;margin:0 0 16px;">${data.eventDate}</p>` : ''}
        <p style="color:#555;line-height:1.6;margin:0 0 20px;">${(data.eventDetails || '').replace(/\n/g, '<br>')}</p>
        ${data.ctaUrl ? ctaButton('Learn More', data.ctaUrl) : ''}
      `,
        url
      )
      return { subject, html }
    }

    case 'announcement': {
      const subject = data.subject || data.headline || "An update from Jeffi Store's"
      const html = baseLayout(
        subject,
        `
        <p style="font-size:16px;color:#333;margin:0 0 12px;">${greeting}</p>
        <h2 style="font-size:24px;color:#1a3a4a;margin:0 0 16px;">${data.headline}</h2>
        <p style="color:#555;line-height:1.6;margin:0 0 20px;">${(data.body || '').replace(/\n/g, '<br>')}</p>
        ${ctaButton('Visit Our Store', url)}
      `,
        url
      )
      return { subject, html }
    }

    case 'custom': {
      const subject = data.subject || "Message from Jeffi Store's"
      const body = data.htmlBody || ''
      const isFullDoc = /<html[\s>]/i.test(body) || /<!DOCTYPE/i.test(body)
      const html = isFullDoc
        ? body
        : baseLayout(subject, `<p style="font-size:16px;color:#333;margin:0 0 12px;">${greeting}</p>${body}`, url)
      return { subject, html }
    }

    default:
      throw new Error(`Unknown template key: ${templateKey}`)
  }
}

interface Recipient {
  user_id: string
  email: string
  first_name: string | null
}

async function resolveAudience(audienceType: string, audienceFilter: Record<string, unknown>): Promise<Recipient[]> {
  const base = `SELECT u.id AS user_id, u.email, u.first_name FROM users u`
  const base_cp = `SELECT u.id AS user_id, u.email, u.first_name FROM users u LEFT JOIN customer_profiles cp ON cp.user_id = u.id`
  const where = `WHERE u.is_active = true AND u.is_guest = false AND u.email IS NOT NULL`

  if (audienceType === 'customer_type') {
    const types = audienceFilter.customerTypes as string[]
    return queryMany<Recipient>(`${base_cp} ${where} AND cp.customer_type = ANY($1)`, [types])
  }

  if (audienceType === 'order_history') {
    const days = (audienceFilter.daysSinceOrder as number) || 30
    return queryMany<Recipient>(
      `${base} ${where} AND u.id IN (SELECT DISTINCT user_id FROM orders WHERE created_at > NOW() - INTERVAL '${days} days' AND user_id IS NOT NULL)`
    )
  }

  if (audienceType === 'specific_user') {
    const userId = audienceFilter.userId as string
    return queryMany<Recipient>(
      `SELECT u.id AS user_id, u.email, u.first_name FROM users u WHERE u.id = $1 AND u.email IS NOT NULL`,
      [userId]
    )
  }

  if (audienceType === 'segment') {
    const seg = audienceFilter.segment as string
    const segConditions: Record<string, string> = {
      vip: `COALESCE(o.lifetime_value,0)>=50000`,
      loyal: `COALESCE(o.paid_orders,0)>=5 AND COALESCE(o.lifetime_value,0)>=25000`,
      b2b: `(cp.gst_number IS NOT NULL OR cp.company_name IS NOT NULL)`,
      repeat: `COALESCE(o.order_count,0)>=3`,
      one_time: `COALESCE(o.order_count,0)=1`,
      new: `u.created_at>=NOW()-INTERVAL'30 days'`,
      at_risk: `o.last_order_at IS NOT NULL AND o.last_order_at<NOW()-INTERVAL'90 days' AND o.last_order_at>=NOW()-INTERVAL'180 days'`,
      dormant: `o.last_order_at IS NOT NULL AND o.last_order_at<NOW()-INTERVAL'180 days'`,
      lead: `COALESCE(o.order_count,0)=0`,
    }
    const cond = segConditions[seg]
    if (cond) {
      const from = `SELECT u.id AS user_id, u.email, u.first_name FROM users u LEFT JOIN (SELECT user_id, COUNT(*) AS order_count, SUM(total_amount) AS lifetime_value, MAX(created_at) AS last_order_at, COUNT(*) FILTER (WHERE payment_status='paid') AS paid_orders FROM orders GROUP BY user_id) o ON o.user_id=u.id LEFT JOIN customer_profiles cp ON cp.user_id=u.id`
      return queryMany<Recipient>(`${from} ${where} AND ${cond}`)
    }
  }

  return queryMany<Recipient>(`${base} ${where}`)
}

export async function sendCampaign(
  campaignId: string,
  opts?: { batchSize?: number; batchDelay?: number }
): Promise<{ sent: number; failed: number }> {
  const batchSize = opts?.batchSize ?? 50
  const batchDelay = opts?.batchDelay ?? 1000
  const campaign = await queryOne<{
    id: string
    title: string
    template_key: string
    subject: string
    template_data: Record<string, string>
    audience_type: string
    audience_filter: Record<string, unknown>
    status: string
  }>('SELECT * FROM email_campaigns WHERE id = $1', [campaignId])

  if (!campaign) throw new Error('Campaign not found')
  if (campaign.status === 'sent') throw new Error('Campaign already sent')

  await query(`UPDATE email_campaigns SET status = 'sending' WHERE id = $1`, [campaignId])

  const recipients = await resolveAudience(campaign.audience_type, campaign.audience_filter)

  // Store identity drives {store_*} vars. From sender and base URL are tenant-aware.
  const store = await getStoreIdentity()
  const { campaignMailFromAsync, storeBaseUrlAsync } = await import('./brand')
  const fromAddr = await campaignMailFromAsync()
  const baseUrl = await storeBaseUrlAsync()

  let sent = 0
  let failed = 0

  // Resolve coupon once
  const sourceCouponId = campaign.audience_filter.couponId as string | undefined
  let sourceCoupon: { id: string; code: string; discount_type: string; discount_value: number } | null = null
  if (sourceCouponId) {
    sourceCoupon = await queryOne(`SELECT id, code, discount_type, discount_value FROM coupons WHERE id = $1`, [
      sourceCouponId,
    ])
  }

  // Send in batches to avoid blocking and stay under SES rate limits
  for (let i = 0; i < recipients.length; i += batchSize) {
    const batch = recipients.slice(i, i + batchSize)

    await Promise.all(
      batch.map(async recipient => {
        try {
          let templateData: Record<string, string> = { ...campaign.template_data, subject: campaign.subject }

          if (sourceCoupon) {
            await query(
              `INSERT INTO coupon_eligible_users (coupon_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
              [sourceCoupon.id, recipient.user_id]
            )
            const valLabel =
              sourceCoupon.discount_type === 'percentage'
                ? `${sourceCoupon.discount_value}% off`
                : `₹${sourceCoupon.discount_value} off`
            templateData = {
              ...templateData,
              body: [
                templateData.body,
                `\nUse coupon code <strong>${sourceCoupon.code}</strong> for ${valLabel} on your next order.`,
              ]
                .filter(Boolean)
                .join('\n'),
            }
          }

          const { subject, html } = renderCampaignEmail(
            campaign.template_key,
            templateData,
            recipient.first_name || undefined,
            baseUrl
          )
          const vars = buildVarMap({
            recipient: { email: recipient.email, first_name: recipient.first_name },
            store: { name: store.name, email: store.email, phone: store.phone, web: store.web },
          })
          const finalSubject = substituteVars(subject, vars)
          const finalHtml = substituteVars(html, vars)
          await sendAuditedMail({
            from: fromAddr,
            to: recipient.email,
            subject: finalSubject,
            html: finalHtml,
            kind: 'campaign',
            templateName: campaign.template_key,
            entityType: 'email_campaigns',
            entityId: campaignId,
            userId: recipient.user_id,
          })
          await query(`INSERT INTO email_campaign_logs (campaign_id, email, status) VALUES ($1, $2, 'sent')`, [
            campaignId,
            recipient.email,
          ])
          sent++
        } catch (err) {
          await query(
            `INSERT INTO email_campaign_logs (campaign_id, email, status, error) VALUES ($1, $2, 'failed', $3)`,
            [campaignId, recipient.email, String(err)]
          )
          failed++
        }
      })
    )

    // Delay between batches (skip after last batch)
    if (i + batchSize < recipients.length) {
      await new Promise(r => setTimeout(r, batchDelay))
    }
  }

  await query(`UPDATE email_campaigns SET status = 'sent', sent_at = NOW(), recipient_count = $2 WHERE id = $1`, [
    campaignId,
    sent + failed,
  ])

  return { sent, failed }
}
