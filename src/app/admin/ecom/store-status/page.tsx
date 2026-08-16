import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { hasScope } from '@/lib/scopes'
import { listTenants, tenantSummary } from '@/lib/tenant-registry'
import { EcomHero, EcomFilters } from '@/components/admin/ecom/EcomUI'

export const dynamic = 'force-dynamic'

type SP = { [k: string]: string | string[] | undefined }
const one = (sp: SP, k: string) => (Array.isArray(sp[k]) ? (sp[k] as string[])[0] : (sp[k] as string | undefined))

const DOT: Record<string, string> = {
  active: 'bg-green-500', provisioning: 'bg-amber-500', suspended: 'bg-red-500', terminated: 'bg-foreground-muted',
}

export default async function EcomStoreStatusPage({ searchParams }: { searchParams: Promise<SP> }) {
  const h = await headers()
  const role = h.get('x-user-role') || ''
  const scopes = (h.get('x-user-scopes') || '').split(',').filter(Boolean)
  if (role !== 'super_admin' && !hasScope(role, scopes, 'ecom_customers:read')) redirect('/admin')

  const sp = await searchParams
  const [tenants, summary] = await Promise.all([
    listTenants({ status: one(sp, 'status'), plan: one(sp, 'plan'), q: one(sp, 'q') }),
    tenantSummary(),
  ])
  const provisioning = tenants.filter((t) => t.status === 'provisioning').length
  const suspended = tenants.filter((t) => t.status === 'suspended').length

  return (
    <div className="p-6 w-full">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Store Status</h1>
        <p className="text-sm text-foreground-muted mt-1">Live status of each tenant store</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 mb-6">
        <EcomHero
          label="Fleet health"
          value={`${summary.active} / ${summary.total} active`}
          tiles={[
            { value: summary.active, label: 'Active' },
            { value: provisioning, label: 'Provisioning' },
            { value: suspended, label: 'Suspended' },
          ]}
        />
        <div className="bg-surface-elevated rounded-lg border border-border-default p-4 sm:p-6 lg:h-56 flex items-center justify-center">
          <p className="text-sm text-foreground-muted text-center">Uptime &amp; last-deploy status wire in once the tenant fleet + /api/ready probes are live.</p>
        </div>
      </div>

      <EcomFilters />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {tenants.length === 0 && <p className="text-foreground-muted">No tenants match.</p>}
        {tenants.map((t) => (
          <Link key={t.id} href={`/admin/ecom/customers/${t.id}`}
            className="rounded-xl border border-border-default p-4 bg-surface-elevated hover:border-accent-400 transition-colors">
            <div className="flex items-center justify-between">
              <span className="font-medium text-foreground">{t.display_name}</span>
              <span className="flex items-center gap-1.5 text-xs text-foreground-muted">
                <span className={`w-2 h-2 rounded-full ${DOT[t.status] || DOT.terminated}`} />
                {t.status}
              </span>
            </div>
            <div className="text-xs text-foreground-muted mt-1">{t.slug}.jeffistores.in</div>
            <div className="text-xs text-foreground-muted mt-2 capitalize">Plan: {t.plan || '—'}</div>
          </Link>
        ))}
      </div>
    </div>
  )
}
