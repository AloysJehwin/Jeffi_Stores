import { queryOne, queryMany } from '@/lib/shared/db'
import { sendTestCampaignEmail } from '@/lib/shared/automation-emails'
import { sendOrderDelayNotification, sendProductAnnouncementEmail } from '@/lib/email'
import { VARIANT_MIN_PRICE_SQL } from '@/lib/queries'
import type { CampaignKind } from '@/lib/shared/marketing'
import { sendAuditedMail } from '@/lib/shared/mail-audit'
import { mailShell } from '@/lib/shared/mail-template'
import type { AgentAction, ActionResult } from './shared'

export async function sendTestEmail(action: AgentAction): Promise<ActionResult> {
  const { campaignKind, toEmail } = action.payload
  const r = await sendTestCampaignEmail(campaignKind as CampaignKind, toEmail)
  if (!r.ok) return { result: null, error: r.reason || 'Send failed' }
  return { result: { sentTo: toEmail, campaign: campaignKind }, error: null }
}

export async function toggleCampaignEnabled(action: AgentAction): Promise<ActionResult> {
  const { campaignKind, enabled } = action.payload
  const updated = await queryOne(
    `UPDATE campaigns SET enabled = $1, updated_at = NOW() WHERE kind = $2 RETURNING kind, name, enabled`,
    [!!enabled, campaignKind]
  )
  if (!updated) return { result: null, error: 'Campaign not found' }
  return { result: updated, error: null }
}

export async function sendOrderDelayEmail(action: AgentAction): Promise<ActionResult> {
  const { customerEmail, customerName, orderNumber, delayDays, reason } = action.payload
  if (!customerEmail || !orderNumber || !delayDays || !reason) {
    return { result: null, error: 'Missing required fields in payload' }
  }
  const r = await sendOrderDelayNotification({
    toEmail: customerEmail,
    customerName: customerName || 'there',
    orderNumber,
    delayDays: Number(delayDays),
    reason: String(reason),
  })
  if (!r.success) return { result: null, error: 'Send failed' }
  return { result: { sentTo: customerEmail, orderNumber, delayDays, messageId: r.messageId }, error: null }
}

export async function sendProductAnnouncement(action: AgentAction): Promise<ActionResult> {
  const { productIds, audience, testEmail, subject, intro } = action.payload as {
    productIds: string[]
    audience: string
    testEmail: string | null
    subject: string
    intro: string
  }
  if (!Array.isArray(productIds) || productIds.length === 0) {
    return { result: null, error: 'productIds missing' }
  }
  const products = await queryMany<{
    id: string
    name: string
    slug: string
    price: string
    short_description: string | null
    primary_image_url: string | null
  }>(
    `SELECT p.id::text, p.name, p.slug,
            COALESCE(NULLIF(${VARIANT_MIN_PRICE_SQL}, 0), p.base_price)::text AS price,
            p.short_description,
            (SELECT image_url FROM product_images WHERE product_id = p.id ORDER BY display_order ASC LIMIT 1) AS primary_image_url
       FROM products p WHERE p.id = ANY($1::uuid[]) AND p.is_active = TRUE`,
    [productIds]
  )
  if (products.length === 0) return { result: null, error: 'No active products resolved' }

  let recipients: { email: string; name: string }[] = []
  if (audience === 'test_only') {
    if (!testEmail) return { result: null, error: 'testEmail missing' }
    recipients = [{ email: testEmail, name: 'there' }]
  } else if (audience === 'all_opted_in') {
    recipients = (await queryMany(
      `SELECT email, COALESCE(NULLIF(TRIM(first_name || ' ' || COALESCE(last_name,'')), ''), email) AS name
         FROM users WHERE is_guest = false AND email IS NOT NULL AND marketing_opt_out IS NOT TRUE`
    )) as any
  } else if (audience === 'recent_buyers') {
    recipients = (await queryMany(
      `SELECT DISTINCT u.email, COALESCE(NULLIF(TRIM(u.first_name || ' ' || COALESCE(u.last_name,'')), ''), u.email) AS name
         FROM users u JOIN orders o ON o.user_id = u.id
        WHERE u.is_guest = false AND u.email IS NOT NULL AND u.marketing_opt_out IS NOT TRUE
          AND o.created_at > NOW() - INTERVAL '90 days'`
    )) as any
  } else {
    return { result: null, error: `Unknown audience: ${audience}` }
  }

  let sent = 0,
    failed = 0
  for (const r of recipients) {
    const out = await sendProductAnnouncementEmail({
      toEmail: r.email,
      customerName: r.name,
      subject,
      intro,
      products,
    })
    if (out.success) sent++
    else failed++
  }
  return {
    result: { audience, recipients: recipients.length, sent, failed, productCount: products.length },
    error: failed > 0 && sent === 0 ? `All ${failed} sends failed` : null,
  }
}

export async function updateCampaignTemplate(action: AgentAction): Promise<ActionResult> {
  const { campaignKind, newSubject, newBody } = action.payload as {
    campaignKind: string
    newSubject: string | null
    newBody: string | null
  }
  if (!campaignKind) return { result: null, error: 'campaignKind missing' }
  if (newSubject === null && newBody === null) return { result: null, error: 'No fields to update' }
  const sets: string[] = ['updated_at = NOW()']
  const vals: any[] = []
  let i = 1
  if (newSubject !== null) {
    sets.push(`subject_template = $${i++}`)
    vals.push(newSubject.slice(0, 500))
  }
  if (newBody !== null) {
    sets.push(`body_template = $${i++}`)
    vals.push(newBody.slice(0, 50000))
  }
  vals.push(campaignKind)
  const updated = await queryOne<{ kind: string; name: string }>(
    `UPDATE campaigns SET ${sets.join(', ')} WHERE kind = $${i} RETURNING kind, name`,
    vals
  )
  if (!updated) return { result: null, error: 'Campaign not found' }
  return {
    result: {
      kind: updated.kind,
      name: updated.name,
      subjectChanged: newSubject !== null,
      bodyChanged: newBody !== null,
    },
    error: null,
  }
}

export async function sendMailerBroadcast(action: AgentAction): Promise<ActionResult> {
  const { audience, testEmail, subject, body, fromName } = action.payload as {
    audience: 'all_opted_in' | 'recent_buyers' | 'test_only'
    testEmail: string | null
    subject: string
    body: string
    fromName: string
  }
  if (!subject || !body) return { result: null, error: 'subject and body required' }
  let recipients: { email: string; name: string }[] = []
  if (audience === 'test_only') {
    if (!testEmail) return { result: null, error: 'testEmail missing' }
    recipients = [{ email: testEmail, name: 'there' }]
  } else if (audience === 'all_opted_in') {
    recipients = await queryMany<{ email: string; name: string }>(
      `SELECT email, COALESCE(NULLIF(TRIM(first_name || ' ' || COALESCE(last_name,'')), ''), email) AS name
         FROM users WHERE is_guest = false AND email IS NOT NULL AND marketing_opt_out IS NOT TRUE`
    )
  } else if (audience === 'recent_buyers') {
    recipients = await queryMany<{ email: string; name: string }>(
      `SELECT DISTINCT u.email, COALESCE(NULLIF(TRIM(u.first_name || ' ' || COALESCE(u.last_name,'')), ''), u.email) AS name
         FROM users u JOIN orders o ON o.user_id = u.id
        WHERE u.is_guest = false AND u.email IS NOT NULL AND u.marketing_opt_out IS NOT TRUE
          AND o.created_at > NOW() - INTERVAL '90 days'`
    )
  } else {
    return { result: null, error: `Unknown audience: ${audience}` }
  }
  const { currentBrandNameAsync } = await import('@/lib/catalog/brand')
  const brandName = await currentBrandNameAsync()
  const fromHeader = `"${(fromName || brandName).replace(/"/g, '')}" <${process.env.SES_FROM_EMAIL}>`
  const isFullDocument = /<(?:!doctype|html)\b/i.test(body)
  let sent = 0,
    failed = 0
  for (const r of recipients) {
    try {
      const personalised = body.replace(/\{firstName\}/g, r.name.split(' ')[0] || 'there')
      await sendAuditedMail({
        kind: 'agent_action',
        from: fromHeader,
        to: r.email,
        subject,
        html: isFullDocument
          ? personalised
          : mailShell({ brand: brandName, kicker: `Message from ${brandName}`, content: personalised }),
        text: personalised
          .replace(/<[^>]+>/g, '')
          .replace(/\s+/g, ' ')
          .trim(),
      })
      sent++
    } catch {
      failed++
    }
  }
  return {
    result: { audience, recipients: recipients.length, sent, failed },
    error: failed > 0 && sent === 0 ? `All ${failed} sends failed` : null,
  }
}
