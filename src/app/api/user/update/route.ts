import { NextRequest, NextResponse } from 'next/server'
import { queryOne } from '@/lib/db'
import { authenticateUser } from '@/lib/jwt'

export async function PATCH(request: NextRequest) {
  try {
    const authUser = await authenticateUser(request)
    if (!authUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = authUser.userId
    const body = await request.json()
    const { firstName, lastName, phone } = body

    if (!firstName) {
      return NextResponse.json({ error: 'First name is required' }, { status: 400 })
    }

    let normalizedPhone = null
    if (phone) {
      const digits = phone.replace(/\D/g, '')
      const cleaned = digits.startsWith('91') && digits.length === 12 ? digits.slice(2) : digits
      if (cleaned.length !== 10) {
        return NextResponse.json({ error: 'Enter a valid 10-digit mobile number' }, { status: 400 })
      }
      normalizedPhone = cleaned
    }

    const updatedUser = await queryOne(
      `UPDATE users SET first_name = $1, last_name = $2, phone = $3, updated_at = NOW()
       WHERE id = $4
       RETURNING *`,
      [firstName, lastName || null, normalizedPhone, userId]
    )

    if (!updatedUser) {
      return NextResponse.json({ error: 'Failed to update profile' }, { status: 500 })
    }

    const user = {
      id: updatedUser.id,
      email: updatedUser.email,
      firstName: updatedUser.first_name,
      lastName: updatedUser.last_name,
      phone: updatedUser.phone,
      createdAt: updatedUser.created_at,
    }

    return NextResponse.json({ user })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
