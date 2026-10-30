import { NextRequest, NextResponse } from 'next/server'
import { sweepExpiredAdminSessions } from '@/lib/auth/auth-sessions'
import { sweepDraftLocks } from '@/lib/admin/draft-locks'
import { verifyCronRequest } from '@/lib/shared/cron-auth'

export const dynamic = 'force-dynamic'

// Every 5 min: revoke admin sessions past their idle or absolute deadline and push logout to
// any tab still showing them. resolveSession already refuses them; this keeps the rows honest.
// Also tidies draft locks: stale presence, orphaned locks, inactive holders, old tombstones.
export async function GET(request: NextRequest) {
  if (!verifyCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const ids = await sweepExpiredAdminSessions()
    const drafts = await sweepDraftLocks().catch(err => {
      console.error('[sweep-sessions] draft lock sweep failed', err)
      return null
    })
    return NextResponse.json({ ok: true, revoked: ids.length, drafts })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Sweep failed' }, { status: 500 })
  }
}
