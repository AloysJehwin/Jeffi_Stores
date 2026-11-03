import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { PageHeader } from '@/components/admin/kit/layout'
import { isPlatformAdmin } from '@/lib/auth/scopes'
import { planSlugs } from '@/lib/tenant-registry'
import { loadEcomRows } from '@controller/lib/ecom/rows'
import { EcomHero, EcomStatCard, EcomFilters } from '@controller/components/admin/ecom/EcomUI'
import { FLEET_UNKNOWN, inr } from '@controller/components/admin/ecom/cells'
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
        <PageHeader title="Instances" description="What each store runs and what it costs" />
        <EcomTabs base="/admin/ecom/instances" active="overview" listLabel="All instances" />
        <Suspense>
          <EcomInstancesOverview />
        </Suspense>
      </div>
    )
  const filters = { status: one(sp, 'status'), plan: one(sp, 'plan'), q: one(sp, 'q'), product: 'store' as const }
  const [{ rows, fleet, totals }, plans] = await Promise.all([loadEcomRows(filters), planSlugs()])
  const pool = fleet?.pool
  const pods = totals.podsTotal == null ? '—' : `${totals.podsReady}/${totals.podsTotal}`

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <PageHeader title="Instances" description="What each store runs and what it costs" />
      <EcomTabs base="/admin/ecom/instances" active="list" listLabel="All instances" />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <EcomHero
          label="Servers running"
          value={String(totals.serversRunning ?? '—')}
          note={fleet ? 'Dedicated EC2 servers of the stores listed' : FLEET_UNKNOWN}
          tiles={[
            { value: pods, label: 'Pods ready' },
            { value: inr(totals.awsMonth), label: 'AWS cost/mo' },
            { value: inr(totals.marginMonth), label: 'Margin/mo' },
            { value: totals.total, label: 'Stores' },
          ]}
        />
        <EcomStatCard
          title="Shared pool"
          note={pool ? undefined : FLEET_UNKNOWN}
          rows={[
            { label: 'Pool nodes ready', value: pool ? `${pool.readyNodes}/${pool.nodes}` : '—' },
            { label: 'Stores on the pool', value: pool ? `${pool.stores} of ${pool.capacity}` : '—', tone: pool && pool.stores >= pool.capacity ? 'text-amber-600 dark:text-amber-400' : undefined },
            { label: 'Core + pool servers', value: pool ? pool.servers.length : '—' },
          ]}
        />
      </div>

      <EcomFilters plans={plans} />

      <EcomInstancesTable rows={rows} fleetKnown={fleet !== null} />
    </div>
  )
}
