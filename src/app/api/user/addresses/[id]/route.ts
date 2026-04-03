import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { jwtVerify } from 'jose'
import { cookies } from 'next/headers'

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET || 'your-secret-key')

// Update address
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get('auth_token')?.value

    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    let userId: string
    try {
      const { payload } = await jwtVerify(token, JWT_SECRET)
      userId = payload.userId as string
    } catch (error) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
    }

    const addressId = params.id
    const body = await request.json()
    const {
      address_type,
      full_name,
      address_line1,
      address_line2,
      landmark,
      city,
      state,
      postal_code,
      country,
      phone,
      is_default,
    } = body

    // If this is set as default, unset other defaults
    if (is_default) {
      await supabaseAdmin
        .from('addresses')
        .update({ is_default: false })
        .eq('user_id', userId)
        .eq('address_type', address_type)
        .neq('id', addressId)
    }

    const { data: address, error } = await supabaseAdmin
      .from('addresses')
      .update({
        address_type,
        full_name,
        address_line1,
        address_line2: address_line2 || null,
        landmark: landmark || null,
        city,
        state,
        postal_code,
        country: country || 'India',
        phone,
        is_default: is_default || false,
        updated_at: new Date().toISOString(),
      })
      .eq('id', addressId)
      .eq('user_id', userId)
      .select()
      .single()

    if (error) {
      console.error('Error updating address:', error)
      return NextResponse.json({ error: 'Failed to update address' }, { status: 500 })
    }

    if (!address) {
      return NextResponse.json({ error: 'Address not found' }, { status: 404 })
    }

    return NextResponse.json({ address })
  } catch (error) {
    console.error('Error in address update API:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// Delete address
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get('auth_token')?.value

    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    let userId: string
    try {
      const { payload } = await jwtVerify(token, JWT_SECRET)
      userId = payload.userId as string
    } catch (error) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
    }

    const addressId = params.id

    // Check if address is being used by any orders
    const { data: ordersUsingAddress, error: checkError } = await supabaseAdmin
      .from('orders')
      .select('id, order_number')
      .or(`shipping_address_id.eq.${addressId},billing_address_id.eq.${addressId}`)
      .limit(1)

    if (checkError) {
      console.error('Error checking address usage:', checkError)
      return NextResponse.json({ error: 'Failed to check address usage' }, { status: 500 })
    }

    if (ordersUsingAddress && ordersUsingAddress.length > 0) {
      return NextResponse.json(
        { 
          error: 'This address cannot be deleted because it is associated with existing orders. You can edit it instead.',
          code: 'ADDRESS_IN_USE'
        },
        { status: 400 }
      )
    }

    const { error } = await supabaseAdmin
      .from('addresses')
      .delete()
      .eq('id', addressId)
      .eq('user_id', userId)

    if (error) {
      console.error('Error deleting address:', error)
      
      // Handle foreign key constraint violations
      if (error.code === '23503') {
        return NextResponse.json(
          { 
            error: 'This address cannot be deleted because it is associated with existing orders.',
            code: 'ADDRESS_IN_USE'
          },
          { status: 400 }
        )
      }
      
      return NextResponse.json({ error: 'Failed to delete address' }, { status: 500 })
    }

    return NextResponse.json({ message: 'Address deleted successfully' })
  } catch (error) {
    console.error('Error in address delete API:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
