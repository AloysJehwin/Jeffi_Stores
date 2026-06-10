import { NextRequest, NextResponse } from 'next/server'
import { authenticateBusiness } from '@/lib/jwt'
import { queryOne, queryMany } from '@/lib/db'

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await authenticateBusiness(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rfq = await queryOne<any>(
    `SELECT r.id, r.rfq_number, r.status, r.notes, r.admin_note, r.created_at, r.converted_quotation_id,
            q.view_token AS quotation_view_token, q.quote_number
     FROM business_rfqs r
     LEFT JOIN quotations q ON q.id = r.converted_quotation_id
     WHERE r.id = $1 AND r.user_id = $2`,
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
