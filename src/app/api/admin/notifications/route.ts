import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { listAdminNotifications } from '@/lib/admin-notify'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request, { passive: true })
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { items, unreadCount } = await listAdminNotifications(admin.role, admin.scopes)
    return NextResponse.json({ items, unreadCount })
  } catch (err) {
    console.error('[notifications]', err)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
