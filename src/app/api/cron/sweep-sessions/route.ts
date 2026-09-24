import { NextRequest, NextResponse } from 'next/server'
import { sweepExpiredAdminSessions } from '@/lib/auth-sessions'

export const dynamic = 'force-dynamic'

// Every 5 min: revoke admin sessions past their idle or absolute deadline and push logout to
// any tab still showing them. resolveSession already refuses them; this keeps the rows honest.
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const ids = await sweepExpiredAdminSessions()
    return NextResponse.json({ ok: true, revoked: ids.length })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Sweep failed' }, { status: 500 })
  }
}
