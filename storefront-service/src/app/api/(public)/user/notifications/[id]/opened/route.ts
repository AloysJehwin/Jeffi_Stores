import { NextRequest, NextResponse } from 'next/server'
import { authenticateAnyUser } from '@/lib/auth/jwt'
import { zUuid } from '@/lib/shared/validate'
import { markOpened } from '@/lib/push/inbox'

export const dynamic = 'force-dynamic'

// Tap tracking (push or inbox): records the first open and marks the notification read.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await authenticateAnyUser(request)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { id } = await params
    if (!zUuid.safeParse(id).success || !(await markOpened(user.userId, id))) {
      return NextResponse.json({ error: 'Notification not found' }, { status: 404 })
    }
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
