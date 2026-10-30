import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { rejectAgentAction } from '@/lib/admin-agent/actions/approve'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'agent:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }
  const out = await rejectAgentAction(id, { adminId: admin.adminId, role: admin.role, scopes: admin.scopes || [] }, 'web')
  if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.code })
  return NextResponse.json({ ok: true, status: 'rejected' })
}
