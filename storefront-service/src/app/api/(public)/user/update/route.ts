import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { queryOne } from '@/lib/shared/db'
import { authenticateAnyUser as authenticateUser } from '@/lib/auth/jwt'
import { logActivity } from '@/lib/shared/activity'
import { parseBody, zNonEmpty, zPhone, zDob } from '@/lib/shared/validate'
import { formatDob } from '@/lib/shared/format'

const UpdateUserSchema = z
  .object({
    firstName: zNonEmpty.optional(),
    lastName: zNonEmpty.optional(),
    phone: zPhone.optional(),
    notificationChannel: z.enum(['email', 'sms', 'whatsapp']).optional(),
    dateOfBirth: zDob.optional(),
  })
  .refine(
    d =>
      d.firstName !== undefined ||
      d.lastName !== undefined ||
      d.phone !== undefined ||
      d.notificationChannel !== undefined ||
      d.dateOfBirth !== undefined,
    { message: 'At least one field must be provided' }
  )

export async function PATCH(request: NextRequest) {
  try {
    const authUser = await authenticateUser(request)
    if (!authUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = authUser.userId
    const body = await request.json()
    const parsed = parseBody(UpdateUserSchema, body)
    if (!parsed.ok) return parsed.response
    const { firstName, lastName, phone, notificationChannel, dateOfBirth } = parsed.data

    const existing = await queryOne(
      'SELECT first_name, last_name, phone, notification_channel, date_of_birth FROM users WHERE id = $1',
      [userId]
    )
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

    const resolvedChannel = notificationChannel !== undefined ? notificationChannel : existing.notification_channel
    const resolvedDob = dateOfBirth !== undefined ? dateOfBirth : formatDob(existing.date_of_birth)

    const updatedUser = await queryOne(
      `UPDATE users SET first_name = $1, last_name = $2, phone = $3, notification_channel = $4,
                        date_of_birth = $5, updated_at = NOW()
       WHERE id = $6
       RETURNING *`,
      [resolvedFirstName, resolvedLastName || null, normalizedPhone, resolvedChannel, resolvedDob, userId]
    )

    if (!updatedUser) {
      return NextResponse.json({ error: 'Failed to update profile' }, { status: 500 })
    }

    logActivity({
      userId,
      kind: 'profile_updated',
      summary: 'Updated profile',
      metadata: {
        fields: ['firstName', 'lastName', 'phone', 'notificationChannel', 'dateOfBirth'].filter(
          f => body[f] !== undefined
        ),
      },
    }).catch(() => {})

    const user = {
      id: updatedUser.id,
      email: updatedUser.email,
      firstName: updatedUser.first_name,
      lastName: updatedUser.last_name,
      phone: updatedUser.phone,
      notificationChannel: updatedUser.notification_channel,
      dateOfBirth: formatDob(updatedUser.date_of_birth),
      createdAt: updatedUser.created_at,
    }

    return NextResponse.json({ user })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
