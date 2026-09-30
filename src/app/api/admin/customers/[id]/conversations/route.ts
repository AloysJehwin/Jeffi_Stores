import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { listConversations, parseChannels, clampConversationLimit } from '@/lib/shared/customer-conversations'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'customers:read'))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const sp = req.nextUrl.searchParams
  const parsed = parseChannels(sp.get('channels'))
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })

  const limit = clampConversationLimit(sp.get('limit'))
  const before = sp.get('before')
  const q = sp.get('q')

  try {
    const { items, nextBefore } = await listConversations(id, { channels: parsed.channels, before, limit, q })
    return NextResponse.json({ items, nextBefore })
  } catch (err) {
    console.error('[conversations] list failed for', id, err)
    return NextResponse.json({ error: 'Could not load conversations' }, { status: 500 })
  }
}
