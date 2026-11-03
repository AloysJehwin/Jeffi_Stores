import 'server-only'
import { z } from 'zod'
import { query, queryOne } from '@/lib/shared/db'
import { cancelSubscription, pauseSubscription, resumeSubscription } from '@/lib/subscriptions/service'
import type { ExecResult, Scenario } from '../types'

// A renewal reminder for a subscription: the customer keeps it, pauses or resumes it, cancels it, or
// wants it delivered somewhere else (an admin sets the new address). Razorpay subscriptions change
// through the service; reminder-only ones (no Razorpay) only have a local status, which an admin sets.

interface Snap {
  id: string
  status: string
  managed: boolean
  product: string
  nextRenewal: string | null
}

async function setLocal(id: string, status: 'active' | 'paused' | 'cancelled'): Promise<void> {
  await query(
    `UPDATE subscriptions SET status = $2::text, paused_at = CASE WHEN $2::text = 'paused' THEN now() ELSE paused_at END,
            cancelled_at = CASE WHEN $2::text = 'cancelled' THEN now() ELSE cancelled_at END, updated_at = now()
      WHERE id = $1 AND razorpay_subscription_id IS NULL`,
    [id, status]
  )
}

async function run(fn: () => Promise<unknown>, done: string, close = true): Promise<ExecResult> {
  try {
    await fn()
    return { ok: true, close, text: done }
  } catch (err) {
    return { ok: false, text: err instanceof Error ? err.message : 'That could not be done' }
  }
}

export const subscriptionRenewal: Scenario<Snap> = {
  key: 'subscription_renewal',
  label: 'Subscription',
  scope: 'subscriptions:write',
  href: ctx => `/admin/subscriptions/${ctx.entity_id}/view`,

  async snapshot(ctx) {
    const s = await queryOne<any>(
      `SELECT s.id, s.status, s.next_renewal_at, s.razorpay_subscription_id IS NOT NULL AND COALESCE(s.source, 'legacy') <> 'legacy' AS managed,
              p.name AS product FROM subscriptions s LEFT JOIN products p ON p.id = s.product_id
        WHERE s.id = $1 AND s.status IN ('active', 'paused')`,
      [ctx.entity_id]
    )
    return s ? { id: s.id, status: s.status, managed: !!s.managed, product: s.product ?? 'your subscription', nextRenewal: s.next_renewal_at ? new Date(s.next_renewal_at).toDateString() : null } : null
  },

  describe: s =>
    `We reminded the customer about their ${s.product} subscription (${s.status}${s.nextRenewal ? `, next renewal ${s.nextRenewal}` : ''}).`,

  yes: 'keep',
  intents: {
    keep: { describe: 'They are happy for it to continue as it is.', tier: 'auto', title: s => `Keep the ${s.product} subscription` },
    pause: { describe: 'Pause it for now (skip upcoming deliveries).', tier: s => (s.managed ? 'auto' : 'admin'), title: s => `Pause the ${s.product} subscription` },
    resume: { describe: 'Restart a paused subscription.', tier: s => (s.managed ? 'auto' : 'admin'), title: s => `Resume the ${s.product} subscription` },
    cancel: { describe: 'Stop the subscription for good.', tier: s => (s.managed ? 'confirm' : 'admin'), title: s => `Cancel the ${s.product} subscription` },
    change_address: {
      describe: 'Deliver future orders to a different address.',
      tier: 'admin',
      manual: true,
      args: z.object({ address: z.string().max(500).optional() }),
      title: (s, a) => `Change the delivery address for the ${s.product} subscription${a?.address ? ` to: ${a.address}` : ''}`,
    },
  },

  async execute(intent, _args, s) {
    if (intent === 'keep') return { ok: true, close: true, text: `Great, your ${s.product} subscription continues as it is.` }
    if (intent === 'pause') return run(() => (s.managed ? pauseSubscription(s.id, 'customer') : setLocal(s.id, 'paused')), `Your ${s.product} subscription is paused. Just reply "resume" whenever you want it back.`, false)
    if (intent === 'resume') return run(() => (s.managed ? resumeSubscription(s.id) : setLocal(s.id, 'active')), `Your ${s.product} subscription is active again.`)
    if (intent === 'cancel')
      return run(() => (s.managed ? cancelSubscription(s.id, { atCycleEnd: true, actor: 'customer' }) : setLocal(s.id, 'cancelled')), `Your ${s.product} subscription is cancelled; nothing more will be charged after the current period.`)
    if (intent === 'change_address') return { ok: true, text: `Thanks, our team will update the delivery address for your ${s.product} subscription and confirm.` }
    return { ok: false, text: 'Unknown request' }
  },
}
