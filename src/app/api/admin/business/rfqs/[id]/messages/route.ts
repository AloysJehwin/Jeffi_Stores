import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/jwt'
import { queryOne, queryMany, query } from '@/lib/db'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const admin = await requireAdminScope(request, 'business_rfqs')
  if (admin instanceof NextResponse) return admin

  const rfq = await queryOne<any>(`SELECT id FROM business_rfqs WHERE id = $1`, [id])
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
  const admin = await requireAdminScope(request, 'business_rfqs')
  if (admin instanceof NextResponse) return admin

  try {
    const rfq = await queryOne<any>(`SELECT id, status FROM business_rfqs WHERE id = $1`, [id])
    if (!rfq) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (['converted', 'rejected'].includes(rfq.status)) {
      return NextResponse.json({ error: 'Cannot message on a closed quote' }, { status: 400 })
    }

    const { message, counter_items } = await request.json()
    if (!message?.trim()) return NextResponse.json({ error: 'Message is required' }, { status: 400 })

    // Validate counter_items shape if provided
    if (counter_items != null) {
      if (!Array.isArray(counter_items)) {
        return NextResponse.json({ error: 'counter_items must be an array' }, { status: 400 })
      }
      for (const ci of counter_items) {
        if (!ci.rfq_item_id || ci.offered_price == null) {
          return NextResponse.json({ error: 'Each counter item needs rfq_item_id and offered_price' }, { status: 400 })
        }
      }
    }

    const msg = await queryOne<any>(
      `INSERT INTO rfq_messages (rfq_id, sender, message, counter_items)
       VALUES ($1, 'admin', $2, $3) RETURNING id, sender, message, counter_items, created_at`,
      [id, message.trim(), counter_items ? JSON.stringify(counter_items) : null]
    )

    // Move to negotiating if not already there
    if (['pending', 'reviewed'].includes(rfq.status)) {
      await query(
        `UPDATE business_rfqs SET status = 'negotiating' WHERE id = $1`,
        [id]
      )
    }

    return NextResponse.json({ message: msg })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
