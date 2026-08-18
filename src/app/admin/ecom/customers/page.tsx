import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { hasScope } from '@/lib/scopes'
import { listTenants, tenantSummary, planMix } from '@/lib/tenant-registry'
import { EcomHero, PlanMixChart, EcomFilters, StatusPill } from '@/components/admin/ecom/EcomUI'

export const dynamic = 'force-dynamic'

type SP = { [k: string]: string | string[] | undefined }
const one = (sp: SP, k: string) => (Array.isArray(sp[k]) ? (sp[k] as string[])[0] : (sp[k] as string | undefined))

export default async function EcomCustomersPage({ searchParams }: { searchParams: Promise<SP> }) {
  const h = await headers()
  const role = h.get('x-user-role') || ''
  const scopes = (h.get('x-user-scopes') || '').split(',').filter(Boolean)
  if (role !== 'super_admin' && !hasScope(role, scopes, 'ecom_customers:read')) redirect('/admin')

  const sp = await searchParams
  const filters = { status: one(sp, 'status'), plan: one(sp, 'plan'), q: one(sp, 'q') }
  const [tenants, summary, mix] = await Promise.all([listTenants(filters), tenantSummary(), planMix()])

  return (
    <div className="p-6 w-full">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Customers</h1>
        <p className="text-sm text-foreground-muted mt-1">Manage SaaS tenant stores</p>
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

      <div className="rounded-xl border border-border-default overflow-hidden bg-surface-elevated">
        <table className="w-full text-sm">
          <thead className="bg-surface-secondary text-foreground-muted">
            <tr>
              <th className="text-left px-4 py-3 font-medium">Store</th>
              <th className="text-left px-4 py-3 font-medium">Subdomain</th>
              <th className="text-left px-4 py-3 font-medium">Plan</th>
              <th className="text-left px-4 py-3 font-medium">Price</th>
              <th className="text-left px-4 py-3 font-medium">Status</th>
              <th className="text-left px-4 py-3 font-medium">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-default">
            {tenants.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-foreground-muted">No tenants match.</td></tr>
            )}
            {tenants.map((t) => (
              <tr key={t.id} className="hover:bg-surface-secondary cursor-pointer">
                <td className="px-4 py-3 font-medium text-foreground">
                  <Link href={`/admin/ecom/customers/${t.id}`} className="hover:text-accent-600">{t.display_name}</Link>
                </td>
                <td className="px-4 py-3 text-foreground-secondary">{t.slug}.jeffistores.in</td>
                <td className="px-4 py-3 text-foreground-secondary capitalize">{t.plan || '—'}</td>
                <td className="px-4 py-3 text-foreground-secondary">{t.monthly_price_inr ? '₹' + Number(t.monthly_price_inr).toLocaleString('en-IN') : '—'}{t.daily_payout ? ' +daily' : ''}</td>
                <td className="px-4 py-3"><StatusPill status={t.status} /></td>
                <td className="px-4 py-3 text-foreground-muted">{new Date(t.created_at).toLocaleDateString('en-IN')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
