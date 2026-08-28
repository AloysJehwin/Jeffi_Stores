import { headers } from 'next/headers'
import { redirect, notFound } from 'next/navigation'
import { isPlatformAdmin } from '@/lib/scopes'
import { getTenant, getProvisioningJob, listCustomDomains } from '@/lib/tenant-registry'
import { getTenantMigrationRuns } from '@/lib/tenant-migrations'
import TenantObjectHeader from '@/components/admin/ecom/TenantObjectHeader'
import InfrastructureTab from '@/components/admin/ecom/tabs/InfrastructureTab'

export const dynamic = 'force-dynamic'

/**
 * Infrastructure object page. Shares its body with the Infrastructure tab on the customer
 * page — same component, two entry points — so the two can never drift apart.
 */
export default async function InstanceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const h = await headers()
  const role = h.get('x-user-role') || ''
  if (!isPlatformAdmin(role)) redirect('/admin')

  const { id } = await params
  const t = await getTenant(id)
  if (!t) notFound()

  const [job, domains, migrations] = await Promise.all([
    getProvisioningJob(id).catch(() => null),
    listCustomDomains(id).catch(() => []),
    getTenantMigrationRuns(id).catch(() => []),
  ])

  return (
    <div className="p-6 w-full max-w-full min-w-0 overflow-x-hidden">
      <TenantObjectHeader
        tenant={t}
        backHref="/admin/ecom/instances"
        backLabel="Instances"
        job={job}
        related={[
          { href: `/admin/ecom/customers/${t.id}`, label: 'Store' },
          { href: `/admin/ecom/customers/${t.id}?tab=provisioning`, label: 'Provisioning' },
          { href: `/admin/ecom/store-status/${t.id}`, label: 'Status' },
        ]}
      />

      <InfrastructureTab
        tenant={t}
        job={job}
        domains={domains}
        migrations={migrations}
        currentSha={process.env.GIT_SHA || null}
      />
    </div>
  )
}
