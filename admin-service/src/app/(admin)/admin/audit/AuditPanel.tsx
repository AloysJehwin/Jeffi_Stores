import { cookies } from 'next/headers'
import { verifyToken } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { Suspense } from 'react'
import AdminAuditClient from './AdminAuditClient'
import AuditTabs from './AuditTabs'
import AccessDenied from '@/components/admin/AccessDenied'
import { adminCookieName } from '@/lib/auth/admin-cookie'
import SettingsHub from '@/components/admin/SettingsHub'

/** Audit log tab of the Settings hub. */
export default async function AuditPanel() {
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
    <>
      <SettingsHub active="audit" />
      <Suspense fallback={null}>
        <AuditTabs>
          <AdminAuditClient />
        </AuditTabs>
      </Suspense>
    </>
  )
}
