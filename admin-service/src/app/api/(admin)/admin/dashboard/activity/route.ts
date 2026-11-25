import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { getDashboardActivity } from '@/lib/queries'
import type { ActivityChannel } from '@/lib/dashboard/activity-types'

export const dynamic = 'force-dynamic'

const WEEKS = [13, 26, 52]
const CHANNELS: ActivityChannel[] = ['all', 'online', 'cod', 'business']

/** Fulfilment activity (shipped calendar, rhythm, time to ship) behind the dashboard's "Orders shipped" drawer. */
export async function GET(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'dashboard:read')) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const sp = request.nextUrl.searchParams
    const weeks = sp.has('weeks') ? Number(sp.get('weeks')) : 26
    const channel = sp.get('channel') ?? 'all'
    if (!WEEKS.includes(weeks)) return NextResponse.json({ error: 'weeks must be 13, 26 or 52' }, { status: 400 })
    if (!CHANNELS.includes(channel as ActivityChannel)) {
      return NextResponse.json({ error: 'channel must be all, online, cod or business' }, { status: 400 })
    }

    const activity = await getDashboardActivity({ weeks, channel: channel as ActivityChannel })
    return NextResponse.json({ activity })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to load activity' }, { status: 500 })
  }
}
