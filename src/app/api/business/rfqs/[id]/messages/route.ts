import { NextRequest, NextResponse } from 'next/server'
import { authenticateBusiness } from '@/lib/jwt'
import { queryOne, queryMany, query } from '@/lib/db'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await authenticateBusiness(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rfq = await queryOne<any>(`SELECT id FROM business_rfqs WHERE id = $1 AND user_id = $2`, [id, user.userId])
  if (!rfq) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const messages = await queryMany<any>(
    `SELECT id, sender, message, counter_items, created_at FROM rfq_messages
     WHERE rfq_id = $1 ORDER BY created_at ASC`,
    [id]
  )

  return NextResponse.json({ messages })
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await authenticateBusiness(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rfq = await queryOne<any>(`SELECT id, status FROM business_rfqs WHERE id = $1 AND user_id = $2`, [
    id,
    user.userId,
  ])
  if (!rfq) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (['converted', 'rejected'].includes(rfq.status)) {
    return NextResponse.json({ error: 'Cannot message on a closed quote' }, { status: 400 })
  }

  const { message, counter_items } = await request.json()
  if (!message?.trim()) return NextResponse.json({ error: 'Message is required' }, { status: 400 })

  if (counter_items != null) {
    if (!Array.isArray(counter_items)) {
      return NextResponse.json({ error: 'counter_items must be an array' }, { status: 400 })
    }
    for (const ci of counter_items) {
      if (!ci.rfq_item_id || ci.offered_price == null || Number(ci.offered_price) < 0) {
        return NextResponse.json(
          { error: 'Each counter item needs rfq_item_id and a non-negative offered_price' },
          { status: 400 }
        )
      }
    }
    const ids = counter_items.map((c: any) => c.rfq_item_id)
    const rows = await queryMany<{ id: string }>(
      `SELECT id FROM business_rfq_items WHERE rfq_id = $1 AND id = ANY($2::uuid[])`,
      [id, ids]
    )
    if (rows.length !== ids.length) {
      return NextResponse.json({ error: 'One or more counter items do not belong to this RFQ' }, { status: 400 })
    }
  }

  const msg = await queryOne<any>(
    `INSERT INTO rfq_messages (rfq_id, sender, message, counter_items)
     VALUES ($1, 'customer', $2, $3) RETURNING id, sender, message, counter_items, created_at`,
    [id, message.trim(), counter_items && counter_items.length ? JSON.stringify(counter_items) : null]
  )

  // Move to negotiating if still pending/reviewed
  if (['pending', 'reviewed'].includes(rfq.status)) {
    await query(`UPDATE business_rfqs SET status = 'negotiating' WHERE id = $1`, [id])
  }

  return NextResponse.json({ message: msg })
}
