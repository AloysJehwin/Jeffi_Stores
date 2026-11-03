import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { PageHeader } from '@/components/admin/kit/layout'
import { isPlatformAdmin } from '@/lib/auth/scopes'
import { planMix, planSlugs } from '@/lib/tenant-registry'
import { loadEcomRows } from '@controller/lib/ecom/rows'
import { EcomHero, PlanMixChart, EcomFilters } from '@controller/components/admin/ecom/EcomUI'
import { FLEET_UNKNOWN, inr } from '@controller/components/admin/ecom/cells'
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
  const [{ rows, fleet, totals }, mix, plans] = await Promise.all([loadEcomRows(filters), planMix(), planSlugs()])

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <PageHeader title="Customers" description={'Stores and API (Messaging / Documents) workspaces'} />
      <EcomTabs base="/admin/ecom/customers" active="list" listLabel="All customers" />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <EcomHero
          label="Monthly Recurring Revenue"
          value={inr(totals.mrr)}
          note={fleet ? undefined : FLEET_UNKNOWN}
          tiles={[
            { value: totals.total, label: 'Customers' },
            { value: totals.active, label: 'Active' },
            { value: totals.provisioning, label: 'Provisioning' },
            { value: totals.review, label: 'Needs review' },
            { value: totals.serversRunning ?? '—', label: 'Servers running' },
            { value: inr(totals.awsMonth), label: 'AWS cost/mo' },
          ]}
        />
        <PlanMixChart mix={mix} />
      </div>

      <EcomFilters plans={plans} />

      <EcomCustomersTable rows={rows} fleetKnown={fleet !== null} />
    </div>
  )
}
