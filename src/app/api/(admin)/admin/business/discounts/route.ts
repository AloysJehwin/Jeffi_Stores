import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { query, queryMany } from '@/lib/shared/db'

export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'business_customers:read')
  if (admin instanceof NextResponse) return admin

  const { searchParams } = new URL(request.url)
  const userId = searchParams.get('user_id')
  if (!userId) return NextResponse.json({ error: 'user_id required' }, { status: 400 })

  const discounts = await queryMany<any>(
    `SELECT bd.id, bd.user_id, bd.category_id, c.name AS category_name, bd.discount_pct, bd.updated_at
     FROM business_discounts bd
     JOIN categories c ON c.id = bd.category_id
     WHERE bd.user_id = $1
     ORDER BY c.name`,
    [userId]
  )
  return NextResponse.json({ discounts })
}

export async function POST(request: NextRequest) {
  const admin = await requireAdminScope(request, 'business_customers:write')
  if (admin instanceof NextResponse) return admin

  const { userId, categoryId, discountPct } = await request.json()
  if (!userId || !categoryId || discountPct == null) {
    return NextResponse.json({ error: 'userId, categoryId, and discountPct are required' }, { status: 400 })
  }
  const pct = parseFloat(discountPct)
  if (isNaN(pct) || pct < 0 || pct > 100) {
    return NextResponse.json({ error: 'discountPct must be between 0 and 100' }, { status: 400 })
  }

  if (pct === 0) {
    await query('DELETE FROM business_discounts WHERE user_id=$1 AND category_id=$2', [userId, categoryId])
    return NextResponse.json({ success: true, deleted: true })
  }

  await query(
    `INSERT INTO business_discounts (user_id, category_id, discount_pct)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, category_id) DO UPDATE SET discount_pct=$3, updated_at=NOW()`,
    [userId, categoryId, pct]
  )
  return NextResponse.json({ success: true })
}
