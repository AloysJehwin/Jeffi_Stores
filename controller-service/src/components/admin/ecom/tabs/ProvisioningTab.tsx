import type { TenantDetail } from '@/lib/tenant-registry'
import { loadStoreCronJobs } from '@controller/lib/cron/store-jobs'
import ProvisioningLogsClient from '../ProvisioningLogsClient'
import ScheduledJobs from '../detail/ScheduledJobs'

export default async function ProvisioningTab({ tenant }: { tenant: TenantDetail }) {
  const jobs = await loadStoreCronJobs(tenant.id, tenant.slug).catch(() => [])
  return (
    <div className="space-y-5 sm:space-y-6 min-w-0">
      <ProvisioningLogsClient tenantId={tenant.id} />
      <ScheduledJobs jobs={jobs} />
    </div>
  )
}
