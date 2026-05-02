import { NextRequest, NextResponse } from 'next/server'
import { queryOne } from '@/lib/db'
import { authenticateUser } from '@/lib/jwt'

export async function GET(request: NextRequest) {
  try {
    const userPayload = await authenticateUser(request)

    if (!userPayload) {
      return NextResponse.json({ user: null })
    }

    const user = await queryOne(
      'SELECT id, email, first_name, last_name, phone, created_at FROM users WHERE id = $1',
      [userPayload.userId]
    )

    if (!user) {
      return NextResponse.json({ user: null })
    }

    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        phone: user.phone,
        createdAt: user.created_at,
      },
    })
  } catch {
    return NextResponse.json({ user: null })
  }
}
