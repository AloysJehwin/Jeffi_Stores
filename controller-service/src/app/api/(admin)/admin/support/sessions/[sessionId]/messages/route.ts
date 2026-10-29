import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { parseBody } from '@/lib/shared/validate'
import { currentBrandNameAsync } from '@/lib/catalog/brand'
import { getSessionDto } from '@/lib/support/sessions'
import { listMessages, localize } from '@/lib/support/messages'
import { ensureTranslations } from '@/lib/support/translate'
import { agentAttachments, agentReply } from '@/lib/support/admin'
import { adminChat, adminLanguage, agentRef } from '@/lib/support/http'

export const dynamic = 'force-dynamic'

const postSchema = z
  .object({
    message: z.string().max(4000).optional(),
    clientId: z.string().max(64).nullish(),
    attachmentIds: z.array(z.string().uuid()).max(10).optional(),
  })
  .refine(b => !!b.message?.trim() || !!b.attachmentIds?.length, { message: 'Write a message or attach a file' })

// The conversation in the agent's language (translations are fetched for what's missing, briefly;
// late ones arrive on the stream).
export async function GET(request: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params
  try {
    const ctx = await adminChat(request, sessionId, 'customers:read', { passive: true })
    if (ctx instanceof NextResponse) return ctx
    const lang = await adminLanguage(ctx.admin.adminId)
    const after = request.nextUrl.searchParams.get('after')
    const pending = ensureTranslations(sessionId, lang, 40).catch(() => 0)
    let timer: ReturnType<typeof setTimeout> | undefined
    await Promise.race([pending, new Promise(r => (timer = setTimeout(r, 6000)))])
    clearTimeout(timer)
    const brand = await currentBrandNameAsync()
    const listed = await listMessages(sessionId, { after, brand })
    return NextResponse.json({
      messages: listed.map(l => localize(l.message, l.translations, lang)),
      session: after ? undefined : await getSessionDto(sessionId),
      lang,
      me: ctx.admin.adminId,
    })
  } catch (err) {
    console.error('[support] admin messages GET', err)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params
  try {
    const ctx = await adminChat(request, sessionId, 'customers:write')
    if (ctx instanceof NextResponse) return ctx
    if (ctx.session.status !== 'open') return NextResponse.json({ error: 'This chat is closed' }, { status: 409 })
    const parsed = parseBody(postSchema, await request.json().catch(() => ({})))
    if (!parsed.ok) return parsed.response
    const attachments = await agentAttachments({ adminId: ctx.admin.adminId, role: ctx.admin.role, scopes: ctx.admin.scopes ?? [] }, parsed.data.attachmentIds ?? [])
    if (!attachments) return NextResponse.json({ error: 'Attachment not found' }, { status: 400 })
    const message = await agentReply(
      ctx.session,
      await agentRef(ctx.admin),
      { text: (parsed.data.message ?? '').trim(), clientId: parsed.data.clientId ?? null, attachments }
    )
    return NextResponse.json({ message })
  } catch (err) {
    console.error('[support] admin messages POST', err)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
