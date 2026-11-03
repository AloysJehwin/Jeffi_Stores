import { NextRequest, NextResponse } from 'next/server'
import { updateSession } from '@/lib/support/sessions'
import { ensureTranslations } from '@/lib/support/translate'
import { customerChat } from '@/lib/support/http'
import { isSupportLanguage } from '@/lib/support/types'
import { afterResponse } from '@/lib/support/agent'

export const dynamic = 'force-dynamic'

// The customer picks the language they want the chat in.
export async function POST(request: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params
  const ctx = await customerChat(request, sessionId)
  if (ctx instanceof NextResponse) return ctx
  const { lang } = await request.json().catch(() => ({}))
  if (!isSupportLanguage(lang)) return NextResponse.json({ error: 'Unsupported language' }, { status: 400 })
  await updateSession(sessionId, { customer_lang: lang })
  await afterResponse(() => ensureTranslations(sessionId, lang))
  return NextResponse.json({ ok: true, lang })
}
