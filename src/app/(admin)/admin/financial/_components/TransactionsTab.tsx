'use client'

import { useState, useCallback, useEffect } from 'react'
import Link from 'next/link'
import AdminSelect from '@/components/admin/AdminSelect'
import { ap } from '@/lib/shared/admin-path'
import DatePicker from '@/components/ui/DatePicker'
import {
  Skeleton,
  SummaryCard,
  btnPrimary,
  btnSecondary,
  labelCls,
  formatDate,
  formatINR,
  thCls,
  thRight,
  thCenter,
} from './shared'

const TYPE_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'inflow', label: 'Inflow only' },
  { value: 'outflow', label: 'Outflow only' },
]

export function TransactionsTab({ initialData }: { initialData: any }) {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [search, setSearch] = useState('')
  const [type, setType] = useState('all')
  const [data, setData] = useState<any>(initialData)
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 50

  useEffect(() => {
    if (initialData !== null) {
      setData(initialData)
      setPage(1)
    }
  }, [initialData])

  const load = useCallback(
    async (p = page) => {
      setLoading(true)
      const params = new URLSearchParams()
      if (from) params.set('from', from)
      if (to) params.set('to', to)
      if (search) params.set('search', search)
      if (type !== 'all') params.set('type', type)
      params.set('page', String(p))
      const res = await fetch(`/api/admin/financial/transactions?${params}`)
      const json = await res.json()
      setData(json?.error ? null : json)
      setPage(p)
      setLoading(false)
    },
    [from, to, search, type, page]
  )

  const handleRefresh = () => {
    setPage(1)
    load(1)
  }

  const totalPages = data?.total ? Math.ceil(data.total / PAGE_SIZE) : 1

  const exportCSV = () => {
    if (!data?.rows?.length) return
    const headers = ['Date', 'Type', 'Party', 'Ref', 'Method', 'Amount', 'Reference', 'Payout ID', 'Payout Status']
    const rows = data.rows.map((r: any) => [
      r.txn_date,
      r.direction,
      r.party,
      r.txn_ref,
      r.method,
      r.amount,
      r.reference || '',
      r.payout_id || '',
      r.payout_status || '',
    ])
    const csv = [headers, ...rows].map(r => r.join(',')).join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = `transactions-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
  }

  return (
    <div className="space-y-5">
      <div className="bg-surface-elevated rounded-xl border border-border-default px-4 py-3">
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className={labelCls}>From</label>
            <DatePicker className="w-36" value={from} onChange={setFrom} />
          </div>
          <div>
            <label className={labelCls}>To</label>
            <DatePicker className="w-36" value={to} onChange={setTo} />
          </div>
          <div className="w-36">
            <AdminSelect label="Type" value={type} onChange={setType} options={TYPE_OPTIONS} sm />
          </div>
          <div className="flex-1 min-w-[180px]">
            <label className={labelCls}>Search party / ref</label>
            <input
              className="field-compact w-full border border-border-default bg-surface-secondary text-foreground focus:outline-none focus:ring-2 focus:ring-accent-500 dark:focus:ring-accent-400"
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleRefresh()}
              placeholder="Supplier, customer, ref..."
            />
          </div>
          <div className="flex gap-2 pb-0.5">
            <button className={btnPrimary} onClick={handleRefresh}>
              {loading ? 'Loading…' : 'Refresh'}
            </button>
            {data?.rows?.length > 0 && (
              <button className={btnSecondary} onClick={exportCSV}>
                Export CSV
              </button>
            )}
          </div>
        </div>
      </div>

      {!data ? (
        <Skeleton />
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3">
            <SummaryCard label="Total Inflow" value={formatINR(data.summary.total_inflow)} sub="payments received" />
            <SummaryCard label="Total Outflow" value={formatINR(data.summary.total_outflow)} sub="payments made" />
            <SummaryCard
              label="Net"
              value={formatINR(data.summary.net)}
              sub={data.summary.net >= 0 ? 'surplus' : 'deficit'}
            />
          </div>

          {data.rows.length === 0 ? (
            <p className="text-foreground-secondary text-sm text-center py-10">No transactions found</p>
          ) : (
            <>
              <div className="hidden md:block overflow-x-auto rounded-xl border border-border-default">
                <table className="w-full text-sm">
                  <thead className="bg-surface-secondary">
                    <tr>
                      <th className={thCls}>Date</th>
                      <th className={thCls}>Type</th>
                      <th className={thCls}>Party</th>
                      <th className={thCls}>Ref</th>
                      <th className={thCls}>Method</th>
                      <th className={thRight}>Amount</th>
                      <th className={thCls}>UTR / Payout</th>
                      <th className={thCenter}>Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-default">
                    {data.rows.map((r: any) => (
                      <tr key={r.id + r.direction} className="hover:bg-surface-secondary/40 transition-colors">
                        <td className="px-4 py-3 text-foreground-secondary whitespace-nowrap">
                          {formatDate(r.txn_date)}
                        </td>
                        <td className="px-4 py-3">
                          {r.direction === 'inflow' ? (
                            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                              Inflow
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
                              Outflow
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 font-medium text-foreground">
                          {r.direction === 'inflow' ? (
                            r.source === 'cash_sale' ? (
                              <span>{r.party}</span>
                            ) : r.user_id ? (
                              <Link
                                href={ap(`/admin/customers/${r.user_id}`)}
                                className="hover:text-accent-500 hover:underline"
                              >
                                {r.party}
                              </Link>
                            ) : (
                              <Link
                                href={ap(`/admin/orders/${r.id}`)}
                                className="hover:text-accent-500 hover:underline"
                              >
                                {r.party}
                              </Link>
                            )
                          ) : r.supplier_id ? (
                            <Link
                              href={ap(`/admin/suppliers/${r.supplier_id}`)}
                              className="hover:text-accent-500 hover:underline"
                            >
                              {r.party}
                            </Link>
                          ) : (
                            <Link
                              href={ap(`/admin/financial/payables/${r.expense_id}`)}
                              className="hover:text-accent-500 hover:underline"
                            >
                              {r.party}
                            </Link>
                          )}
                        </td>
                        <td className="px-4 py-3 text-foreground-secondary">
                          {r.direction === 'inflow' ? (
                            r.source === 'cash_sale' ? (
                              <a
                                href={`/api/admin/cash-sale/${r.id}/receipt`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="hover:text-accent-500 hover:underline font-mono"
                              >
                                {r.txn_ref}
                              </a>
                            ) : r.invoice_number ? (
                              <Link
                                href={ap(`/admin/invoices/${r.id}`)}
                                className="hover:text-accent-500 hover:underline font-mono"
                              >
                                {r.txn_ref}
                              </Link>
                            ) : (
                              <Link
                                href={ap(`/admin/orders/${r.id}`)}
                                className="hover:text-accent-500 hover:underline font-mono"
                              >
                                {r.txn_ref}
                              </Link>
                            )
                          ) : (
                            <Link
                              href={ap(`/admin/financial/payables/${r.expense_id}`)}
                              className="hover:text-accent-500 hover:underline font-mono"
                            >
                              {r.txn_ref}
                            </Link>
                          )}
                        </td>
                        <td className="px-4 py-3 text-foreground-secondary capitalize">
                          {r.method?.replace('_', ' ')}
                        </td>
                        <td
                          className={`px-4 py-3 text-right font-semibold ${r.direction === 'inflow' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}
                        >
                          {r.direction === 'inflow' ? '+' : '-'}
                          {formatINR(parseFloat(r.amount))}
                        </td>
                        <td className="px-4 py-3 text-xs text-foreground-secondary font-mono">
                          {r.payout_id || r.reference || '—'}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {r.payout_status ? (
                            <span
                              className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                                r.payout_status === 'processed'
                                  ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                                  : r.payout_status === 'failed' || r.payout_status === 'reversed'
                                    ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                                    : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
                              }`}
                            >
                              {r.payout_status}
                            </span>
                          ) : (
                            <span className="text-foreground-secondary">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="md:hidden rounded-xl border border-border-default divide-y divide-border-default">
                {data.rows.map((r: any) => (
                  <div key={r.id + r.direction} className="p-4 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        {r.direction === 'inflow' ? (
                          r.source === 'cash_sale' ? (
                            <span className="font-medium text-foreground text-sm">{r.party}</span>
                          ) : r.user_id ? (
                            <Link
                              href={ap(`/admin/customers/${r.user_id}`)}
                              className="font-medium text-foreground text-sm hover:text-accent-500 hover:underline"
                            >
                              {r.party}
                            </Link>
                          ) : (
                            <Link
                              href={ap(`/admin/orders/${r.id}`)}
                              className="font-medium text-foreground text-sm hover:text-accent-500 hover:underline"
                            >
                              {r.party}
                            </Link>
                          )
                        ) : r.supplier_id ? (
                          <Link
                            href={ap(`/admin/suppliers/${r.supplier_id}`)}
                            className="font-medium text-foreground text-sm hover:text-accent-500 hover:underline"
                          >
                            {r.party}
                          </Link>
                        ) : (
                          <Link
                            href={ap(`/admin/financial/payables/${r.expense_id}`)}
                            className="font-medium text-foreground text-sm hover:text-accent-500 hover:underline"
                          >
                            {r.party}
                          </Link>
                        )}
                        {r.txn_ref &&
                          (r.direction === 'inflow' ? (
                            r.source === 'cash_sale' ? (
                              <a
                                href={`/api/admin/cash-sale/${r.id}/receipt`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-foreground-secondary font-mono mt-0.5 hover:text-accent-500 hover:underline block"
                              >
                                {r.txn_ref}
                              </a>
                            ) : r.invoice_number ? (
                              <Link
                                href={ap(`/admin/invoices/${r.id}`)}
                                className="text-xs text-foreground-secondary font-mono mt-0.5 hover:text-accent-500 hover:underline block"
                              >
                                {r.txn_ref}
                              </Link>
                            ) : (
                              <Link
                                href={ap(`/admin/orders/${r.id}`)}
                                className="text-xs text-foreground-secondary font-mono mt-0.5 hover:text-accent-500 hover:underline block"
                              >
                                {r.txn_ref}
                              </Link>
                            )
                          ) : (
                            <Link
                              href={ap(`/admin/financial/payables/${r.expense_id}`)}
                              className="text-xs text-foreground-secondary font-mono mt-0.5 hover:text-accent-500 hover:underline block"
                            >
                              {r.txn_ref}
                            </Link>
                          ))}
                      </div>
                      <p
                        className={`font-semibold text-sm shrink-0 ${r.direction === 'inflow' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}
                      >
                        {r.direction === 'inflow' ? '+' : '-'}
                        {formatINR(parseFloat(r.amount))}
                      </p>
                    </div>
                    <div className="flex items-center justify-between gap-2 text-xs text-foreground-secondary">
                      <span>{formatDate(r.txn_date)}</span>
                      {r.method && <span className="capitalize">{r.method.replace('_', ' ')}</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      {r.direction === 'inflow' ? (
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                          Inflow
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
                          Outflow
                        </span>
                      )}
                      {r.payout_status && (
                        <span
                          className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                            r.payout_status === 'processed'
                              ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                              : r.payout_status === 'failed' || r.payout_status === 'reversed'
                                ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                                : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
                          }`}
                        >
                          {r.payout_status}
                        </span>
                      )}
                    </div>
                    {(r.payout_id || r.reference) && (
                      <p className="text-xs text-foreground-secondary font-mono">{r.payout_id || r.reference}</p>
                    )}
                  </div>
                ))}
              </div>

              {totalPages > 1 && (
                <div className="flex items-center justify-between pt-2">
                  <p className="text-sm text-foreground-secondary">
                    Page {page} of {totalPages} · {data.total} total
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => load(page - 1)}
                      disabled={page === 1 || loading}
                      className="px-3 py-1.5 rounded-lg border border-border-default text-sm font-medium text-foreground-secondary hover:bg-surface-secondary disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      Previous
                    </button>
                    <button
                      onClick={() => load(page + 1)}
                      disabled={page === totalPages || loading}
                      className="px-3 py-1.5 rounded-lg border border-border-default text-sm font-medium text-foreground-secondary hover:bg-surface-secondary disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}
