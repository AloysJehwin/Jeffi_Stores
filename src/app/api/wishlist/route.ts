import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { cookies } from 'next/headers'
import { verifyToken } from '@/lib/jwt'
import { getUserIdForSession } from '@/lib/guest-user'

// Get wishlist items for a user
export async function GET(request: NextRequest) {
  try {
    const cookieStore = await cookies()
    const sessionId = cookieStore.get('session_id')?.value
    const token = cookieStore.get('token')?.value

    // Verify JWT token if exists
    let authUserId: string | undefined
    if (token) {
      const payload = await verifyToken(token)
      authUserId = payload?.userId
    }

    // Get user ID (either authenticated or guest)
    const userId = await getUserIdForSession(sessionId, authUserId)

    const { data: wishlistItems, error } = await supabaseAdmin
      .from('wishlist_items')
      .select(`
        *,
        products (
          id,
          name,
          slug,
          base_price,
          sale_price,
          stock_quantity,
          is_in_stock,
          product_images (
            thumbnail_url,
            is_primary
          )
        )
      `)
      .eq('user_id', userId)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ items: wishlistItems || [] })
  } catch (error) {
    console.error('Wishlist GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch wishlist' }, { status: 500 })
  }
}

// Add item to wishlist
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { productId } = body

    const cookieStore = await cookies()
    const sessionId = cookieStore.get('session_id')?.value
    const token = cookieStore.get('token')?.value

    // Verify JWT token if exists
    let authUserId: string | undefined
    if (token) {
      const payload = await verifyToken(token)
      authUserId = payload?.userId
    }

    // Get user ID (either authenticated or guest)
    const userId = await getUserIdForSession(sessionId, authUserId)

    // Check if item already exists in wishlist
    const { data: existingItem } = await supabaseAdmin
      .from('wishlist_items')
      .select('*')
      .eq('user_id', userId)
      .eq('product_id', productId)
      .single()

    if (existingItem) {
      return NextResponse.json({ message: 'Item already in wishlist' })
    }

    // Insert new item
    const { error: insertError } = await supabaseAdmin
      .from('wishlist_items')
      .insert({
        user_id: userId,
        product_id: productId,
      })

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 })
    }

    return NextResponse.json({ message: 'Item added to wishlist' })
  } catch (error) {
    console.error('Wishlist POST error:', error)
    return NextResponse.json({ error: 'Failed to add to wishlist' }, { status: 500 })
  }
}

// Remove item from wishlist
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const productId = searchParams.get('productId')

    const cookieStore = await cookies()
    const sessionId = cookieStore.get('session_id')?.value
    const token = cookieStore.get('token')?.value

    // Verify JWT token if exists
    let authUserId: string | undefined
    if (token) {
      const payload = await verifyToken(token)
      authUserId = payload?.userId
    }

    // Get user ID (either authenticated or guest)
    const userId = await getUserIdForSession(sessionId, authUserId)

    const { error } = await supabaseAdmin
      .from('wishlist_items')
      .delete()
      .eq('product_id', productId)
      .eq('user_id', userId)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ message: 'Item removed from wishlist' })
  } catch (error) {
    console.error('Wishlist DELETE error:', error)
    return NextResponse.json({ error: 'Failed to remove from wishlist' }, { status: 500 })
  }
}
