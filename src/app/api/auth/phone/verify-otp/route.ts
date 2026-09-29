import { NextRequest, NextResponse } from 'next/server'
import { authenticateAnyUser } from '@/lib/jwt'
import { verifyPhoneOTP } from '@/lib/otp'
import { queryOne } from '@/lib/db'
import { logActivity } from '@/lib/activity'

function normalizeIndianPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '')
  const cleaned = digits.startsWith('91') && digits.length === 12 ? digits.slice(2) : digits
  return cleaned.length === 10 ? cleaned : null
}

export async function POST(request: NextRequest) {
  try {
    const authUser = await authenticateAnyUser(request)
    if (!authUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { phone, otp } = await request.json()
    const cleaned = normalizeIndianPhone(String(phone || ''))
    if (!cleaned || !otp) {
      return NextResponse.json({ error: 'Mobile number and OTP are required' }, { status: 400 })
    }

    const result = await verifyPhoneOTP(cleaned, String(otp))
    if (!result.valid) {
      return NextResponse.json({ error: result.message }, { status: 400 })
    }

    let updated
    try {
      updated = await queryOne(
        `UPDATE users
            SET phone = $1, phone_verified = true, phone_verified_at = NOW(), updated_at = NOW()
          WHERE id = $2 AND user_type != 'business'
          RETURNING *`,
        [cleaned, authUser.userId]
      )
    } catch (err: any) {
      if (err?.code === '23505') {
        return NextResponse.json({ error: 'This mobile number is already in use by another account.' }, { status: 409 })
      }
      throw err
    }

    if (!updated) {
      return NextResponse.json({ error: 'Failed to save mobile number' }, { status: 500 })
    }

    logActivity({
      userId: authUser.userId,
      kind: 'profile_updated',
      summary: 'Verified mobile number',
      metadata: { field: 'phone_verified' },
    }).catch(() => {})

    return NextResponse.json({
      message: 'Mobile number verified',
      user: {
        id: updated.id,
        email: updated.email,
        firstName: updated.first_name,
        lastName: updated.last_name,
        phone: updated.phone,
        phoneVerified: updated.phone_verified,
      },
    })
  } catch {
    return NextResponse.json({ error: 'Failed to verify OTP' }, { status: 500 })
  }
}
