import { cookies } from 'next/headers'
import { verifyToken } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import AdminReplicationClient from './AdminReplicationClient'
import AccessDenied from '@/components/admin/AccessDenied'

export default async function AdminReplicationPage() {
  const cookieStore = cookies()
  const token = cookieStore.get('admin_token')
  let role = ''
  let scopes: string[] = []
  try {
    if (token) {
      const payload = await verifyToken(token.value)
      role = payload?.role || ''
      scopes = payload?.scopes || []
    }
  } catch {
    /* fall through */
  }

  if (!hasScope(role, scopes, 'replication')) {
    return <AccessDenied scopeKey="replication" scopeLabel="Replication Runs" />
  }

  return <AdminReplicationClient />
}
