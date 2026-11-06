import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope, isPlatformOwner } from '@/lib/auth/scopes'
import { revokeAllForPrincipal, type PrincipalType } from '@/lib/auth/auth-sessions'
import { revokeAllForAdmin } from '@/lib/auth/api-tokens'
import { queryMany } from '@/lib/shared/db'
import { getCurrentTenant } from '@/lib/tenancy/tenant-context'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface Params {
  params: Promise<{ id: string }>
}

// Admin force-logout of another account. The [id] is the target user's id.
// Audience is selected via ?type=customer|business (default 'customer') and
// scope-gated per audience.
export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const typeParam = request.nextUrl.searchParams.get('type') || 'customer'
  if (typeParam !== 'customer' && typeParam !== 'business') {
    return NextResponse.json({ error: "type must be 'customer' or 'business'" }, { status: 400 })
  }
  const type: PrincipalType = typeParam

  const requiredScope = type === 'business' ? 'business_customers:write' : 'customers:write'
  if (!hasScope(admin.role, admin.scopes, requiredScope)) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const revoked = await revokeAllForPrincipal(type, id)
  // A store owner force-logging-out someone who is also an admin ends their CLI and extension tokens too.
  let tokensRevoked = 0
  if (isPlatformOwner(admin.role)) {
    const tenantId = getCurrentTenant()?.tenantId ?? request.headers.get('x-tenant-id')
    const admins = await queryMany<{ id: string }>(`SELECT id FROM admins WHERE user_id = $1`, [id]).catch(() => [])
    for (const a of admins) tokensRevoked += await revokeAllForAdmin(tenantId, a.id).catch(() => 0)
  }
  return NextResponse.json({ success: true, revoked, tokensRevoked })
}
