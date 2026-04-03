import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { cookies } from 'next/headers'
import { jwtVerify } from 'jose'
import { getUserIdForSession } from '@/lib/guest-user'

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET || 'your-secret-key')

// Get cart items for a user
export async function GET(request: NextRequest) {
  try {
    const cookieStore = await cookies()
    let sessionId = cookieStore.get('session_id')?.value
    let authUserId: string | undefined

    // Check if user is authenticated
    const authToken = cookieStore.get('auth_token')?.value
    if (authToken) {
      try {
        const { payload } = await jwtVerify(authToken, JWT_SECRET)
        authUserId = payload.userId as string
      } catch (error) {
        // Invalid token, continue as guest
      }
    }

    // Get user ID (creates guest user if needed)
    const userId = await getUserIdForSession(sessionId, authUserId)

    // Update session cookie if it was created
    if (!sessionId && !authUserId) {
      sessionId = `guest_${Date.now()}_${Math.random().toString(36).substring(7)}`
      cookieStore.set('session_id', sessionId, {
        maxAge: 30 * 24 * 60 * 60,
        path: '/',
      })
    }

    const { data: cartItems, error } = await supabaseAdmin
      .from('cart_items')
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

    return NextResponse.json({ items: cartItems || [] })
  } catch (error) {
    console.error('Cart GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch cart' }, { status: 500 })
  }
}

// Add item to cart
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { productId, quantity = 1 } = body

    const cookieStore = await cookies()
    let sessionId = cookieStore.get('session_id')?.value
    let authUserId: string | undefined

    // Check if user is authenticated
    const authToken = cookieStore.get('auth_token')?.value
    if (authToken) {
      try {
        const { payload } = await jwtVerify(authToken, JWT_SECRET)
        authUserId = payload.userId as string
      } catch (error) {
        // Invalid token, continue as guest
      }
    }

    // Get user ID (creates guest user if needed)
    const userId = await getUserIdForSession(sessionId, authUserId)

    // Update session cookie if it was created
    if (!sessionId && !authUserId) {
      sessionId = `guest_${Date.now()}_${Math.random().toString(36).substring(7)}`
      cookieStore.set('session_id', sessionId, {
        maxAge: 30 * 24 * 60 * 60,
        path: '/',
      })
    }

    // Get product details
    const { data: product, error: productError } = await supabaseAdmin
      .from('products')
      .select('id, base_price, sale_price, stock_quantity')
      .eq('id', productId)
      .single()

    if (productError || !product) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 })
    }

    if (product.stock_quantity < quantity) {
      return NextResponse.json({ error: 'Insufficient stock' }, { status: 400 })
    }

    const priceAtAddition = product.sale_price || product.base_price

    // Check if item already exists in cart
    const { data: existingItem } = await supabaseAdmin
      .from('cart_items')
      .select('*')
      .eq('user_id', userId)
      .eq('product_id', productId)
      .is('variant_id', null)
      .single()

    if (existingItem) {
      // Update quantity
      const newQuantity = existingItem.quantity + quantity

      if (product.stock_quantity < newQuantity) {
        return NextResponse.json({ error: 'Insufficient stock' }, { status: 400 })
      }

      const { error: updateError } = await supabaseAdmin
        .from('cart_items')
        .update({
          quantity: newQuantity,
          updated_at: new Date().toISOString()
        })
        .eq('id', existingItem.id)

      if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 500 })
      }

      return NextResponse.json({ message: 'Cart updated', quantity: newQuantity })
    } else {
      // Insert new item
      const { error: insertError } = await supabaseAdmin
        .from('cart_items')
        .insert({
          user_id: userId,
          product_id: productId,
          quantity,
          price_at_addition: priceAtAddition,
        })

      if (insertError) {
        return NextResponse.json({ error: insertError.message }, { status: 500 })
      }

      return NextResponse.json({ message: 'Item added to cart' })
    }
  } catch (error) {
    console.error('Cart POST error:', error)
    return NextResponse.json({ error: 'Failed to add to cart' }, { status: 500 })
  }
}

// Update cart item quantity
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json()
    const { cartItemId, quantity } = body

    const sessionId = cookies().get('session_id')?.value

    if (!sessionId) {
      return NextResponse.json({ error: 'Session not found' }, { status: 401 })
    }

    // Get cart item
    const { data: cartItem } = await supabaseAdmin
      .from('cart_items')
      .select('*, products(stock_quantity)')
      .eq('id', cartItemId)
      .eq('user_id', sessionId)
      .single()

    if (!cartItem) {
      return NextResponse.json({ error: 'Cart item not found' }, { status: 404 })
    }

    if (cartItem.products.stock_quantity < quantity) {
      return NextResponse.json({ error: 'Insufficient stock' }, { status: 400 })
    }

    const { error } = await supabaseAdmin
      .from('cart_items')
      .update({ quantity, updated_at: new Date().toISOString() })
      .eq('id', cartItemId)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ message: 'Cart updated' })
  } catch (error) {
    console.error('Cart PATCH error:', error)
    return NextResponse.json({ error: 'Failed to update cart' }, { status: 500 })
  }
}

// Remove item from cart
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const cartItemId = searchParams.get('id')

    const sessionId = cookies().get('session_id')?.value

    if (!sessionId) {
      return NextResponse.json({ error: 'Session not found' }, { status: 401 })
    }

    const { error } = await supabaseAdmin
      .from('cart_items')
      .delete()
      .eq('id', cartItemId)
      .eq('user_id', sessionId)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ message: 'Item removed from cart' })
  } catch (error) {
    console.error('Cart DELETE error:', error)
    return NextResponse.json({ error: 'Failed to remove from cart' }, { status: 500 })
  }
}
