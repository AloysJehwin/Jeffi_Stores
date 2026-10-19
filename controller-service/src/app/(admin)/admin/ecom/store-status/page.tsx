import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Suspense } from 'react'
import { PageHeader } from '@/components/admin/kit/layout'
import { isPlatformAdmin } from '@/lib/auth/scopes'
import { listTenants, tenantSummary } from '@/lib/tenant-registry'
import { EcomHero, EcomFilters } from '@/components/admin/ecom/EcomUI'
import EcomTabs, { ecomTab } from '../_components/EcomTabs'
import EcomStoreStatusOverview from './_components/EcomStoreStatusOverview'

export const dynamic = 'force-dynamic'

type SP = { [k: string]: string | string[] | undefined }
const one = (sp: SP, k: string) => (Array.isArray(sp[k]) ? (sp[k] as string[])[0] : (sp[k] as string | undefined))

const DOT: Record<string, string> = {
  active: 'bg-green-500',
  provisioning: 'bg-amber-500',
  suspended: 'bg-red-500',
  terminated: 'bg-foreground-muted',
}

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
  const [tenants, summary] = await Promise.all([
    listTenants({ status: one(sp, 'status'), plan: one(sp, 'plan'), q: one(sp, 'q'), product: 'store' }),
    tenantSummary(),
  ])
  const provisioning = tenants.filter(t => t.status === 'provisioning').length
  const suspended = tenants.filter(t => t.status === 'suspended').length

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <PageHeader title="Store Status" description={'Live status of each tenant store'} />
      <EcomTabs base="/admin/ecom/store-status" active="list" listLabel="All stores" />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <EcomHero
          label="Fleet health"
          value={`${summary.active} / ${summary.total} active`}
          tiles={[
            { value: summary.active, label: 'Active' },
            { value: provisioning, label: 'Provisioning' },
            { value: suspended, label: 'Suspended' },
          ]}
        />
        <div className="bg-surface-elevated rounded-xl border border-border-default p-4 sm:p-5 lg:h-56 flex items-center justify-center">
          <p className="text-sm text-foreground-muted text-center">
            Uptime &amp; last-deploy status wire in once the tenant fleet + /api/ready probes are live.
          </p>
        </div>
      </div>

      <EcomFilters />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {tenants.length === 0 && <p className="text-foreground-muted">No tenants match.</p>}
        {tenants.map(t => (
          <Link
            key={t.id}
            href={`/admin/ecom/store-status/${t.id}/view`}
            className="rounded-xl border border-border-default p-4 bg-surface-elevated hover:border-accent-400 transition-colors"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-foreground min-w-0 truncate">{t.display_name}</span>
              <span className="shrink-0 flex items-center gap-1.5 text-xs text-foreground-muted">
                <span className={`w-2 h-2 rounded-full ${DOT[t.status] || DOT.terminated}`} />
                {t.status}
              </span>
            </div>
            <div className="text-xs text-foreground-muted mt-1 break-all">{t.slug}.jeffistores.in</div>
            <div className="text-xs text-foreground-muted mt-2 capitalize">Plan: {t.plan || '—'}</div>
          </Link>
        ))}
      </div>
    </div>
  )
}
