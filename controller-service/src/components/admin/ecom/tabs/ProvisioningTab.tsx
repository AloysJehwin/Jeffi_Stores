import type { TenantDetail } from '@/lib/tenant-registry'
import ProvisioningLogsClient from '../ProvisioningLogsClient'

export default function ProvisioningTab({ tenant }: { tenant: TenantDetail }) {
  return <ProvisioningLogsClient tenantId={tenant.id} />
}
