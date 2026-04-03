import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { cookies } from 'next/headers'
import { verifyToken } from '@/lib/jwt'

// Get reviews for admin (all or filtered)
export async function GET(request: NextRequest) {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get('admin_token')?.value

    // Verify admin is logged in
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    await verifyToken(token)

    const { searchParams } = new URL(request.url)
    const filter = searchParams.get('filter') || 'pending'

    let query = supabaseAdmin
      .from('product_reviews')
      .select(`
        *,
        users (
          first_name,
          last_name,
          email
        ),
        products (
          name,
          slug
        )
      `)

    // Apply filter
    if (filter === 'pending') {
      query = query.eq('is_approved', false)
    } else if (filter === 'approved') {
      query = query.eq('is_approved', true)
    }
    // 'all' shows everything

    query = query.order('created_at', { ascending: false })

    const { data: reviews, error } = await query

    if (error) {
      console.error('Reviews fetch error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ reviews: reviews || [] })
  } catch (error) {
    console.error('Admin reviews GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch reviews' }, { status: 500 })
  }
}

// Approve or reject a review
export async function PATCH(request: NextRequest) {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get('admin_token')?.value

    // Verify admin is logged in
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    await verifyToken(token)

    const body = await request.json()
    const { reviewId, action } = body

    if (!reviewId || !action) {
      return NextResponse.json({ error: 'Review ID and action required' }, { status: 400 })
    }

    if (action === 'approve') {
      // Approve the review
      const { error } = await supabaseAdmin
        .from('product_reviews')
        .update({ is_approved: true, updated_at: new Date().toISOString() })
        .eq('id', reviewId)

      if (error) {
        console.error('Review approval error:', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
      }

      return NextResponse.json({ message: 'Review approved successfully' })
    } else if (action === 'reject') {
      // Delete the review
      const { error } = await supabaseAdmin
        .from('product_reviews')
        .delete()
        .eq('id', reviewId)

      if (error) {
        console.error('Review deletion error:', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
      }

      return NextResponse.json({ message: 'Review deleted successfully' })
    } else {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }
  } catch (error) {
    console.error('Admin review PATCH error:', error)
    return NextResponse.json({ error: 'Failed to update review' }, { status: 500 })
  }
}
