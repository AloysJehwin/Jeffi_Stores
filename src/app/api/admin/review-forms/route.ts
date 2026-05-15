import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { queryMany, queryCount } from '@/lib/db'
import { buildSearchClause } from '@/lib/search'

export async function GET(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const search = searchParams.get('search') || ''
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10))
  const limit = 25
  const offset = (page - 1) * limit

  const conditions: string[] = []
  const params: unknown[] = []
  let i = 1

  if (search) {
    const sc = buildSearchClause(search, ['rf.title', 'rf.slug'], i)
    conditions.push(sc.clause)
    params.push(...sc.params)
    i = sc.nextIdx
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

  const [forms, total] = await Promise.all([
    queryMany(
      `SELECT rf.*, c.code AS coupon_code FROM review_forms rf LEFT JOIN coupons c ON rf.coupon_id = c.id ${where} ORDER BY rf.created_at DESC LIMIT $${i} OFFSET $${i + 1}`,
      [...params, limit, offset]
    ),
    queryCount(`SELECT COUNT(*) FROM review_forms rf ${where}`, params),
  ])

  return NextResponse.json({ forms, total })
}

export async function POST(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { title, slug, description, google_review_url, coupon_id, is_active, custom_fields } = body

  if (!title || !slug || !google_review_url) {
    return NextResponse.json({ error: 'title, slug and google_review_url are required' }, { status: 400 })
  }

  try {
    const result = await queryMany(
      `INSERT INTO review_forms (title, slug, description, google_review_url, coupon_id, is_active, custom_fields)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [title, slug.toLowerCase().trim(), description || null, google_review_url, coupon_id || null, is_active ?? true, JSON.stringify(custom_fields || [])]
    )
    return NextResponse.json({ form: result[0] }, { status: 201 })
  } catch (err: unknown) {
    if ((err as { code?: string }).code === '23505') return NextResponse.json({ error: 'Slug already exists' }, { status: 409 })
    throw err
  }
}
