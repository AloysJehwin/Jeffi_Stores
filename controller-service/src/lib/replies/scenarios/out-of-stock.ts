import 'server-only'
import { z } from 'zod'
import { queryOne } from '@/lib/shared/db'
import type { Scenario } from '../types'
import { cancelForCustomer } from './cancel'

// One item in an order is unavailable (ref_id = the order item): the customer wants it refunded,
// an alternative, to wait for it, or the whole order cancelled. Refunds and swaps are admin work.

interface Snap {
  orderId: string
  number: string
  userId: string | null
  item: string
}

export const outOfStock: Scenario<Snap> = {
  key: 'out_of_stock',
  label: 'Item unavailable',
  scope: 'orders:write',
  href: ctx => `/admin/orders/${ctx.entity_id}/view`,

  async snapshot(ctx) {
    const o = await queryOne<any>(
      `SELECT o.id, o.order_number, o.user_id, oi.product_name, oi.variant_name, oi.quantity
         FROM orders o JOIN order_items oi ON oi.order_id = o.id AND oi.id = $2
        WHERE o.id = $1 AND o.status IN ('pending', 'confirmed', 'processing')`,
      [ctx.entity_id, ctx.ref_id]
    )
    if (!o) return null
    const item = `${o.product_name}${o.variant_name ? ` (${o.variant_name})` : ''} × ${Number(o.quantity)}`
    return { orderId: o.id, number: o.order_number, userId: o.user_id, item }
  },

  describe: s => `We told the customer that ${s.item} in order ${s.number} is temporarily unavailable, and asked whether they want a refund for it, an alternative, or to wait.`,

  intents: {
    refund_item: {
      describe: 'Remove the unavailable item and refund it; the rest of the order goes ahead.',
      tier: 'admin',
      manual: true,
      title: s => `Remove ${s.item} from order ${s.number} and refund it`,
    },
    alternative: {
      describe: 'They would take a substitute (a different brand, size, colour or product).',
      tier: 'admin',
      manual: true,
      args: z.object({ preference: z.string().max(300).optional() }),
      title: (s, a) => `Offer an alternative for ${s.item} on order ${s.number}${a?.preference ? `: ${a.preference}` : ''}`,
    },
    wait: { describe: 'They will wait until the item is back in stock.', tier: 'auto', title: s => `Wait for ${s.item} on order ${s.number}` },
    cancel_order: { describe: 'They want the whole order cancelled.', tier: 'confirm', title: s => `Cancel order ${s.number}` },
  },

  async execute(intent, _args, s, ctx) {
    if (intent === 'refund_item') return { ok: true, text: `Thanks, we'll remove ${s.item} from order ${s.number} and refund it. You'll get a confirmation shortly.` }
    if (intent === 'alternative') return { ok: true, text: `Thanks, our team will suggest an alternative for ${s.item} shortly.` }
    if (intent === 'wait') return { ok: true, close: true, text: `Thank you! We'll keep order ${s.number} and send ${s.item} as soon as it's back in stock.` }
    if (intent === 'cancel_order') return cancelForCustomer(s.orderId, s.number, ctx.userId)
    return { ok: false, text: 'Unknown request' }
  },
}
