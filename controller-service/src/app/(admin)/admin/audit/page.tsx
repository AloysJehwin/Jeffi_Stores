import { cookies } from 'next/headers'
import { verifyToken } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { Suspense } from 'react'
import AdminAuditClient from './AdminAuditClient'
import AuditTabs from './AuditTabs'
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

  return (
    <Suspense fallback={null}>
      <AuditTabs>
        <AdminAuditClient />
      </AuditTabs>
    </Suspense>
  )
}
