import { NextRequest, NextResponse } from 'next/server'
import { publishSupportEvent } from '@/lib/support/events'
import { customerChat } from '@/lib/support/http'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params
  const ctx = await customerChat(request, sessionId)
  if (ctx instanceof NextResponse) return ctx
  const body = await request.json().catch(() => ({}))
  await publishSupportEvent({ kind: 'typing', sessionId, who: 'customer', on: body?.on !== false }, ctx.session.tenant_id)
  return NextResponse.json({ ok: true })
}
