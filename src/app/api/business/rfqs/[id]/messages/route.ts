import { NextRequest, NextResponse } from 'next/server'
import { authenticateBusiness } from '@/lib/jwt'
import { queryOne, queryMany, query } from '@/lib/db'

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await authenticateBusiness(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rfq = await queryOne<any>(
    `SELECT id FROM business_rfqs WHERE id = $1 AND user_id = $2`,
    [params.id, user.userId]
  )
  if (!rfq) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const messages = await queryMany<any>(
    `SELECT id, sender, message, counter_items, created_at FROM rfq_messages
     WHERE rfq_id = $1 ORDER BY created_at ASC`,
    [params.id]
  )

  return NextResponse.json({ messages })
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await authenticateBusiness(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rfq = await queryOne<any>(
    `SELECT id, status FROM business_rfqs WHERE id = $1 AND user_id = $2`,
    [params.id, user.userId]
  )
  if (!rfq) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (['converted', 'rejected'].includes(rfq.status)) {
    return NextResponse.json({ error: 'Cannot message on a closed quote' }, { status: 400 })
  }

  const { message } = await request.json()
  if (!message?.trim()) return NextResponse.json({ error: 'Message is required' }, { status: 400 })

  const msg = await queryOne<any>(
    `INSERT INTO rfq_messages (rfq_id, sender, message)
     VALUES ($1, 'customer', $2) RETURNING id, sender, message, counter_items, created_at`,
    [params.id, message.trim()]
  )

  // Move to negotiating if still pending/reviewed
  if (['pending', 'reviewed'].includes(rfq.status)) {
    await query(
      `UPDATE business_rfqs SET status = 'negotiating' WHERE id = $1`,
      [params.id]
    )
  }

  return NextResponse.json({ message: msg })
}
