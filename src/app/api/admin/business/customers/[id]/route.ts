import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/jwt'
import { queryOne, queryMany } from '@/lib/db'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const admin = await requireAdminScope(request, 'business_customers:read')
  if (admin instanceof NextResponse) return admin

  const customer = await queryOne<any>(
    `SELECT u.id, u.email, u.first_name, u.last_name, u.phone, u.created_at,
            bp.id AS profile_id, bp.company_name, bp.gst_number, bp.business_address, bp.industry,
            bp.approval_status, bp.approved_at, bp.rejection_note
     FROM users u
     JOIN business_profiles bp ON bp.user_id = u.id
     WHERE u.id = $1`,
    [id]
  )
  if (!customer) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const discounts = await queryMany<any>(
    `SELECT bd.id, bd.category_id, c.name AS category_name, bd.discount_pct
     FROM business_discounts bd
     JOIN categories c ON c.id = bd.category_id
     WHERE bd.user_id = $1
     ORDER BY c.name`,
    [id]
  )

  return NextResponse.json({ customer, discounts })
}
