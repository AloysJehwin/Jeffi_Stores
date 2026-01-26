import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { cookies } from 'next/headers'

// Get wishlist items for a user
export async function GET(request: NextRequest) {
  try {
    const userId = cookies().get('user_id')?.value

    if (!userId) {
      return NextResponse.json({ items: [] })
    }

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

    let userId = cookies().get('user_id')?.value

    // Create guest user if doesn't exist
    if (!userId) {
      const { data: guestUser, error: userError } = await supabaseAdmin
        .from('users')
        .insert({
          email: `guest_${Date.now()}_${Math.random().toString(36).substring(7)}@guest.local`,
          first_name: 'Guest',
          is_active: true
        })
        .select('id')
        .single()

      if (userError || !guestUser) {
        return NextResponse.json({ error: 'Failed to create session' }, { status: 500 })
      }

      userId = guestUser.id
      cookies().set('user_id', guestUser.id, {
        maxAge: 30 * 24 * 60 * 60, // 30 days
        path: '/',
      })
    }

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

    const userId = cookies().get('user_id')?.value

    if (!userId) {
      return NextResponse.json({ error: 'Session not found' }, { status: 401 })
    }

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
