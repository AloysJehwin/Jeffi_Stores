import MerchantConsole from './_components/MerchantConsole'
import { PageHeader } from '@/components/admin/kit/layout'
import AdminIntegrationsPopup from '@/components/admin/AdminIntegrationsPopup'
import { credentialOwnerId } from '@/lib/integrations/owner'
import { listIntegrationCredentials } from '@/lib/tenant-registry'
import { oauthProviderInfo } from '@/lib/integrations/oauth'
import { merchantConfigured, getMerchantId } from '@/lib/merchant/client'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function MerchantPage() {
  // Stores and the flagship connect through the same gear; the flagship's creds sit under the platform id.
  const integrations = await listIntegrationCredentials(await credentialOwnerId())
  const connected = await merchantConfigured()
  const merchantId = connected ? await getMerchantId().catch(() => null) : null

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <PageHeader
        title="Google Merchant Center"
        description={connected ? `Account ${merchantId}` : 'Free listings, Shopping ads, prices and account health for your products on Google'}
        actions={
          <AdminIntegrationsPopup
            scope="merchant"
            integrations={integrations}
            socialAccounts={[]}
            oauth={{
              google_merchant: oauthProviderInfo('google_merchant'),
              amazon_seller: oauthProviderInfo('amazon_seller'),
            }}
          />
        }
      />
      <MerchantConsole connected={connected} />
    </div>
  )
}
