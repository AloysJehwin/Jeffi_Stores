import { queryMany } from '@/lib/db'
import {
  APP_URL,
  fetchUserContext,
  resolveCoupon,
  sendCampaignEmail,
} from '@/lib/automation-emails'
import type { ScenarioModule } from '../types'

interface Params extends Record<string, unknown> {
  minMinutesAfterCancel: number
  maxRecipientsPerSweep: number
}

interface Row {
  id: string
  user_id: string
  order_number: string
  total_amount: string
}

export const abandonedCheckout: ScenarioModule<Params, Row> = {
  kind: 'abandoned_checkout',
  name: 'Abandoned Checkout',
  description: 'Order auto-cancelled after the 10-minute payment window expired',
  trigger: 'Fires when an order is auto-cancelled because Razorpay payment didn\'t complete within the 10-minute window. Waits the configured minutes after cancel before sending. One send per order.',
  defaultParams: {
    minMinutesAfterCancel: 15,
    maxRecipientsPerSweep: 50,
  },
  paramSchema: {
    minMinutesAfterCancel: { type: 'integer', min: 1, max: 120, label: 'Minimum minutes after cancel', description: 'Wait at least this many minutes after the order was cancelled' },
    maxRecipientsPerSweep: { type: 'integer', min: 1, max: 500, label: 'Max recipients per run',       description: 'Hard limit per sweep' },
  },

  async findEligible({ campaign, params }) {
    return queryMany<Row>(`
      SELECT o.id, o.user_id, o.order_number, o.total_amount::text
      FROM orders o
      JOIN users u ON u.id = o.user_id
      WHERE o.status = 'cancelled' AND o.payment_status = 'cancelled'
        AND o.updated_at > NOW() - ($2 || ' hours')::interval
        AND o.updated_at < NOW() - ($3 || ' minutes')::interval
        AND u.is_active = TRUE AND u.marketing_opt_out = FALSE
        AND NOT EXISTS (
          SELECT 1 FROM email_campaigns_sent ecs
          WHERE ecs.campaign_kind = $1
            AND ecs.user_id = o.user_id
            AND ecs.reference_id = o.id::text
        )
      LIMIT $4
    `, [campaign.kind, campaign.delay_hours, params.minMinutesAfterCancel, params.maxRecipientsPerSweep])
  },

  async send(row, { campaign }) {
    const user = await fetchUserContext(row.user_id)
    if (!user) return { ok: false, reason: 'no_user' }

    const { couponCode, discountPercent } = await resolveCoupon(campaign, row.user_id)

    return sendCampaignEmail({
      campaign,
      user,
      referenceId: row.id,
      vars: {
        firstName: user.first_name || 'there',
        orderNumber: row.order_number,
        total: Number(row.total_amount).toFixed(2),
        couponCode,
        discountPercent,
        ctaUrl: `${APP_URL}/cart`,
      },
    })
  },
}
