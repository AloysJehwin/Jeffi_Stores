import { cookies } from 'next/headers'
import { verifyToken } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import AdminAuditClient from './AdminAuditClient'
import AccessDenied from '@/components/admin/AccessDenied'
import { adminCookieName } from '@/lib/auth/admin-cookie'

export default async function AdminAuditPage() {
  const cookieStore = await cookies()
  const token = cookieStore.get(await adminCookieName())
  let role = ''
  let scopes: string[] = []
  try {
    if (token) {
      const payload = await verifyToken(token.value)
      role = payload?.role || ''
      scopes = payload?.scopes || []
    }
  } catch {}

  if (!hasScope(role, scopes, 'audit:read')) {
    return <AccessDenied scopeKey="audit" scopeLabel="Audit Log" />
  }

  const canViewReplication = hasScope(role, scopes, 'replication:read')

  return <AdminAuditClient canViewReplication={canViewReplication} />
}
