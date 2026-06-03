import { NextRequest, NextResponse } from 'next/server'
import { queryOne } from '@/lib/db'
import { authenticateUser } from '@/lib/jwt'
import { logActivity } from '@/lib/activity'

export async function PATCH(request: NextRequest) {
  try {
    const authUser = await authenticateUser(request)
    if (!authUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = authUser.userId
    const body = await request.json()
    const { firstName, lastName, phone } = body

    const existing = await queryOne('SELECT first_name, last_name, phone FROM users WHERE id = $1', [userId])
    if (!existing) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const resolvedFirstName = firstName !== undefined ? firstName : existing.first_name
    const resolvedLastName = lastName !== undefined ? lastName : existing.last_name

    if (!resolvedFirstName) {
      return NextResponse.json({ error: 'First name is required' }, { status: 400 })
    }

    let normalizedPhone = phone === undefined ? existing.phone : null
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
      [resolvedFirstName, resolvedLastName || null, normalizedPhone, userId]
    )

    if (!updatedUser) {
      return NextResponse.json({ error: 'Failed to update profile' }, { status: 500 })
    }

    logActivity({
      userId,
      kind: 'profile_updated',
      summary: 'Updated profile',
      metadata: { fields: ['firstName', 'lastName', 'phone'].filter(f => body[f] !== undefined) },
    }).catch(() => {})

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
