'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import Link from 'next/link'
import AdminSelect from '@/components/admin/AdminSelect'
import { ap } from '@/lib/shared/admin-path'
import DatePicker from '@/components/ui/DatePicker'
import { EmptyState, badgeCls, InfiniteFooter } from '@/components/admin/kit'
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
  theadCls,
  tableWrapCls,
  payoutBadge,
  inputCls,
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
  const [more, setMore] = useState<{ loading: boolean; error: string | null }>({ loading: false, error: null })
  const applied = useRef('')
  const inflight = useRef(false)

  useEffect(() => {
    if (initialData !== null) {
      setData(initialData)
      setPage(1)
    }
  }, [initialData])

  // Page 1 replaces (with the current filters); later pages append with the filters page 1 used.
  const load = useCallback(
    async (p = 1) => {
      if (p > 1 && inflight.current) return
      inflight.current = true
      let params: URLSearchParams
      if (p === 1) {
        setLoading(true)
        params = new URLSearchParams()
        if (from) params.set('from', from)
        if (to) params.set('to', to)
        if (search) params.set('search', search)
      if (type !== 'all') params.set('type', type)
        applied.current = params.toString()
      } else {
        setMore({ loading: true, error: null })
        params = new URLSearchParams(applied.current)
      }
      params.set('page', String(p))
      try {
        const res = await fetch(`/api/admin/financial/transactions?${params}`)
        const json = await res.json()
        if (p === 1) setData(json?.error ? null : json)
        else if (!res.ok || json?.error) throw new Error(json?.error || 'Failed to load')
        else setData((prev: any) => ({ ...prev, rows: [...(prev?.rows ?? []), ...(json.rows ?? [])], total: json.total }))
        setPage(p)
        setMore({ loading: false, error: null })
      } catch (e) {
        if (p > 1) setMore({ loading: false, error: e instanceof Error ? e.message : 'Failed to load' })
      } finally {
        inflight.current = false
        if (p === 1) setLoading(false)
      }
    },
    [from, to, search, type]
  )

  const handleRefresh = () => load(1)


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
            <AdminSelect label="Type" value={type} onChange={setType} options={TYPE_OPTIONS} />
          </div>
          <div className="flex-1 min-w-[180px]">
            <label className={labelCls}>Search party / ref</label>
            <input
              className={inputCls}
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleRefresh()}
              placeholder="Supplier, customer, ref..."
            />
          </div>
          <div className="flex gap-2 pb-0.5">
            <button type="button" className={btnPrimary} onClick={handleRefresh} disabled={loading}>
              {loading ? 'Loading…' : 'Refresh'}
            </button>
            {data?.rows?.length > 0 && (
              <button type="button" className={btnSecondary} onClick={exportCSV}>
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
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <SummaryCard label="Total Inflow" value={formatINR(data.summary.total_inflow)} sub="payments received" />
            <SummaryCard label="Total Outflow" value={formatINR(data.summary.total_outflow)} sub="payments made" />
            <SummaryCard
              label="Net"
              value={formatINR(data.summary.net)}
              sub={data.summary.net >= 0 ? 'surplus' : 'deficit'}
            />
          </div>

          {data.rows.length === 0 ? (
            <EmptyState title="No transactions found" />
          ) : (
            <>
              <div className={`hidden md:block overflow-x-auto ${tableWrapCls}`}>
                <table className="w-full text-sm">
                  <thead className={theadCls}>
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
                            <span className={badgeCls('green')}>
                              Inflow
                            </span>
                          ) : (
                            <span className={badgeCls('red')}>
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
                                href={ap(`/admin/customers/${r.user_id}/view`)}
                                className="hover:text-accent-500 hover:underline"
                              >
                                {r.party}
                              </Link>
                            ) : (
                              <Link
                                href={ap(`/admin/orders/${r.id}/view`)}
                                className="hover:text-accent-500 hover:underline"
                              >
                                {r.party}
                              </Link>
                            )
                          ) : r.supplier_id ? (
                            <Link
                              href={ap(`/admin/suppliers/${r.supplier_id}/view`)}
                              className="hover:text-accent-500 hover:underline"
                            >
                              {r.party}
                            </Link>
                          ) : (
                            <Link
                              href={ap(`/admin/financial/payables/${r.expense_id}/view`)}
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
                                href={ap(`/admin/invoices/${r.id}/view`)}
                                className="hover:text-accent-500 hover:underline font-mono"
                              >
                                {r.txn_ref}
                              </Link>
                            ) : (
                              <Link
                                href={ap(`/admin/orders/${r.id}/view`)}
                                className="hover:text-accent-500 hover:underline font-mono"
                              >
                                {r.txn_ref}
                              </Link>
                            )
                          ) : (
                            <Link
                              href={ap(`/admin/financial/payables/${r.expense_id}/view`)}
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
                          className={`px-4 py-3 text-right font-semibold tabular-nums ${r.direction === 'inflow' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}
                        >
                          {r.direction === 'inflow' ? '+' : '-'}
                          {formatINR(parseFloat(r.amount))}
                        </td>
                        <td className="px-4 py-3 text-xs text-foreground-secondary font-mono">
                          {r.payout_id || r.reference || '—'}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {payoutBadge(r.payout_status)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className={`md:hidden divide-y divide-border-default ${tableWrapCls}`}>
                {data.rows.map((r: any) => (
                  <div key={r.id + r.direction} className="p-4 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        {r.direction === 'inflow' ? (
                          r.source === 'cash_sale' ? (
                            <span className="font-medium text-foreground text-sm">{r.party}</span>
                          ) : r.user_id ? (
                            <Link
                              href={ap(`/admin/customers/${r.user_id}/view`)}
                              className="font-medium text-foreground text-sm hover:text-accent-500 hover:underline"
                            >
                              {r.party}
                            </Link>
                          ) : (
                            <Link
                              href={ap(`/admin/orders/${r.id}/view`)}
                              className="font-medium text-foreground text-sm hover:text-accent-500 hover:underline"
                            >
                              {r.party}
                            </Link>
                          )
                        ) : r.supplier_id ? (
                          <Link
                            href={ap(`/admin/suppliers/${r.supplier_id}/view`)}
                            className="font-medium text-foreground text-sm hover:text-accent-500 hover:underline"
                          >
                            {r.party}
                          </Link>
                        ) : (
                          <Link
                            href={ap(`/admin/financial/payables/${r.expense_id}/view`)}
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
                                href={ap(`/admin/invoices/${r.id}/view`)}
                                className="text-xs text-foreground-secondary font-mono mt-0.5 hover:text-accent-500 hover:underline block"
                              >
                                {r.txn_ref}
                              </Link>
                            ) : (
                              <Link
                                href={ap(`/admin/orders/${r.id}/view`)}
                                className="text-xs text-foreground-secondary font-mono mt-0.5 hover:text-accent-500 hover:underline block"
                              >
                                {r.txn_ref}
                              </Link>
                            )
                          ) : (
                            <Link
                              href={ap(`/admin/financial/payables/${r.expense_id}/view`)}
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
                        <span className={badgeCls('green')}>
                          Inflow
                        </span>
                      ) : (
                        <span className={badgeCls('red')}>
                          Outflow
                        </span>
                      )}
                      {r.payout_status && payoutBadge(r.payout_status)}
                    </div>
                    {(r.payout_id || r.reference) && (
                      <p className="text-xs text-foreground-secondary font-mono">{r.payout_id || r.reference}</p>
                    )}
                  </div>
                ))}
              </div>

              <InfiniteFooter
                shown={data.rows.length}
                noun="rows"
                control={{ total: data.total, hasMore: data.rows.length < (data.total ?? 0), loadingMore: more.loading, error: more.error, loadMore: () => load(page + 1) }}
              />
            </>
          )}
        </>
      )}
    </div>
  )
}
