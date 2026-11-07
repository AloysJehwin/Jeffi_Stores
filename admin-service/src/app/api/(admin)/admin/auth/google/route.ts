import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/shared/db'
import { issueMfaTicket } from '@/lib/auth/mfa'
import { resolveAdminByEmail, enforceCertGate } from '@/lib/auth/admin-identity'
import { logActivity } from '@/lib/shared/activity'
import { verifyGoogle } from '@/lib/shared/google-verify'

export const dynamic = 'force-dynamic'

// Layer 2 (identity) — Google sign-in for admins. Verifies the Google token, maps
// it to an ACTIVE admin (no auto-provisioning), enforces the cert gate, and issues
// the 5-min MFA ticket. Never mints admin_sid — TOTP is still required.
export async function POST(request: NextRequest) {
  try {
    const { idToken, accessToken } = await request.json().catch(() => ({}))
    if (!idToken && !accessToken) {
      return NextResponse.json({ error: 'idToken or accessToken required' }, { status: 400 })
    }

    const payload = await verifyGoogle({ idToken, accessToken })
    if (!payload) return NextResponse.json({ error: 'Invalid Google token' }, { status: 401 })

    const admin = await resolveAdminByEmail(payload.email)
    if (!admin || (admin.google_id && admin.google_id !== payload.sub)) {
      return NextResponse.json({ error: 'Not an authorized admin account' }, { status: 403 })
    }

    const certCN = request.headers.get('x-client-cert-cn') || ''
    const certSerial = request.headers.get('x-client-cert-serial') || ''
    const gate = await enforceCertGate(admin, certCN, certSerial)
    if (!gate.ok) {
      return NextResponse.json({ error: gate.error }, { status: gate.status })
    }

    // Backfill google_id on first Google login (email already matched an admin).
    if (!admin.google_id) {
      query(`UPDATE users SET google_id = $1 WHERE id = $2 AND google_id IS NULL`, [payload.sub, admin.user_id]).catch(
        () => {}
      )
    }

    const purpose = admin.mfa_enabled ? 'verify' : 'enroll'
    const ticket = await issueMfaTicket({
      adminId: admin.id,
      purpose,
      certCN: gate.certCN,
    })

    logActivity({
      userId: admin.user_id,
      kind: 'login',
      summary: 'Admin identity verified via Google',
      metadata: { provider: 'google', step: purpose },
    }).catch(() => {})

    return purpose === 'verify'
      ? NextResponse.json({ mfa_required: true, ticket })
      : NextResponse.json({ enroll_required: true, ticket })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
