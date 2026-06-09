import { NextRequest, NextResponse } from 'next/server'
import { authenticateBusiness } from '@/lib/jwt'
import { queryOne, queryMany } from '@/lib/db'

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await authenticateBusiness(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rfq = await queryOne<any>(
    `SELECT id, rfq_number, status, notes, admin_note, created_at, converted_quotation_id
     FROM business_rfqs WHERE id = $1 AND user_id = $2`,
    [params.id, user.userId]
  )
  if (!rfq) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const items = await queryMany<any>(
    `SELECT id, description, quantity, unit, requested_price, notes
     FROM business_rfq_items WHERE rfq_id = $1 ORDER BY position, created_at`,
    [params.id]
  )

  return NextResponse.json({ rfq, items })
}
