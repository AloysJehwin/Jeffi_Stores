import { headers } from 'next/headers'
import { hasScope } from '@/lib/scopes'
import SocialPostsClient from './SocialPostsClient'
import AdminIntegrationsPopup from '@/components/admin/AdminIntegrationsPopup'
import { getCurrentTenantId } from '@/lib/tenant-context'
import { getTenantSocialAccounts } from '@/lib/tenant-registry'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function SocialPostsPage() {
  const h = await headers()
  const role = h.get('x-user-role') || ''
  const scopes: string[] = JSON.parse(h.get('x-user-scopes') || '[]')
  const canWrite = hasScope(role, scopes, 'products:write')

  const tenantId = getCurrentTenantId()
  const socialAccounts = tenantId ? await getTenantSocialAccounts(tenantId) : []

  return (
    <div className="p-4 sm:p-6 space-y-4">
      {tenantId && hasScope(role, scopes, 'campaigns:write') && (
        <div className="flex justify-end">
          <AdminIntegrationsPopup
            scope="social"
            integrations={[]}
            socialAccounts={socialAccounts.map((s) => ({ provider: s.provider, page_name: s.page_name, status: s.status }))}
          />
        </div>
      )}
      <SocialPostsClient canWrite={canWrite} />
    </div>
  )
}
