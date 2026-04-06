import { NextRequest, NextResponse } from 'next/server'
import { queryMany, query } from '@/lib/db'
import { authenticateAdmin } from '@/lib/jwt'

// Get reviews for admin (all or filtered)
export async function GET(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const filter = searchParams.get('filter') || 'pending'

    let sql = `
      SELECT
        pr.*,
        json_build_object('first_name', u.first_name, 'last_name', u.last_name, 'email', u.email) AS users,
        json_build_object('name', p.name, 'slug', p.slug) AS products
      FROM product_reviews pr
      LEFT JOIN users u ON pr.user_id = u.id
      LEFT JOIN products p ON pr.product_id = p.id
    `
    const params: any[] = []

    if (filter === 'pending') {
      sql += ' WHERE pr.is_approved = $1'
      params.push(false)
    } else if (filter === 'approved') {
      sql += ' WHERE pr.is_approved = $1'
      params.push(true)
    }

    sql += ' ORDER BY pr.created_at DESC'

    const reviews = await queryMany(sql, params)

    return NextResponse.json({ reviews: reviews || [] })
  } catch (error) {
    console.error('Admin reviews GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch reviews' }, { status: 500 })
  }
}

// Approve or reject a review
export async function PATCH(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { reviewId, action } = body

    if (!reviewId || !action) {
      return NextResponse.json({ error: 'Review ID and action required' }, { status: 400 })
    }

    if (action === 'approve') {
      await query(
        'UPDATE product_reviews SET is_approved = true, updated_at = NOW() WHERE id = $1',
        [reviewId]
      )
      return NextResponse.json({ message: 'Review approved successfully' })
    } else if (action === 'reject') {
      await query('DELETE FROM product_reviews WHERE id = $1', [reviewId])
      return NextResponse.json({ message: 'Review deleted successfully' })
    } else {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }
  } catch (error) {
    console.error('Admin review PATCH error:', error)
    return NextResponse.json({ error: 'Failed to update review' }, { status: 500 })
  }
}
