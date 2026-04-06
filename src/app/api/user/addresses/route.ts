import { NextRequest, NextResponse } from 'next/server'
import { query, queryOne, queryMany } from '@/lib/db'
import { authenticateUser } from '@/lib/jwt'

// Get user's addresses
export async function GET(request: NextRequest) {
  try {
    const user = await authenticateUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = user.userId

    const addresses = await queryMany(
      'SELECT * FROM addresses WHERE user_id = $1 ORDER BY is_default DESC, created_at DESC',
      [userId]
    )

    return NextResponse.json({ addresses: addresses || [] })
  } catch (error) {
    console.error('Error in addresses API:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// Create new address
export async function POST(request: NextRequest) {
  try {
    const user = await authenticateUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = user.userId

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

    // Validate and normalize phone
    if (!phone) {
      return NextResponse.json({ error: 'Phone number is required' }, { status: 400 })
    }
    const phoneDigits = phone.replace(/\D/g, '')
    const cleanedPhone = phoneDigits.startsWith('91') && phoneDigits.length === 12 ? phoneDigits.slice(2) : phoneDigits
    if (cleanedPhone.length !== 10) {
      return NextResponse.json({ error: 'Enter a valid 10-digit mobile number' }, { status: 400 })
    }
    const normalizedPhone = `+91${cleanedPhone}`

    // If this is set as default, unset other defaults
    if (is_default) {
      await query(
        'UPDATE addresses SET is_default = false WHERE user_id = $1 AND address_type = $2',
        [userId, address_type]
      )
    }

    const address = await queryOne(
      `INSERT INTO addresses (user_id, address_type, full_name, address_line1, address_line2, landmark, city, state, postal_code, country, phone, is_default)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [userId, address_type, full_name, address_line1, address_line2 || null,
       landmark || null, city, state, postal_code, country || 'India', normalizedPhone, is_default || false]
    )

    if (!address) {
      return NextResponse.json({ error: 'Failed to create address' }, { status: 500 })
    }

    return NextResponse.json({ address })
  } catch (error) {
    console.error('Error in addresses API:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
