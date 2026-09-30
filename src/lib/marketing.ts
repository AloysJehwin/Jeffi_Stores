import { query, queryOne } from './db'
import { currentBrandName } from './brand'

export type CampaignKind =
  | 'abandoned_cart'
  | 'abandoned_checkout'
  | 'post_purchase'
  | 'review_reminder'
  | 'winback_90'
  | 'winback_180'
  | 'restock'
  | 'price_drop'
  | string

export interface Campaign {
  kind: CampaignKind
  name: string
  description: string | null
  enabled: boolean
  delay_hours: number
  discount_percent: number
  coupon_id: string | null
  subject_template: string
  body_template: string
  last_run_at: string | null
}

const FREQUENCY_CAP_HOURS = 72

function resolveAppUrl(): string {
  const isLocalhost = (v: string | undefined) =>
    !!v && /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:|\/|$)/i.test(v)
  const isProd = process.env.NODE_ENV === 'production'
  const pickFirst = (vals: Array<string | undefined>) => vals.find(v => v && (!isProd || !isLocalhost(v))) || ''
  const candidate =
    pickFirst([
      process.env.NEXT_PUBLIC_APP_URL,
      process.env.APP_URL,
      process.env.NEXT_PUBLIC_BASE_URL,
      process.env.BASE_URL,
    ]) ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '') ||
    (isProd ? 'https://jeffistores.in' : 'http://localhost:3000')
  return candidate.replace(/\/$/, '')
}

const APP_URL = resolveAppUrl()

export async function getCampaign(kind: CampaignKind): Promise<Campaign | null> {
  return queryOne<Campaign>(`SELECT * FROM campaigns WHERE kind = $1`, [kind])
}

export async function getAllCampaigns(): Promise<Campaign[]> {
  const result = await query<Campaign>(`SELECT * FROM campaigns ORDER BY name`)
  return result.rows
}

export async function canSendMarketing(
  userId: string,
  campaignKind: CampaignKind
): Promise<{ ok: boolean; reason?: string }> {
  const user = await queryOne<{ marketing_opt_out: boolean; email: string | null; is_active: boolean }>(
    `SELECT marketing_opt_out, email, is_active FROM users WHERE id = $1`,
    [userId]
  )
  if (!user) return { ok: false, reason: 'user_not_found' }
  if (!user.email) return { ok: false, reason: 'no_email' }
  if (!user.is_active) return { ok: false, reason: 'inactive_user' }
  if (user.marketing_opt_out) return { ok: false, reason: 'opted_out' }

  const campaign = await getCampaign(campaignKind)
  if (!campaign) return { ok: false, reason: 'campaign_not_found' }
  if (!campaign.enabled) return { ok: false, reason: 'campaign_disabled' }

  const recent = await queryOne<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt FROM email_campaigns_sent
     WHERE user_id = $1 AND campaign_kind = $2 AND sent_at > NOW() - INTERVAL '${FREQUENCY_CAP_HOURS} hours'`,
    [userId, campaignKind]
  )
  if (recent && parseInt(recent.cnt, 10) >= 1) {
    return { ok: false, reason: 'frequency_cap' }
  }

  return { ok: true }
}

export async function alreadySentForReference(
  campaignKind: CampaignKind,
  userId: string,
  referenceId: string | null
): Promise<boolean> {
  const timeFilter = referenceId === null ? `AND sent_at > NOW() - INTERVAL '${FREQUENCY_CAP_HOURS} hours'` : ''
  const row = await queryOne<{ id: string }>(
    `SELECT id FROM email_campaigns_sent
     WHERE campaign_kind = $1 AND user_id = $2
       AND COALESCE(reference_id, '') = COALESCE($3, '')
       AND unsubscribed_at IS NULL AND bounced_at IS NULL AND complained_at IS NULL
       ${timeFilter}
     LIMIT 1`,
    [campaignKind, userId, referenceId]
  )
  return row !== null
}

export async function recordSent(params: {
  campaignKind: CampaignKind
  userId: string
  referenceId?: string | null
  messageId?: string | null
  metadata?: Record<string, unknown>
}): Promise<string | null> {
  try {
    const result = await query<{ id: string }>(
      `INSERT INTO email_campaigns_sent
         (campaign_kind, user_id, reference_id, message_id, metadata)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [
        params.campaignKind,
        params.userId,
        params.referenceId ?? null,
        params.messageId ?? null,
        JSON.stringify(params.metadata ?? {}),
      ]
    )
    const sentId = result.rows[0]?.id ?? null
    if (sentId) {
      await query(
        `INSERT INTO campaign_send_counts (campaign_kind, user_id, send_count, last_sent_at)
         VALUES ($1, $2, 1, NOW())
         ON CONFLICT (campaign_kind, user_id) DO UPDATE
           SET send_count   = campaign_send_counts.send_count + 1,
               last_sent_at = NOW()`,
        [params.campaignKind, params.userId]
      )
    }
    return sentId
  } catch {
    return null
  }
}

export async function generateCouponForCampaign(params: {
  campaignKind: CampaignKind
  discountPercent: number
  expiresInDays: number
  minPurchaseAmount?: number
  maxDiscountAmount?: number
}): Promise<string | null> {
  // Reuse an existing active campaign-level coupon if one exists
  const existing = await queryOne<{ id: string; code: string }>(
    `SELECT id, code FROM coupons
     WHERE auto_generated = TRUE
       AND generated_for_campaign = $1
       AND generated_for_user_id IS NULL
       AND is_active = TRUE
       AND (valid_until IS NULL OR valid_until > NOW())
     ORDER BY created_at DESC LIMIT 1`,
    [params.campaignKind]
  )
  if (existing) {
    // Ensure campaigns.coupon_id is set even if it was cleared
    await query(`UPDATE campaigns SET coupon_id = $1 WHERE kind = $2 AND (coupon_id IS NULL OR coupon_id != $1)`, [
      existing.id,
      params.campaignKind,
    ])
    return existing.code
  }

  const prefix = params.campaignKind.startsWith('winback') ? 'BACK' : 'OFFER'
  const random = Math.random().toString(36).slice(2, 8).toUpperCase()
  const code = `${prefix}-${random}`
  const validUntil = new Date(Date.now() + params.expiresInDays * 86400000)

  try {
    const result = await query<{ id: string }>(
      `INSERT INTO coupons
         (code, description, discount_type, discount_value, min_purchase_amount, max_discount_amount,
          usage_limit, usage_limit_per_user, valid_from, valid_until, is_active,
          auto_generated, generated_for_user_id, generated_for_campaign)
       VALUES ($1, $2, 'percentage', $3, $4, $5, 500, 1, NOW(), $6, TRUE, TRUE, NULL, $7)
       RETURNING id`,
      [
        code,
        `Auto-generated for ${params.campaignKind}`,
        params.discountPercent,
        params.minPurchaseAmount ?? 100,
        params.maxDiscountAmount ?? null,
        validUntil.toISOString(),
        params.campaignKind,
      ]
    )
    const couponId = result.rows[0]?.id
    if (couponId) {
      await query(`UPDATE campaigns SET coupon_id = $1 WHERE kind = $2`, [couponId, params.campaignKind])
    }
    return code
  } catch {
    return null
  }
}

export async function getAssignedCouponCode(
  couponId: string
): Promise<{ code: string; discountValue: number; discountType: string } | null> {
  return queryOne<{ code: string; discountValue: number; discountType: string }>(
    `SELECT code, discount_value::float AS "discountValue", discount_type AS "discountType"
     FROM coupons WHERE id = $1 AND is_active = TRUE`,
    [couponId]
  )
}

export function buildUnsubscribeUrl(token: string, campaignKind: CampaignKind, baseUrl: string = APP_URL): string {
  return `${baseUrl}/api/unsubscribe?token=${token}&campaign=${campaignKind}`
}

export function buildTrackingPixelUrl(sentId: string, baseUrl: string = APP_URL): string {
  return `${baseUrl}/api/email-events/open?id=${sentId}`
}

export function buildClickTrackingUrl(sentId: string, destinationUrl: string, baseUrl: string = APP_URL): string {
  return `${baseUrl}/api/email-events/click?id=${sentId}&url=${encodeURIComponent(destinationUrl)}`
}

export function rewriteLinksForTracking(html: string, sentId: string, baseUrl: string = APP_URL): string {
  return html.replace(/href="(https?:\/\/[^"]+)"/g, (_match, url) => {
    return `href="${buildClickTrackingUrl(sentId, url, baseUrl)}"`
  })
}

export function renderTemplate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_match, key) => {
    const v = vars[key]
    return v != null ? String(v) : ''
  })
}

export function wrapWithTracking(
  html: string,
  sentId: string,
  unsubscribeUrl: string,
  baseUrl: string = APP_URL,
  storeName?: string
): string {
  const rewritten = rewriteLinksForTracking(html, sentId, baseUrl)
  const pixel = `<img src="${buildTrackingPixelUrl(sentId, baseUrl)}" width="1" height="1" alt="" style="display:none;"/>`
  const footer = `
    <div style="margin-top: 32px; padding-top: 16px; border-top: 1px solid #e5e7eb; color: #6b7280; font-size: 12px; text-align: center;">
      <p>You're receiving this email because you signed up at ${storeName || currentBrandName()}.<br/>
      <a href="${unsubscribeUrl}" style="color: #6b7280; text-decoration: underline;">Unsubscribe</a> from marketing emails.</p>
    </div>
  `
  return rewritten + pixel + footer
}

export async function attributeConversion(userId: string, orderId: string): Promise<void> {
  try {
    await query(
      `UPDATE email_campaigns_sent
       SET converted_at = NOW(), conversion_order_id = $2
       WHERE id = (
         SELECT id FROM email_campaigns_sent
         WHERE user_id = $1
           AND clicked_at IS NOT NULL
           AND converted_at IS NULL
           AND clicked_at > NOW() - INTERVAL '7 days'
         ORDER BY clicked_at DESC
         LIMIT 1
       )`,
      [userId, orderId]
    )
  } catch {}
}
