import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateAnyUser } from '@/lib/auth/jwt'
import { parseBody, zUuid } from '@/lib/shared/validate'
import { markRead } from '@/lib/push/inbox'

export const dynamic = 'force-dynamic'

const ReadSchema = z
  .object({ ids: z.array(zUuid).max(200).optional(), all: z.boolean().optional() })
  .refine(b => b.all === true || (b.ids?.length ?? 0) > 0, { message: 'Pass ids or all: true' })

export async function POST(request: NextRequest) {
  try {
    const user = await authenticateAnyUser(request)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const parsed = parseBody(ReadSchema, await request.json().catch(() => null), 'notifications-read')
    if (!parsed.ok) return parsed.response
    const unread = await markRead(user.userId, parsed.data)
    return NextResponse.json({ ok: true, unread_count: unread })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
