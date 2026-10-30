import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateAnyUser } from '@/lib/auth/jwt'
import { logActivity } from '@/lib/shared/activity'
import { parseBody } from '@/lib/shared/validate'
import { createSession, getSessionDto, openSessionFor } from '@/lib/support/sessions'
import { clientChannel, isV2, legacySession } from '@/lib/support/http'
import { isSupportLanguage } from '@/lib/support/types'

export const dynamic = 'force-dynamic'

const postSchema = z.object({ lang: z.string().max(10).nullish(), productId: z.string().nullish() })

// GET: the customer's open chat. POST: open one (the assistant answers first; a person joins only
// when the assistant hands over).
export async function GET(request: NextRequest) {
  try {
    const user = await authenticateAnyUser(request)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const s = await openSessionFor(user.userId)
    if (!isV2(request)) return NextResponse.json({ session: s ? legacySession(s) : null })
    return NextResponse.json({ session: s ? await getSessionDto(s.id) : null })
  } catch (err) {
    console.error('[support] sessions GET', err)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await authenticateAnyUser(request)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const parsed = parseBody(postSchema, await request.json().catch(() => ({})), 'POST /api/support/sessions')
    if (!parsed.ok) return parsed.response

    let s = await openSessionFor(user.userId)
    if (!s) {
      const lang = parsed.data.lang
      s = await createSession({ userId: user.userId, channel: clientChannel(request), customerLang: isSupportLanguage(lang) ? lang : null })
      logActivity({ userId: user.userId, kind: 'support_session_started', referenceId: s.id, referenceType: 'support_sessions', summary: `Started a support chat (${s.ticket_number})` }).catch(() => {})
    }
    if (!isV2(request)) return NextResponse.json({ session: legacySession(s) })
    return NextResponse.json({ session: await getSessionDto(s.id) })
  } catch (err) {
    console.error('[support] sessions POST', err)
    return NextResponse.json({ error: 'Could not start the chat' }, { status: 500 })
  }
}
