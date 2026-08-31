'use server'

import { cookies} from 'next/headers'
import { redirect } from 'next/navigation'
import { ap } from '@/lib/admin-path'
import { getHost } from '@/lib/get-host'
import { verifyToken } from '@/lib/jwt'
import { revokeSession } from '@/lib/auth-sessions'
import { adminCookieName } from '@/lib/admin-cookie'

export async function logoutAction() {
  const cookieStore = await cookies()
  // Revoke the server-side session before clearing the cookie.
  const existing = cookieStore.get(await adminCookieName())?.value
  if (existing) {
    try {
      const payload = await verifyToken(existing)
      const sid = (payload as any)?.sid
      if (typeof sid === 'string' && sid) await revokeSession(sid)
    } catch { /* best-effort revoke */ }
  }
  cookieStore.delete(await adminCookieName())
  cookieStore.delete('admin_session') // Clear old session cookie too
  const host = await getHost()
  redirect(ap('/admin/login', host))
}
