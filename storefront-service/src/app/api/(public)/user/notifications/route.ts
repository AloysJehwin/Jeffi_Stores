import { NextRequest, NextResponse } from 'next/server'
import { authenticateAnyUser } from '@/lib/auth/jwt'
import { listInbox } from '@/lib/push/inbox'

export const dynamic = 'force-dynamic'

// The app inbox, newest first: { items, next_cursor, unread_count }.
export async function GET(request: NextRequest) {
  try {
    const user = await authenticateAnyUser(request)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    return NextResponse.json(await listInbox(user.userId, request.nextUrl.searchParams.get('cursor')))
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
