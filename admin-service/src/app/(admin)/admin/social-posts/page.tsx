import { headers } from 'next/headers'
import { hasScope } from '@/lib/auth/scopes'
import SocialPostsClient from './SocialPostsClient'
import { PageBody, PageHeader } from '@/components/admin/kit'
import AdminIntegrationsPopup from '@/components/admin/AdminIntegrationsPopup'
import { credentialOwnerId } from '@/lib/integrations/owner'
import { getTenantSocialAccounts } from '@/lib/tenant-registry'
import { metaOAuthInfo } from '@/lib/integrations/oauth'
import { missingMetaPermissions, readPendingPagePick } from '@/lib/social/meta-connect'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function SocialPostsPage() {
  const h = await headers()
  const role = h.get('x-user-role') || ''
  const scopes: string[] = JSON.parse(h.get('x-user-scopes') || '[]')
  const canWrite = hasScope(role, scopes, 'social:write')
  const canApprove = hasScope(role, scopes, 'social:approve')

  // Same Meta connect flow for stores and the flagship (whose accounts sit under the platform id).
  const ownerId = canWrite ? await credentialOwnerId() : null
  const [socialAccounts, metaOAuth, pickPending, missingPermissions] = ownerId
    ? await Promise.all([
        getTenantSocialAccounts(ownerId),
        metaOAuthInfo('meta', ownerId),
        readPendingPagePick(ownerId).then(p => !!p),
        missingMetaPermissions(ownerId).catch(() => []),
      ])
    : [[], undefined, false, []]

  return (
    <PageBody>
      <PageHeader
        title="Social"
        description="Plan, publish and measure posts across Facebook, Instagram, Business Profile, YouTube, Pinterest, LinkedIn and X"
        actions={
          canWrite && (
            <AdminIntegrationsPopup
              scope="social"
              integrations={[]}
              socialAccounts={socialAccounts.flatMap(s =>
                s.provider === 'facebook' || s.provider === 'instagram'
                  ? [{ provider: s.provider, page_name: s.page_name, page_id: s.page_id, status: s.status }]
                  : []
              )}
              oauth={{ meta: metaOAuth }}
              meta={{ pickPending, missingPermissions }}
            />
          )
        }
      />
      <SocialPostsClient canWrite={canWrite} canApprove={canApprove} />
    </PageBody>
  )
}
