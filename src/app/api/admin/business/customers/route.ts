import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/jwt'
import { queryMany, queryCount } from '@/lib/db'

export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'business_customers:read')
  if (admin instanceof NextResponse) return admin

  const { searchParams } = new URL(request.url)
  const status = searchParams.get('status') || ''
  const q = searchParams.get('q') || ''
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10))
  const PAGE_SIZE = 25
  const offset = (page - 1) * PAGE_SIZE

  const conditions: string[] = []
  const params: any[] = []
  let i = 1

  if (status) {
    conditions.push(`bp.approval_status = $${i++}`)
    params.push(status)
  }
  if (q) {
    conditions.push(
      `(u.first_name ILIKE $${i} OR u.last_name ILIKE $${i} OR u.email ILIKE $${i} OR bp.company_name ILIKE $${i} OR bp.gst_number ILIKE $${i})`
    )
    params.push(`%${q}%`)
    i++
  }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''

  const [customers, total] = await Promise.all([
    queryMany<any>(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.phone, u.created_at,
              bp.id AS profile_id, bp.company_name, bp.gst_number, bp.industry, bp.approval_status,
              bp.approved_at, bp.rejection_note
       FROM users u
       JOIN business_profiles bp ON bp.user_id = u.id
       ${where}
       ORDER BY bp.created_at DESC
       LIMIT $${i} OFFSET $${i + 1}`,
      [...params, PAGE_SIZE, offset]
    ),
    queryCount(`SELECT COUNT(*) FROM users u JOIN business_profiles bp ON bp.user_id = u.id ${where}`, params),
  ])

  return NextResponse.json({ customers, total, page, pageSize: PAGE_SIZE })
}
