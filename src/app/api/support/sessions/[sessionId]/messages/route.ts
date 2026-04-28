import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/jwt'
import { queryMany, queryOne } from '@/lib/db'

const CLOSING_PHRASES = [
  'thank you for contacting',
  'have a great day',
  'your issue has been resolved',
  "don't hesitate to reach out",
]

export async function GET(
  request: NextRequest,
  { params }: { params: { sessionId: string } }
) {
  try {
    const authUser = await authenticateUser(request)
    if (!authUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const session = await queryOne(
      `SELECT id, admin_name FROM support_sessions WHERE id = $1 AND user_id = $2`,
      [params.sessionId, authUser.userId]
    )
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }

    const messages = await queryMany(
      `SELECT id, sender, message, created_at FROM support_messages
       WHERE session_id = $1 ORDER BY created_at ASC`,
      [params.sessionId]
    )

    const messagesWithMeta = messages.map((m: any) => ({
      ...m,
      sender_name: m.sender === 'admin' ? session.admin_name : undefined,
      is_closing: m.sender === 'admin'
        ? CLOSING_PHRASES.some(p => m.message.toLowerCase().includes(p))
        : false,
    }))

    return NextResponse.json({ messages: messagesWithMeta, admin_name: session.admin_name })
  } catch {
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { sessionId: string } }
) {
  try {
    const authUser = await authenticateUser(request)
    if (!authUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const session = await queryOne(
      `SELECT id FROM support_sessions WHERE id = $1 AND user_id = $2 AND status = 'open'`,
      [params.sessionId, authUser.userId]
    )
    if (!session) {
      return NextResponse.json({ error: 'Session not found or closed' }, { status: 404 })
    }

    const { message } = await request.json()
    if (!message?.trim()) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 })
    }

    const msg = await queryOne(
      `INSERT INTO support_messages (session_id, sender, message)
       VALUES ($1, 'user', $2)
       RETURNING id, sender, message, created_at`,
      [params.sessionId, message.trim()]
    )

    return NextResponse.json({ message: msg })
  } catch {
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
