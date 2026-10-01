'use client'

import { useState, useCallback, useEffect } from 'react'
import Link from 'next/link'
import AdminTypeahead from '@/components/admin/AdminTypeahead'
import { ap } from '@/lib/shared/admin-path'
import DatePicker from '@/components/ui/DatePicker'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import {
  labelCls,
  btnPrimary,
  btnSecondary,
  Skeleton,
  SummaryCard,
  StatusBadge,
  agingBadge,
  formatDate,
  formatINR,
  thCls,
  thRight,
  thCenter,
} from './shared'

export function ReceivablesTab({ initialData }: { initialData: any }) {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [search, setSearch] = useState('')
  const [data, setData] = useState<any>(initialData)
  const [loading, setLoading] = useState(false)
  const [markingPaid, setMarkingPaid] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 50
  const canWrite = useCanWrite('financial:write')

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
      params.set('page', String(p))
      const res = await fetch(`/api/admin/financial/receivables?${params}`)
      const json = await res.json()
      setData(json?.error ? null : json)
      setPage(p)
      setLoading(false)
    },
    [from, to, search, page]
  )

  const handleRefresh = () => {
    setPage(1)
    load(1)
  }

  const markPaid = async (orderId: string) => {
    setMarkingPaid(orderId)
    await fetch(`/api/admin/orders/${orderId}/payment-status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payment_status: 'paid' }),
    })
    await load(page)
    setMarkingPaid(null)
  }

  const exportCSV = () => {
    if (!data?.rows?.length) return
    const headers = ['Customer', 'Invoice #', 'Date', 'Amount', 'Age (days)', 'Bucket', 'Status']
    const rows = data.rows.map((r: any) => [
      r.customer_name,
      r.invoice_number || r.order_number,
      formatDate(r.invoice_date),
      r.total_amount,
      r.days_outstanding,
      r.aging_bucket,
      r.payment_status,
    ])
    const csv = [headers, ...rows].map(r => r.join(',')).join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = `receivables-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
  }

  const totalPages = data?.total ? Math.ceil(data.total / PAGE_SIZE) : 1

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
          <div className="flex-1 min-w-[200px]">
            <label className={labelCls}>Search customer / invoice</label>
            <AdminTypeahead
              type="receivables"
              value={search}
              onChange={setSearch}
              onEnter={handleRefresh}
              placeholder="Name, invoice #..."
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
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <SummaryCard label="Total Outstanding" value={formatINR(data.summary.total)} />
            <SummaryCard label="0–30 Days" value={formatINR(data.summary.bucket_0_30)} sub="current" />
            <SummaryCard label="31–60 Days" value={formatINR(data.summary.bucket_31_60)} sub="aging" />
            <SummaryCard label="60+ Days" value={formatINR(data.summary.bucket_60plus)} sub="overdue" />
          </div>

          {data.rows.length === 0 ? (
            <p className="text-foreground-secondary text-sm text-center py-10">No outstanding receivables</p>
          ) : (
            <>
              <div className="hidden md:block overflow-x-auto rounded-xl border border-border-default">
                <table className="w-full text-sm">
                  <thead className="bg-surface-secondary">
                    <tr>
                      <th className={thCls}>Customer</th>
                      <th className={thCls}>Invoice #</th>
                      <th className={thCls}>Date</th>
                      <th className={thRight}>Amount</th>
                      <th className={thCenter}>Age</th>
                      <th className={thCenter}>Status</th>
                      <th className={thCenter}>Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-default">
                    {data.rows.map((r: any) => (
                      <tr key={r.order_id} className="hover:bg-surface-secondary/40 transition-colors">
                        <td className="px-4 py-3">
                          {r.user_id ? (
                            <Link
                              href={ap(`/admin/customers/${r.user_id}`)}
                              className="font-medium text-foreground hover:text-accent-500 hover:underline"
                            >
                              {r.customer_name}
                            </Link>
                          ) : (
                            <Link
                              href={ap(`/admin/orders/${r.order_id}`)}
                              className="font-medium text-foreground hover:text-accent-500 hover:underline"
                            >
                              {r.customer_name}
                            </Link>
                          )}
                          {r.customer_phone && (
                            <div className="text-xs text-foreground-secondary">+91 {r.customer_phone}</div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-foreground-secondary">
                          {r.invoice_number ? (
                            <Link
                              href={ap(`/admin/invoices/${r.order_id}`)}
                              className="hover:text-accent-500 hover:underline font-mono"
                            >
                              {r.invoice_number || r.order_number}
                            </Link>
                          ) : (
                            <Link
                              href={ap(`/admin/orders/${r.order_id}`)}
                              className="hover:text-accent-500 hover:underline font-mono"
                            >
                              {r.order_number}
                            </Link>
                          )}
                          {r.invoice_number && (
                            <a
                              href={`/api/orders/${r.order_id}/invoice`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="ml-2 text-xs text-accent-500 hover:underline"
                            >
                              PDF
                            </a>
                          )}
                        </td>
                        <td className="px-4 py-3 text-foreground-secondary whitespace-nowrap">
                          {formatDate(r.invoice_date)}
                        </td>
                        <td className="px-4 py-3 text-right font-medium text-foreground">
                          {formatINR(parseFloat(r.total_amount))}
                        </td>
                        <td className="px-4 py-3 text-center">{agingBadge(r.aging_bucket)}</td>
                        <td className="px-4 py-3 text-center">
                          <StatusBadge status={r.payment_status} />
                        </td>
                        <td className="px-4 py-3 text-center">
                          {canWrite && (
                            <button
                              className="px-3 py-1 rounded-lg text-xs font-medium bg-green-600 hover:bg-green-700 text-white disabled:opacity-50 transition-colors"
                              disabled={markingPaid === r.order_id}
                              onClick={() => markPaid(r.order_id)}
                            >
                              {markingPaid === r.order_id ? '…' : 'Mark Paid'}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="md:hidden rounded-xl border border-border-default divide-y divide-border-default">
                {data.rows.map((r: any) => (
                  <div key={r.order_id} className="p-4 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        {r.user_id ? (
                          <Link
                            href={ap(`/admin/customers/${r.user_id}`)}
                            className="font-medium text-foreground text-sm hover:text-accent-500 hover:underline"
                          >
                            {r.customer_name}
                          </Link>
                        ) : (
                          <Link
                            href={ap(`/admin/orders/${r.order_id}`)}
                            className="font-medium text-foreground text-sm hover:text-accent-500 hover:underline"
                          >
                            {r.customer_name}
                          </Link>
                        )}
                        {r.customer_phone && (
                          <p className="text-xs text-foreground-secondary mt-0.5">+91 {r.customer_phone}</p>
                        )}
                      </div>
                      <p className="font-semibold text-foreground text-sm shrink-0">
                        {formatINR(parseFloat(r.total_amount))}
                      </p>
                    </div>
                    <div className="flex items-center justify-between gap-2 text-xs text-foreground-secondary">
                      <div className="flex items-center gap-1.5">
                        {r.invoice_number ? (
                          <Link
                            href={ap(`/admin/invoices/${r.order_id}`)}
                            className="font-mono hover:text-accent-500 hover:underline"
                          >
                            {r.invoice_number || r.order_number}
                          </Link>
                        ) : (
                          <Link
                            href={ap(`/admin/orders/${r.order_id}`)}
                            className="font-mono hover:text-accent-500 hover:underline"
                          >
                            {r.order_number}
                          </Link>
                        )}
                        {r.invoice_number && (
                          <a
                            href={`/api/orders/${r.order_id}/invoice`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-accent-500 hover:underline"
                          >
                            PDF
                          </a>
                        )}
                      </div>
                      <span>{formatDate(r.invoice_date)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {agingBadge(r.aging_bucket)}
                      <StatusBadge status={r.payment_status} />
                    </div>
                    {canWrite && (
                      <button
                        className="w-full mt-1 py-1.5 rounded-lg text-xs font-medium bg-green-600 hover:bg-green-700 text-white disabled:opacity-50 transition-colors"
                        disabled={markingPaid === r.order_id}
                        onClick={() => markPaid(r.order_id)}
                      >
                        {markingPaid === r.order_id ? '…' : 'Mark Paid'}
                      </button>
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
