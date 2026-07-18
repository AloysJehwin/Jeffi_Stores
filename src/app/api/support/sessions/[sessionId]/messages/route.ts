import { NextRequest, NextResponse } from 'next/server'
import { authenticateAnyUser } from '@/lib/jwt'
import { queryMany, queryOne } from '@/lib/db'
import { logActivity } from '@/lib/activity'
import { z } from 'zod'
import { parseBody, zNonEmpty } from '@/lib/validate'
import { fetchUserOrders, getBotReply } from '@/lib/support-bot'

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

    const session = await queryOne<{ id: string; admin_name: string | null; created_at: string }>(
      `SELECT id, admin_name, created_at FROM support_sessions WHERE id = $1 AND user_id = $2`,
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

    const messagesWithMeta: any[] = messages.map((m: any) => ({
      ...m,
      sender_name: m.sender === 'admin' ? session.admin_name : undefined,
      is_closing: m.sender === 'admin'
        ? CLOSING_PHRASES.some(p => m.message.toLowerCase().includes(p))
        : false,
    }))

    const BOT_DELAY_MS = parseInt(process.env.SUPPORT_BOT_DELAY_MS || '120000', 10)
    const last = messagesWithMeta[messagesWithMeta.length - 1]

    // Case 1: last message is from user and unanswered
    // Case 2: no messages at all — session opened but user hasn't typed yet
    const shouldCheckBot =
      (last && last.sender === 'user' &&
        Date.now() - new Date(last.created_at).getTime() >= BOT_DELAY_MS) ||
      (!last && Date.now() - new Date(session.created_at).getTime() >= BOT_DELAY_MS)

    if (shouldCheckBot) {
      const refTime = last ? last.created_at : session.created_at
      const hasReply = await queryOne(
        `SELECT id FROM support_messages
         WHERE session_id = $1 AND sender IN ('admin','bot') AND created_at > $2 LIMIT 1`,
        [sessionId, refTime]
      )
      if (!hasReply) {
        const orders = await fetchUserOrders(authUser.userId)
        const userMsg = last?.message ?? ''
        const replyText = userMsg
          ? getBotReply(userMsg, orders, messagesWithMeta)
          : "hey! i'm Jeffi. looks like you're waiting for a support agent — they'll be with you shortly. in the meantime, what can i help you with?"
        const botMsg = await queryOne(
          `INSERT INTO support_messages (session_id, sender, message)
           VALUES ($1, 'bot', $2)
           RETURNING id, sender, message, created_at`,
          [sessionId, replyText]
        )
        if (botMsg) messagesWithMeta.push({ ...botMsg, is_closing: false })
      }
    }

    return NextResponse.json({ messages: messagesWithMeta, admin_name: session.admin_name })
  } catch {
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
  } catch {
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
