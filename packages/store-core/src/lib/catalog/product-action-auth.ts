import { getAdminSession } from '@/lib/auth/admin-auth'
import { hasScope } from '@/lib/auth/scopes'

/** Server-action guard: an error message when the caller may not write products, else null. */
export async function productsWriteError(): Promise<string | null> {
  const session = await getAdminSession()
  if (!session) return 'Your admin session has expired. Sign in again, then retry.'
  if (!hasScope(session.role, session.scopes, 'products:write'))
    return 'You do not have permission to create or edit products.'
  return null
}
