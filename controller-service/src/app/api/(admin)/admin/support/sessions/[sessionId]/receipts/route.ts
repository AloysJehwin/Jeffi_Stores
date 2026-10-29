import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { queryOne } from '@/lib/shared/db'
import { parseBody } from '@/lib/shared/validate'
import { markWhatsAppRead } from '@/lib/shared/whatsapp'
import { markReceipts } from '@/lib/support/messages'
import { adminChat } from '@/lib/support/http'

export const dynamic = 'force-dynamic'

const schema = z.object({ state: z.enum(['delivered', 'read']), upTo: z.string().uuid() })

// The agent saw the customer's messages: ticks on the customer's side (blue ticks on WhatsApp too).
export async function POST(request: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params
  const ctx = await adminChat(request, sessionId, 'customers:read', { passive: true })
  if (ctx instanceof NextResponse) return ctx
  const parsed = parseBody(schema, await request.json().catch(() => ({})))
  if (!parsed.ok) return parsed.response
  const updated = await markReceipts(sessionId, 'admin', parsed.data.state, parsed.data.upTo)
  if (parsed.data.state === 'read') {
    const wa = await queryOne<{ provider_sid: string | null; read_at: string | null }>(
      `UPDATE support_messages SET read_at = COALESCE(read_at, now()), status = 'read'
        WHERE session_id = $1 AND sender = 'customer' AND channel = 'whatsapp' AND read_at IS NULL
          AND (created_at, id) <= (SELECT created_at, id FROM support_messages WHERE id = $2)
        RETURNING provider_sid, read_at`,
      [sessionId, parsed.data.upTo]
    ).catch(() => null)
    if (wa?.provider_sid) await markWhatsAppRead(wa.provider_sid).catch(() => {})
  }
  return NextResponse.json({ updated })
}
