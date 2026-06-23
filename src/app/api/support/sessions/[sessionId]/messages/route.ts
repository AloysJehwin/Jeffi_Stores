import { NextRequest, NextResponse } from 'next/server'
import { authenticateAnyUser } from '@/lib/jwt'
import { queryMany, queryOne } from '@/lib/db'
import { logActivity } from '@/lib/activity'
import { z } from 'zod'
import { parseBody, zNonEmpty } from '@/lib/validate'

const postSchema = z.object({
  message: zNonEmpty.max(2000),
})

const CLOSING_PHRASES = [
  'thank you for contacting',
  'have a great day',
  'your issue has been resolved',
  "don't hesitate to reach out",
]

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params
  try {
    const authUser = await authenticateAnyUser(request)
    if (!authUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const session = await queryOne(
      `SELECT id, admin_name FROM support_sessions WHERE id = $1 AND user_id = $2`,
      [sessionId, authUser.userId]
    )
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }

    const messages = await queryMany(
      `SELECT id, sender, message, created_at FROM support_messages
       WHERE session_id = $1 ORDER BY created_at ASC`,
      [sessionId]
    )

    const messagesWithMeta = messages.map((m: any) => ({
      ...m,
      sender_name: m.sender === 'admin' ? session.admin_name : undefined,
      is_closing: m.sender === 'admin'
        ? CLOSING_PHRASES.some(p => m.message.toLowerCase().includes(p))
        : false,
    }))

    return NextResponse.json({ messages: messagesWithMeta, admin_name: session.admin_name })
  } catch (err) {
    console.error('[route]', err)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params
  try {
    const authUser = await authenticateAnyUser(request)
    if (!authUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const session = await queryOne(
      `SELECT id FROM support_sessions WHERE id = $1 AND user_id = $2 AND status = 'open'`,
      [sessionId, authUser.userId]
    )
    if (!session) {
      return NextResponse.json({ error: 'Session not found or closed' }, { status: 404 })
    }

    const { message } = await request.json()
    if (!message?.trim()) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 })
    }

    const parsed = parseBody(postSchema, { message })
    if (!parsed.ok) return parsed.response

    const msg = await queryOne(
      `INSERT INTO support_messages (session_id, sender, message)
       VALUES ($1, 'user', $2)
       RETURNING id, sender, message, created_at`,
      [sessionId, message.trim()]
    )

    const trimmed = message.trim()
    const preview = trimmed.length > 80 ? trimmed.slice(0, 80) + '…' : trimmed
    logActivity({
      userId: authUser.userId,
      kind: 'support_message',
      referenceId: sessionId,
      referenceType: 'support_sessions',
      summary: `Customer: ${preview}`,
      metadata: { from: 'customer' },
    }).catch(() => {})

    return NextResponse.json({ message: msg })
  } catch (err) {
    console.error('[route]', err)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
