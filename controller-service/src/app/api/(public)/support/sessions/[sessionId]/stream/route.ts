import { NextRequest, NextResponse } from 'next/server'
import { resolveTenant } from '@/lib/tenancy/tenant-context'
import { subscribeSession } from '@/lib/support/events'
import { localize } from '@/lib/support/messages'
import { customerChat, sseStream } from '@/lib/support/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Live events for the customer's chat: messages (in their language), ticks, typing, agent presence.
export async function GET(request: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params
  const ctx = await customerChat(request, sessionId)
  if (ctx instanceof NextResponse) return ctx
  const tenant = await resolveTenant().catch(() => null)
  let lang = ctx.session.customer_lang
  return sseStream(request, async send => {
    send({ kind: 'hello', sessionId })
    return subscribeSession(tenant?.tenantId ?? null, sessionId, e => {
      if (e.kind === 'session') {
        if (e.session.customerLang !== undefined) lang = e.session.customerLang
        // The customer sees who is handling the chat, not the team's internal notes.
        const { handoffSummary: _s, handoffReason: _r, ...visible } = e.session
        send({ ...e, session: visible })
      } else if (e.kind === 'message') {
        const m = e.message.sender === 'customer' ? e.message : localize(e.message, e.translations, lang)
        send({ kind: 'message', sessionId, message: m })
      } else if (e.kind === 'translation') {
        if (lang && e.translations[lang]) send(e)
      } else if (e.kind === 'presence' && e.side === 'customer') {
        /* own presence */
      } else send(e)
    })
  })
}
