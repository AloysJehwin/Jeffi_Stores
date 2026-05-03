import nodemailer from 'nodemailer'
import { query, queryMany, queryOne } from './db'

const transporter = nodemailer.createTransport({
  host: 'email-smtp.us-east-1.amazonaws.com',
  port: 465,
  secure: true,
  auth: {
    user: process.env.SES_SMTP_USER,
    pass: process.env.SES_SMTP_PASSWORD,
  },
})

const FROM = `"Jeffi Store's" <${process.env.SES_FROM_EMAIL}>`
const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://jeffistores.in'

type TemplateData = Record<string, string>

function baseLayout(title: string, body: string) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:32px 16px;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
      <tr><td style="background:#1a3a4a;padding:20px 32px;border-radius:8px 8px 0 0;">
        <a href="${BASE_URL}" style="text-decoration:none;color:#ffffff;font-size:20px;font-weight:700;">Jeffi Store's</a>
      </td></tr>
      <tr><td style="background:#ffffff;padding:32px;border-radius:0 0 8px 8px;">${body}</td></tr>
      <tr><td style="padding:16px 0;text-align:center;font-size:12px;color:#999;">
        &copy; ${new Date().getFullYear()} Jeffi Store's &bull; <a href="${BASE_URL}" style="color:#999;">jeffistores.in</a>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`
}

function ctaButton(text: string, url: string) {
  return `<a href="${url}" style="display:inline-block;background:#e07b3f;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:6px;font-weight:600;font-size:15px;margin:16px 0;">${text}</a>`
}

export function renderCampaignEmail(templateKey: string, data: TemplateData, recipientName?: string): { subject: string; html: string } {
  const greeting = recipientName ? `Hi ${recipientName},` : 'Hi there,'

  switch (templateKey) {
    case 'review_form_share': {
      const subject = data.subject || `Share your experience — get ${data.couponCode ? data.couponCode : 'a reward'}!`
      const html = baseLayout(subject, `
        <p style="font-size:16px;color:#333;margin:0 0 12px;">${greeting}</p>
        <h2 style="font-size:22px;color:#1a3a4a;margin:0 0 16px;">${data.formTitle || 'Leave Us a Google Review'}</h2>
        <p style="color:#555;line-height:1.6;margin:0 0 20px;">
          We'd love to hear what you think! Leave us a Google review and we'll send you a special discount as a thank-you.
        </p>
        ${ctaButton('Leave a Review & Claim Reward', data.formUrl || BASE_URL)}
        <p style="color:#999;font-size:13px;margin:20px 0 0;">Or paste this link: <a href="${data.formUrl}" style="color:#e07b3f;">${data.formUrl}</a></p>
      `)
      return { subject, html }
    }

    case 'promotion': {
      const subject = data.subject || data.headline || 'Special offer just for you'
      const html = baseLayout(subject, `
        <p style="font-size:16px;color:#333;margin:0 0 12px;">${greeting}</p>
        <h2 style="font-size:24px;color:#1a3a4a;margin:0 0 16px;">${data.headline}</h2>
        <p style="color:#555;line-height:1.6;margin:0 0 20px;">${(data.body || '').replace(/\n/g, '<br>')}</p>
        ${data.ctaUrl ? ctaButton(data.ctaText || 'Shop Now', data.ctaUrl) : ''}
      `)
      return { subject, html }
    }

    case 'event': {
      const subject = data.subject || `You're invited: ${data.eventName}`
      const html = baseLayout(subject, `
        <p style="font-size:16px;color:#333;margin:0 0 12px;">${greeting}</p>
        <h2 style="font-size:24px;color:#1a3a4a;margin:0 0 8px;">${data.eventName}</h2>
        ${data.eventDate ? `<p style="color:#e07b3f;font-weight:600;margin:0 0 16px;">${data.eventDate}</p>` : ''}
        <p style="color:#555;line-height:1.6;margin:0 0 20px;">${(data.eventDetails || '').replace(/\n/g, '<br>')}</p>
        ${data.ctaUrl ? ctaButton('Learn More', data.ctaUrl) : ''}
      `)
      return { subject, html }
    }

    case 'announcement': {
      const subject = data.subject || data.headline || 'An update from Jeffi Store\'s'
      const html = baseLayout(subject, `
        <p style="font-size:16px;color:#333;margin:0 0 12px;">${greeting}</p>
        <h2 style="font-size:24px;color:#1a3a4a;margin:0 0 16px;">${data.headline}</h2>
        <p style="color:#555;line-height:1.6;margin:0 0 20px;">${(data.body || '').replace(/\n/g, '<br>')}</p>
        ${ctaButton('Visit Our Store', BASE_URL)}
      `)
      return { subject, html }
    }

    case 'custom': {
      return {
        subject: data.subject || 'Message from Jeffi Store\'s',
        html: data.htmlBody || '',
      }
    }

    default:
      throw new Error(`Unknown template key: ${templateKey}`)
  }
}

interface Recipient {
  email: string
  first_name: string | null
}

async function resolveAudience(audienceType: string, audienceFilter: Record<string, unknown>): Promise<Recipient[]> {
  const base = `SELECT u.email, u.first_name FROM users u`
  const where = `WHERE u.is_active = true AND u.is_guest = false AND u.email IS NOT NULL`

  if (audienceType === 'customer_type') {
    const types = audienceFilter.customerTypes as string[]
    return queryMany<Recipient>(
      `${base} JOIN customer_profiles cp ON cp.user_id = u.id ${where} AND cp.customer_type = ANY($1)`,
      [types]
    )
  }

  if (audienceType === 'order_history') {
    const days = (audienceFilter.daysSinceOrder as number) || 30
    return queryMany<Recipient>(
      `${base} ${where} AND u.id IN (SELECT DISTINCT user_id FROM orders WHERE created_at > NOW() - INTERVAL '${days} days' AND user_id IS NOT NULL)`
    )
  }

  return queryMany<Recipient>(`${base} ${where}`)
}

export async function sendCampaign(campaignId: string): Promise<{ sent: number; failed: number }> {
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

  let sent = 0
  let failed = 0

  for (const recipient of recipients) {
    const { subject, html } = renderCampaignEmail(campaign.template_key, { ...campaign.template_data, subject: campaign.subject }, recipient.first_name || undefined)
    try {
      await transporter.sendMail({ from: FROM, to: recipient.email, subject, html })
      await query(
        `INSERT INTO email_campaign_logs (campaign_id, email, status) VALUES ($1, $2, 'sent')`,
        [campaignId, recipient.email]
      )
      sent++
    } catch (err) {
      await query(
        `INSERT INTO email_campaign_logs (campaign_id, email, status, error) VALUES ($1, $2, 'failed', $3)`,
        [campaignId, recipient.email, String(err)]
      )
      failed++
    }
  }

  await query(
    `UPDATE email_campaigns SET status = 'sent', sent_at = NOW(), recipient_count = $2 WHERE id = $1`,
    [campaignId, sent + failed]
  )

  return { sent, failed }
}
