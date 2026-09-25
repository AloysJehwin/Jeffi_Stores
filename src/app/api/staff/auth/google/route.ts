import { NextRequest, NextResponse } from 'next/server'
import { verifyGoogle } from '@/lib/google-verify'
import { resolveAdminByEmail } from '@/lib/admin-identity'
import { hasPlanScope } from '@/lib/plan-gate'
import { resolveTenantId } from '@/lib/tenant-context'
import { issueStaffToken, setStaffCookie } from '@/lib/staff-session'

export const dynamic = 'force-dynamic'

// Google sign-in for the staff capture form. The verified Google email must belong to an active
// admin of THIS store whose role + plan allow customer notes; otherwise it is refused like OTP.
export async function POST(request: NextRequest) {
  try {
    const { idToken, accessToken } = await request.json().catch(() => ({}))
    const identity = await verifyGoogle({ idToken, accessToken })
    if (!identity?.email) return NextResponse.json({ error: 'Invalid Google token' }, { status: 401 })

    const admin = await resolveAdminByEmail(identity.email)
    if (!admin) return NextResponse.json({ error: 'No admin account found for this Google email.' }, { status: 404 })
    if (!(await hasPlanScope(admin.role, admin.scopes, 'customers:write'))) {
      return NextResponse.json({ error: 'This account cannot add customer notes.' }, { status: 403 })
    }
    const tenantId = await resolveTenantId()
    const name = [admin.first_name, admin.last_name].filter(Boolean).join(' ') || identity.name || null
    const token = await issueStaffToken({ adminId: admin.id, tenantId, email: admin.email, name })
    return setStaffCookie(NextResponse.json({ ok: true, name }), token)
  } catch {
    return NextResponse.json({ error: 'Sign-in failed' }, { status: 500 })
  }
}
