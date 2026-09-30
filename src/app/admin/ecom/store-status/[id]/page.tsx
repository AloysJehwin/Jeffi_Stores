import { headers } from 'next/headers'
import { redirect, notFound } from 'next/navigation'
import { isPlatformAdmin } from '@/lib/auth/scopes'
import { getTenant, getProvisioningJob, getTenantOwners } from '@/lib/tenant-registry'
import TenantObjectHeader from '@/components/admin/ecom/TenantObjectHeader'
import OverviewTab from '@/components/admin/ecom/tabs/OverviewTab'

export const dynamic = 'force-dynamic'

/**
 * Store-status object page. Shares its body with the Overview tab on the customer page —
 * same component, two entry points — so the two can never drift apart.
 */
export default async function StoreStatusDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const h = await headers()
  const role = h.get('x-user-role') || ''
  if (!isPlatformAdmin(role)) redirect('/admin')

  const { id } = await params
  const t = await getTenant(id)
  if (!t) notFound()

  const [job, owners] = await Promise.all([
    getProvisioningJob(id).catch(() => null),
    getTenantOwners(id).catch(() => []),
  ])

  return (
    <div className="p-6 w-full max-w-full min-w-0 overflow-x-hidden">
      <TenantObjectHeader
        tenant={t}
        backHref="/admin/ecom/store-status"
        backLabel="Store Status"
        job={job}
        related={[
          { href: `/admin/ecom/customers/${t.id}`, label: 'Store' },
          { href: `/admin/ecom/customers/${t.id}?tab=provisioning`, label: 'Provisioning' },
          { href: `/admin/ecom/instances/${t.id}`, label: 'Instance' },
        ]}
      />

      <OverviewTab tenant={t} job={job} owners={owners} />
    </div>
  )
}
