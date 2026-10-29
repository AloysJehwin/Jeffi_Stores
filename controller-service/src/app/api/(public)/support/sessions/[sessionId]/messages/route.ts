import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { queryMany } from '@/lib/shared/db'
import { logActivity } from '@/lib/shared/activity'
import { parseBody } from '@/lib/shared/validate'
import { currentBrandNameAsync } from '@/lib/catalog/brand'
import { getSessionDto } from '@/lib/support/sessions'
import { listMessages, localize, markReceipts, postMessage, type AttachmentInput } from '@/lib/support/messages'
import { settleCustomerLang } from '@/lib/support/translate'
import { onCustomerMessage } from '@/lib/support/agent'
import { customerChat, clientChannel, isV2, legacyMessage } from '@/lib/support/http'
import type { AttachmentKind } from '@/lib/support/types'

export const dynamic = 'force-dynamic'

const postSchema = z
  .object({
    message: z.string().max(4000).optional(),
    clientId: z.string().max(64).nullish(),
    attachmentIds: z.array(z.string().uuid()).max(10).optional(),
  })
  .refine(b => !!b.message?.trim() || !!b.attachmentIds?.length, { message: 'Write a message or attach a file' })

export async function GET(request: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params
  try {
    const ctx = await customerChat(request, sessionId)
    if (ctx instanceof NextResponse) return ctx
    const brand = await currentBrandNameAsync()
    const after = request.nextUrl.searchParams.get('after')
    const listed = await listMessages(sessionId, { after, brand })
    const lang = ctx.session.customer_lang
    const messages = listed.map(l => (l.message.sender === 'customer' ? l.message : localize(l.message, l.translations, lang)))

    if (!isV2(request)) {
      const last = listed[listed.length - 1]
      if (last) await markReceipts(sessionId, 'customer', 'read', last.message.id).catch(() => 0)
      return NextResponse.json({ messages: messages.map(legacyMessage), admin_name: ctx.session.admin_name })
    }
    return NextResponse.json({ messages, session: after ? undefined : await getSessionDto(sessionId) })
  } catch (err) {
    console.error('[support] messages GET', err)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params
  try {
    const ctx = await customerChat(request, sessionId)
    if (ctx instanceof NextResponse) return ctx
    if (ctx.session.status !== 'open') return NextResponse.json({ error: 'This chat is closed' }, { status: 409 })
    const parsed = parseBody(postSchema, await request.json().catch(() => ({})))
    if (!parsed.ok) return parsed.response
    const text = (parsed.data.message ?? '').trim()

    let attachments: AttachmentInput[] = []
    if (parsed.data.attachmentIds?.length) {
      const files = await queryMany<any>(
        `SELECT id, kind, mime_type, name, size_bytes, width, height, duration_seconds FROM drive_files
          WHERE id = ANY($1::uuid[]) AND uploaded_by_user_id = $2 AND source = 'support' AND deleted_at IS NULL`,
        [parsed.data.attachmentIds, ctx.user.userId]
      )
      if (files.length !== parsed.data.attachmentIds.length) return NextResponse.json({ error: 'Attachment not found' }, { status: 400 })
      const order = new Map(parsed.data.attachmentIds.map((id, i) => [id, i]))
      attachments = files
        .sort((a, b) => order.get(a.id)! - order.get(b.id)!)
        .map(f => ({
          driveFileId: f.id,
          kind: f.kind as AttachmentKind,
          mime: f.mime_type,
          name: f.name,
          size: Number(f.size_bytes),
          width: f.width,
          height: f.height,
          duration: f.duration_seconds != null ? Number(f.duration_seconds) : null,
        }))
    }

    const { session, lang } = await settleCustomerLang(ctx.session, text)
    const message = await postMessage({
      session,
      sender: 'customer',
      text,
      channel: clientChannel(request),
      clientId: parsed.data.clientId ?? null,
      attachments,
      lang,
    })
    await onCustomerMessage(session, message)

    const preview = text.length > 80 ? `${text.slice(0, 80)}…` : text || `${attachments.length} attachment(s)`
    logActivity({ userId: ctx.user.userId, kind: 'support_message', referenceId: sessionId, referenceType: 'support_sessions', summary: `Customer: ${preview}`, metadata: { from: 'customer' } }).catch(() => {})

    return NextResponse.json({ message: isV2(request) ? message : legacyMessage(message) })
  } catch (err) {
    console.error('[support] messages POST', err)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
