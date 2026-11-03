import 'server-only'
import { queryMany, queryOne } from '@/lib/shared/db'
import { postCustomerRfqMessage, respondToRfq } from '@/lib/business/rfq-respond'
import type { Scenario } from '../types'

// Our reply on a business customer's quote request (an offer with prices, or a message): they
// accept the offer, or anything else they say joins the RFQ thread for the team.

interface Snap {
  id: string
  number: string
  userId: string
  status: string
  lastMessage: string | null
  offer: string[] | null
}

const rupees = (n: number) => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export const rfqOffer: Scenario<Snap> = {
  key: 'rfq_offer',
  label: 'Quote request',
  scope: 'business_rfqs:write',
  href: ctx => `/admin/business/rfqs/${ctx.entity_id}/view`,

  async snapshot(ctx) {
    const r = await queryOne<any>(
      `SELECT id, rfq_number, user_id, status FROM business_rfqs WHERE id = $1 AND status IN ('pending', 'reviewed', 'negotiating')`,
      [ctx.entity_id]
    )
    if (!r) return null
    const last = await queryOne<{ message: string; counter_items: any }>(
      `SELECT message, counter_items FROM rfq_messages WHERE rfq_id = $1 AND sender = 'admin' ORDER BY created_at DESC LIMIT 1`,
      [r.id]
    )
    let offer: string[] | null = null
    const ci = last?.counter_items ? (Array.isArray(last.counter_items) ? last.counter_items : JSON.parse(last.counter_items)) : null
    if (ci?.length) {
      const items = await queryMany<{ id: string; description: string; quantity: number; unit: string }>(
        `SELECT id, description, quantity, unit FROM business_rfq_items WHERE rfq_id = $1`,
        [r.id]
      )
      offer = ci.map((c: any) => {
        const it = items.find(i => i.id === c.rfq_item_id)
        return `${it?.description ?? 'item'} × ${it?.quantity ?? ''} ${it?.unit ?? ''} at ${rupees(Number(c.offered_price))} each`.replace(/\s+/g, ' ')
      })
    }
    return { id: r.id, number: r.rfq_number, userId: r.user_id, status: r.status, lastMessage: last?.message ?? null, offer }
  },

  describe: s =>
    `The customer's quote request ${s.number}. ` +
    (s.offer ? `Our latest offer: ${s.offer.join('; ')}. ` : 'We have not made a priced offer yet. ') +
    (s.lastMessage ? `Our last message to them: "${s.lastMessage.slice(0, 400)}"` : ''),

  yes: 'accept',
  intents: {
    accept: {
      describe: 'They accept our latest priced offer as it is (only when we have made one).',
      tier: s => (s.offer ? 'auto' : 'admin'),
      title: s => `Accept our offer on ${s.number}`,
    },
    message: {
      describe: 'Anything else about this request: a counter-offer or other prices, a question, more details, changed quantities, or that they no longer need it.',
      tier: 'auto',
      title: s => `Add the customer's message to ${s.number}`,
    },
  },

  async execute(intent, _args, s, ctx) {
    if (intent === 'accept') {
      if (!s.offer) return { ok: false, text: 'There is no offer to accept yet.' }
      await respondToRfq(s.id, s.userId, 'accept', { message: ctx.text?.slice(0, 2000) || null })
      return { ok: true, close: true, text: `Thank you! We've noted that you accept our offer on ${s.number}. We'll send the quotation shortly.` }
    }
    if (intent === 'message') {
      if (!ctx.text || !(await postCustomerRfqMessage(s.id, s.userId, ctx.text))) return { ok: false, text: 'This quote request is closed.' }
      // The thread stays open: they may still accept, and our team will answer.
      return { ok: true, close: false, text: `Thanks, I've added this to your quote request ${s.number}. Our team will get back to you.` }
    }
    return { ok: false, text: 'Unknown request' }
  },
}
