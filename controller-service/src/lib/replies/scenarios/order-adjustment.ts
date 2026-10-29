import 'server-only'
import { z } from 'zod'
import { queryMany, queryOne } from '@/lib/shared/db'
import { orderUrlById } from '@/lib/shared/customer-links'
import { createAdminNotification } from '@/lib/shared/admin-notify'
import { confirmAdjustment, rejectAdjustment } from '@/lib/orders/adjustment-decision'
import type { Scenario } from '../types'

interface Snap {
  adjId: string
  orderId: string
  orderNumber: string
  settlement: 'refund' | 'collect' | 'cod_adjust' | 'none'
  netDiff: number
  newTotal: number
  lines: Array<{ action: string; from: string; to: string | null }>
}

const rupees = (n: number) => `₹${Math.abs(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`

function changesText(s: Snap): string {
  return s.lines.map(l => (l.action === 'remove' ? `remove ${l.from}` : `${l.from} → ${l.to}`)).join('; ')
}

export const orderAdjustment: Scenario<Snap> = {
  key: 'order_adjustment',
  label: 'Order change',
  scope: 'orders:write',
  href: ctx => `/admin/orders/${ctx.entity_id}/view`,

  async snapshot(ctx) {
    if (!ctx.ref_id) return null
    const a = await queryOne<any>(
      `SELECT a.id, a.order_id, a.status, a.settlement_type, a.net_diff, a.new_total, o.order_number
         FROM order_adjustments a JOIN orders o ON o.id = a.order_id WHERE a.id = $1 AND a.order_id = $2`,
      [ctx.ref_id, ctx.entity_id]
    )
    if (!a || !['pending_customer', 'awaiting_payment'].includes(a.status)) return null
    const qty = (v: unknown) => (v == null || v === '' ? '' : String(Number(v)))
    const lines = await queryMany<any>(`SELECT action, old_snapshot, new_line, new_quantity FROM order_adjustment_lines WHERE adjustment_id = $1 ORDER BY created_at`, [a.id])
    return {
      adjId: a.id,
      orderId: a.order_id,
      orderNumber: a.order_number,
      settlement: a.settlement_type,
      netDiff: Number(a.net_diff),
      newTotal: Number(a.new_total),
      lines: lines.map(l => ({
        action: l.action,
        from: `${l.old_snapshot?.name ?? 'item'} × ${qty(l.old_snapshot?.quantity)}`.trim(),
        to: l.action === 'remove' ? null : `${l.new_line?.productName ?? l.old_snapshot?.name ?? 'item'} × ${qty(l.new_quantity ?? l.new_line?.quantity)}`.trim(),
      })),
    }
  },

  describe: s =>
    `We asked the customer to approve changes to order ${s.orderNumber}: ${changesText(s)}. ` +
    (s.settlement === 'refund'
      ? `They would get ${rupees(s.netDiff)} back.`
      : s.settlement === 'collect'
        ? `They would pay ${rupees(s.netDiff)} more.`
        : s.settlement === 'cod_adjust'
          ? `The cash-on-delivery total becomes ${rupees(s.newTotal)}.`
          : `What they pay does not change.`),

  yes: 'approve',
  no: 'decline',
  intents: {
    approve: { describe: 'They agree to the proposed changes as they are.', tier: 'auto', title: s => `Approve the changes to order ${s.orderNumber} (${changesText(s)})` },
    decline: { describe: 'They do not want the changes; keep the order as it was.', tier: 'auto', title: s => `Decline the changes to order ${s.orderNumber}` },
    request_change: {
      describe: 'They want something different from what we proposed (another size, quantity, product, or only part of the change).',
      tier: 'admin',
      manual: true,
      args: z.object({ request: z.string().max(500) }),
      title: (s, a) => `Customer wants a different change on order ${s.orderNumber}: ${a?.request ?? ''}`,
    },
  },

  async execute(intent, args, s, ctx) {
    if (intent === 'approve') {
      const r = await confirmAdjustment(s.adjId, s.orderId, ctx.userId)
      if (!r.ok) return { ok: false, text: r.error }
      if (r.settlement === 'collect')
        return { ok: true, close: true, text: `Thanks! To finish the change to order ${s.orderNumber}, please pay the extra ${rupees(s.netDiff)} here: ${await orderUrlById(s.orderId)}` }
      if (r.settlement === 'refund_pending')
        return { ok: true, close: true, text: `Done, order ${s.orderNumber} is updated. Your refund of ${rupees(s.netDiff)} will be issued to your original payment method shortly.` }
      if (r.settlement === 'cod_adjust') return { ok: true, close: true, text: `Done, order ${s.orderNumber} is updated. You'll pay ${rupees(s.newTotal)} on delivery.` }
      return { ok: true, close: true, text: `Done, order ${s.orderNumber} is updated.` }
    }
    if (intent === 'decline') {
      if (!(await rejectAdjustment(s.adjId, s.orderId, ctx.userId))) return { ok: false, text: 'That change can no longer be declined.' }
      createAdminNotification({
        type: 'order_adjustment_declined',
        category: 'orders',
        title: `Customer declined the changes to ${s.orderNumber}`,
        message: changesText(s),
        link: `/admin/orders/${s.orderId}/view`,
        entityType: 'orders',
        entityId: s.orderId,
        scope: 'orders:read',
      }).catch(() => {})
      return { ok: true, close: true, text: `No problem, order ${s.orderNumber} stays as it was.` }
    }
    if (intent === 'request_change') return { ok: true, text: `Thanks, our team has your request for order ${s.orderNumber} and will send an updated change.` }
    return { ok: false, text: 'Unknown request' }
  },
}
