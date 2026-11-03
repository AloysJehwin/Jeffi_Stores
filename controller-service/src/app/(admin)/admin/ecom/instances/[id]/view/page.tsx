import { loadInfraDetail, loadTenantDetail } from '@controller/lib/ecom/detail'
import TenantObjectHeader from '@controller/components/admin/ecom/TenantObjectHeader'
import InfrastructureTab from '@controller/components/admin/ecom/tabs/InfrastructureTab'
import { ApiOverview } from '@controller/components/admin/ecom/tabs/OverviewTab'

export const dynamic = 'force-dynamic'

/**
 * Instance detail page: servers, workloads, database, storage, cost breakdown and DNS. Shares its body with the
 * Store page's Infrastructure tab (same component, two entry points) so the two never drift apart.
 */
export default async function InstanceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const d = await loadTenantDetail(id)

  return (
    <div className="p-4 sm:p-6 space-y-5 w-full max-w-full min-w-0 overflow-x-hidden">
      <TenantObjectHeader d={d} back={{ href: '/admin/ecom/instances', label: 'Instances' }} section="instance" />
      {d.isStore ? <InfrastructureTab d={d} infra={await loadInfraDetail(d)} /> : <ApiOverview tenant={d.t} approvals={d.approvals} />}
    </div>
  )
}
