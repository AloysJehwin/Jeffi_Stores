import { NextRequest, NextResponse } from 'next/server'
import { requireStaff, isStaffDenied } from '@/lib/auth/staff-auth'
import { hasPlanScope } from '@/lib/auth/plan-gate'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const auth = await requireStaff(request, 'customers:read')
  if (isStaffDenied(auth)) return auth
  const { session } = auth
  return NextResponse.json({
    email: session.email,
    name: session.name,
    canWrite: await hasPlanScope(session.role, session.scopes, 'customers:write'),
  })
}
