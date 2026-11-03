import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { resolveTenant } from '@/lib/tenancy/tenant-context'
import { approveAgentAction } from '@/lib/admin-agent/actions/approve'
import { storeTarget, withApproveTarget } from '@/lib/admin-agent/actions/shared'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'agent:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  // A store's admin signs in on admin-{slug} (cookie admin_sid_t); its calls go to the store's own
  // host, which reads admin_sid. The platform keeps the browser's cookies as they are.
  const tenant = await resolveTenant()
  const cookieHeader = tenant && admin.sid ? `admin_sid=${admin.sid}` : req.headers.get('cookie') || ''
  const out = await withApproveTarget(storeTarget(tenant?.slug), () =>
    approveAgentAction(id, { adminId: admin.adminId, role: admin.role, scopes: admin.scopes || [] }, { via: 'web', cookieHeader })
  )
  if (out.ok) return NextResponse.json({ ok: true, result: out.result, status: 'executed' })
  if (out.status === 'refused') return NextResponse.json({ error: out.error }, { status: out.code })
  return NextResponse.json({ ok: false, error: out.error, status: 'failed' }, { status: out.code })
}
