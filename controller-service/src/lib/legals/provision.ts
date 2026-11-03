import { controlPlanePool } from '@/lib/tenant-registry'
import { POLICY_VERSION } from './generate'

// The storefront now templates each store's legal pages at request time from its own
// site_settings (store-core lib/legals/store-policies.ts), so provisioning no longer writes a
// policies blob. This only records the policy version the owner accepted. Non-fatal by contract.
export async function generateTenantLegals(tenantId: string, _endpoint?: string): Promise<void> {
  await controlPlanePool()
    .query(
      `UPDATE tenant_kyc SET legals_accepted_version=COALESCE(legals_accepted_version,$2), updated_at=now() WHERE tenant_id=$1`,
      [tenantId, POLICY_VERSION]
    )
    .catch(() => {})
}
