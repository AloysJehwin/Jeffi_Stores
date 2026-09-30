import MerchantSyncClient from './_components/MerchantSyncClient'
import AdminIntegrationsPopup from '@/components/admin/AdminIntegrationsPopup'
import { resolveTenantId } from '@/lib/tenancy/tenant-context'
import { listIntegrationCredentials } from '@/lib/tenant-registry'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function MerchantSyncPage() {
  const tenantId = await resolveTenantId()
  const integrations = tenantId ? await listIntegrationCredentials(tenantId) : []

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Merchant Sync</h1>
          <p className="text-sm text-foreground-secondary mt-1">
            Manage and inspect the product feeds pushed to online marketplaces.
          </p>
        </div>
        {tenantId && <AdminIntegrationsPopup scope="merchant" integrations={integrations} socialAccounts={[]} />}
      </div>

      <MerchantSyncClient />
    </div>
  )
}
