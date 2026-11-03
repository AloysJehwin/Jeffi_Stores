import { getTenantOwners } from '@/lib/tenant-registry'
import { loadTenantDetail } from '@controller/lib/ecom/detail'
import TenantObjectHeader from '@controller/components/admin/ecom/TenantObjectHeader'
import { ApiOverview, Surfaces } from '@controller/components/admin/ecom/tabs/OverviewTab'
import HealthSummary from '@controller/components/admin/ecom/detail/HealthSummary'
import RunningNow from '@controller/components/admin/ecom/detail/RunningNow'
import ProvisioningLogsClient from '@controller/components/admin/ecom/ProvisioningLogsClient'

export const dynamic = 'force-dynamic'

/** Store-status detail page: is it healthy, what runs, and the provisioning timeline. */
export default async function StoreStatusDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const d = await loadTenantDetail(id)

  return (
    <div className="p-4 sm:p-6 space-y-5 w-full max-w-full min-w-0 overflow-x-hidden">
      <TenantObjectHeader d={d} back={{ href: '/admin/ecom/store-status', label: 'Store Status' }} section="status" />

      {d.isStore ? (
        <>
          <HealthSummary d={d} />
          <RunningNow d={d} />
          <Surfaces t={d.t} />
          <section className="space-y-3 min-w-0">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground">Provisioning timeline</h2>
            <ProvisioningLogsClient tenantId={d.t.id} />
          </section>
        </>
      ) : (
        <ApiOverview tenant={d.t} owners={await getTenantOwners(id).catch(() => [])} approvals={d.approvals} />
      )}
    </div>
  )
}
