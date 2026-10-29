import { NextRequest, NextResponse } from 'next/server'
import { publishSupportEvent } from '@/lib/support/events'
import { adminChat, agentRef } from '@/lib/support/http'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params
  const ctx = await adminChat(request, sessionId, 'customers:write', { passive: true })
  if (ctx instanceof NextResponse) return ctx
  const body = await request.json().catch(() => ({}))
  await publishSupportEvent({ kind: 'typing', sessionId, who: 'admin', name: (await agentRef(ctx.admin)).name, on: body?.on !== false })
  return NextResponse.json({ ok: true })
}
