import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { PageHeader } from '@/components/admin/kit/layout'
import { isPlatformAdmin } from '@/lib/auth/scopes'
import { planSlugs } from '@/lib/tenant-registry'
import { loadEcomRows } from '@controller/lib/ecom/rows'
import { EcomHero, EcomStatCard, EcomFilters } from '@controller/components/admin/ecom/EcomUI'
import { FLEET_UNKNOWN } from '@controller/components/admin/ecom/cells'
import EcomTabs, { ecomTab } from '../_components/EcomTabs'
import { EcomStoreStatusTable } from '../_components/EcomTables'
import EcomStoreStatusOverview from './_components/EcomStoreStatusOverview'

export const dynamic = 'force-dynamic'

type SP = { [k: string]: string | string[] | undefined }
const one = (sp: SP, k: string) => (Array.isArray(sp[k]) ? (sp[k] as string[])[0] : (sp[k] as string | undefined))

export default async function EcomStoreStatusPage({ searchParams }: { searchParams: Promise<SP> }) {
  const h = await headers()
  const role = h.get('x-user-role') || ''
  if (!isPlatformAdmin(role)) redirect('/admin')

  const sp = await searchParams
  const tab = ecomTab(sp)
  if (tab === 'overview')
    return (
      <div className="p-4 sm:p-6 space-y-5">
        <PageHeader title="Store Status" description={'Live status of each tenant store'} />
        <EcomTabs base="/admin/ecom/store-status" active="overview" listLabel="All stores" />
        <Suspense>
          <EcomStoreStatusOverview />
        </Suspense>
      </div>
    )
  const filters = { status: one(sp, 'status'), plan: one(sp, 'plan'), q: one(sp, 'q'), product: 'store' as const }
  const [{ rows, fleet, totals }, plans] = await Promise.all([loadEcomRows(filters), planSlugs()])
  const count = (f: (r: (typeof rows)[number]) => boolean) => rows.filter(f).length
  const amber = (n: number) => (n ? 'text-amber-600 dark:text-amber-400' : undefined)
  // Active stores whose pods aren't all Ready, or that run none (only knowable in-cluster).
  const degraded = fleet ? count(r => r.status === 'active' && (!r.fleet?.pods.total || r.fleet.pods.ready < r.fleet.pods.total)) : 0
  const failed = count(r => r.job_status === 'failed')

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <PageHeader title="Store Status" description={'Live status of each tenant store'} />
      <EcomTabs base="/admin/ecom/store-status" active="list" listLabel="All stores" />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <EcomHero
          label="Fleet health"
          value={`${totals.active} / ${totals.total} active`}
          tiles={[
            { value: totals.provisioning, label: 'Provisioning' },
            { value: failed, label: 'Failed jobs' },
            { value: totals.review, label: 'Needs review' },
            { value: count(r => r.status === 'suspended'), label: 'Suspended' },
          ]}
        />
        <EcomStatCard
          title="Serving"
          note={fleet ? undefined : FLEET_UNKNOWN}
          rows={[
            { label: 'Pods ready', value: totals.podsTotal == null ? '—' : `${totals.podsReady}/${totals.podsTotal}`, tone: amber((totals.podsTotal ?? 0) - (totals.podsReady ?? 0)) },
            { label: 'Active stores not fully serving', value: fleet ? degraded : '—', tone: amber(degraded) },
            { label: 'Servers running', value: totals.serversRunning ?? '—' },
            { label: 'Custom domains live', value: count(r => !!r.custom_domain) },
          ]}
        />
      </div>

      <EcomFilters plans={plans} />

      <EcomStoreStatusTable rows={rows} fleetKnown={fleet !== null} />
    </div>
  )
}
