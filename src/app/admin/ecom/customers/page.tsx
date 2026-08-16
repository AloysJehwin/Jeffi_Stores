import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { hasScope } from '@/lib/scopes'
import { listTenants, tenantSummary } from '@/lib/tenant-registry'

export const dynamic = 'force-dynamic'

function money(n: string | null): string {
  if (!n) return '—'
  return '₹' + Number(n).toLocaleString('en-IN')
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    active: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300',
    provisioning: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300',
    suspended: 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400',
    terminated: 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300',
  }
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${map[status] || map.terminated}`}>
      {status}
    </span>
  )
}

export default async function EcomCustomersPage() {
  const h = await headers()
  const role = h.get('x-user-role') || ''
  const scopes = (h.get('x-user-scopes') || '').split(',').filter(Boolean)
  // Platform-operator only. super_admin passes hasScope; others need ecom_customers:read.
  if (role !== 'super_admin' && !hasScope(role, scopes, 'ecom_customers:read')) {
    redirect('/admin')
  }

  const [tenants, summary] = await Promise.all([listTenants(), tenantSummary()])

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Ecom Store — Customers</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">SaaS tenants provisioned on the platform</p>
        </div>
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 bg-white dark:bg-gray-800">
          <div className="text-sm text-gray-500 dark:text-gray-400">Total tenants</div>
          <div className="text-2xl font-bold text-gray-900 dark:text-white">{summary.total}</div>
        </div>
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 bg-white dark:bg-gray-800">
          <div className="text-sm text-gray-500 dark:text-gray-400">Active</div>
          <div className="text-2xl font-bold text-green-600 dark:text-green-400">{summary.active}</div>
        </div>
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 bg-white dark:bg-gray-800">
          <div className="text-sm text-gray-500 dark:text-gray-400">MRR (active)</div>
          <div className="text-2xl font-bold text-gray-900 dark:text-white">₹{summary.mrr.toLocaleString('en-IN')}</div>
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden bg-white dark:bg-gray-800">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-900/50 text-gray-500 dark:text-gray-400">
            <tr>
              <th className="text-left px-4 py-3 font-medium">Store</th>
              <th className="text-left px-4 py-3 font-medium">Subdomain</th>
              <th className="text-left px-4 py-3 font-medium">Plan</th>
              <th className="text-left px-4 py-3 font-medium">Price</th>
              <th className="text-left px-4 py-3 font-medium">Status</th>
              <th className="text-left px-4 py-3 font-medium">Custom domain</th>
              <th className="text-left px-4 py-3 font-medium">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {tenants.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">No tenants yet.</td></tr>
            )}
            {tenants.map((t) => (
              <tr key={t.id} className="hover:bg-gray-50 dark:hover:bg-gray-900/30">
                <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{t.display_name}</td>
                <td className="px-4 py-3 text-gray-600 dark:text-gray-300">{t.slug}.jeffistores.in</td>
                <td className="px-4 py-3 text-gray-600 dark:text-gray-300 capitalize">{t.plan || '—'}</td>
                <td className="px-4 py-3 text-gray-600 dark:text-gray-300">{money(t.monthly_price_inr)}{t.daily_payout ? ' +daily' : ''}</td>
                <td className="px-4 py-3"><StatusBadge status={t.status} /></td>
                <td className="px-4 py-3 text-gray-600 dark:text-gray-300">{t.custom_domain || '—'}</td>
                <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{new Date(t.created_at).toLocaleDateString('en-IN')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
