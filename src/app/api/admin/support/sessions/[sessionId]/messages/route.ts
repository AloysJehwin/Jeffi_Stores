import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { queryMany, queryOne } from '@/lib/db'
import { sendAgentConnectedEmail } from '@/lib/email'

export async function GET(
  request: NextRequest,
  { params }: { params: { sessionId: string } }
) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const messages = await queryMany(
      `SELECT id, sender, message, created_at FROM support_messages
       WHERE session_id = $1 ORDER BY created_at ASC`,
      [params.sessionId]
    )

    return NextResponse.json({ messages })
  } catch {
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { sessionId: string } }
) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const session = await queryOne<{ id: string; admin_name: string | null; user_id: string }>(
      `SELECT id, admin_name, user_id FROM support_sessions WHERE id = $1 AND status = 'open'`,
      [params.sessionId]
    )
    if (!session) {
      return NextResponse.json({ error: 'Session not found or closed' }, { status: 404 })
    }

    const { message, isClosingMessage } = await request.json()
    if (!message?.trim()) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 })
    }

    const isFirstAgentMessage = !session.admin_name

    await queryOne(
      `UPDATE support_sessions SET admin_name = COALESCE(admin_name, $1) WHERE id = $2`,
      [admin.username, params.sessionId]
    )

    const msg = await queryOne(
      `INSERT INTO support_messages (session_id, sender, message)
       VALUES ($1, 'admin', $2)
       RETURNING id, sender, message, created_at`,
      [params.sessionId, message.trim()]
    )

    if (isFirstAgentMessage) {
      const customer = await queryOne<{ first_name: string; last_name: string; email: string }>(
        `SELECT first_name, last_name, email FROM users WHERE id = $1`,
        [session.user_id]
      )
      if (customer) {
        const customerName = `${customer.first_name} ${customer.last_name}`.trim()
        sendAgentConnectedEmail(customerName, customer.email, admin.username).catch(() => {})
      }
    }

    return NextResponse.json({ message: { ...msg, sender_name: admin.username, is_closing: isClosingMessage || false } })
  } catch {
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
