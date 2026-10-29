import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { parseBody } from '@/lib/shared/validate'
import { markReceipts } from '@/lib/support/messages'
import { customerChat } from '@/lib/support/http'

export const dynamic = 'force-dynamic'

const schema = z.object({ state: z.enum(['delivered', 'read']), upTo: z.string().uuid() })

// The customer's client received / read the chat up to a message: ticks for the agent.
export async function POST(request: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params
  const ctx = await customerChat(request, sessionId)
  if (ctx instanceof NextResponse) return ctx
  const parsed = parseBody(schema, await request.json().catch(() => ({})))
  if (!parsed.ok) return parsed.response
  const updated = await markReceipts(sessionId, 'customer', parsed.data.state, parsed.data.upTo)
  return NextResponse.json({ updated })
}
