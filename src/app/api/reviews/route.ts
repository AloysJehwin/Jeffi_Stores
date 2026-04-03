import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { cookies } from 'next/headers'
import { verifyToken } from '@/lib/jwt'
import { sendNewReviewNotification } from '@/lib/email'

// Get reviews for a product
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const productId = searchParams.get('productId')

    if (!productId) {
      return NextResponse.json({ error: 'Product ID required' }, { status: 400 })
    }

    const { data: reviews, error } = await supabaseAdmin
      .from('product_reviews')
      .select(`
        *,
        users (
          first_name,
          last_name
        )
      `)
      .eq('product_id', productId)
      .eq('is_approved', true)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Reviews fetch error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ reviews: reviews || [] })
  } catch (error) {
    console.error('Reviews GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch reviews' }, { status: 500 })
  }
}

// Submit a new review
export async function POST(request: NextRequest) {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get('auth_token')?.value

    // Verify user is logged in
    if (!token) {
      return NextResponse.json({ error: 'Please login to submit a review' }, { status: 401 })
    }

    const payload = await verifyToken(token)
    if (!payload?.userId) {
      return NextResponse.json({ error: 'Invalid authentication' }, { status: 401 })
    }

    const body = await request.json()
    const { productId, rating, title, comment } = body

    // Validate required fields
    if (!productId || !rating || !comment) {
      return NextResponse.json({ error: 'Product ID, rating, and comment are required' }, { status: 400 })
    }

    if (rating < 1 || rating > 5) {
      return NextResponse.json({ error: 'Rating must be between 1 and 5' }, { status: 400 })
    }

    // Check if user already reviewed this product
    const { data: existingReview } = await supabaseAdmin
      .from('product_reviews')
      .select('id')
      .eq('product_id', productId)
      .eq('user_id', payload.userId)
      .single()

    if (existingReview) {
      return NextResponse.json({ error: 'You have already reviewed this product' }, { status: 400 })
    }

    // Check if user purchased this product
    const { data: hasPurchased } = await supabaseAdmin
      .from('order_items')
      .select('id')
      .eq('product_id', productId)
      .eq('order_id', supabaseAdmin
        .from('orders')
        .select('id')
        .eq('user_id', payload.userId)
        .eq('order_status', 'delivered')
      )
      .limit(1)
      .single()

    // Insert review
    const { data: review, error } = await supabaseAdmin
      .from('product_reviews')
      .insert({
        product_id: productId,
        user_id: payload.userId,
        rating,
        title: title || null,
        comment,
        is_verified_purchase: !!hasPurchased,
        is_approved: false, // Requires admin approval
      })
      .select()
      .single()

    if (error) {
      console.error('Review insert error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Get user and product details for email
    const { data: user } = await supabaseAdmin
      .from('users')
      .select('first_name, last_name, email')
      .eq('id', payload.userId)
      .single()

    const { data: product } = await supabaseAdmin
      .from('products')
      .select('name, slug')
      .eq('id', productId)
      .single()

    // Send email notification to admin
    if (user && product) {
      try {
        await sendNewReviewNotification(review, user, product)
      } catch (emailError) {
        console.error('Failed to send review notification email:', emailError)
        // Don't fail the request if email fails
      }
    }

    return NextResponse.json({ 
      message: 'Review submitted successfully! It will be visible after admin approval.',
      review 
    })
  } catch (error) {
    console.error('Review POST error:', error)
    return NextResponse.json({ error: 'Failed to submit review' }, { status: 500 })
  }
}
