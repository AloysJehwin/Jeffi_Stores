import { NextRequest, NextResponse } from 'next/server'
import { verifyCronRequest } from '@/lib/shared/cron-auth'
import { sweepUnreadAgentReplies } from '@/lib/support/notify'

export const dynamic = 'force-dynamic'

// Every minute: an agent's reply still unread after 2 minutes, with the customer gone from the chat,
// gets them one email (and a push in the app).
export async function GET(request: NextRequest) {
  if (!verifyCronRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    return NextResponse.json({ ok: true, notified: await sweepUnreadAgentReplies() })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Sweep failed' }, { status: 500 })
  }
}
