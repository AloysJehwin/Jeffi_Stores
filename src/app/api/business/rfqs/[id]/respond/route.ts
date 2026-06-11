import { NextRequest, NextResponse } from 'next/server'
import { authenticateBusiness } from '@/lib/jwt'
import { queryOne, queryMany, query } from '@/lib/db'

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await authenticateBusiness(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const rfq = await queryOne<any>(
      `SELECT id, status FROM business_rfqs WHERE id = $1 AND user_id = $2`,
      [params.id, user.userId]
    )
    if (!rfq) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (!['negotiating', 'reviewed', 'pending'].includes(rfq.status)) {
      return NextResponse.json({ error: 'No active offer to respond to' }, { status: 400 })
    }

    const { action, message } = await request.json()
    if (!['accept', 'decline'].includes(action)) {
      return NextResponse.json({ error: 'action must be accept or decline' }, { status: 400 })
    }

    const systemMessage = action === 'accept'
      ? (message?.trim() || 'Offer accepted. Please proceed with the quotation.')
      : (message?.trim() || 'Offer declined. I would like to continue negotiating.')

    await query(
      `INSERT INTO rfq_messages (rfq_id, sender, message) VALUES ($1, 'customer', $2)`,
      [params.id, systemMessage]
    )

    await query(
      `UPDATE business_rfqs SET status = $1 WHERE id = $2`,
      [action === 'accept' ? 'offer_accepted' : 'negotiating', params.id]
    )

    // When customer accepts, stamp the agreed prices onto the RFQ items
    if (action === 'accept') {
      const latestOffer = await queryOne<{ counter_items: any }>(
        `SELECT counter_items FROM rfq_messages
         WHERE rfq_id = $1 AND sender = 'admin' AND counter_items IS NOT NULL
         ORDER BY created_at DESC LIMIT 1`,
        [params.id]
      )
      if (latestOffer?.counter_items) {
        const ci = Array.isArray(latestOffer.counter_items)
          ? latestOffer.counter_items
          : JSON.parse(latestOffer.counter_items)
        for (const entry of ci) {
          if (entry.rfq_item_id && entry.offered_price != null) {
            await query(
              `UPDATE business_rfq_items SET requested_price = $1 WHERE id = $2 AND rfq_id = $3`,
              [Number(entry.offered_price), entry.rfq_item_id, params.id]
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
