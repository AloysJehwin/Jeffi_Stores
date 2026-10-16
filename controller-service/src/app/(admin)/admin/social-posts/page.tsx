import { headers } from 'next/headers'
import { hasScope } from '@/lib/auth/scopes'
import SocialPostsClient from './SocialPostsClient'
import AdminIntegrationsPopup from '@/components/admin/AdminIntegrationsPopup'
import { resolveTenantId } from '@/lib/tenancy/tenant-context'
import { getTenantSocialAccounts } from '@/lib/tenant-registry'
import { oauthProviderInfo } from '@/lib/integrations/oauth'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function SocialPostsPage() {
  const h = await headers()
  const role = h.get('x-user-role') || ''
  const scopes: string[] = JSON.parse(h.get('x-user-scopes') || '[]')
  const canWrite = hasScope(role, scopes, 'social:write')
  const canApprove = hasScope(role, scopes, 'social:approve')

  const tenantId = await resolveTenantId()
  const socialAccounts = tenantId && canWrite ? await getTenantSocialAccounts(tenantId) : []

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-secondary-500 dark:text-foreground">Social</h1>
          <p className="text-sm text-foreground-secondary mt-0.5">Plan, publish and measure posts across Facebook, Instagram, Business Profile, YouTube, Pinterest, LinkedIn and X</p>
        </div>
        {tenantId && canWrite && (
          <AdminIntegrationsPopup
            scope="social"
            integrations={[]}
            socialAccounts={socialAccounts.flatMap(s =>
              s.provider === 'facebook' || s.provider === 'instagram'
                ? [{ provider: s.provider, page_name: s.page_name, page_id: s.page_id, status: s.status }]
                : []
            )}
            oauth={{ meta: oauthProviderInfo('meta') }}
          />
        )}
      </div>
      <SocialPostsClient canWrite={canWrite} canApprove={canApprove} />
    </div>
  )
}
