import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryOne } from '@/lib/shared/db'
import { conversationSummary } from '@/lib/shared/customer-conversations'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'customers:read'))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const user = await queryOne<{ email: string | null; phone: string | null }>(
    'SELECT email, phone FROM users WHERE id = $1',
    [id]
  )
  const summary = await conversationSummary(id, user?.email, user?.phone)
  return NextResponse.json(summary)
}
