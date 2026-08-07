import { cookies } from 'next/headers'
import { verifyToken, type JWTPayload } from '@/lib/jwt'
import { validateSession } from '@/lib/auth-sessions'

// Canonical admin-session resolver for admin server components (layout.tsx + the ~20
// page.tsx files that read admin_token directly). Verifies the JWT signature AND the
// server-side session (revoked / idle / absolute expiry). Runs on the Node runtime, so
// the pg-backed validateSession is available here (unlike the Edge middleware).
// STRICT: a token without a sid (pre-revocable-sessions) is rejected → forced re-login.
export async function getAdminSession(): Promise<JWTPayload | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get('admin_token')
  if (!token) return null
  try {
    const payload = await verifyToken(token.value)
    if (!payload) return null
    const sid = (payload as any).sid
    if (typeof sid !== 'string' || !sid) return null
    if (!(await validateSession(sid, 'admin'))) return null
    return payload
  } catch {
    return null
  }
}
