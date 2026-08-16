import { headers } from 'next/headers'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { hasScope } from '@/lib/scopes'
import { getTenant, getTenantBilling } from '@/lib/tenant-registry'
import { StatusPill } from '@/components/admin/ecom/EcomUI'

export const dynamic = 'force-dynamic'

const inr = (n: number | string) => '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2 })

const LEDGER_LABEL: Record<string, string> = {
  order_capture: 'Order capture (tenant share)',
  commission: 'Platform commission',
  gateway_fee: 'Gateway fee',
  subscription_charge: 'Subscription charge',
  cod_remittance: 'COD remittance',
  delhivery_correction: 'Delhivery charge correction',
  refund: 'Refund',
  payout: 'Payout to tenant',
  adjustment: 'Adjustment',
}

export default async function TenantBillingPage({ params }: { params: Promise<{ id: string }> }) {
  const h = await headers()
  const role = h.get('x-user-role') || ''
  const scopes = (h.get('x-user-scopes') || '').split(',').filter(Boolean)
  if (role !== 'super_admin' && !hasScope(role, scopes, 'ecom_billing:read')) redirect('/admin')

  const { id } = await params
  const t = await getTenant(id)
  if (!t) notFound()
  const { transactions, ledger, balance, totals } = await getTenantBilling(id)

  return (
    <div className="p-6 w-full">
      <Link href="/admin/ecom/billing" className="text-sm text-accent-600 dark:text-accent-400 hover:underline">← Billing</Link>
      <div className="flex items-center gap-3 mt-2 mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t.display_name} — Billing</h1>
        <StatusPill status={t.status} />
      </div>

      {/* Settlement summary tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 bg-white dark:bg-gray-800">
          <div className="text-xs text-gray-400 uppercase tracking-wide">Settlement balance</div>
          <div className={`text-xl font-bold ${balance >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>{inr(balance)}</div>
        </div>
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 bg-white dark:bg-gray-800">
          <div className="text-xs text-gray-400 uppercase tracking-wide">GMV</div>
          <div className="text-xl font-bold text-gray-900 dark:text-white">{inr(totals.gross)}</div>
        </div>
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 bg-white dark:bg-gray-800">
          <div className="text-xs text-gray-400 uppercase tracking-wide">Tenant share</div>
          <div className="text-xl font-bold text-gray-900 dark:text-white">{inr(totals.tenantShare)}</div>
        </div>
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 bg-white dark:bg-gray-800">
          <div className="text-xs text-gray-400 uppercase tracking-wide">Your commission</div>
          <div className="text-xl font-bold text-accent-600 dark:text-accent-400">{inr(totals.commission)}</div>
        </div>
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 bg-white dark:bg-gray-800">
          <div className="text-xs text-gray-400 uppercase tracking-wide">Gateway fees</div>
          <div className="text-xl font-bold text-gray-900 dark:text-white">{inr(totals.fees)}</div>
        </div>
      </div>

      {/* Transactions with split breakdown */}
      <h2 className="font-semibold text-gray-900 dark:text-white mb-3">Transactions &amp; splits</h2>
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden bg-white dark:bg-gray-800 mb-8">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-900/50 text-gray-500 dark:text-gray-400">
            <tr>
              <th className="text-left px-4 py-3 font-medium">Order</th>
              <th className="text-right px-4 py-3 font-medium">Gross</th>
              <th className="text-right px-4 py-3 font-medium">Tenant share</th>
              <th className="text-right px-4 py-3 font-medium">Commission</th>
              <th className="text-right px-4 py-3 font-medium">Gateway fee</th>
              <th className="text-left px-4 py-3 font-medium">Mode</th>
              <th className="text-left px-4 py-3 font-medium">Status</th>
              <th className="text-left px-4 py-3 font-medium">Date</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {transactions.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">No transactions yet.</td></tr>
            )}
            {transactions.map((tx) => (
              <tr key={tx.id} className="hover:bg-gray-50 dark:hover:bg-gray-900/30">
                <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{tx.order_ref || '—'}</td>
                <td className="px-4 py-3 text-right text-gray-900 dark:text-white">{inr(tx.gross_amount)}</td>
                <td className="px-4 py-3 text-right text-green-600 dark:text-green-400">{inr(tx.tenant_share)}</td>
                <td className="px-4 py-3 text-right text-accent-600 dark:text-accent-400">{inr(tx.platform_commission)}</td>
                <td className="px-4 py-3 text-right text-gray-500">{inr(tx.gateway_fee)}</td>
                <td className="px-4 py-3 text-gray-600 dark:text-gray-300">{tx.is_cod ? 'COD' : 'Prepaid'}</td>
                <td className="px-4 py-3"><StatusPill status={tx.status} /></td>
                <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{new Date(tx.occurred_at).toLocaleDateString('en-IN')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Settlement ledger */}
      <h2 className="font-semibold text-gray-900 dark:text-white mb-3">Settlement ledger</h2>
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden bg-white dark:bg-gray-800">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-900/50 text-gray-500 dark:text-gray-400">
            <tr>
              <th className="text-left px-4 py-3 font-medium">Entry</th>
              <th className="text-left px-4 py-3 font-medium">Note</th>
              <th className="text-right px-4 py-3 font-medium">Amount</th>
              <th className="text-left px-4 py-3 font-medium">Date</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {ledger.length === 0 && (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400">No ledger entries yet.</td></tr>
            )}
            {ledger.map((e) => {
              const amt = Number(e.amount)
              return (
                <tr key={e.id} className="hover:bg-gray-50 dark:hover:bg-gray-900/30">
                  <td className="px-4 py-3 text-gray-900 dark:text-white">{LEDGER_LABEL[e.entry_type] || e.entry_type}</td>
                  <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{e.note || '—'}</td>
                  <td className={`px-4 py-3 text-right font-medium ${amt >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                    {amt >= 0 ? '+' : '−'}{inr(Math.abs(amt))}
                  </td>
                  <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{new Date(e.occurred_at).toLocaleDateString('en-IN')}</td>
                </tr>
              )
            })}
          </tbody>
          <tfoot className="bg-gray-50 dark:bg-gray-900/50 font-semibold">
            <tr>
              <td className="px-4 py-3 text-gray-900 dark:text-white" colSpan={2}>Balance</td>
              <td className={`px-4 py-3 text-right ${balance >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>{inr(balance)}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}
