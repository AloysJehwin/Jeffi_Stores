import { NextRequest, NextResponse } from 'next/server'
import { authenticateBusiness } from '@/lib/jwt'
import { queryOne, queryMany, query } from '@/lib/db'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await authenticateBusiness(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const rfq = await queryOne<any>(
      `SELECT id, status FROM business_rfqs WHERE id = $1 AND user_id = $2`,
      [id, user.userId]
    )
    if (!rfq) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (!['negotiating', 'reviewed', 'pending'].includes(rfq.status)) {
      return NextResponse.json({ error: 'No active offer to respond to' }, { status: 400 })
    }

    const { action, message, counter_items } = await request.json()
    if (!['accept', 'decline'].includes(action)) {
      return NextResponse.json({ error: 'action must be accept or decline' }, { status: 400 })
    }

    let validatedCounter: Array<{ rfq_item_id: string; offered_price: number }> | null = null
    if (action === 'decline' && counter_items != null) {
      if (!Array.isArray(counter_items)) {
        return NextResponse.json({ error: 'counter_items must be an array' }, { status: 400 })
      }
      for (const ci of counter_items) {
        if (!ci.rfq_item_id || ci.offered_price == null || Number(ci.offered_price) < 0) {
          return NextResponse.json({ error: 'Each counter item needs rfq_item_id and a non-negative offered_price' }, { status: 400 })
        }
      }
      if (counter_items.length > 0) {
        const ids = counter_items.map((c: any) => c.rfq_item_id)
        const rows = await queryMany<{ id: string }>(
          `SELECT id FROM business_rfq_items WHERE rfq_id = $1 AND id = ANY($2::uuid[])`,
          [id, ids]
        )
        if (rows.length !== ids.length) {
          return NextResponse.json({ error: 'One or more counter items do not belong to this RFQ' }, { status: 400 })
        }
        validatedCounter = counter_items.map((c: any) => ({
          rfq_item_id: c.rfq_item_id,
          offered_price: Number(c.offered_price),
        }))
      }
    }

    const systemMessage = action === 'accept'
      ? (message?.trim() || 'Offer accepted. Please proceed with the quotation.')
      : (message?.trim() || (validatedCounter ? 'Sending a counter offer for your review.' : 'Offer declined. I would like to continue negotiating.'))

    await query(
      `INSERT INTO rfq_messages (rfq_id, sender, message, counter_items)
       VALUES ($1, 'customer', $2, $3)`,
      [id, systemMessage, validatedCounter ? JSON.stringify(validatedCounter) : null]
    )

    await query(
      `UPDATE business_rfqs SET status = $1 WHERE id = $2`,
      [action === 'accept' ? 'offer_accepted' : 'negotiating', id]
    )

    // When customer accepts, stamp the agreed prices onto the RFQ items
    if (action === 'accept') {
      const latestOffer = await queryOne<{ counter_items: any }>(
        `SELECT counter_items FROM rfq_messages
         WHERE rfq_id = $1 AND sender = 'admin' AND counter_items IS NOT NULL
         ORDER BY created_at DESC LIMIT 1`,
        [id]
      )
      if (latestOffer?.counter_items) {
        const ci = Array.isArray(latestOffer.counter_items)
          ? latestOffer.counter_items
          : JSON.parse(latestOffer.counter_items)
        for (const entry of ci) {
          if (entry.rfq_item_id && entry.offered_price != null) {
            await query(
              `UPDATE business_rfq_items SET requested_price = $1 WHERE id = $2 AND rfq_id = $3`,
              [Number(entry.offered_price), entry.rfq_item_id, id]
            )
          }
        }
      }
    }

    return NextResponse.json({ ok: true, action, newStatus: action === 'accept' ? 'offer_accepted' : 'negotiating' })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
