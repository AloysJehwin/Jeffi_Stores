import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { assignableScopes, hasScope } from '@/lib/auth/scopes'
import { assignableScopeKeys } from '@/lib/auth/scopes-server'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'
import { publicApiOrigin } from '@/lib/auth/api-tokens'
import AddServiceAccountForm from './AddServiceAccountForm'

export default async function AddServiceAccountPage() {
  const h = await headers()
  const role = h.get('x-user-role') || ''
  let scopes: string[] = []
  try {
    scopes = JSON.parse(h.get('x-user-scopes') || '[]')
  } catch {}
  const host = await getHost()
  if (!hasScope(role, scopes, 'service_accounts:write')) redirect(ap('/admin/settings?tab=service-accounts', host))

  // What the plan sells, never control-plane scopes, and only what the creator holds themselves.
  const sellable = new Set(await assignableScopeKeys(h.get('x-tenant-id')))
  const allowedKeys = assignableScopes(false)
    .map(s => s.key)
    .filter(k => sellable.has(k) && hasScope(role, scopes, k))

  return <AddServiceAccountForm allowedKeys={allowedKeys} host={host} publicOrigin={publicApiOrigin(host, h.get('x-tenant-slug'))} />
}
