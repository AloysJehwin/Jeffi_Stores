import 'server-only'
import { query, queryMany, queryOne } from '@/lib/shared/db'
import { closeReplyContexts } from '@/lib/replies/context'

// The customer's side of an RFQ negotiation: accept our latest offer, or keep negotiating with a
// message (and their own prices). Used by the business portal and by email/WhatsApp replies.

export class RfqError extends Error {
  constructor(message: string, public status = 400) {
    super(message)
  }
}

const OPEN = ['negotiating', 'reviewed', 'pending']

export type CounterItem = { rfq_item_id: string; offered_price: number }

export async function respondToRfq(
  rfqId: string,
  userId: string,
  action: 'accept' | 'decline',
  opts: { message?: string | null; counterItems?: unknown } = {}
): Promise<{ newStatus: 'offer_accepted' | 'negotiating' }> {
  const rfq = await queryOne<{ id: string; status: string }>(`SELECT id, status FROM business_rfqs WHERE id = $1 AND user_id = $2`, [rfqId, userId])
  if (!rfq) throw new RfqError('Not found', 404)
  if (!OPEN.includes(rfq.status)) throw new RfqError('No active offer to respond to')

  let counter: CounterItem[] | null = null
  if (action === 'decline' && opts.counterItems != null) {
    if (!Array.isArray(opts.counterItems)) throw new RfqError('counter_items must be an array')
    for (const ci of opts.counterItems) {
      if (!ci?.rfq_item_id || ci.offered_price == null || Number(ci.offered_price) < 0)
        throw new RfqError('Each counter item needs rfq_item_id and a non-negative offered_price')
    }
    if (opts.counterItems.length) {
      const ids = opts.counterItems.map((c: any) => c.rfq_item_id)
      const rows = await queryMany<{ id: string }>(`SELECT id FROM business_rfq_items WHERE rfq_id = $1 AND id = ANY($2::uuid[])`, [rfqId, ids])
      if (rows.length !== ids.length) throw new RfqError('One or more counter items do not belong to this RFQ')
      counter = opts.counterItems.map((c: any) => ({ rfq_item_id: c.rfq_item_id, offered_price: Number(c.offered_price) }))
    }
  }

  const text =
    opts.message?.trim() ||
    (action === 'accept' ? 'Offer accepted. Please proceed with the quotation.' : counter ? 'Sending a counter offer for your review.' : 'Offer declined. I would like to continue negotiating.')
  await query(`INSERT INTO rfq_messages (rfq_id, sender, message, counter_items) VALUES ($1, 'customer', $2, $3)`, [rfqId, text, counter ? JSON.stringify(counter) : null])
  const newStatus = action === 'accept' ? 'offer_accepted' : 'negotiating'
  await query(`UPDATE business_rfqs SET status = $1 WHERE id = $2`, [newStatus, rfqId])

  // Accepting stamps our latest offered prices onto the RFQ items.
  if (action === 'accept') {
    const latest = await queryOne<{ counter_items: any }>(
      `SELECT counter_items FROM rfq_messages WHERE rfq_id = $1 AND sender = 'admin' AND counter_items IS NOT NULL ORDER BY created_at DESC LIMIT 1`,
      [rfqId]
    )
    const items = latest?.counter_items ? (Array.isArray(latest.counter_items) ? latest.counter_items : JSON.parse(latest.counter_items)) : []
    for (const e of items) {
      if (e.rfq_item_id && e.offered_price != null) {
        await query(`UPDATE business_rfq_items SET requested_price = $1 WHERE id = $2 AND rfq_id = $3`, [Number(e.offered_price), e.rfq_item_id, rfqId])
      }
    }
    await closeReplyContexts('business_rfqs', rfqId)
  }
  return { newStatus }
}

/** Anything else the customer says about the RFQ goes into its thread for the team. */
export async function postCustomerRfqMessage(rfqId: string, userId: string, message: string): Promise<boolean> {
  const rfq = await queryOne<{ status: string }>(`SELECT status FROM business_rfqs WHERE id = $1 AND user_id = $2`, [rfqId, userId])
  if (!rfq || ['converted', 'rejected'].includes(rfq.status)) return false
  await query(`INSERT INTO rfq_messages (rfq_id, sender, message) VALUES ($1, 'customer', $2)`, [rfqId, message.trim().slice(0, 5000)])
  if (['pending', 'reviewed'].includes(rfq.status)) await query(`UPDATE business_rfqs SET status = 'negotiating' WHERE id = $1`, [rfqId])
  return true
}
