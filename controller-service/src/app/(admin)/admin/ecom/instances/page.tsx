import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { PageHeader } from '@/components/admin/kit/layout'
import { isPlatformAdmin } from '@/lib/auth/scopes'
import { listTenants } from '@/lib/tenant-registry'
import { EcomFilters } from '@/components/admin/ecom/EcomUI'
import EcomTabs, { ecomTab } from '../_components/EcomTabs'
import { EcomInstancesTable } from '../_components/EcomTables'
import EcomInstancesOverview from './_components/EcomInstancesOverview'

export const dynamic = 'force-dynamic'

type SP = { [k: string]: string | string[] | undefined }
const one = (sp: SP, k: string) => (Array.isArray(sp[k]) ? (sp[k] as string[])[0] : (sp[k] as string | undefined))

export default async function EcomInstancesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const h = await headers()
  const role = h.get('x-user-role') || ''
  if (!isPlatformAdmin(role)) redirect('/admin')

  const sp = await searchParams
  const tab = ecomTab(sp)
  if (tab === 'overview')
    return (
      <div className="p-4 sm:p-6 space-y-5">
        <PageHeader title="Instances" description="Per-tenant infrastructure" />
        <EcomTabs base="/admin/ecom/instances" active="overview" listLabel="All instances" />
        <Suspense>
          <EcomInstancesOverview />
        </Suspense>
      </div>
    )
  const tenants = await listTenants({
    status: one(sp, 'status'),
    plan: one(sp, 'plan'),
    q: one(sp, 'q'),
    product: 'store',
  })
  const provisioned = tenants.filter(t => t.rds_endpoint).length

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <PageHeader title="Instances" description={`Per-tenant infrastructure, ${provisioned}/${tenants.length} provisioned`} />
      <EcomTabs base="/admin/ecom/instances" active="list" listLabel="All instances" />

      <EcomFilters />

      <EcomInstancesTable tenants={tenants} />
      <p className="text-xs text-foreground-muted">
        Live AWS health (CloudWatch CPU/connections, RDS/EC2 status) wires in with the provisioning engine.
      </p>
    </div>
  )
}
