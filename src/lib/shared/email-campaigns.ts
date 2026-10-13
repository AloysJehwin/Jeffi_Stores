import nodemailer from 'nodemailer'
import { query, queryMany, queryOne } from '@/lib/shared/db'
import { sendAuditedMail } from '@/lib/shared/mail-audit'
import { createTemplateVariableResolver, renderTemplate } from '@/lib/templates/variables'
import { platformBrandName } from '@/lib/catalog/brand'
import { getEmailLayout } from '@/lib/templates/email-layouts'

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

function baseLayout(title: string, body: string, baseUrl: string = BASE_URL, layoutKey?: string | null) {
  return getEmailLayout(layoutKey).render({
    title,
    bodyHtml: body,
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
  baseUrl?: string,
  storeName?: string,
  vars?: Record<string, string>
): { subject: string; html: string; ampHtml?: string } {
  const out = renderCampaignEmailRaw(templateKey, data, recipientName, baseUrl, storeName)
  if (!vars) return out
  return {
    subject: renderTemplate(out.subject, vars),
    html: renderTemplate(out.html, vars, { escape: true }),
    ...(out.ampHtml ? { ampHtml: renderTemplate(out.ampHtml, vars, { escape: true }) } : {}),
  }
}

// Leaves {store_name} / {store_web} and any composer tokens for the caller's variables.
function renderCampaignEmailRaw(
  templateKey: string,
  data: TemplateData,
  recipientName?: string,
  baseUrl?: string,
  storeName?: string
): { subject: string; html: string; ampHtml?: string } {
  const greeting = recipientName ? `Hi ${recipientName},` : 'Hi there,'
  const url = baseUrl || BASE_URL
  const brand = storeName?.trim() || platformBrandName()

  switch (templateKey) {
    case 'review_request': {
      const subject = data.subject || 'How was your order? Share your thoughts ⭐'
      const items: Array<{
        name: string
        imageUrl: string | null
        starLinks: string[]
        reviewUrl?: string
        productUrl?: string
      }> = JSON.parse(data.itemsJson || '[]')
      const appUrl = url
      const ampBaseUrl = url
      // The AMP form posts to the sending store's API, so a tenant's reviews reach its own database.
      const apiBase = data.apiBaseUrl || url

      // Fallback HTML (non-Gmail clients): each product opens its own review page.
      const fallbackLinks = items
        .map(item => {
          // Older item data has no reviewUrl: use its review link without a preselected rating.
          const legacyReview = item.starLinks?.find(Boolean)?.replace(/&rating=\d+$/, '')
          const url = item.reviewUrl || legacyReview || item.productUrl || `${appUrl}/products`
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
        <p style="color:#555;line-height:1.6;margin:0 0 20px;">We hope you love your recent purchase! Tap a product below to review it.</p>
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
                action-xhr="${apiBase}/api/reviews/amp"
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
                  <template type="amp-mustache">Something went wrong. <a href="${item.reviewUrl || item.productUrl || ampBaseUrl + '/products'}">Open in browser</a></template>
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
      const subject = data.subject || data.headline || `An update from ${brand}`
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
      const subject = data.subject || `Message from ${brand}`
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
  phone?: string | null
  first_name: string | null
  last_name?: string | null
}

export type MessagingChannels = {
  email?: { slug: string; vars?: Record<string, string>; subject?: string }
  sms?: { slug: string; vars?: Record<string, string> }
  whatsapp?: { slug: string; vars?: Record<string, string> }
}

async function resolveAudience(audienceType: string, audienceFilter: Record<string, unknown>): Promise<Recipient[]> {
  const base = `SELECT u.id AS user_id, u.email, u.phone, u.first_name, u.last_name FROM users u`
  const base_cp = `SELECT u.id AS user_id, u.email, u.phone, u.first_name, u.last_name FROM users u LEFT JOIN customer_profiles cp ON cp.user_id = u.id`
  const where = `WHERE u.is_active = true AND u.is_guest = false AND u.email IS NOT NULL AND u.marketing_opt_out = false`

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
      `SELECT u.id AS user_id, u.email, u.phone, u.first_name, u.last_name FROM users u WHERE u.id = $1 AND u.email IS NOT NULL AND u.marketing_opt_out = false`,
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
      const from = `SELECT u.id AS user_id, u.email, u.phone, u.first_name, u.last_name FROM users u LEFT JOIN (SELECT user_id, COUNT(*) AS order_count, SUM(total_amount) AS lifetime_value, MAX(created_at) AS last_order_at, COUNT(*) FILTER (WHERE payment_status='paid') AS paid_orders FROM orders GROUP BY user_id) o ON o.user_id=u.id LEFT JOIN customer_profiles cp ON cp.user_id=u.id`
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
    channels: MessagingChannels | null
    audience_type: string
    audience_filter: Record<string, unknown>
    status: string
  }>('SELECT * FROM email_campaigns WHERE id = $1', [campaignId])

  if (!campaign) throw new Error('Campaign not found')
  if (campaign.status === 'sent') throw new Error('Campaign already sent')

  await query(`UPDATE email_campaigns SET status = 'sending' WHERE id = $1`, [campaignId])

  const recipients = await resolveAudience(campaign.audience_type, campaign.audience_filter)

  // Store identity + custom variables load once; From sender and base URL are tenant-aware.
  const resolveVars = await createTemplateVariableResolver()
  const { campaignMailFromAsync, storeBaseUrlAsync } = await import('@/lib/catalog/brand')
  const fromAddr = await campaignMailFromAsync()
  const baseUrl = await storeBaseUrlAsync()

  // Resolve coupon once
  const sourceCouponId = campaign.audience_filter.couponId as string | undefined
  let sourceCoupon: { id: string; code: string; discount_type: string; discount_value: number } | null = null
  if (sourceCouponId) {
    sourceCoupon = await queryOne(`SELECT id, code, discount_type, discount_value FROM coupons WHERE id = $1`, [
      sourceCouponId,
    ])
  }

  if (campaign.template_key === 'library') {
    const r = await sendLibraryMessaging(campaign.id, campaign.channels ?? {}, campaign.subject, recipients, {
      resolveVars, fromAddr, baseUrl, sourceCoupon, batchSize, batchDelay,
    })
    await query(`UPDATE email_campaigns SET status = 'sent', sent_at = NOW(), recipient_count = $2 WHERE id = $1`, [
      campaignId, recipients.length,
    ])
    return r
  }

  let sent = 0
  let failed = 0

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

          const vars = resolveVars({
            recipient: { email: recipient.email, first_name: recipient.first_name, last_name: recipient.last_name },
          })
          const { subject: finalSubject, html: finalHtml } = renderCampaignEmail(
            campaign.template_key,
            templateData,
            recipient.first_name || undefined,
            baseUrl,
            vars.store_name,
            vars
          )
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

type Coupon = { id: string; code: string; discount_type: string; discount_value: number }

async function logSend(campaignId: string, channel: string, to: string, ok: boolean, error?: string) {
  await query(
    `INSERT INTO email_campaign_logs (campaign_id, email, channel, to_address, status, error) VALUES ($1, $2, $3, $4, $5, $6)`,
    [campaignId, channel === 'email' ? to : null, channel, to, ok ? 'sent' : 'failed', error ?? null]
  )
}

const alreadySent = (campaignId: string, channel: string, to: string) =>
  queryOne(`SELECT 1 FROM email_campaign_logs WHERE campaign_id = $1 AND channel = $2 AND to_address = $3 AND status = 'sent'`, [
    campaignId, channel, to,
  ])

// Messaging (library templates): each picked channel goes to every recipient that has that address.
async function sendLibraryMessaging(
  campaignId: string,
  channels: MessagingChannels,
  fallbackSubject: string,
  recipients: Recipient[],
  ctx: {
    resolveVars: Awaited<ReturnType<typeof createTemplateVariableResolver>>
    fromAddr: string
    baseUrl: string
    sourceCoupon: Coupon | null
    batchSize: number
    batchDelay: number
  }
): Promise<{ sent: number; failed: number }> {
  const { getLibraryTemplate } = await import('@/lib/messaging/library')
  const { renderCampaignTemplate } = await import('@/lib/shared/automation-emails')
  const { sendCampaignSMS } = await import('@/lib/shared/sms')
  const { sendByTemplate } = await import('@/lib/shared/send-by-template')
  const { fillActionSlots, plainSlug } = await import('@/lib/messaging/action-slots')
  const { renderBlocks } = await import('@/lib/templates/blocks')

  const [emailT, smsT, waT] = await Promise.all([
    channels.email ? getLibraryTemplate('email', channels.email.slug) : null,
    channels.sms ? getLibraryTemplate('sms', channels.sms.slug) : null,
    channels.whatsapp ? getLibraryTemplate('whatsapp', channels.whatsapp.slug) : null,
  ])
  const emailBody = emailT
    ? (emailT.blocks_format === 'email-blocks' && Array.isArray(emailT.blocks?.blocks) && renderBlocks(emailT.blocks.blocks)) || emailT.body
    : ''
  const waSlots = waT ? [...new Set([...waT.body.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map(m => m[1]))] : []
  const waProblem = !channels.whatsapp ? null
    : !waT ? 'WhatsApp template not found'
    : waT.approval_status !== 'approved' ? 'WhatsApp template is not approved by Meta'
    : waSlots.some(n => !channels.whatsapp!.vars?.[n]?.trim()) ? 'WhatsApp template has unfilled slots'
    : null

  let sent = 0
  let failed = 0
  const tally = (ok: boolean) => (ok ? sent++ : failed++)

  async function one(r: Recipient) {
    const registered = ctx.resolveVars({ recipient: { email: r.email, first_name: r.first_name, last_name: r.last_name } })
    const coupon = ctx.sourceCoupon
    if (coupon) {
      await query(`INSERT INTO coupon_eligible_users (coupon_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [coupon.id, r.user_id])
    }
    const scenario = (own?: Record<string, string>): Record<string, string> => ({
      firstName: r.first_name || 'there',
      ...(coupon ? { couponCode: coupon.code, discountPercent: coupon.discount_type === 'percentage' ? String(coupon.discount_value) : '' } : {}),
      ...(own ?? {}),
    })

    if (channels.email && r.email && !(await alreadySent(campaignId, 'email', r.email))) {
      try {
        if (!emailT) throw new Error('Email template not found')
        const vars = scenario(channels.email.vars)
        const subject = renderCampaignTemplate(channels.email.subject || emailT.subject || fallbackSubject, vars, registered, false)
        const body = renderCampaignTemplate(emailBody, vars, registered, true)
        const html = renderTemplate(baseLayout(subject, body, ctx.baseUrl), registered, { escape: true })
        await sendAuditedMail({
          from: ctx.fromAddr, to: r.email, subject, html, kind: 'campaign', templateName: emailT.slug,
          entityType: 'email_campaigns', entityId: campaignId, userId: r.user_id,
        })
        await logSend(campaignId, 'email', r.email, true); tally(true)
      } catch (e) {
        await logSend(campaignId, 'email', r.email, false, String(e)); tally(false)
      }
    }

    if (channels.sms && r.phone && !(await alreadySent(campaignId, 'sms', r.phone))) {
      const body = smsT ? renderCampaignTemplate(smsT.body, scenario(channels.sms.vars), registered, false) : ''
      const ok = !!body && (await sendCampaignSMS({ phone: r.phone, body, kind: 'messaging', userId: r.user_id }))
      await logSend(campaignId, 'sms', r.phone, ok, ok ? undefined : smsT ? 'SMS not delivered (channel off or provider error)' : 'SMS template not found')
      tally(ok)
    }

    if (channels.whatsapp && r.phone && !(await alreadySent(campaignId, 'whatsapp', r.phone))) {
      if (waProblem) {
        await logSend(campaignId, 'whatsapp', r.phone, false, waProblem); tally(false)
      } else {
        const vars = scenario()
        const variables = Object.fromEntries(
          waSlots.map(n => [n, renderCampaignTemplate(channels.whatsapp!.vars![n], vars, registered, false)])
        )
        const extra = await fillActionSlots(waT!, { imageUrl: null, linkUrl: null })
        Object.assign(variables, extra ?? {})
        const res = await sendByTemplate({ channel: 'whatsapp', slug: extra ? waT!.slug : plainSlug(waT!.slug), to: r.phone, variables, reference: `messaging:${campaignId}` })
        const ok = res.status !== 'failed' && res.status !== 'skipped'
        await logSend(campaignId, 'whatsapp', r.phone, ok, ok ? undefined : res.error || res.status); tally(ok)
      }
    }
  }

  for (let i = 0; i < recipients.length; i += ctx.batchSize) {
    await Promise.all(recipients.slice(i, i + ctx.batchSize).map(r => one(r).catch(() => tally(false))))
    if (i + ctx.batchSize < recipients.length) await new Promise(res => setTimeout(res, ctx.batchDelay))
  }
  return { sent, failed }
}
