import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { isPlatformAdmin } from '@/lib/scopes'
import { listTenants, billingSummary } from '@/lib/tenant-registry'
import { EcomHero, EcomFilters, StatusPill } from '@/components/admin/ecom/EcomUI'

export const dynamic = 'force-dynamic'

type SP = { [k: string]: string | string[] | undefined }
const one = (sp: SP, k: string) => (Array.isArray(sp[k]) ? (sp[k] as string[])[0] : (sp[k] as string | undefined))

export default async function EcomBillingPage({ searchParams }: { searchParams: Promise<SP> }) {
  const h = await headers()
  const role = h.get('x-user-role') || ''
  if (!isPlatformAdmin(role)) redirect('/admin')

  const sp = await searchParams
  const [tenants, summary] = await Promise.all([
    listTenants({ status: one(sp, 'status'), plan: one(sp, 'plan'), q: one(sp, 'q') }),
    billingSummary(),
  ])

  return (
    <div className="p-6 w-full">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Billing</h1>
        <p className="text-sm text-foreground-muted mt-1">
          Tenant transactions, splits &amp; settlement — click a store for detail
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 mb-6">
        <EcomHero
          label="Platform Revenue (30d commission)"
          value={`₹${summary.commission30d.toLocaleString('en-IN')}`}
          tiles={[
            { value: `₹${(summary.mrr / 1000).toFixed(0)}k`, label: 'MRR' },
            { value: `₹${(summary.gmv30d / 1000).toFixed(0)}k`, label: 'GMV 30d' },
            { value: summary.payingTenants, label: 'Paying' },
          ]}
        />
        <div className="bg-surface-elevated rounded-lg border border-border-default p-4 sm:p-6 lg:h-56 flex flex-col justify-center">
          <p className="font-semibold text-foreground mb-2">How settlement works</p>
          <p className="text-sm text-foreground-muted">
            Each order is split at payment via Razorpay Route: the seller&apos;s share to their linked account, your
            commission + the subscription + any Delhivery corrections netted into their settlement balance. COD is
            remitted separately. Click a store to see its ledger.
          </p>
        </div>
      </div>

      <EcomFilters />

      <div className="rounded-xl border border-border-default overflow-hidden bg-surface-elevated">
        <table className="w-full text-sm">
          <thead className="bg-surface-secondary text-foreground-muted">
            <tr>
              <th className="text-left px-4 py-3 font-medium">Store</th>
              <th className="text-left px-4 py-3 font-medium">Plan</th>
              <th className="text-left px-4 py-3 font-medium">Monthly</th>
              <th className="text-left px-4 py-3 font-medium">Payout</th>
              <th className="text-left px-4 py-3 font-medium">Status</th>
              <th className="text-right px-4 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-default">
            {tenants.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-foreground-muted">
                  No tenants match.
                </td>
              </tr>
            )}
            {tenants.map(t => (
              <tr key={t.id} className="hover:bg-surface-secondary">
                <td className="px-4 py-3 font-medium text-foreground">
                  <Link href={`/admin/ecom/billing/${t.id}`} className="hover:text-accent-600">
                    {t.display_name}
                  </Link>
                </td>
                <td className="px-4 py-3 text-foreground-secondary capitalize">{t.plan || '—'}</td>
                <td className="px-4 py-3 text-foreground-secondary">
                  {t.monthly_price_inr ? '₹' + Number(t.monthly_price_inr).toLocaleString('en-IN') : '—'}
                </td>
                <td className="px-4 py-3 text-foreground-secondary">{t.daily_payout ? 'Daily (+5%)' : 'Weekly'}</td>
                <td className="px-4 py-3">
                  <StatusPill status={t.status} />
                </td>
                <td className="px-4 py-3 text-right">
                  <Link
                    href={`/admin/ecom/billing/${t.id}`}
                    className="text-accent-600 dark:text-accent-400 hover:underline"
                  >
                    View →
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
