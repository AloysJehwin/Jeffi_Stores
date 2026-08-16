import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { hasScope } from '@/lib/scopes'
import { listTenants, tenantSummary } from '@/lib/tenant-registry'

export const dynamic = 'force-dynamic'

export default async function EcomBillingPage() {
  const h = await headers()
  const role = h.get('x-user-role') || ''
  const scopes = (h.get('x-user-scopes') || '').split(',').filter(Boolean)
  if (role !== 'super_admin' && !hasScope(role, scopes, 'ecom_billing:read')) redirect('/admin')

  const [tenants, summary] = await Promise.all([listTenants(), tenantSummary()])

  return (
    <div className="p-6 w-full">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-1">Ecom Store — Billing</h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">Tenant subscriptions & settlement</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 bg-white dark:bg-gray-800">
          <div className="text-sm text-gray-500 dark:text-gray-400">Monthly recurring revenue (active)</div>
          <div className="text-2xl font-bold text-gray-900 dark:text-white">₹{summary.mrr.toLocaleString('en-IN')}</div>
        </div>
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 bg-white dark:bg-gray-800">
          <div className="text-sm text-gray-500 dark:text-gray-400">Paying tenants</div>
          <div className="text-2xl font-bold text-gray-900 dark:text-white">{summary.active}</div>
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden bg-white dark:bg-gray-800">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-900/50 text-gray-500 dark:text-gray-400">
            <tr>
              <th className="text-left px-4 py-3 font-medium">Store</th>
              <th className="text-left px-4 py-3 font-medium">Plan</th>
              <th className="text-left px-4 py-3 font-medium">Monthly</th>
              <th className="text-left px-4 py-3 font-medium">Payout</th>
              <th className="text-left px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {tenants.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">No tenants yet.</td></tr>
            )}
            {tenants.map((t) => (
              <tr key={t.id} className="hover:bg-gray-50 dark:hover:bg-gray-900/30">
                <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{t.display_name}</td>
                <td className="px-4 py-3 text-gray-600 dark:text-gray-300 capitalize">{t.plan || '—'}</td>
                <td className="px-4 py-3 text-gray-600 dark:text-gray-300">{t.monthly_price_inr ? '₹' + Number(t.monthly_price_inr).toLocaleString('en-IN') : '—'}</td>
                <td className="px-4 py-3 text-gray-600 dark:text-gray-300">{t.daily_payout ? 'Daily (+5%)' : 'Weekly'}</td>
                <td className="px-4 py-3 text-gray-600 dark:text-gray-300 capitalize">{t.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-400 mt-4">Settlement ledger (Razorpay Route splits, COD remittance, Delhivery charge corrections, payouts) wires in with the payments integration once Route is enabled.</p>
    </div>
  )
}
