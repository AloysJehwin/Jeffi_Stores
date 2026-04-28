import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/jwt'
import { query, queryOne, queryMany } from '@/lib/db'
import { sendSupportEscalationEmail } from '@/lib/email'

export async function GET(request: NextRequest) {
  try {
    const authUser = await authenticateUser(request)
    if (!authUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const session = await queryOne(
      `SELECT id, status, created_at, admin_name FROM support_sessions
       WHERE user_id = $1 AND status = 'open'
       ORDER BY created_at DESC LIMIT 1`,
      [authUser.userId]
    )

    return NextResponse.json({ session: session || null })
  } catch {
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const authUser = await authenticateUser(request)
    if (!authUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const existing = await queryOne(
      `SELECT id FROM support_sessions WHERE user_id = $1 AND status = 'open' LIMIT 1`,
      [authUser.userId]
    )
    if (existing) {
      return NextResponse.json({ session: existing })
    }

    const session = await queryOne(
      `INSERT INTO support_sessions (user_id) VALUES ($1) RETURNING id, status, created_at`,
      [authUser.userId]
    )

    const user = await queryOne(
      `SELECT first_name, last_name, email FROM users WHERE id = $1`,
      [authUser.userId]
    )

    if (user) {
      const name = `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'Customer'
      const admins = await queryMany(
        `SELECT u.email FROM admins a JOIN users u ON u.id = a.user_id WHERE a.is_active = true AND u.email IS NOT NULL`,
        []
      )
      const adminEmails = admins.map((a: any) => a.email)
      try {
        await sendSupportEscalationEmail(name, user.email, authUser.userId, session.id, adminEmails)
      } catch {}
    }

    return NextResponse.json({ session })
  } catch {
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
