import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { jwtVerify } from 'jose'
import { supabaseAdmin } from '@/lib/supabase'
import { sendOrderConfirmationEmail, sendNewOrderNotification } from '@/lib/email'

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET || 'your-secret-key')

export async function POST(request: NextRequest) {
  try {
    // Get auth token
    const cookieStore = await cookies()
    const token = cookieStore.get('auth_token')?.value

    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Verify JWT
    let userId: string
    let userEmail: string
    try {
      const { payload } = await jwtVerify(token, JWT_SECRET)
      userId = payload.userId as string
      userEmail = payload.email as string
    } catch (error) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
    }

    // Get user details
    const { data: user } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('id', userId)
      .single()

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const body = await request.json()
    const { shippingAddress, notes } = body

    // Get session_id for cart
    const sessionId = cookieStore.get('session_id')?.value || userId

    // Get cart items
    const { data: cartItems, error: cartError } = await supabaseAdmin
      .from('cart_items')
      .select(`
        *,
        products (
          id,
          name,
          sku,
          base_price,
          sale_price,
          stock_quantity,
          is_in_stock
        )
      `)
      .eq('user_id', sessionId)

    if (cartError || !cartItems || cartItems.length === 0) {
      return NextResponse.json({ error: 'Cart is empty' }, { status: 400 })
    }

    // Check stock availability
    for (const item of cartItems) {
      if (!item.products.is_in_stock || item.products.stock_quantity < item.quantity) {
        return NextResponse.json(
          { error: `${item.products.name} is out of stock or has insufficient quantity` },
          { status: 400 }
        )
      }
    }

    // Calculate totals
    const subtotal = cartItems.reduce((sum, item) => {
      const price = item.products.sale_price || item.products.base_price
      return sum + (price * item.quantity)
    }, 0)

    const total = subtotal // Can add shipping, tax later

    // Generate order number
    const orderNumber = `ORD-${Date.now()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`

    // Create shipping address
    let shippingAddressId = null
    let billingAddressId = null
    
    if (shippingAddress) {
      const fullName = shippingAddress.fullName || `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'Customer'
      const phone = shippingAddress.phone || user.phone || '0000000000'
      
      const { data: address, error: addressError } = await supabaseAdmin
        .from('addresses')
        .insert({
          user_id: userId,
          address_type: 'both', // Use for both shipping and billing
          full_name: fullName,
          phone: phone,
          address_line1: shippingAddress.addressLine1,
          address_line2: shippingAddress.addressLine2 || null,
          landmark: shippingAddress.landmark || null,
          city: shippingAddress.city,
          state: shippingAddress.state,
          postal_code: shippingAddress.postalCode,
          country: shippingAddress.country || 'India',
          is_default: false,
        })
        .select('id')
        .single()

      if (!addressError && address) {
        shippingAddressId = address.id
        billingAddressId = address.id // Use same address for billing
      } else {
        console.error('Address creation error:', addressError)
      }
    }

    // Create order
    const { data: order, error: orderError } = await supabaseAdmin
      .from('orders')
      .insert({
        order_number: orderNumber,
        user_id: userId,
        customer_email: user.email,
        customer_phone: user.phone,
        customer_name: `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'Customer',
        status: 'pending',
        payment_status: 'unpaid',
        subtotal,
        total_amount: total,
        shipping_address_id: shippingAddressId,
        billing_address_id: billingAddressId,
        notes: notes || null,
      })
      .select()
      .single()

    if (orderError || !order) {
      console.error('Order creation error:', orderError)
      return NextResponse.json({ error: 'Failed to create order' }, { status: 500 })
    }

    // Create order items
    const orderItems = cartItems.map(item => ({
      order_id: order.id,
      product_id: item.product_id,
      product_name: item.products.name,
      product_sku: item.products.sku,
      quantity: item.quantity,
      unit_price: item.products.sale_price || item.products.base_price,
      total_price: (item.products.sale_price || item.products.base_price) * item.quantity,
    }))

    const { error: itemsError } = await supabaseAdmin
      .from('order_items')
      .insert(orderItems)

    if (itemsError) {
      console.error('Order items error:', itemsError)
      // Rollback order if items creation fails
      await supabaseAdmin.from('orders').delete().eq('id', order.id)
      return NextResponse.json({ error: 'Failed to create order items' }, { status: 500 })
    }

    // Update product stock
    for (const item of cartItems) {
      await supabaseAdmin
        .from('products')
        .update({
          stock_quantity: item.products.stock_quantity - item.quantity,
          is_in_stock: (item.products.stock_quantity - item.quantity) > 0
        })
        .eq('id', item.product_id)
    }

    // Clear cart
    await supabaseAdmin
      .from('cart_items')
      .delete()
      .eq('user_id', sessionId)

    // Send emails (don't wait for them)
    sendOrderConfirmationEmail(user.email, order, orderItems).catch(err =>
      console.error('Failed to send order confirmation email:', err)
    )

    sendNewOrderNotification(order, orderItems, user).catch(err =>
      console.error('Failed to send new order notification:', err)
    )

    return NextResponse.json({
      message: 'Order created successfully',
      order: {
        id: order.id,
        orderNumber: order.order_number,
        total: order.total_amount,
        status: order.status,
      },
    })
  } catch (error) {
    console.error('Order creation error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
