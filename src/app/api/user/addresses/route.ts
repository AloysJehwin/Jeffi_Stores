import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { query, queryOne, queryMany } from '@/lib/db'
import { authenticateUser } from '@/lib/jwt'
import { logActivity } from '@/lib/activity'
import { parseBody, zNonEmpty, zPhone, zIndianPin } from '@/lib/validate'

const CreateAddressSchema = z.object({
  address_type: z.string().optional().default('shipping'),
  full_name: zNonEmpty,
  phone: zPhone,
  address_line1: zNonEmpty,
  address_line2: z.string().nullish(),
  landmark: z.string().nullish(),
  city: zNonEmpty,
  state: zNonEmpty,
  postal_code: zIndianPin,
  country: z.string().optional().default('India'),
  is_default: z.boolean().optional().default(false),
})

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
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await authenticateUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = user.userId

    const body = await request.json()
    const parsed = parseBody(CreateAddressSchema, body)
    if (!parsed.ok) return parsed.response
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
    } = parsed.data

    if (!phone) {
      return NextResponse.json({ error: 'Phone number is required' }, { status: 400 })
    }
    const phoneDigits = phone.replace(/\D/g, '')
    const cleanedPhone = phoneDigits.startsWith('91') && phoneDigits.length === 12 ? phoneDigits.slice(2) : phoneDigits
    if (cleanedPhone.length !== 10) {
      return NextResponse.json({ error: 'Enter a valid 10-digit mobile number' }, { status: 400 })
    }
    const normalizedPhone = `+91${cleanedPhone}`

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

    logActivity({
      userId,
      kind: 'address_added',
      referenceId: address.id,
      referenceType: 'addresses',
      summary: `Added ${address_type || 'a'} address: ${city}, ${state}`,
      metadata: { address_type, city, state, postal_code },
    }).catch(() => {})

    return NextResponse.json({ address })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
