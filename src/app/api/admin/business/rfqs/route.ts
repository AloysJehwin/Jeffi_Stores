import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { queryMany, queryCount } from '@/lib/shared/db'

export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'business_rfqs:read')
  if (admin instanceof NextResponse) return admin

  const { searchParams } = new URL(request.url)
  const status = searchParams.get('status') || ''
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10))
  const PAGE_SIZE = 25
  const offset = (page - 1) * PAGE_SIZE

  const conditions: string[] = []
  const params: any[] = []
  let i = 1

  if (status) {
    conditions.push(`r.status = $${i++}`)
    params.push(status)
  }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''

  const [rfqs, total] = await Promise.all([
    queryMany<any>(
      `SELECT r.id, r.rfq_number, r.status, r.notes, r.converted_quotation_id, r.created_at,
              u.first_name, u.last_name, u.email,
              bp.company_name,
              (SELECT COUNT(*) FROM business_rfq_items ri WHERE ri.rfq_id = r.id)::int AS item_count
       FROM business_rfqs r
       JOIN users u ON u.id = r.user_id
       LEFT JOIN business_profiles bp ON bp.user_id = r.user_id
       ${where}
       ORDER BY r.created_at DESC
       LIMIT $${i} OFFSET $${i + 1}`,
      [...params, PAGE_SIZE, offset]
    ),
    queryCount(`SELECT COUNT(*) FROM business_rfqs r ${where}`, params),
  ])

  return NextResponse.json({ rfqs, total, page, pageSize: PAGE_SIZE })
}
