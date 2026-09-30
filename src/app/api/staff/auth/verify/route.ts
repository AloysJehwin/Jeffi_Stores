import { NextRequest, NextResponse } from 'next/server'
import { verifyOTP, deleteOTP } from '@/lib/auth/otp'
import { resolveAdminByEmail } from '@/lib/auth/admin-identity'
import { resolveTenantId } from '@/lib/tenancy/tenant-context'
import { issueStaffToken, setStaffCookie } from '@/lib/auth/staff-session'
import { staffOtpKey } from '@/lib/auth/staff-auth'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const { email, code } = await request.json().catch(() => ({}))
    if (!email || !code || typeof email !== 'string' || typeof code !== 'string') {
      return NextResponse.json({ error: 'Email and code are required' }, { status: 400 })
    }
    const key = staffOtpKey(email)
    const result = await verifyOTP(key, code.trim())
    if (!result.valid) return NextResponse.json({ error: result.message || 'Invalid or expired code' }, { status: 401 })
    await deleteOTP(key)

    const admin = await resolveAdminByEmail(email)
    if (!admin) return NextResponse.json({ error: 'No admin account found for this email.' }, { status: 404 })
    const tenantId = await resolveTenantId()
    const name = [admin.first_name, admin.last_name].filter(Boolean).join(' ') || null
    const token = await issueStaffToken({ adminId: admin.id, tenantId, email: admin.email, name })
    return setStaffCookie(NextResponse.json({ ok: true, name }), token)
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
