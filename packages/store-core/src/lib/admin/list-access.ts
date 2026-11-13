import { getAdminSession } from '@/lib/auth/admin-auth'
import { getScopeForPath, hasScope } from '@/lib/auth/scopes'

// A list's load-more server action can be posted from any admin page, so it checks the scope of the
// list's own page the way the middleware checks a page request.
export async function requireListAccess(path: string): Promise<void> {
  const session = await getAdminSession()
  const scope = getScopeForPath(path)
  if (!session || (scope && !hasScope(session.role, session.scopes || [], scope))) throw new Error('Insufficient permissions')
}
