import { queryMany } from '@/lib/shared/db'
import { fetchUserContext, resolveCoupon, sendCampaignEmail, renderItemRows } from '@/lib/shared/automation-emails'
import { sendCampaignWhatsApp } from '@/lib/campaigns/whatsapp-dispatch'
import type { ScenarioModule, ParamSchema } from '../types'

export interface WinbackParams extends Record<string, unknown> {
  minDaysSinceOrder: number
  maxDaysSinceOrder: number
  healthScoreMin: number
  healthScoreMax: number
  sendCooldownDays: number
  maxRecipientsPerSweep: number
  whatsappEnabled: boolean
}

interface Row {
  id: string
}

const winbackSchema: ParamSchema<WinbackParams> = {
  minDaysSinceOrder: {
    type: 'integer',
    min: 1,
    max: 730,
    label: 'Min days since last order',
    description: 'Lower bound of the dormant window',
  },
  maxDaysSinceOrder: {
    type: 'integer',
    min: 1,
    max: 730,
    label: 'Max days since last order',
    description: 'Upper bound of the dormant window',
  },
  healthScoreMin: {
    type: 'integer',
    min: 0,
    max: 100,
    label: 'Health score min',
    description: 'Customer health lower bound (inclusive)',
  },
  healthScoreMax: {
    type: 'integer',
    min: 0,
    max: 100,
    label: 'Health score max',
    description: 'Customer health upper bound (exclusive)',
  },
  sendCooldownDays: {
    type: 'integer',
    min: 1,
    max: 365,
    label: 'Per-user cooldown (days)',
    description: 'Skip users sent this campaign within N days',
  },
  maxRecipientsPerSweep: {
    type: 'integer',
    min: 1,
    max: 500,
    label: 'Max recipients per run',
    description: 'Hard limit per sweep',
  },
  whatsappEnabled: {
    type: 'boolean',
    label: 'Also send via WhatsApp',
    description: "Additionally send this campaign to the customer's WhatsApp when a phone number is on file",
  },
}

export function buildWinbackScenario(opts: {
  kind: string
  name: string
  description: string
  trigger: string
  defaults: WinbackParams
}): ScenarioModule<WinbackParams, Row> {
  return {
    kind: opts.kind,
    name: opts.name,
    description: opts.description,
    trigger: opts.trigger,
    defaultParams: opts.defaults,
    paramSchema: winbackSchema,

    async findEligible({ campaign, params }) {
      return queryMany<Row>(
        `
        SELECT u.id
        FROM users u
        LEFT JOIN customer_health ch ON ch.user_id = u.id
        LEFT JOIN business_profiles bp ON bp.user_id = u.id
        WHERE u.is_active = TRUE AND u.is_guest = FALSE AND u.marketing_opt_out = FALSE
          AND (bp.user_id IS NULL OR bp.approval_status != 'approved')
          AND EXISTS (
            SELECT 1 FROM orders o
            WHERE o.user_id = u.id AND o.payment_status = 'paid'
            GROUP BY o.user_id
            HAVING MAX(o.created_at) BETWEEN NOW() - ($3 || ' days')::interval AND NOW() - ($2 || ' days')::interval
          )
          AND (ch.score IS NULL OR (ch.score >= $4 AND ch.score < $5))
          AND NOT EXISTS (
            SELECT 1 FROM email_campaigns_sent ecs
            WHERE ecs.campaign_kind = $1
              AND ecs.user_id = u.id
              AND ecs.sent_at > NOW() - ($6 || ' days')::interval
          )
        LIMIT $7
      `,
        [
          campaign.kind,
          params.minDaysSinceOrder,
          params.maxDaysSinceOrder,
          params.healthScoreMin,
          params.healthScoreMax,
          params.sendCooldownDays,
          params.maxRecipientsPerSweep,
        ]
      )
    },

    async send(row, { campaign, params }) {
      const user = await fetchUserContext(row.id)
      if (!user) return { ok: false, reason: 'no_user' }

      const { couponCode, discountPercent } = await resolveCoupon(campaign, row.id)
      if ((campaign.coupon_id || campaign.discount_percent > 0) && !couponCode) {
        return { ok: false, reason: 'coupon_failed' }
      }

      const items = await queryMany<{ name: string; product_slug: string | null; image_url: string | null }>(
        `
        SELECT DISTINCT ON (oi.product_id)
          oi.product_name AS name,
          p.slug AS product_slug,
          (SELECT image_url FROM product_images WHERE product_id = oi.product_id ORDER BY display_order ASC LIMIT 1) AS image_url
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        LEFT JOIN products p ON p.id = oi.product_id
        WHERE o.user_id = $1::uuid AND o.payment_status = 'paid'
        ORDER BY oi.product_id, o.created_at DESC
        LIMIT 3
      `,
        [row.id]
      )

      const itemsHtml = renderItemRows(
        items.map(i => ({
          name: i.name,
          imageUrl: i.image_url,
          productUrl: i.product_slug ? `${user.baseUrl}/products/${i.product_slug}` : null,
        }))
      )

      const emailResult = await sendCampaignEmail({
        campaign,
        user,
        referenceId: null,
        vars: {
          firstName: user.first_name || 'there',
          discountPercent,
          couponCode,
          itemsHtml,
          ctaUrl: `${user.baseUrl}/products`,
        },
      })
      if (params.whatsappEnabled) {
        sendCampaignWhatsApp(campaign.kind, row.id, {
          headline: 'We miss you!',
          code: couponCode || '',
          discount: discountPercent ? String(discountPercent) : '',
        }).catch(() => {})
      }
      return emailResult
    },
  }
}
