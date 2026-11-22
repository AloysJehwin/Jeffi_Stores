import AmazonConsole from './_components/AmazonConsole'
import { PageHeader } from '@/components/admin/kit/layout'
import AdminIntegrationsPopup from '@/components/admin/AdminIntegrationsPopup'
import { credentialOwnerId } from '@/lib/integrations/owner'
import { listIntegrationCredentials } from '@/lib/tenant-registry'
import { storeOAuthInfo } from '@/lib/integrations/oauth'
import { amazonConfigured } from '@/lib/amazon/client'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function AmazonPage() {
  // Stores and the flagship connect through the same gear; the flagship's creds sit under the platform id.
  const owner = await credentialOwnerId()
  const integrations = await listIntegrationCredentials(owner)
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
              google_merchant: await storeOAuthInfo('google_merchant', owner),
              amazon_seller: await storeOAuthInfo('amazon_seller', owner),
            }}
          />
        }
      />
      <AmazonConsole connected={connected} />
    </div>
  )
}
