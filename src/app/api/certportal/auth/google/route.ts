import { NextRequest, NextResponse } from 'next/server'
import { verifyGoogle } from '@/lib/google-verify'
import { issuePortalToken, setPortalCookie } from '@/lib/portal-session'

// certificate.jeffistores.in Google sign-in. Any verified Google (Gmail) account may sign in; the
// portal then shows only the certificates issued to that exact verified email. Signing in reveals
// nothing on its own — an account with no matching certs sees an empty list.
export async function POST(request: NextRequest) {
  try {
    const { idToken, accessToken } = await request.json()
    const identity = await verifyGoogle({ idToken, accessToken })
    if (!identity?.email) return NextResponse.json({ error: 'Invalid Google token' }, { status: 401 })

    const name = identity.name || [identity.given_name, identity.family_name].filter(Boolean).join(' ') || null
    const token = await issuePortalToken(identity.email, name)

    const res = NextResponse.json({ email: identity.email.toLowerCase(), name })
    return setPortalCookie(res, token)
  } catch {
    return NextResponse.json({ error: 'Sign-in failed' }, { status: 500 })
  }
}
