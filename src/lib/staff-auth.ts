import { NextRequest, NextResponse } from 'next/server'
import { resolveTenantId } from './tenant-context'
import { staffSessionFromRequest, type StaffSession } from './staff-session'
import { hasPlanScope } from './plan-gate'

export type StaffScope = 'customers:read' | 'customers:write'

/** Staff-form guard: valid host-bound staff cookie whose admin role + tenant plan grant the scope. */
export async function requireStaff(
  req: NextRequest,
  scope: StaffScope
): Promise<{ session: StaffSession; tenantId: string | null } | NextResponse> {
  const tenantId = await resolveTenantId()
  const session = await staffSessionFromRequest(req, tenantId)
  if (!session) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
  if (!(await hasPlanScope(session.role, session.scopes, scope))) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }
  return { session, tenantId }
}

export function isStaffDenied(x: unknown): x is NextResponse {
  return x instanceof NextResponse
}

// Separate OTP namespace from the admin-panel login so the two flows cannot redeem each other's codes.
export const staffOtpKey = (email: string) => `staff:${email.toLowerCase()}`
