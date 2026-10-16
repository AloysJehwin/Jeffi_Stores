import AmazonConsole from './_components/AmazonConsole'
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
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-secondary-500 dark:text-foreground">Amazon</h1>
          <p className="text-sm text-foreground-secondary mt-0.5">
            Listing health, Buy Box, fees and margin, and repricing for your Amazon.in listings
          </p>
        </div>
        <AdminIntegrationsPopup
          scope="merchant"
          integrations={integrations}
          socialAccounts={[]}
          oauth={{
            google_merchant: oauthProviderInfo('google_merchant'),
            amazon_seller: oauthProviderInfo('amazon_seller'),
          }}
        />
      </div>
      <AmazonConsole connected={connected} />
    </div>
  )
}
