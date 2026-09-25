import { NextRequest, NextResponse } from 'next/server'
import { resolveTenantId } from './tenant-context'
import { staffSessionFromRequest, type StaffSession } from './staff-session'
import { resolveAdminByEmail } from './admin-identity'
import { hasPlanScope } from './plan-gate'

export type StaffScope = 'customers:read' | 'customers:write'

/** Staff-form guard: valid host-bound staff cookie for a still-active admin whose role + tenant plan grant the scope. */
export async function requireStaff(
  req: NextRequest,
  scope: StaffScope
): Promise<{ session: StaffSession; tenantId: string | null } | NextResponse> {
  const tenantId = await resolveTenantId()
  const claims = await staffSessionFromRequest(req, tenantId)
  if (!claims) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
  const admin = await resolveAdminByEmail(claims.email)
  if (!admin || admin.id !== claims.adminId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
  if (!(await hasPlanScope(admin.role, admin.scopes, scope))) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }
  return { session: { ...claims, role: admin.role, scopes: admin.scopes }, tenantId }
}

export function isStaffDenied(x: unknown): x is NextResponse {
  return x instanceof NextResponse
}

// Separate OTP namespace from the admin-panel login so the two flows cannot redeem each other's codes.
export const staffOtpKey = (email: string) => `staff:${email.toLowerCase()}`
