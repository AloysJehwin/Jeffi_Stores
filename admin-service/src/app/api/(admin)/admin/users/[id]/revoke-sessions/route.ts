import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { revokeAllForPrincipal, type PrincipalType } from '@/lib/auth/auth-sessions'

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
  return NextResponse.json({ success: true, revoked })
}
