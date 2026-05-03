import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { queryMany, queryCount } from '@/lib/db'

export async function GET(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const search = searchParams.get('search') || ''
  const isActive = searchParams.get('is_active')
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10))
  const limit = 25
  const offset = (page - 1) * limit

  const conditions: string[] = []
  const params: unknown[] = []
  let i = 1

  if (isActive === 'true' || isActive === 'false') {
    conditions.push(`is_active = $${i++}`)
    params.push(isActive === 'true')
  }
  if (search) {
    conditions.push(`(code ILIKE $${i} OR description ILIKE $${i})`)
    params.push(`%${search}%`)
    i++
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

  const [coupons, total] = await Promise.all([
    queryMany(`SELECT * FROM coupons ${where} ORDER BY created_at DESC LIMIT $${i} OFFSET $${i + 1}`, [...params, limit, offset]),
    queryCount(`SELECT COUNT(*) FROM coupons ${where}`, params),
  ])

  return NextResponse.json({ coupons, total })
}

export async function POST(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { code, description, discount_type, discount_value, min_purchase_amount, max_discount_amount, usage_limit, usage_limit_per_user, valid_from, valid_until, is_active } = body

  if (!code || !discount_type || discount_value == null) {
    return NextResponse.json({ error: 'code, discount_type and discount_value are required' }, { status: 400 })
  }

  try {
    const result = await queryMany(
      `INSERT INTO coupons (code, description, discount_type, discount_value, min_purchase_amount, max_discount_amount, usage_limit, usage_limit_per_user, valid_from, valid_until, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [code.toUpperCase(), description || null, discount_type, discount_value, min_purchase_amount || null, max_discount_amount || null, usage_limit || null, usage_limit_per_user || null, valid_from || null, valid_until || null, is_active ?? true]
    )
    return NextResponse.json({ coupon: result[0] }, { status: 201 })
  } catch (err: unknown) {
    if ((err as { code?: string }).code === '23505') return NextResponse.json({ error: 'Coupon code already exists' }, { status: 409 })
    throw err
  }
}
