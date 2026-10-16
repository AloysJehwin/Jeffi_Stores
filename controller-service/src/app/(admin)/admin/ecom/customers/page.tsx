import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { isPlatformAdmin } from '@/lib/auth/scopes'
import { listTenants, tenantSummary, planMix, hasService } from '@/lib/tenant-registry'
import { EcomHero, PlanMixChart, EcomFilters, StatusPill } from '@/components/admin/ecom/EcomUI'
import PurgeCustomerButton from '@/components/admin/ecom/PurgeCustomerButton'
import EcomCustomersMobileList from './_components/EcomCustomersMobileList'

export const dynamic = 'force-dynamic'

type SP = { [k: string]: string | string[] | undefined }
const one = (sp: SP, k: string) => (Array.isArray(sp[k]) ? (sp[k] as string[])[0] : (sp[k] as string | undefined))

export default async function EcomCustomersPage({ searchParams }: { searchParams: Promise<SP> }) {
  const h = await headers()
  const role = h.get('x-user-role') || ''
  if (!isPlatformAdmin(role)) redirect('/admin')

  const sp = await searchParams
  const filters = { status: one(sp, 'status'), plan: one(sp, 'plan'), q: one(sp, 'q') }
  const [tenants, summary, mix] = await Promise.all([listTenants(filters), tenantSummary(), planMix()])

  return (
    <div className="p-6 w-full">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Customers</h1>
        <p className="text-sm text-foreground-muted mt-1">Stores and API (Messaging / Documents) workspaces</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 mb-6">
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

      <div className="md:hidden">
        <EcomCustomersMobileList tenants={tenants} />
      </div>

      <div className="hidden md:block rounded-xl border border-border-default overflow-hidden bg-surface-elevated">
        <table className="w-full text-sm">
          <thead className="bg-surface-secondary text-foreground-muted">
            <tr>
              <th className="text-left px-4 py-3 font-medium">Customer</th>
              <th className="text-left px-4 py-3 font-medium">Subdomain</th>
              <th className="text-left px-4 py-3 font-medium">Plan</th>
              <th className="text-left px-4 py-3 font-medium">Price</th>
              <th className="text-left px-4 py-3 font-medium">Status</th>
              <th className="text-left px-4 py-3 font-medium">Created</th>
              <th className="text-right px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-default">
            {tenants.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-foreground-muted">
                  No tenants match.
                </td>
              </tr>
            )}
            {tenants.map(t => (
              <tr key={t.id} className="hover:bg-surface-secondary cursor-pointer">
                <td className="px-4 py-3 font-medium text-foreground">
                  <Link href={`/admin/ecom/customers/${t.id}/view?tab=overview`} className="hover:text-accent-600">
                    {t.display_name}
                  </Link>
                </td>
                {hasService(t, 'store') ? (
                  <>
                    <td className="px-4 py-3 text-foreground-secondary">{t.slug}.jeffistores.in</td>
                    <td className="px-4 py-3 text-foreground-secondary capitalize">{t.plan || '—'}</td>
                    <td className="px-4 py-3 text-foreground-secondary">
                      {t.monthly_price_inr ? '₹' + Number(t.monthly_price_inr).toLocaleString('en-IN') : '—'}
                      {t.daily_payout ? ' +daily' : ''}
                    </td>
                  </>
                ) : (
                  <td colSpan={3} className="px-4 py-3">
                    <span className="rounded-full bg-sky-100 dark:bg-sky-900/30 px-2 py-0.5 text-xs font-medium text-sky-700 dark:text-sky-300">API workspace</span>
                    <span className="ml-2 text-xs text-foreground-muted">{(t.service_types ?? []).filter(x => x !== 'store').map(x => (x === 'messaging' ? 'Messaging' : 'Documents')).join(' + ')} · pay as you go</span>
                    {t.store_request && <span className="ml-2 rounded-full bg-amber-100 dark:bg-amber-900/30 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300">Store upgrade</span>}
                  </td>
                )}
                <td className="px-4 py-3">
                  <StatusPill status={t.status} />
                </td>
                <td className="px-4 py-3 text-foreground-muted">
                  {new Date(t.created_at).toLocaleDateString('en-IN')}
                </td>
                <td className="px-4 py-3 text-right">
                  {hasService(t, 'store') && ['terminated', 'deprovisioned', 'suspended'].includes(t.status) && (
                    <PurgeCustomerButton tenantId={t.id} slug={t.slug} />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
