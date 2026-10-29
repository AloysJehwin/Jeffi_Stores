import { NextRequest, NextResponse } from 'next/server'
import { inboxCounts, listInbox, type InboxFilter } from '@/lib/support/sessions'
import { adminFor } from '@/lib/support/http'
import type { SupportChannel } from '@/lib/support/types'

export const dynamic = 'force-dynamic'

const FILTERS: InboxFilter[] = ['needs_human', 'approval', 'mine', 'ai', 'open', 'closed']

// The support inbox: ?filter=needs_human|approval|mine|ai|open|closed, ?channel=, ?q=, ?customerId=.
export async function GET(request: NextRequest) {
  try {
    const admin = await adminFor(request, 'customers:read', { passive: true })
    if (admin instanceof NextResponse) return admin
    const sp = request.nextUrl.searchParams
    const f = sp.get('filter') as InboxFilter | null
    const channel = sp.get('channel') as SupportChannel | null
    const [sessions, counts] = await Promise.all([
      listInbox({
        filter: f && FILTERS.includes(f) ? f : 'open',
        adminId: admin.adminId,
        channel: channel && ['web', 'app', 'whatsapp', 'email'].includes(channel) ? channel : undefined,
        search: sp.get('q')?.trim() || undefined,
        customerId: sp.get('customerId') || undefined,
        limit: Math.min(Number(sp.get('limit')) || 100, 200),
      }),
      inboxCounts(admin.adminId),
    ])
    return NextResponse.json({ sessions, counts })
  } catch (err) {
    console.error('[support] inbox', err)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
