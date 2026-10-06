import { NextRequest, NextResponse } from 'next/server'
import { queryOne } from '@/lib/shared/db'
import { verifyBirthdayToken } from '@/lib/auth/jwt'
import { normalizeDob } from '@/lib/shared/format'

export const dynamic = 'force-dynamic'

// Email-link flow for customers who never added a birthday. The token proves which account
// the link was sent to; it can only fill an empty date, never overwrite one already saved.

async function loadUser(token: string | null) {
  if (!token) return { error: NextResponse.json({ error: 'Missing link token' }, { status: 400 }) }
  const payload = await verifyBirthdayToken(token)
  if (!payload) {
    return { error: NextResponse.json({ error: 'This link has expired. Add your birthday from your account.' }, { status: 401 }) }
  }
  const user = await queryOne<{ id: string; first_name: string | null; date_of_birth: unknown }>(
    `SELECT id, first_name, date_of_birth FROM users WHERE id = $1 AND is_active = TRUE AND is_guest = FALSE`,
    [payload.userId]
  )
  if (!user) return { error: NextResponse.json({ error: 'Account not found' }, { status: 404 }) }
  return { user }
}

export async function GET(request: NextRequest) {
  try {
    const { user, error } = await loadUser(request.nextUrl.searchParams.get('token'))
    if (error) return error
    return NextResponse.json({ firstName: user.first_name, alreadySet: user.date_of_birth != null })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null)
    const { user, error } = await loadUser(typeof body?.token === 'string' ? body.token : null)
    if (error) return error

    const dob = normalizeDob(body?.dateOfBirth)
    if (!dob) return NextResponse.json({ error: 'Enter a valid date of birth' }, { status: 400 })

    const saved = await queryOne<{ id: string }>(
      `UPDATE users SET date_of_birth = $2, updated_at = NOW()
       WHERE id = $1 AND date_of_birth IS NULL
       RETURNING id`,
      [user.id, dob]
    )
    if (!saved) return NextResponse.json({ ok: true, alreadySet: true })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
