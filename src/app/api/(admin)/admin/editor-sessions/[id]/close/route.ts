import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { cancelSession, saveSession } from '@/lib/admin/editor-sessions'
import { zUuid } from '@/lib/shared/validate'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  if (!zUuid.safeParse(id).success)
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const raw = await req.json().catch(() => null)
  const action = raw?.action
  if (action !== 'save' && action !== 'cancel')
    return NextResponse.json({ error: "action must be 'save' or 'cancel'" }, { status: 400 })

  const ok = action === 'save'
    ? await saveSession(id, admin.id)
    : await cancelSession(id, admin.id)

  if (!ok) return NextResponse.json({ error: 'Session not found or already closed' }, { status: 404 })
  return NextResponse.json({ success: true })
}
