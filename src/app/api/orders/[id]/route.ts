import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { verifyToken } from '@/lib/jwt'
import { cookies } from 'next/headers'
import { sendOrderStatusUpdate, sendPaymentStatusUpdate } from '@/lib/email'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get('auth_token')?.value

    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const payload = await verifyToken(token)
    if (!payload) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
    }

    const orderId = params.id

    // Fetch order with items
    const { data: order, error: orderError } = await supabaseAdmin
      .from('orders')
      .select(`
        *,
        addresses (
          address_line1,
          address_line2,
          city,
          state,
          postal_code,
          phone
        )
      `)
      .eq('id', orderId)
      .eq('user_id', payload.userId)
      .single()

    if (orderError || !order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    // Fetch order items
    const { data: orderItems, error: itemsError } = await supabaseAdmin
      .from('order_items')
      .select(`
        id,
        product_name,
        quantity,
        price_at_purchase
      `)
      .eq('order_id', orderId)

    if (itemsError) {
      return NextResponse.json({ error: 'Failed to fetch order items' }, { status: 500 })
    }

    const orderDetails = {
      id: order.id,
      orderNumber: order.order_number,
      totalAmount: parseFloat(order.total_amount),
      status: order.status,
      createdAt: order.created_at,
      shippingAddress: {
        addressLine1: order.addresses.address_line1,
        addressLine2: order.addresses.address_line2,
        city: order.addresses.city,
        state: order.addresses.state,
        postalCode: order.addresses.postal_code,
        phone: order.addresses.phone,
      },
      items: orderItems.map(item => ({
        id: item.id,
        productName: item.product_name,
        quantity: item.quantity,
        priceAtPurchase: parseFloat(item.price_at_purchase),
      })),
    }

    return NextResponse.json({ order: orderDetails })
  } catch (error) {
    console.error('Order fetch error:', error)
    return NextResponse.json({ error: 'Failed to fetch order' }, { status: 500 })
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const orderId = params.id
    const body = await request.json()
    const { status, payment_status } = body

    // First, get current order details and user info
    const { data: currentOrder, error: fetchError } = await supabaseAdmin
      .from('orders')
      .select(`
        order_number,
        status,
        payment_status,
        total_amount,
        user_id,
        customer_name,
        customer_email,
        users (
          email,
          first_name,
          last_name
        )
      `)
      .eq('id', orderId)
      .single()

    if (fetchError || !currentOrder) {
      console.error('Order fetch error:', fetchError)
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    const statusChanged = status && status !== currentOrder.status
    const paymentStatusChanged = payment_status && payment_status !== currentOrder.payment_status

    const updateData: any = {
      updated_at: new Date().toISOString(),
    }

    if (status) {
      updateData.status = status
    }

    if (payment_status) {
      updateData.payment_status = payment_status
    }

    // Update the order
    const { error: updateError } = await supabaseAdmin
      .from('orders')
      .update(updateData)
      .eq('id', orderId)

    if (updateError) {
      console.error('Order update error:', updateError)
      throw updateError
    }

    // Send email notifications if user exists
    const user = Array.isArray(currentOrder.users) ? currentOrder.users[0] : currentOrder.users
    const userEmail = user?.email || currentOrder.customer_email
    const userName = user ? `${user.first_name || ''} ${user.last_name || ''}`.trim() : currentOrder.customer_name

    let statusEmailSent = false
    let paymentEmailSent = false

    if (userEmail && userName) {
      // Send order status update notification
      if (statusChanged) {
        const statusResult = await sendOrderStatusUpdate(
          userEmail,
          userName,
          currentOrder.order_number,
          orderId,
          status,
          currentOrder.status
        )
        statusEmailSent = statusResult.success
      }

      // Send payment status update notification
      if (paymentStatusChanged) {
        const paymentResult = await sendPaymentStatusUpdate(
          userEmail,
          userName,
          currentOrder.order_number,
          orderId,
          payment_status,
          parseFloat(currentOrder.total_amount)
        )
        paymentEmailSent = paymentResult.success
      }
    }

    return NextResponse.json({
      success: true,
      notifications: {
        statusEmailSent,
        paymentEmailSent,
      },
    })
  } catch (error: any) {
    console.error('Update error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to update order' },
      { status: 500 }
    )
  }
}
