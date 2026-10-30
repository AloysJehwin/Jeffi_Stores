import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { PageHeader } from '@/components/admin/kit/layout'
import { isPlatformAdmin } from '@/lib/auth/scopes'
import { listTenants, tenantSummary, planMix } from '@/lib/tenant-registry'
import { EcomHero, PlanMixChart, EcomFilters } from '@controller/components/admin/ecom/EcomUI'
import EcomTabs, { ecomTab } from '../_components/EcomTabs'
import { EcomCustomersTable } from '../_components/EcomTables'
import EcomCustomersOverview from './_components/EcomCustomersOverview'

export const dynamic = 'force-dynamic'

type SP = { [k: string]: string | string[] | undefined }
const one = (sp: SP, k: string) => (Array.isArray(sp[k]) ? (sp[k] as string[])[0] : (sp[k] as string | undefined))

export default async function EcomCustomersPage({ searchParams }: { searchParams: Promise<SP> }) {
  const h = await headers()
  const role = h.get('x-user-role') || ''
  if (!isPlatformAdmin(role)) redirect('/admin')

  const sp = await searchParams
  const tab = ecomTab(sp)
  if (tab === 'overview')
    return (
      <div className="p-4 sm:p-6 space-y-5">
        <PageHeader title="Customers" description={'Stores and API (Messaging / Documents) workspaces'} />
        <EcomTabs base="/admin/ecom/customers" active="overview" listLabel="All customers" />
        <Suspense>
          <EcomCustomersOverview />
        </Suspense>
      </div>
    )
  const filters = { status: one(sp, 'status'), plan: one(sp, 'plan'), q: one(sp, 'q') }
  const [tenants, summary, mix] = await Promise.all([listTenants(filters), tenantSummary(), planMix()])

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <PageHeader title="Customers" description={'Stores and API (Messaging / Documents) workspaces'} />
      <EcomTabs base="/admin/ecom/customers" active="list" listLabel="All customers" />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <EcomHero
          label="Monthly Recurring Revenue"
          value={`₹${summary.mrr.toLocaleString('en-IN')}`}
          tiles={[
            { value: summary.total, label: 'Total' },
            { value: summary.active, label: 'Active' },
            { value: summary.total - summary.active, label: 'Inactive' },
            { value: mix.length, label: 'Plans' },
          ]}
        />
        <PlanMixChart mix={mix} />
      </div>

      <EcomFilters />

      <EcomCustomersTable tenants={tenants} />
    </div>
  )
}
