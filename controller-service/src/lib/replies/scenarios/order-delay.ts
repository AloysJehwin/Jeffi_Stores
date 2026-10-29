import 'server-only'
import { queryOne } from '@/lib/shared/db'
import type { Scenario } from '../types'
import { cancelForCustomer } from './cancel'

// We told the customer their order is delayed: they're happy to wait, or they want to cancel.

interface Snap {
  orderId: string
  number: string
  status: string
  userId: string | null
}

export const orderDelay: Scenario<Snap> = {
  key: 'order_delay',
  label: 'Order delay',
  scope: 'orders:write',
  href: ctx => `/admin/orders/${ctx.entity_id}/view`,

  async snapshot(ctx) {
    const o = await queryOne<any>(
      `SELECT id, order_number, status, user_id FROM orders WHERE id = $1 AND status IN ('pending', 'confirmed', 'processing')`,
      [ctx.entity_id]
    )
    return o ? { orderId: o.id, number: o.order_number, status: o.status, userId: o.user_id } : null
  },

  describe: s => `We told the customer that order ${s.number} (${s.status}) is delayed and apologised.`,

  yes: 'wait',
  intents: {
    wait: { describe: "They're fine waiting for the order.", tier: 'auto', title: s => `Keep order ${s.number} and wait` },
    cancel: { describe: 'They no longer want the order because of the delay.', tier: 'confirm', title: s => `Cancel order ${s.number}` },
  },

  async execute(intent, _args, s, ctx) {
    if (intent === 'wait') return { ok: true, close: true, text: `Thank you for your patience! We'll keep you posted on order ${s.number}.` }
    if (intent === 'cancel') return cancelForCustomer(s.orderId, s.number, ctx.userId)
    return { ok: false, text: 'Unknown request' }
  },
}
