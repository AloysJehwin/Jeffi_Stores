import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { jwtVerify } from 'jose'
import { cookies } from 'next/headers'

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET || 'your-secret-key')

// Get user's addresses
export async function GET(request: NextRequest) {
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

    const { data: addresses, error } = await supabaseAdmin
      .from('addresses')
      .select('*')
      .eq('user_id', userId)
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Error fetching addresses:', error)
      return NextResponse.json({ error: 'Failed to fetch addresses' }, { status: 500 })
    }

    return NextResponse.json({ addresses: addresses || [] })
  } catch (error) {
    console.error('Error in addresses API:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// Create new address
export async function POST(request: NextRequest) {
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
    }

    const { data: address, error } = await supabaseAdmin
      .from('addresses')
      .insert({
        user_id: userId,
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
      })
      .select()
      .single()

    if (error) {
      console.error('Error creating address:', error)
      return NextResponse.json({ error: 'Failed to create address' }, { status: 500 })
    }

    return NextResponse.json({ address })
  } catch (error) {
    console.error('Error in addresses API:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
