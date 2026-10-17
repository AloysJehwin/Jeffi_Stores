import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { hasScope } from '@/lib/auth/scopes'
import { settingsHubRedirect } from '@/lib/admin/settings-hub'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'
import ServiceAccountsPanel from './_components/ServiceAccountsPanel'

// Now a Settings hub tab. Admins without settings:read cannot open the hub, so they keep this route.
export default async function ServiceAccountsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const h = await headers()
  const role = h.get('x-user-role') || ''
  let scopes: string[] = []
  try {
    scopes = JSON.parse(h.get('x-user-scopes') || '[]')
  } catch {}
  if (hasScope(role, scopes, 'settings:read')) redirect(ap(settingsHubRedirect('service-accounts', await searchParams), await getHost()))
  return <ServiceAccountsPanel />
}
