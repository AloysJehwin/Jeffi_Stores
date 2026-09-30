import { NextRequest, NextResponse } from 'next/server'
import { queryMany, query, queryOne } from '@/lib/shared/db'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'

export async function GET(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'reviews:read'))
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const { searchParams } = new URL(request.url)
    const filter = searchParams.get('filter') || 'pending'
    const q = searchParams.get('q')?.trim() || ''
    const pageSize = Math.min(parseInt(searchParams.get('pageSize') || '25', 10), 200)
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10))
    const offset = (page - 1) * pageSize

    const conditions: string[] = []
    const params: unknown[] = []
    let i = 1

    if (filter === 'pending') {
      conditions.push(`pr.is_approved = $${i++}`)
      params.push(false)
    } else if (filter === 'approved') {
      conditions.push(`pr.is_approved = $${i++}`)
      params.push(true)
    }

    if (q) {
      conditions.push(
        `(p.name ILIKE $${i} OR u.first_name ILIKE $${i} OR u.last_name ILIKE $${i} OR u.email ILIKE $${i})`
      )
      params.push(`%${q}%`)
      i++
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

    const countRow = await queryOne<{ total: string }>(
      `SELECT COUNT(*)::text AS total
       FROM product_reviews pr
       LEFT JOIN users u ON pr.user_id = u.id
       LEFT JOIN products p ON pr.product_id = p.id
       ${where}`,
      params
    )
    const total = parseInt(countRow?.total || '0', 10)

    const sql = `
      SELECT
        pr.*,
        json_build_object('first_name', u.first_name, 'last_name', u.last_name, 'email', u.email) AS users,
        json_build_object('name', p.name, 'slug', p.slug) AS products
      FROM product_reviews pr
      LEFT JOIN users u ON pr.user_id = u.id
      LEFT JOIN products p ON pr.product_id = p.id
      ${where}
      ORDER BY pr.created_at DESC
      LIMIT $${i} OFFSET $${i + 1}
    `

    const reviews = await queryMany(sql, [...params, pageSize, offset])

    return NextResponse.json({ reviews: reviews || [], total, page, pageSize })
  } catch (err) {
    console.error('[route]', err)
    return NextResponse.json({ error: 'Failed to fetch reviews' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'reviews:write'))
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const body = await request.json()
    const { reviewId, action } = body

    if (!reviewId || !action) {
      return NextResponse.json({ error: 'Review ID and action required' }, { status: 400 })
    }

    if (action === 'approve') {
      await query('UPDATE product_reviews SET is_approved = true, updated_at = NOW() WHERE id = $1', [reviewId])
      return NextResponse.json({ message: 'Review approved successfully' })
    } else if (action === 'reject') {
      await query('DELETE FROM product_reviews WHERE id = $1', [reviewId])
      return NextResponse.json({ message: 'Review deleted successfully' })
    } else {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }
  } catch (err) {
    console.error('[route]', err)
    return NextResponse.json({ error: 'Failed to update review' }, { status: 500 })
  }
}
