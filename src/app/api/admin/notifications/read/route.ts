import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { markRead, markAllRead } from '@/lib/admin-notify'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json().catch(() => ({}))
    if (body?.all === true) {
      await markAllRead()
    } else if (Array.isArray(body?.ids)) {
      await markRead(body.ids.filter((id: unknown) => typeof id === 'string'))
    } else {
      return NextResponse.json({ error: 'ids[] or all required' }, { status: 400 })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[notifications/read]', err)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
