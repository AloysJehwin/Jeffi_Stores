import { NextRequest, NextResponse } from 'next/server'
import { query, queryOne } from '@/lib/db'
import { authenticateUser } from '@/lib/jwt'

// Update address
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await authenticateUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = user.userId
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
        'UPDATE addresses SET is_default = false WHERE user_id = $1 AND address_type = $2 AND id != $3',
        [userId, address_type, addressId]
      )
    }

    const address = await queryOne(
      `UPDATE addresses SET
        address_type = $1, full_name = $2, address_line1 = $3, address_line2 = $4,
        landmark = $5, city = $6, state = $7, postal_code = $8, country = $9,
        phone = $10, is_default = $11, updated_at = NOW()
       WHERE id = $12 AND user_id = $13
       RETURNING *`,
      [address_type, full_name, address_line1, address_line2 || null,
       landmark || null, city, state, postal_code, country || 'India',
       normalizedPhone, is_default || false, addressId, userId]
    )

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
    const user = await authenticateUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = user.userId
    const addressId = params.id

    // Check if address is the default
    const address = await queryOne(
      'SELECT is_default FROM addresses WHERE id = $1 AND user_id = $2',
      [addressId, userId]
    )

    if (!address) {
      return NextResponse.json({ error: 'Address not found' }, { status: 404 })
    }

    if (address.is_default) {
      return NextResponse.json(
        { error: 'Default address cannot be deleted. Set another address as default first.' },
        { status: 400 }
      )
    }

    // Check if address is linked to any orders
    const orderLink = await queryOne(
      'SELECT id FROM orders WHERE shipping_address_id = $1 OR billing_address_id = $1 LIMIT 1',
      [addressId]
    )

    if (orderLink) {
      return NextResponse.json(
        { error: 'This address cannot be deleted because it is associated with existing orders. You can edit it instead.' },
        { status: 400 }
      )
    }

    await query(
      'DELETE FROM addresses WHERE id = $1 AND user_id = $2',
      [addressId, userId]
    )

    return NextResponse.json({ message: 'Address deleted successfully' })
  } catch (error) {
    console.error('Error in address delete API:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
