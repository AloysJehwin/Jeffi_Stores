'use client'

import { useState } from 'react'
import type { TenantTransaction, LedgerEntry } from '@/lib/tenant-registry'

type Tab = 'overview' | 'transactions' | 'ledger'

const STATUS_PILL: Record<string, string> = {
  captured:  'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  settled:   'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  split:     'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  refunded:  'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  failed:    'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
}

const LEDGER_COLORS: Record<string, string> = {
  order_capture:       'text-green-600 dark:text-green-400',
  payout:              'text-red-500 dark:text-red-400',
  commission:          'text-orange-500 dark:text-orange-400',
  gateway_fee:         'text-orange-400 dark:text-orange-300',
  subscription_charge: 'text-purple-600 dark:text-purple-400',
  refund:              'text-red-500 dark:text-red-400',
  adjustment:          'text-foreground-secondary',
  cod_remittance:      'text-blue-600 dark:text-blue-400',
}

function fmt(n: number) {
  return '₹' + Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtDate(s: string) {
  return new Date(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

interface Props {
  transactions: TenantTransaction[]
  ledger: LedgerEntry[]
  balance: number
  totals: { gross: number; tenantShare: number; commission: number; fees: number }
  subscriptionStatus: string
  billingInterval: string
  plan: string | null
  renewalDate: string | null
  slug: string
  ownRazorpay: boolean
}

export default function StoreDashboardTabs({ transactions, ledger, balance, totals, subscriptionStatus, billingInterval, plan, renewalDate, slug, ownRazorpay }: Props) {
  const [tab, setTab] = useState<Tab>('overview')

  const tabs: { id: Tab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'transactions', label: `Transactions${transactions.length ? ` (${transactions.length})` : ''}` },
    { id: 'ledger', label: `Settlement ledger${ledger.length ? ` (${ledger.length})` : ''}` },
  ]

  return (
    <div>
      {/* Tab bar */}
      <div className="flex gap-1 border-b border-border-default mb-6">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${tab === t.id ? 'border-accent-600 text-accent-600 dark:text-accent-400 dark:border-accent-400' : 'border-transparent text-foreground-secondary hover:text-foreground'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Overview */}
      {tab === 'overview' && (
        <div className="space-y-6">
          {/* Account-mode badge — explains why platform fees are zero for own-Razorpay tenants. */}
          <div className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${
            ownRazorpay
              ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
              : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
          }`}>
            {ownRazorpay
              ? 'Collecting on your own Razorpay — no platform commission'
              : 'Platform Razorpay — Route settlement applies'}
          </div>

          {/* Financial summary tiles */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: 'Wallet balance', value: fmt(balance), accent: balance >= 0 },
              { label: 'Gross GMV', value: fmt(totals.gross), accent: false },
              { label: 'Your earnings', value: fmt(totals.tenantShare), accent: false },
              { label: 'Platform fees', value: fmt(totals.commission + totals.fees), accent: false },
            ].map((s) => (
              <div key={s.label} className="rounded-xl border border-border-default bg-surface-elevated p-4">
                <div className="text-xs text-foreground-secondary uppercase tracking-widest mb-1">{s.label}</div>
                <div className={`text-2xl font-bold ${s.accent ? 'text-accent-600 dark:text-accent-400' : 'text-foreground'}`}>{s.value}</div>
              </div>
            ))}
          </div>

          {/* Subscription card */}
          <div className="rounded-xl border border-border-default bg-surface-elevated p-5">
            <div className="text-xs text-foreground-secondary uppercase tracking-widest mb-3">Subscription</div>
            <div className="flex flex-wrap gap-4 items-center">
              <div>
                <div className="font-semibold text-foreground capitalize">{plan ?? '—'}</div>
                <div className="text-xs text-foreground-secondary capitalize mt-0.5">{billingInterval} billing</div>
              </div>
              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                subscriptionStatus === 'active' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                subscriptionStatus === 'halted' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' :
                'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
              }`}>
                {subscriptionStatus}
              </span>
              {renewalDate && <div className="text-sm text-foreground-secondary ml-auto">Renews <span className="text-foreground font-medium">{renewalDate}</span></div>}
            </div>
          </div>

          {/* Storefront link */}
          <div className="rounded-xl border border-border-default bg-surface-elevated p-5 flex items-center justify-between">
            <div>
              <div className="text-xs text-foreground-secondary uppercase tracking-widest mb-1">Storefront</div>
              <div className="font-medium text-foreground">{slug}.jeffistores.in</div>
            </div>
            <a href={`https://${slug}.jeffistores.in`} target="_blank" rel="noopener noreferrer"
              className="px-4 py-2 rounded-lg border border-border-default text-sm font-medium text-foreground hover:bg-surface-secondary transition-colors">
              Open store →
            </a>
          </div>

          {/* Recent transactions preview */}
          {transactions.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-foreground-secondary uppercase tracking-widest">Recent transactions</h3>
                <button onClick={() => setTab('transactions')} className="text-xs text-accent-600 dark:text-accent-400 hover:underline">View all</button>
              </div>
              <div className="rounded-xl border border-border-default bg-surface-elevated overflow-hidden">
                {transactions.slice(0, 5).map((t, i) => (
                  <div key={t.id} className={`flex items-center justify-between px-4 py-3 text-sm ${i > 0 ? 'border-t border-border-default/60' : ''}`}>
                    <div>
                      <span className="font-medium text-foreground">{t.order_ref ?? t.id.slice(0, 8)}</span>
                      <span className="ml-2 text-xs text-foreground-secondary">{t.is_cod ? 'COD' : t.gateway}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-semibold text-foreground">{fmt(Number(t.tenant_share))}</span>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${STATUS_PILL[t.status] ?? 'bg-surface-secondary text-foreground-muted'}`}>{t.status}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Transactions tab */}
      {tab === 'transactions' && (
        <div className="rounded-xl border border-border-default bg-surface-elevated overflow-x-auto">
          {transactions.length === 0 ? (
            <div className="py-16 text-center text-foreground-secondary text-sm">No transactions yet</div>
          ) : (
            <table className="w-full text-sm min-w-[700px]">
              <thead>
                <tr className="bg-surface-secondary text-left">
                  {['Order ref', 'Date', 'Gross', 'Your share', 'Commission', 'Gateway fee', 'Method', 'Status'].map((h) => (
                    <th key={h} className="px-4 py-3 text-xs font-semibold text-foreground-secondary uppercase tracking-widest">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {transactions.map((t, i) => (
                  <tr key={t.id} className={`border-t border-border-default/60 hover:bg-surface-secondary/30 ${i % 2 === 0 ? '' : 'bg-surface-secondary/10'}`}>
                    <td className="px-4 py-3 font-medium text-foreground">{t.order_ref ?? <span className="text-foreground-secondary font-mono text-xs">{t.id.slice(0, 8)}</span>}</td>
                    <td className="px-4 py-3 text-foreground-secondary whitespace-nowrap">{fmtDate(t.occurred_at)}</td>
                    <td className="px-4 py-3 font-medium">{fmt(Number(t.gross_amount))}</td>
                    <td className="px-4 py-3 font-semibold text-green-600 dark:text-green-400">{fmt(Number(t.tenant_share))}</td>
                    <td className="px-4 py-3 text-foreground-secondary">{fmt(Number(t.platform_commission))}</td>
                    <td className="px-4 py-3 text-foreground-secondary">{fmt(Number(t.gateway_fee))}</td>
                    <td className="px-4 py-3 text-foreground-secondary">{t.is_cod ? 'COD' : t.gateway}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${STATUS_PILL[t.status] ?? 'bg-surface-secondary text-foreground-muted'}`}>{t.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-border-default bg-surface-secondary">
                <tr>
                  <td className="px-4 py-3 font-semibold text-foreground-secondary" colSpan={2}>Totals</td>
                  <td className="px-4 py-3 font-bold">{fmt(totals.gross)}</td>
                  <td className="px-4 py-3 font-bold text-green-600 dark:text-green-400">{fmt(totals.tenantShare)}</td>
                  <td className="px-4 py-3 font-bold text-foreground-secondary">{fmt(totals.commission)}</td>
                  <td className="px-4 py-3 font-bold text-foreground-secondary">{fmt(totals.fees)}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      )}

      {/* Ledger tab */}
      {tab === 'ledger' && (
        <div className="rounded-xl border border-border-default bg-surface-elevated overflow-x-auto">
          {ledger.length === 0 ? (
            <div className="py-16 text-center text-foreground-secondary text-sm">No ledger entries yet</div>
          ) : (
            <table className="w-full text-sm min-w-[500px]">
              <thead>
                <tr className="bg-surface-secondary text-left">
                  {['Date', 'Type', 'Amount', 'Note'].map((h) => (
                    <th key={h} className="px-4 py-3 text-xs font-semibold text-foreground-secondary uppercase tracking-widest">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ledger.map((e, i) => {
                  const amt = Number(e.amount)
                  return (
                    <tr key={e.id} className={`border-t border-border-default/60 hover:bg-surface-secondary/30 ${i % 2 === 0 ? '' : 'bg-surface-secondary/10'}`}>
                      <td className="px-4 py-3 text-foreground-secondary whitespace-nowrap">{fmtDate(e.occurred_at)}</td>
                      <td className="px-4 py-3">
                        <span className={`font-medium capitalize ${LEDGER_COLORS[e.entry_type] ?? 'text-foreground-secondary'}`}>
                          {e.entry_type.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className={`px-4 py-3 font-semibold ${amt >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`}>
                        {amt >= 0 ? '+' : '-'}{fmt(amt)}
                      </td>
                      <td className="px-4 py-3 text-foreground-secondary text-xs">{e.note ?? '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot className="border-t-2 border-border-default bg-surface-secondary">
                <tr>
                  <td className="px-4 py-3 font-semibold text-foreground-secondary" colSpan={2}>Balance</td>
                  <td className={`px-4 py-3 font-bold ${balance >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500'}`}>
                    {balance >= 0 ? '+' : '-'}{fmt(balance)}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      )}
    </div>
  )
}
