import { NextRequest, NextResponse } from 'next/server'
import { verifyGoogle } from '@/lib/shared/google-verify'
import { issueOwnerSession, setOwnerCookie } from '@/lib/auth/owner-session'
import { extractSessionSignals } from '@/lib/auth/session-signals-request'

// Ecom OWNER Google sign-in/up. Reuses the shared Google token verification, then
// upserts the owner + issues an owner session. body: { idToken } or { accessToken }.
export async function POST(request: NextRequest) {
  try {
    const { idToken, accessToken } = await request.json()
    const identity = await verifyGoogle({ idToken, accessToken })
    if (!identity) return NextResponse.json({ error: 'Invalid Google token' }, { status: 401 })

    const name = identity.name || [identity.given_name, identity.family_name].filter(Boolean).join(' ') || null
    const signals = extractSessionSignals(request)
    const { sid, owner } = await issueOwnerSession({ email: identity.email, name, signals })

    const res = NextResponse.json({
      message: 'Signed in',
      owner: { id: owner.id, email: owner.email, name: owner.name },
    })
    return setOwnerCookie(res, sid)
  } catch {
    return NextResponse.json({ error: 'Google sign-in failed' }, { status: 500 })
  }
}
