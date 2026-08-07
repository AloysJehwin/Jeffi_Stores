import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { issueMfaTicket } from '@/lib/mfa'
import { resolveAdminByEmail, enforceCertGate } from '@/lib/admin-identity'
import { logActivity } from '@/lib/activity'

export const dynamic = 'force-dynamic'

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || ''

interface GoogleTokenPayload { sub: string; email: string; email_verified?: boolean }

async function verifyGoogleToken(idToken: string): Promise<GoogleTokenPayload | null> {
  try {
    const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`)
    if (!res.ok) return null
    const data = await res.json()
    if (!data.sub || !data.email) return null
    if (GOOGLE_CLIENT_ID) {
      const aud = Array.isArray(data.aud) ? data.aud : [data.aud]
      if (!aud.includes(GOOGLE_CLIENT_ID)) return null
    }
    // tokeninfo returns email_verified as the string "true"/"false"
    if (String(data.email_verified) === 'false') return null
    return { sub: data.sub, email: data.email, email_verified: true }
  } catch {
    return null
  }
}

async function verifyGoogleAccessToken(accessToken: string): Promise<GoogleTokenPayload | null> {
  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) return null
    const data = await res.json()
    if (!data.sub || !data.email || data.email_verified === false) return null
    return { sub: data.sub, email: data.email, email_verified: true }
  } catch {
    return null
  }
}

// Layer 2 (identity) — Google sign-in for admins. Verifies the Google token, maps
// it to an ACTIVE admin (no auto-provisioning), enforces the cert gate, and issues
// the 5-min MFA ticket. Never mints admin_sid — TOTP is still required.
export async function POST(request: NextRequest) {
  try {
    const { idToken, accessToken } = await request.json().catch(() => ({}))
    if (!idToken && !accessToken) {
      return NextResponse.json({ error: 'idToken or accessToken required' }, { status: 400 })
    }

    const payload = idToken ? await verifyGoogleToken(idToken) : await verifyGoogleAccessToken(accessToken)
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
      query(`UPDATE users SET google_id = $1 WHERE id = $2 AND google_id IS NULL`, [payload.sub, admin.user_id]).catch(() => {})
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
