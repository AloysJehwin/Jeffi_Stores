import { cookies } from 'next/headers'
import { verifyToken, type JWTPayload } from '@/lib/jwt'

// Canonical admin-session resolver for admin server components (layout.tsx + the ~20
// page.tsx files that read admin_token directly). The cookie value is the opaque session
// id; verifyToken now resolves it against the server-side session (revoked/idle/expiry),
// so no separate validateSession call is needed.
export async function getAdminSession(): Promise<JWTPayload | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get('admin_token')
  if (!token) return null
  try {
    return await verifyToken(token.value)
  } catch {
    return null
  }
}
