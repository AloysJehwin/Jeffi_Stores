// Stand-in for @/lib/auth/jwt: auth already happened in the Next proxy; identity comes from the service token.
import type { NextRequest } from './next'
import { NextResponse } from './next'

export interface AdminClaims {
  id: string
  adminId: string
  principalId: string
  tenantId: string
  role: string
  scopes: string[]
}

export async function authenticateAdmin(req: NextRequest): Promise<AdminClaims | null> {
  const c = req.claims
  if (!c?.internal || !c.adminId) return null
  return { id: c.adminId, adminId: c.adminId, principalId: c.adminId, tenantId: c.tenantId, role: c.role ?? '', scopes: c.scopes ?? [] }
}

export async function authenticateAnyUser(req: NextRequest): Promise<{ userId: string } | null> {
  const c = req.claims
  return c?.internal && c.userId ? { userId: c.userId } : null
}

export async function requireAdminScope(req: NextRequest, scope: string | null): Promise<AdminClaims | NextResponse> {
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (scope) {
    const { hasScope } = await import('./lib/scopes')
    if (!hasScope(admin.role, admin.scopes, scope)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }
  return admin
}

