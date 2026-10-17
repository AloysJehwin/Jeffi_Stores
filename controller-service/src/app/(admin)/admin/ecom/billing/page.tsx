import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { PageHeader } from '@/components/admin/kit/layout'
import { isPlatformAdmin } from '@/lib/auth/scopes'
import { listTenants, billingSummary } from '@/lib/tenant-registry'
import { EcomHero, EcomFilters } from '@/components/admin/ecom/EcomUI'
import EcomTabs, { ecomTab } from '../_components/EcomTabs'
import { EcomBillingTable } from '../_components/EcomTables'
import EcomBillingOverview from './_components/EcomBillingOverview'

export const dynamic = 'force-dynamic'

type SP = { [k: string]: string | string[] | undefined }
const one = (sp: SP, k: string) => (Array.isArray(sp[k]) ? (sp[k] as string[])[0] : (sp[k] as string | undefined))

export default async function EcomBillingPage({ searchParams }: { searchParams: Promise<SP> }) {
  const h = await headers()
  const role = h.get('x-user-role') || ''
  if (!isPlatformAdmin(role)) redirect('/admin')

  const sp = await searchParams
  const tab = ecomTab(sp)
  if (tab === 'overview')
    return (
      <div className="p-4 sm:p-6 space-y-5">
        <PageHeader title="Billing" description={'Tenant transactions, splits & settlement. Click a store for detail.'} />
        <EcomTabs base="/admin/ecom/billing" active="overview" listLabel="All stores" />
        <Suspense>
          <EcomBillingOverview />
        </Suspense>
      </div>
    )
  const [tenants, summary] = await Promise.all([
    listTenants({ status: one(sp, 'status'), plan: one(sp, 'plan'), q: one(sp, 'q'), product: 'store' }),
    billingSummary(),
  ])

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <PageHeader title="Billing" description={'Tenant transactions, splits & settlement. Click a store for detail.'} />
      <EcomTabs base="/admin/ecom/billing" active="list" listLabel="All stores" />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <EcomHero
          label="Platform Revenue (30d commission)"
          value={`₹${summary.commission30d.toLocaleString('en-IN')}`}
          tiles={[
            { value: `₹${(summary.mrr / 1000).toFixed(0)}k`, label: 'MRR' },
            { value: `₹${(summary.gmv30d / 1000).toFixed(0)}k`, label: 'GMV 30d' },
            { value: summary.payingTenants, label: 'Paying' },
          ]}
        />
        <div className="bg-surface-elevated rounded-xl border border-border-default p-4 sm:p-5 lg:h-56 flex flex-col justify-center">
          <p className="text-sm font-semibold uppercase tracking-wide text-foreground mb-2">How settlement works</p>
          <p className="text-sm text-foreground-muted">
            Each order is split at payment via Razorpay Route: the seller&apos;s share to their linked account, your
            commission + the subscription + any Delhivery corrections netted into their settlement balance. COD is
            remitted separately. Click a store to see its ledger.
          </p>
        </div>
      </div>

      <EcomFilters />

      <EcomBillingTable tenants={tenants} />
    </div>
  )
}
