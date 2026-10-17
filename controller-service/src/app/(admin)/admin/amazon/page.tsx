import AmazonConsole from './_components/AmazonConsole'
import { PageHeader } from '@/components/admin/kit/layout'
import AdminIntegrationsPopup from '@/components/admin/AdminIntegrationsPopup'
import { credentialOwnerId } from '@/lib/integrations/owner'
import { listIntegrationCredentials } from '@/lib/tenant-registry'
import { oauthProviderInfo } from '@/lib/integrations/oauth'
import { amazonConfigured } from '@/lib/amazon/client'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function AmazonPage() {
  // Stores and the flagship connect through the same gear; the flagship's creds sit under the platform id.
  const integrations = await listIntegrationCredentials(await credentialOwnerId())
  const connected = await amazonConfigured()
  return (
    <div className="p-4 sm:p-6 space-y-5">
      <PageHeader
        title="Amazon"
        description="Listing health, Buy Box, fees and margin, and repricing for your Amazon.in listings"
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
      <AmazonConsole connected={connected} />
    </div>
  )
}
