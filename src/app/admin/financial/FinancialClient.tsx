'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import AdminTypeahead from '@/components/admin/AdminTypeahead'
import AdminSelect from '@/components/admin/AdminSelect'
import { ap } from '@/lib/admin-path'
import DatePicker from '@/components/ui/DatePicker'

type Tab = 'receivables' | 'payables' | 'transactions' | 'pl' | 'cashflow'

const inputCls = 'w-full px-3 py-2.5 rounded-lg border border-border-default bg-surface-secondary text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-accent-500 dark:focus:ring-accent-400'
const labelCls = 'block text-xs font-medium text-foreground-secondary mb-1'
const btnPrimary = 'px-4 py-2 rounded-lg text-sm font-medium bg-secondary-500 hover:bg-secondary-600 dark:bg-secondary-400 dark:hover:bg-secondary-300 text-white dark:text-secondary-900 transition-colors'
const btnSecondary = 'px-4 py-2 rounded-lg text-sm font-medium border border-border-default bg-surface hover:bg-surface-secondary text-foreground transition-colors'

const PAYMENT_METHOD_OPTIONS = [
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'upi', label: 'UPI' },
  { value: 'cash', label: 'Cash' },
  { value: 'cheque', label: 'Cheque' },
]

const PAYOUT_MODE_OPTIONS = [
  { value: 'IMPS', label: 'IMPS (instant)' },
  { value: 'NEFT', label: 'NEFT' },
  { value: 'RTGS', label: 'RTGS' },
  { value: 'UPI', label: 'UPI' },
]

function formatINR(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)
}

function formatDate(s: string) {
  if (!s) return ''
  return new Date(s).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

function agingBadge(bucket: string) {
  if (bucket === '0-30') return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">{bucket}d</span>
  if (bucket === '31-60') return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400">{bucket}d</span>
  return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">60+d</span>
}

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === 'paid' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
    status === 'partial' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' :
    'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>{status}</span>
}

function SummaryCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-surface-elevated rounded-xl border border-border-default px-5 py-4">
      <p className="text-xs font-medium uppercase tracking-wide text-foreground-secondary mb-1">{label}</p>
      <p className="text-2xl font-bold text-foreground">{value}</p>
      {sub && <p className="text-xs text-foreground-secondary mt-0.5">{sub}</p>}
    </div>
  )
}

function Skeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="rounded-xl border border-border-default overflow-hidden">
      <div className="bg-surface-secondary h-10" />
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="border-t border-border-default px-4 py-3 flex gap-4">
          <div className="h-4 bg-surface-secondary rounded w-32 animate-pulse" />
          <div className="h-4 bg-surface-secondary rounded w-24 animate-pulse" />
          <div className="h-4 bg-surface-secondary rounded flex-1 animate-pulse" />
          <div className="h-4 bg-surface-secondary rounded w-20 animate-pulse" />
        </div>
      ))}
    </div>
  )
}

const thCls = 'px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-foreground-secondary'
const thRight = 'px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-foreground-secondary'
const thCenter = 'px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide text-foreground-secondary'

// ── Portal Modal ─────────────────────────────────────────────────────────────

function Modal({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', handler)
      document.body.style.overflow = ''
    }
  }, [onClose])

  return createPortal(
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999] p-4"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}
    >
      {children}
    </div>,
    document.body
  )
}

// ── Receivables ───────────────────────────────────────────────────────────────

function ReceivablesTab({ initialData }: { initialData: any }) {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [search, setSearch] = useState('')
  const [data, setData] = useState<any>(initialData)
  const [loading, setLoading] = useState(false)
  const [markingPaid, setMarkingPaid] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 50

  useEffect(() => { if (initialData !== null) { setData(initialData); setPage(1) } }, [initialData])

  const load = useCallback(async (p = page) => {
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
  }, [from, to, search, page])

  const handleRefresh = () => { setPage(1); load(1) }

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
      r.customer_name, r.invoice_number || r.order_number, formatDate(r.invoice_date),
      r.total_amount, r.days_outstanding, r.aging_bucket, r.payment_status,
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
            <button className={btnPrimary} onClick={handleRefresh}>{loading ? 'Loading…' : 'Refresh'}</button>
            {data?.rows?.length > 0 && <button className={btnSecondary} onClick={exportCSV}>Export CSV</button>}
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
                          {r.user_id
                            ? <Link href={ap(`/admin/customers/${r.user_id}`)} className="font-medium text-foreground hover:text-accent-500 hover:underline">{r.customer_name}</Link>
                            : <Link href={ap(`/admin/orders/${r.order_id}`)} className="font-medium text-foreground hover:text-accent-500 hover:underline">{r.customer_name}</Link>}
                          {r.customer_phone && <div className="text-xs text-foreground-secondary">+91 {r.customer_phone}</div>}
                        </td>
                        <td className="px-4 py-3 text-foreground-secondary">
                          {r.invoice_number
                            ? <Link href={ap(`/admin/invoices/${r.order_id}`)} className="hover:text-accent-500 hover:underline font-mono">{r.invoice_number || r.order_number}</Link>
                            : <Link href={ap(`/admin/orders/${r.order_id}`)} className="hover:text-accent-500 hover:underline font-mono">{r.order_number}</Link>}
                          {r.invoice_number && (
                            <a href={`/api/orders/${r.order_id}/invoice`} target="_blank" rel="noopener noreferrer" className="ml-2 text-xs text-accent-500 hover:underline">PDF</a>
                          )}
                        </td>
                        <td className="px-4 py-3 text-foreground-secondary whitespace-nowrap">{formatDate(r.invoice_date)}</td>
                        <td className="px-4 py-3 text-right font-medium text-foreground">{formatINR(parseFloat(r.total_amount))}</td>
                        <td className="px-4 py-3 text-center">{agingBadge(r.aging_bucket)}</td>
                        <td className="px-4 py-3 text-center"><StatusBadge status={r.payment_status} /></td>
                        <td className="px-4 py-3 text-center">
                          <button
                            className="px-3 py-1 rounded-lg text-xs font-medium bg-green-600 hover:bg-green-700 text-white disabled:opacity-50 transition-colors"
                            disabled={markingPaid === r.order_id}
                            onClick={() => markPaid(r.order_id)}
                          >
                            {markingPaid === r.order_id ? '…' : 'Mark Paid'}
                          </button>
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
                        {r.user_id
                          ? <Link href={ap(`/admin/customers/${r.user_id}`)} className="font-medium text-foreground text-sm hover:text-accent-500 hover:underline">{r.customer_name}</Link>
                          : <Link href={ap(`/admin/orders/${r.order_id}`)} className="font-medium text-foreground text-sm hover:text-accent-500 hover:underline">{r.customer_name}</Link>}
                        {r.customer_phone && <p className="text-xs text-foreground-secondary mt-0.5">+91 {r.customer_phone}</p>}
                      </div>
                      <p className="font-semibold text-foreground text-sm shrink-0">{formatINR(parseFloat(r.total_amount))}</p>
                    </div>
                    <div className="flex items-center justify-between gap-2 text-xs text-foreground-secondary">
                      <div className="flex items-center gap-1.5">
                        {r.invoice_number
                          ? <Link href={ap(`/admin/invoices/${r.order_id}`)} className="font-mono hover:text-accent-500 hover:underline">{r.invoice_number || r.order_number}</Link>
                          : <Link href={ap(`/admin/orders/${r.order_id}`)} className="font-mono hover:text-accent-500 hover:underline">{r.order_number}</Link>}
                        {r.invoice_number && (
                          <a href={`/api/orders/${r.order_id}/invoice`} target="_blank" rel="noopener noreferrer" className="text-accent-500 hover:underline">PDF</a>
                        )}
                      </div>
                      <span>{formatDate(r.invoice_date)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {agingBadge(r.aging_bucket)}
                      <StatusBadge status={r.payment_status} />
                    </div>
                    <button
                      className="w-full mt-1 py-1.5 rounded-lg text-xs font-medium bg-green-600 hover:bg-green-700 text-white disabled:opacity-50 transition-colors"
                      disabled={markingPaid === r.order_id}
                      onClick={() => markPaid(r.order_id)}
                    >
                      {markingPaid === r.order_id ? '…' : 'Mark Paid'}
                    </button>
                  </div>
                ))}
              </div>

              {totalPages > 1 && (
                <div className="flex items-center justify-between pt-2">
                  <p className="text-sm text-foreground-secondary">Page {page} of {totalPages} · {data.total} total</p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => load(page - 1)}
                      disabled={page === 1 || loading}
                      className="px-3 py-1.5 rounded-lg border border-border-default text-sm font-medium text-foreground-secondary hover:bg-surface-secondary disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >Previous</button>
                    <button
                      onClick={() => load(page + 1)}
                      disabled={page === totalPages || loading}
                      className="px-3 py-1.5 rounded-lg border border-border-default text-sm font-medium text-foreground-secondary hover:bg-surface-secondary disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >Next</button>
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

// ── Payables ──────────────────────────────────────────────────────────────────

function PayablesTab({ initialData }: { initialData: any }) {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [search, setSearch] = useState('')
  const [data, setData] = useState<any>(initialData)
  const [loading, setLoading] = useState(false)
  const [showAddForm, setShowAddForm] = useState(false)
  const [addForm, setAddForm] = useState({ supplier_name: '', amount: '', tax_amount: '', expense_date: '', due_date: '', description: '', supplier_gstin: '', notes: '' })
  const [saving, setSaving] = useState(false)
  const [payModal, setPayModal] = useState<any | null>(null)
  const [payTab, setPayTab] = useState<'manual' | 'razorpayx'>('manual')
  const [payForm, setPayForm] = useState({ amount: '', payment_date: new Date().toISOString().slice(0, 10), payment_method: 'bank_transfer', reference: '' })
  const [rzpForm, setRzpForm] = useState({ mode: 'IMPS', amount: '', notes: '' })
  const [paying, setPaying] = useState(false)
  const [payoutResult, setPayoutResult] = useState<any>(null)
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 50

  useEffect(() => { if (initialData !== null) { setData(initialData); setPage(1) } }, [initialData])

  const load = useCallback(async (p = page) => {
    setLoading(true)
    const params = new URLSearchParams()
    if (from) params.set('from', from)
    if (to) params.set('to', to)
    if (search) params.set('search', search)
    params.set('page', String(p))
    const res = await fetch(`/api/admin/financial/payables?${params}`)
    const json = await res.json()
    setData(json?.error ? null : json)
    setPage(p)
    setLoading(false)
  }, [from, to, search, page])

  const handleRefresh = () => { setPage(1); load(1) }

  const totalPages = data?.total ? Math.ceil(data.total / PAGE_SIZE) : 1

  const submitBill = async () => {
    if (!addForm.supplier_name || !addForm.amount || !addForm.expense_date) return
    setSaving(true)
    await fetch('/api/admin/financial/payables', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(addForm),
    })
    setShowAddForm(false)
    setAddForm({ supplier_name: '', amount: '', tax_amount: '', expense_date: '', due_date: '', description: '', supplier_gstin: '', notes: '' })
    setSaving(false)
    load()
  }

  const submitPayment = async () => {
    if (!payModal || !payForm.amount) return
    setPaying(true)
    await fetch(`/api/admin/financial/payables/${payModal.id}/pay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payForm),
    })
    setPayModal(null)
    setPaying(false)
    load()
  }

  const submitPayout = async () => {
    if (!payModal || !rzpForm.amount) return
    setPaying(true)
    setPayoutResult(null)
    const res = await fetch(`/api/admin/financial/payables/${payModal.id}/payout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rzpForm),
    })
    const json = await res.json()
    setPaying(false)
    if (json.success) {
      setPayoutResult({ ok: true, payout_id: json.payout_id, status: json.payout_status })
      fetch('/api/admin/financial/payables/sync-payouts', { method: 'POST' })
      load()
    } else {
      setPayoutResult({ ok: false, error: json.error })
    }
  }

  const openPayModal = (r: any) => {
    const remaining = parseFloat(r.total_amount) - parseFloat(r.paid_amount)
    setPayModal(r)
    setPayTab('manual')
    setPayoutResult(null)
    setPayForm(f => ({ ...f, amount: remaining.toFixed(2) }))
    setRzpForm({ mode: 'IMPS', amount: remaining.toFixed(2), notes: '' })
  }

  const closePayModal = () => { setPayModal(null); setPayoutResult(null) }

  const hasBank = payModal && payModal.supplier_account_number && payModal.supplier_ifsc
  const hasUpi = payModal && payModal.supplier_upi_id

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
            <label className={labelCls}>Search supplier / bill #</label>
            <AdminTypeahead
              type="payables"
              value={search}
              onChange={setSearch}
              onEnter={handleRefresh}
              placeholder="Supplier name, bill #..."
            />
          </div>
          <div className="flex gap-2 pb-0.5">
            <button className={btnPrimary} onClick={handleRefresh}>{loading ? 'Loading…' : 'Refresh'}</button>
            <button className={btnSecondary} onClick={() => setShowAddForm(v => !v)}>+ Add Bill</button>
          </div>
        </div>
      </div>

      {showAddForm && (
        <div className="bg-surface-elevated rounded-xl border border-border-default p-5 space-y-4">
          <h3 className="text-sm font-semibold text-foreground">New Supplier Bill</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className={labelCls}>Supplier Name *</label>
              <input className={inputCls} value={addForm.supplier_name} onChange={e => setAddForm(f => ({ ...f, supplier_name: e.target.value }))} />
            </div>
            <div>
              <label className={labelCls}>GSTIN</label>
              <input className={inputCls + ' font-mono'} value={addForm.supplier_gstin} onChange={e => setAddForm(f => ({ ...f, supplier_gstin: e.target.value.toUpperCase() }))} maxLength={15} placeholder="00XXXXX0000X0Z0" />
            </div>
            <div>
              <label className={labelCls}>Description</label>
              <input className={inputCls} value={addForm.description} onChange={e => setAddForm(f => ({ ...f, description: e.target.value }))} />
            </div>
            <div>
              <label className={labelCls}>Amount (excl. tax) *</label>
              <input type="number" step="0.01" className={inputCls} value={addForm.amount} onChange={e => setAddForm(f => ({ ...f, amount: e.target.value }))} />
            </div>
            <div>
              <label className={labelCls}>Tax Amount</label>
              <input type="number" step="0.01" className={inputCls} value={addForm.tax_amount} onChange={e => setAddForm(f => ({ ...f, tax_amount: e.target.value }))} />
            </div>
            <div>
              <label className={labelCls}>Bill Date *</label>
              <DatePicker value={addForm.expense_date} onChange={v => setAddForm(f => ({ ...f, expense_date: v }))} />
            </div>
            <div>
              <label className={labelCls}>Due Date</label>
              <DatePicker value={addForm.due_date} onChange={v => setAddForm(f => ({ ...f, due_date: v }))} />
            </div>
            <div>
              <label className={labelCls}>Notes</label>
              <input className={inputCls} value={addForm.notes} onChange={e => setAddForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>
          <div className="flex gap-2">
            <button className={btnPrimary} onClick={submitBill} disabled={saving}>{saving ? 'Saving…' : 'Save Bill'}</button>
            <button className={btnSecondary} onClick={() => setShowAddForm(false)}>Cancel</button>
          </div>
        </div>
      )}

      {!data ? (
        <Skeleton />
      ) : data.summary && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <SummaryCard label="Total Payable" value={formatINR(data.summary.total_payable)} />
            <SummaryCard label="Due This Week" value={formatINR(data.summary.due_this_week)} />
            <SummaryCard label="Overdue" value={formatINR(data.summary.overdue)} sub="past due date" />
          </div>

          {data.rows.length === 0 ? (
            <p className="text-foreground-secondary text-sm text-center py-10">No outstanding payables</p>
          ) : (
            <>
              <div className="hidden md:block overflow-x-auto rounded-xl border border-border-default">
                <table className="w-full text-sm">
                  <thead className="bg-surface-secondary">
                    <tr>
                      <th className={thCls}>Supplier</th>
                      <th className={thCls}>Bill #</th>
                      <th className={thCls}>Bill Date</th>
                      <th className={thCls}>Due Date</th>
                      <th className={thRight}>Amount</th>
                      <th className={thRight}>Paid</th>
                      <th className={thCenter}>Status</th>
                      <th className={thCenter}>Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-default">
                    {data.rows.map((r: any) => {
                      const remaining = parseFloat(r.total_amount) - parseFloat(r.paid_amount)
                      return (
                        <tr key={r.id} className="hover:bg-surface-secondary/40 transition-colors">
                          <td className="px-4 py-3">
                            {r.supplier_id
                              ? <Link href={ap(`/admin/suppliers/${r.supplier_id}`)} className="font-medium text-foreground hover:text-accent-500 hover:underline">{r.supplier_name}</Link>
                              : <span className="font-medium text-foreground">{r.supplier_name}</span>}
                            {r.description && <div className="text-xs text-foreground-secondary">{r.description}</div>}
                          </td>
                          <td className="px-4 py-3 text-foreground-secondary">
                            <Link href={ap(`/admin/financial/payables/${r.id}`)} className="font-mono hover:text-accent-500 hover:underline">{r.expense_number}</Link>
                          </td>
                          <td className="px-4 py-3 text-foreground-secondary whitespace-nowrap">{formatDate(r.expense_date)}</td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            {r.due_date ? (
                              <span className={r.days_overdue ? 'text-red-600 dark:text-red-400 font-medium' : 'text-foreground-secondary'}>
                                {formatDate(r.due_date)}
                                {r.days_overdue ? ` (${r.days_overdue}d overdue)` : ''}
                              </span>
                            ) : <span className="text-foreground-secondary">—</span>}
                          </td>
                          <td className="px-4 py-3 text-right font-medium text-foreground">{formatINR(parseFloat(r.total_amount))}</td>
                          <td className="px-4 py-3 text-right text-foreground-secondary">{formatINR(parseFloat(r.paid_amount))}</td>
                          <td className="px-4 py-3 text-center"><StatusBadge status={r.status} /></td>
                          <td className="px-4 py-3 text-center">
                            <button
                              className="px-3 py-1 rounded-lg text-xs font-medium bg-secondary-500 hover:bg-secondary-600 dark:bg-secondary-400 dark:hover:bg-secondary-300 text-white dark:text-secondary-900 transition-colors"
                              onClick={() => openPayModal(r)}
                            >
                              Pay
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              <div className="md:hidden rounded-xl border border-border-default divide-y divide-border-default">
                {data.rows.map((r: any) => {
                  const remaining = parseFloat(r.total_amount) - parseFloat(r.paid_amount)
                  return (
                    <div key={r.id} className="p-4 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          {r.supplier_id
                            ? <Link href={ap(`/admin/suppliers/${r.supplier_id}`)} className="font-medium text-foreground text-sm hover:text-accent-500 hover:underline">{r.supplier_name}</Link>
                            : <span className="font-medium text-foreground text-sm">{r.supplier_name}</span>}
                          {r.description && <p className="text-xs text-foreground-secondary mt-0.5">{r.description}</p>}
                        </div>
                        <div className="text-right shrink-0">
                          <p className="font-semibold text-foreground text-sm">{formatINR(parseFloat(r.total_amount))}</p>
                          {parseFloat(r.paid_amount) > 0 && (
                            <p className="text-xs text-foreground-secondary mt-0.5">Paid {formatINR(parseFloat(r.paid_amount))}</p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center justify-between gap-2 text-xs text-foreground-secondary">
                        <Link href={ap(`/admin/financial/payables/${r.id}`)} className="font-mono hover:text-accent-500 hover:underline">{r.expense_number}</Link>
                        <span>{formatDate(r.expense_date)}</span>
                      </div>
                      {r.due_date && (
                        <p className={`text-xs ${r.days_overdue ? 'text-red-600 dark:text-red-400 font-medium' : 'text-foreground-secondary'}`}>
                          Due {formatDate(r.due_date)}{r.days_overdue ? ` · ${r.days_overdue}d overdue` : ''}
                        </p>
                      )}
                      <div className="flex items-center justify-between gap-2">
                        <StatusBadge status={r.status} />
                        <button
                          className="px-4 py-1.5 rounded-lg text-xs font-medium bg-secondary-500 hover:bg-secondary-600 dark:bg-secondary-400 text-white dark:text-secondary-900 transition-colors"
                          onClick={() => openPayModal(r)}
                        >
                          Pay
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>

              {totalPages > 1 && (
                <div className="flex items-center justify-between pt-2">
                  <p className="text-sm text-foreground-secondary">Page {page} of {totalPages} · {data.total} total</p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => load(page - 1)}
                      disabled={page === 1 || loading}
                      className="px-3 py-1.5 rounded-lg border border-border-default text-sm font-medium text-foreground-secondary hover:bg-surface-secondary disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >Previous</button>
                    <button
                      onClick={() => load(page + 1)}
                      disabled={page === totalPages || loading}
                      className="px-3 py-1.5 rounded-lg border border-border-default text-sm font-medium text-foreground-secondary hover:bg-surface-secondary disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >Next</button>
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}

      {payModal && (
        <Modal onClose={closePayModal}>
          <div className="bg-surface-elevated rounded-xl border border-border-default p-6 w-full max-w-md space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-base font-semibold text-foreground">{payModal.supplier_name}</h3>
                <p className="text-xs text-foreground-secondary mt-0.5">
                  Remaining: {formatINR(parseFloat(payModal.total_amount) - parseFloat(payModal.paid_amount))}
                </p>
              </div>
              <button className="text-foreground-secondary hover:text-foreground text-lg leading-none" onClick={closePayModal}>×</button>
            </div>

            {(hasBank || hasUpi) && (
              <div className="bg-surface-secondary rounded-lg px-3 py-2 text-xs space-y-0.5">
                {payModal.supplier_bank_name && <p className="text-foreground-secondary">Bank: <span className="text-foreground">{payModal.supplier_bank_name}</span></p>}
                {hasBank && <p className="text-foreground-secondary">A/C: <span className="text-foreground font-mono">{payModal.supplier_account_number}</span> · IFSC: <span className="text-foreground font-mono">{payModal.supplier_ifsc}</span></p>}
                {hasUpi && <p className="text-foreground-secondary">UPI: <span className="text-foreground font-mono">{payModal.supplier_upi_id}</span></p>}
              </div>
            )}

            {(hasBank || hasUpi) && (
              <div className="flex rounded-lg border border-border-default overflow-hidden text-xs font-medium">
                <button
                  className={`flex-1 py-2 transition-colors ${payTab === 'manual' ? 'bg-surface-secondary text-foreground' : 'text-foreground-secondary hover:bg-surface-secondary/50'}`}
                  onClick={() => { setPayTab('manual'); setPayoutResult(null) }}
                >
                  Manual Entry
                </button>
                <button
                  className={`flex-1 py-2 transition-colors ${payTab === 'razorpayx' ? 'bg-secondary-500 dark:bg-secondary-400 text-white dark:text-secondary-900' : 'text-foreground-secondary hover:bg-surface-secondary/50'}`}
                  onClick={() => { setPayTab('razorpayx'); setPayoutResult(null) }}
                >
                  Pay via RazorpayX
                </button>
              </div>
            )}

            {payTab === 'manual' && (
              <div className="space-y-3">
                <div>
                  <label className={labelCls}>Amount *</label>
                  <input type="number" step="0.01" className={inputCls} value={payForm.amount} onChange={e => setPayForm(f => ({ ...f, amount: e.target.value }))} />
                </div>
                <div>
                  <label className={labelCls}>Payment Date *</label>
                  <DatePicker value={payForm.payment_date} onChange={v => setPayForm(f => ({ ...f, payment_date: v }))} />
                </div>
                <AdminSelect
                  label="Method"
                  value={payForm.payment_method}
                  onChange={v => setPayForm(f => ({ ...f, payment_method: v }))}
                  options={PAYMENT_METHOD_OPTIONS}
                />
                <div>
                  <label className={labelCls}>Reference / UTR</label>
                  <input className={inputCls} value={payForm.reference} onChange={e => setPayForm(f => ({ ...f, reference: e.target.value }))} />
                </div>
                <div className="flex gap-2 pt-1">
                  <button className={btnPrimary} onClick={submitPayment} disabled={paying}>{paying ? 'Saving…' : 'Record Payment'}</button>
                  <button className={btnSecondary} onClick={closePayModal}>Cancel</button>
                </div>
              </div>
            )}

            {payTab === 'razorpayx' && (
              <div className="space-y-3">
                <AdminSelect
                  label="Mode"
                  value={rzpForm.mode}
                  onChange={v => setRzpForm(f => ({ ...f, mode: v }))}
                  options={PAYOUT_MODE_OPTIONS.filter(o => o.value === 'UPI' ? hasUpi : hasBank)}
                />
                <div>
                  <label className={labelCls}>Amount (₹) *</label>
                  <input type="number" step="0.01" className={inputCls} value={rzpForm.amount} onChange={e => setRzpForm(f => ({ ...f, amount: e.target.value }))} />
                </div>
                <div>
                  <label className={labelCls}>Narration</label>
                  <input className={inputCls} placeholder={`Payment ${payModal.expense_number}`} value={rzpForm.notes} onChange={e => setRzpForm(f => ({ ...f, notes: e.target.value.replace(/[^a-zA-Z0-9 ]/g, '').slice(0, 30) }))} maxLength={30} />
                </div>
                {payoutResult && (
                  <div className={`rounded-lg px-3 py-2 text-xs ${payoutResult.ok ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400' : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400'}`}>
                    {payoutResult.ok
                      ? `Payout queued · ID: ${payoutResult.payout_id} · Status: ${payoutResult.status}`
                      : `Error: ${payoutResult.error}`}
                  </div>
                )}
                <div className="flex gap-2 pt-1">
                  <button
                    className={btnPrimary + ' bg-secondary-500 hover:bg-secondary-600'}
                    onClick={submitPayout}
                    disabled={paying || !!payoutResult?.ok}
                  >
                    {paying ? 'Sending…' : payoutResult?.ok ? 'Sent' : 'Send Payout'}
                  </button>
                  <button className={btnSecondary} onClick={closePayModal}>Close</button>
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  )
}

// ── P&L ───────────────────────────────────────────────────────────────────────

// ── SVG Chart primitives ──────────────────────────────────────────────────────

function PLMonthModal({ m, all, onClose }: { m: any; all: any[]; onClose: () => void }) {
  const W = 520, H = 200, PAD = { t: 12, r: 16, b: 32, l: 64 }
  const innerW = W - PAD.l - PAD.r
  const innerH = H - PAD.t - PAD.b

  const bars = [
    { label: 'Revenue',    value: m.revenue,             color: '#3b82f6' },
    { label: 'Net Rev.',   value: m.net_revenue,         color: '#8b5cf6' },
    { label: 'Gross P.',   value: m.gross_profit,        color: '#10b981' },
    { label: 'Op. Profit', value: m.operating_profit,    color: m.operating_profit >= 0 ? '#22c55e' : '#ef4444' },
    { label: 'COGS',       value: m.cogs,                color: '#f97316' },
    { label: 'Op. Exp.',   value: m.operating_expenses,  color: '#ec4899' },
    { label: 'Refunds',    value: m.refunds,             color: '#f43f5e' },
  ]

  const maxVal = Math.max(...bars.map(b => Math.abs(b.value)), 1)
  const bw = Math.floor(innerW / bars.length)
  const gap = 6

  const monthLabel = new Date(m.month + '-01').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })

  // Source donut data
  const srcTotal = m.revenue_online + m.revenue_business + m.revenue_cash_sale + m.revenue_offline
  const sources = [
    { label: 'Online',    value: m.revenue_online,    color: '#3b82f6' },
    { label: 'Business',  value: m.revenue_business,  color: '#8b5cf6' },
    { label: 'Cash Sale', value: m.revenue_cash_sale, color: '#10b981' },
    { label: 'Offline',   value: m.revenue_offline,   color: '#f97316' },
  ].filter(s => s.value > 0)

  // Trend sparkline: net revenue across all months
  const trendVals = all.map(r => r.net_revenue)
  const tMin = Math.min(...trendVals, 0)
  const tMax = Math.max(...trendVals, 1)
  const tRange = tMax - tMin || 1
  const tW = 300, tH = 60
  const tPts = trendVals.map((v, i) => {
    const x = trendVals.length === 1 ? tW / 2 : (i / (trendVals.length - 1)) * tW
    const y = tH - ((v - tMin) / tRange) * tH
    return `${x},${y}`
  }).join(' ')

  const curIdx = all.findIndex(r => r.month === m.month)
  const curX = trendVals.length === 1 ? tW / 2 : (curIdx / (trendVals.length - 1)) * tW
  const curY = tH - ((m.net_revenue - tMin) / tRange) * tH

  return (
    <Modal onClose={onClose}>
      <div className="bg-surface rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-default">
          <h2 className="text-lg font-semibold text-foreground">{monthLabel} — P&amp;L Breakdown</h2>
          <button onClick={onClose} className="text-foreground-secondary hover:text-foreground transition-colors text-xl leading-none">×</button>
        </div>
        <div className="p-6 space-y-6">

          {/* KPI row */}
          <div className="grid grid-cols-3 gap-3 text-center">
            {[
              { label: 'Gross Revenue', val: m.revenue },
              { label: 'Net Revenue',   val: m.net_revenue },
              { label: 'Gross Margin',  val: null, pct: m.gross_margin_pct },
              { label: 'COGS',          val: m.cogs },
              { label: 'Gross Profit',  val: m.gross_profit },
              { label: 'Op. Profit',    val: m.operating_profit },
            ].map(k => (
              <div key={k.label} className="bg-surface-elevated rounded-xl px-3 py-2 border border-border-default">
                <p className="text-xs text-foreground-secondary mb-0.5">{k.label}</p>
                <p className={`text-base font-bold ${k.val != null && k.val < 0 ? 'text-red-500' : 'text-foreground'}`}>
                  {k.val != null ? formatINR(k.val) : `${k.pct}%`}
                </p>
              </div>
            ))}
          </div>

          {/* Bar chart */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-foreground-secondary mb-2">Metric Comparison</p>
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
              {/* Y grid lines */}
              {[0, 0.25, 0.5, 0.75, 1].map(t => {
                const y = PAD.t + innerH * (1 - t)
                const val = maxVal * t
                return (
                  <g key={t}>
                    <line x1={PAD.l} x2={W - PAD.r} y1={y} y2={y} stroke="currentColor" strokeOpacity="0.08" strokeWidth="1" />
                    <text x={PAD.l - 6} y={y + 4} textAnchor="end" fontSize="9" fill="currentColor" fillOpacity="0.5">
                      {val >= 1000 ? `${Math.round(val / 1000)}k` : Math.round(val)}
                    </text>
                  </g>
                )
              })}
              {/* Bars */}
              {bars.map((b, i) => {
                const barH = (Math.abs(b.value) / maxVal) * innerH
                const x = PAD.l + i * bw + gap / 2
                const y = b.value >= 0 ? PAD.t + innerH - barH : PAD.t + innerH
                return (
                  <g key={b.label}>
                    <rect x={x} y={y} width={bw - gap} height={barH} fill={b.color} rx="3" fillOpacity="0.85" />
                    <text x={x + (bw - gap) / 2} y={H - PAD.b + 12} textAnchor="middle" fontSize="8" fill="currentColor" fillOpacity="0.6">
                      {b.label}
                    </text>
                  </g>
                )
              })}
              {/* Zero line */}
              <line x1={PAD.l} x2={W - PAD.r} y1={PAD.t + innerH} y2={PAD.t + innerH} stroke="currentColor" strokeOpacity="0.2" strokeWidth="1" />
            </svg>
          </div>

          {/* Revenue source donut-style stacked bar */}
          {srcTotal > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-foreground-secondary mb-2">Revenue by Source</p>
              <div className="flex h-5 rounded-full overflow-hidden w-full gap-px">
                {sources.map(s => (
                  <div key={s.label} style={{ width: `${(s.value / srcTotal) * 100}%`, background: s.color }} title={`${s.label}: ${formatINR(s.value)}`} />
                ))}
              </div>
              <div className="flex flex-wrap gap-3 mt-2">
                {sources.map(s => (
                  <span key={s.label} className="flex items-center gap-1 text-xs text-foreground-secondary">
                    <span className="w-2.5 h-2.5 rounded-sm inline-block flex-shrink-0" style={{ background: s.color }} />
                    {s.label} · {formatINR(s.value)} ({Math.round((s.value / srcTotal) * 100)}%)
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Net revenue trend sparkline */}
          {all.length > 1 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-foreground-secondary mb-2">Net Revenue Trend (period)</p>
              <svg viewBox={`0 0 ${tW} ${tH + 16}`} className="w-full h-auto">
                <polyline points={tPts} fill="none" stroke="#8b5cf6" strokeWidth="2" strokeLinejoin="round" />
                {/* Current month highlight */}
                <circle cx={curX} cy={curY} r="4" fill="#8b5cf6" />
                <text x={curX} y={curY - 7} textAnchor="middle" fontSize="9" fill="#8b5cf6">{formatINR(m.net_revenue)}</text>
                {/* Month labels at first/last */}
                <text x={0} y={tH + 13} fontSize="8" fill="currentColor" fillOpacity="0.5">
                  {new Date(all[0].month + '-01').toLocaleDateString('en-IN', { month: 'short' })}
                </text>
                <text x={tW} y={tH + 13} textAnchor="end" fontSize="8" fill="currentColor" fillOpacity="0.5">
                  {new Date(all[all.length - 1].month + '-01').toLocaleDateString('en-IN', { month: 'short' })}
                </text>
              </svg>
            </div>
          )}

          {/* Orders + GST */}
          <div className="flex gap-4 text-sm text-foreground-secondary">
            <span>{m.order_count} orders</span>
            <span>GST collected: {formatINR(m.tax_collected)}</span>
          </div>
        </div>
      </div>
    </Modal>
  )
}

function CashflowMonthModal({ m, all, onClose }: { m: any; all: any[]; onClose: () => void }) {
  const W = 520, H = 200, PAD = { t: 12, r: 16, b: 32, l: 64 }
  const innerW = W - PAD.l - PAD.r
  const innerH = H - PAD.t - PAD.b

  // Grouped bar: cash_in (green) vs cash_out (red)
  const maxVal = Math.max(m.cash_in, m.cash_out, 1)
  const groupW = innerW / 2
  const bw = groupW * 0.35

  // Running balance sparkline over all months
  const balVals = all.map(r => r.running_balance)
  const bMin = Math.min(...balVals, 0)
  const bMax = Math.max(...balVals, 1)
  const bRange = bMax - bMin || 1
  const tW = 300, tH = 60
  const balPts = balVals.map((v, i) => {
    const x = balVals.length === 1 ? tW / 2 : (i / (balVals.length - 1)) * tW
    const y = tH - ((v - bMin) / bRange) * tH
    return `${x},${y}`
  }).join(' ')
  const curIdx = all.findIndex(r => r.month === m.month)
  const curX = balVals.length === 1 ? tW / 2 : (curIdx / (balVals.length - 1)) * tW
  const curY = tH - ((m.running_balance - bMin) / bRange) * tH

  const monthLabel = new Date(m.month + '-01').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })

  const srcTotal = m.cash_in_online + m.cash_in_business + m.cash_in_cash_sale + m.cash_in_offline
  const sources = [
    { label: 'Online',    value: m.cash_in_online,    color: '#3b82f6' },
    { label: 'Business',  value: m.cash_in_business,  color: '#8b5cf6' },
    { label: 'Cash Sale', value: m.cash_in_cash_sale, color: '#10b981' },
    { label: 'Offline',   value: m.cash_in_offline,   color: '#f97316' },
  ].filter(s => s.value > 0)

  return (
    <Modal onClose={onClose}>
      <div className="bg-surface rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-default">
          <h2 className="text-lg font-semibold text-foreground">{monthLabel} — Cashflow</h2>
          <button onClick={onClose} className="text-foreground-secondary hover:text-foreground transition-colors text-xl leading-none">×</button>
        </div>
        <div className="p-6 space-y-6">

          {/* KPI row */}
          <div className="grid grid-cols-3 gap-3 text-center">
            {[
              { label: 'Cash In',      val: m.cash_in,          pos: true },
              { label: 'PO Payments',  val: m.po_payments,      pos: false },
              { label: 'Refunds Out',  val: m.refunds_out,      pos: false },
              { label: 'Total Out',    val: m.cash_out,         pos: false },
              { label: 'Net',          val: m.net,              pos: m.net >= 0 },
              { label: 'Balance',      val: m.running_balance,  pos: m.running_balance >= 0 },
            ].map(k => (
              <div key={k.label} className="bg-surface-elevated rounded-xl px-3 py-2 border border-border-default">
                <p className="text-xs text-foreground-secondary mb-0.5">{k.label}</p>
                <p className={`text-base font-bold ${k.pos ? 'text-green-600 dark:text-green-400' : k.val > 0 ? 'text-red-500' : 'text-foreground'}`}>
                  {formatINR(k.val)}
                </p>
              </div>
            ))}
          </div>

          {/* Grouped bar: in vs out */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-foreground-secondary mb-2">Cash In vs Cash Out</p>
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
              {[0, 0.5, 1].map(t => {
                const y = PAD.t + innerH * (1 - t)
                return (
                  <g key={t}>
                    <line x1={PAD.l} x2={W - PAD.r} y1={y} y2={y} stroke="currentColor" strokeOpacity="0.08" strokeWidth="1" />
                    <text x={PAD.l - 6} y={y + 4} textAnchor="end" fontSize="9" fill="currentColor" fillOpacity="0.5">
                      {t > 0 ? `${Math.round(maxVal * t / 1000)}k` : '0'}
                    </text>
                  </g>
                )
              })}
              {/* Cash In bar */}
              {(() => {
                const bh = (m.cash_in / maxVal) * innerH
                const x = PAD.l + innerW / 4 - bw / 2
                return (
                  <g>
                    <rect x={x} y={PAD.t + innerH - bh} width={bw} height={bh} fill="#22c55e" rx="3" fillOpacity="0.85" />
                    <text x={x + bw / 2} y={H - PAD.b + 12} textAnchor="middle" fontSize="9" fill="currentColor" fillOpacity="0.6">Cash In</text>
                    <text x={x + bw / 2} y={PAD.t + innerH - bh - 4} textAnchor="middle" fontSize="8" fill="#22c55e">{formatINR(m.cash_in)}</text>
                  </g>
                )
              })()}
              {/* Cash Out bar — stacked PO + refunds */}
              {(() => {
                const totalH = (m.cash_out / maxVal) * innerH
                const poH = m.cash_out > 0 ? (m.po_payments / m.cash_out) * totalH : 0
                const rfH = totalH - poH
                const x = PAD.l + (3 * innerW) / 4 - bw / 2
                return (
                  <g>
                    <rect x={x} y={PAD.t + innerH - poH} width={bw} height={poH} fill="#f97316" rx="0" fillOpacity="0.85" />
                    <rect x={x} y={PAD.t + innerH - totalH} width={bw} height={rfH} fill="#ef4444" rx="3" fillOpacity="0.85" style={{ borderRadius: rfH > 0 ? '3px 3px 0 0' : undefined }} />
                    <text x={x + bw / 2} y={H - PAD.b + 12} textAnchor="middle" fontSize="9" fill="currentColor" fillOpacity="0.6">Cash Out</text>
                    {m.cash_out > 0 && <text x={x + bw / 2} y={PAD.t + innerH - totalH - 4} textAnchor="middle" fontSize="8" fill="#ef4444">{formatINR(m.cash_out)}</text>}
                  </g>
                )
              })()}
              <line x1={PAD.l} x2={W - PAD.r} y1={PAD.t + innerH} y2={PAD.t + innerH} stroke="currentColor" strokeOpacity="0.2" strokeWidth="1" />
            </svg>
            <div className="flex gap-4 text-xs text-foreground-secondary mt-1">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-orange-400 inline-block" />PO Payments: {formatINR(m.po_payments)}</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-red-500 inline-block" />Refunds Out: {formatINR(m.refunds_out)}</span>
            </div>
          </div>

          {/* Source breakdown stacked bar */}
          {srcTotal > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-foreground-secondary mb-2">Cash In by Source</p>
              <div className="flex h-5 rounded-full overflow-hidden w-full gap-px">
                {sources.map(s => (
                  <div key={s.label} style={{ width: `${(s.value / srcTotal) * 100}%`, background: s.color }} title={`${s.label}: ${formatINR(s.value)}`} />
                ))}
              </div>
              <div className="flex flex-wrap gap-3 mt-2">
                {sources.map(s => (
                  <span key={s.label} className="flex items-center gap-1 text-xs text-foreground-secondary">
                    <span className="w-2.5 h-2.5 rounded-sm inline-block flex-shrink-0" style={{ background: s.color }} />
                    {s.label} · {formatINR(s.value)}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Running balance sparkline */}
          {all.length > 1 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-foreground-secondary mb-2">Running Balance Trend</p>
              <svg viewBox={`0 0 ${tW} ${tH + 16}`} className="w-full h-auto">
                {/* Zero line if range crosses 0 */}
                {bMin < 0 && bMax > 0 && (
                  <line x1={0} x2={tW} y1={tH - ((0 - bMin) / bRange) * tH} y2={tH - ((0 - bMin) / bRange) * tH} stroke="#ef4444" strokeOpacity="0.3" strokeWidth="1" strokeDasharray="4 3" />
                )}
                <polyline points={balPts} fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinejoin="round" />
                <circle cx={curX} cy={curY} r="4" fill="#3b82f6" />
                <text x={curX} y={curY - 7} textAnchor="middle" fontSize="9" fill="#3b82f6">{formatINR(m.running_balance)}</text>
                <text x={0} y={tH + 13} fontSize="8" fill="currentColor" fillOpacity="0.5">
                  {new Date(all[0].month + '-01').toLocaleDateString('en-IN', { month: 'short' })}
                </text>
                <text x={tW} y={tH + 13} textAnchor="end" fontSize="8" fill="currentColor" fillOpacity="0.5">
                  {new Date(all[all.length - 1].month + '-01').toLocaleDateString('en-IN', { month: 'short' })}
                </text>
              </svg>
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}

// ── Source bar ────────────────────────────────────────────────────────────────

function SourceBar({ online, business, cashSale, offline }: { online: number; business: number; cashSale: number; offline: number }) {
  const total = online + business + cashSale + offline
  if (total <= 0) return null
  const pct = (n: number) => Math.round((n / total) * 100)
  return (
    <div className="flex h-1.5 rounded-full overflow-hidden w-full gap-px" title={`Online ${pct(online)}% · Business ${pct(business)}% · Cash ${pct(cashSale)}% · Offline ${pct(offline)}%`}>
      {online > 0    && <div className="bg-blue-500"    style={{ width: `${pct(online)}%` }} />}
      {business > 0  && <div className="bg-purple-500"  style={{ width: `${pct(business)}%` }} />}
      {cashSale > 0  && <div className="bg-green-500"   style={{ width: `${pct(cashSale)}%` }} />}
      {offline > 0   && <div className="bg-orange-400"  style={{ width: `${pct(offline)}%` }} />}
    </div>
  )
}

function PLTab({ initialData }: { initialData: any }) {
  const now = new Date()
  const fyStart = now.getMonth() >= 3 ? `${now.getFullYear()}-04-01` : `${now.getFullYear() - 1}-04-01`
  const fyEnd = now.getMonth() >= 3 ? `${now.getFullYear() + 1}-03-31` : `${now.getFullYear()}-03-31`

  const [from, setFrom] = useState(fyStart)
  const [to, setTo] = useState(fyEnd)
  const [data, setData] = useState<any>(initialData)
  const [loading, setLoading] = useState(false)
  const [selectedMonth, setSelectedMonth] = useState<any>(null)

  useEffect(() => { if (initialData !== null) setData(initialData) }, [initialData])

  const load = async () => {
    setLoading(true)
    const res = await fetch(`/api/admin/financial/pl?from=${from}&to=${to}`)
    const json = await res.json()
    setData(json)
    setLoading(false)
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
          <div className="pb-0.5">
            <button className={btnPrimary} onClick={load}>{loading ? 'Loading…' : 'Refresh'}</button>
          </div>
        </div>
      </div>

      {!data ? (
        <Skeleton rows={6} />
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <SummaryCard label="Gross Revenue" value={formatINR(data.totals.revenue)} sub={`${data.totals.order_count} orders`} />
            <SummaryCard label="Refunds" value={formatINR(data.totals.refunds)} />
            <SummaryCard label="Net Revenue" value={formatINR(data.totals.net_revenue)} />
            <SummaryCard label="Gross Margin" value={`${data.totals.gross_margin_pct}%`} />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <SummaryCard label="COGS" value={formatINR(data.totals.cogs)} />
            <SummaryCard label="Gross Profit" value={formatINR(data.totals.gross_profit)} />
            <SummaryCard label="Op. Expenses" value={formatINR(data.totals.operating_expenses)} />
            <SummaryCard label="Op. Profit" value={formatINR(data.totals.operating_profit)} />
          </div>

          {/* Source legend */}
          <div className="flex flex-wrap gap-3 text-xs text-foreground-secondary">
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-blue-500 inline-block" />Online</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-purple-500 inline-block" />Business</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-green-500 inline-block" />Cash Sale</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-orange-400 inline-block" />Offline</span>
          </div>

          {data.monthly.length === 0 ? (
            <p className="text-foreground-secondary text-sm text-center py-10">No paid orders in this period</p>
          ) : (
            <>
              {selectedMonth && (
                <PLMonthModal m={selectedMonth} all={data.monthly} onClose={() => setSelectedMonth(null)} />
              )}
              {/* Desktop table */}
              <div className="hidden lg:block overflow-x-auto rounded-xl border border-border-default">
                <table className="w-full text-sm">
                  <thead className="bg-surface-secondary">
                    <tr>
                      <th className={thCls}>Month</th>
                      <th className={thRight}>Revenue</th>
                      <th className={thRight}>Refunds</th>
                      <th className={thRight}>Net Rev.</th>
                      <th className={thRight}>COGS</th>
                      <th className={thRight}>Gross Profit</th>
                      <th className={thCls}>Margin</th>
                      <th className={thRight}>Op. Exp.</th>
                      <th className={thRight}>Op. Profit</th>
                      <th className={thRight}>GST</th>
                      <th className={thRight}>Orders</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-default">
                    {data.monthly.map((m: any) => (
                      <tr key={m.month} className="hover:bg-surface-secondary/40 transition-colors cursor-pointer" onClick={() => setSelectedMonth(m)}>
                        <td className="px-4 py-3 font-medium text-foreground min-w-[110px]">
                          <button className="text-left hover:text-accent-600 dark:hover:text-accent-400 transition-colors underline decoration-dotted underline-offset-2">
                            <div>{new Date(m.month + '-01').toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}</div>
                          </button>
                          <div className="mt-1 w-24">
                            <SourceBar online={m.revenue_online} business={m.revenue_business} cashSale={m.revenue_cash_sale} offline={m.revenue_offline} />
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right text-foreground">{formatINR(m.revenue)}</td>
                        <td className="px-4 py-3 text-right text-red-600 dark:text-red-400 text-xs">{m.refunds > 0 ? `-${formatINR(m.refunds)}` : '—'}</td>
                        <td className="px-4 py-3 text-right text-foreground font-medium">{formatINR(m.net_revenue)}</td>
                        <td className="px-4 py-3 text-right text-foreground-secondary">{formatINR(m.cogs)}</td>
                        <td className="px-4 py-3 text-right text-foreground">{formatINR(m.gross_profit)}</td>
                        <td className="px-4 py-3 min-w-[100px]">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 bg-surface-secondary rounded-full h-2 overflow-hidden">
                              <div className="h-full bg-green-500 rounded-full" style={{ width: `${Math.min(m.gross_margin_pct, 100)}%` }} />
                            </div>
                            <span className="text-xs text-foreground-secondary w-10 text-right">{m.gross_margin_pct}%</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right text-foreground-secondary">{formatINR(m.operating_expenses)}</td>
                        <td className={`px-4 py-3 text-right font-semibold ${m.operating_profit >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                          {formatINR(m.operating_profit)}
                        </td>
                        <td className="px-4 py-3 text-right text-foreground-secondary text-xs">{formatINR(m.tax_collected)}</td>
                        <td className="px-4 py-3 text-right text-foreground-secondary">{m.order_count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile cards */}
              <div className="lg:hidden rounded-xl border border-border-default divide-y divide-border-default">
                {data.monthly.map((m: any) => (
                  <button key={m.month} className="w-full text-left p-4 space-y-2 hover:bg-surface-secondary/40 transition-colors" onClick={() => setSelectedMonth(m)}>
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium text-foreground text-sm underline decoration-dotted underline-offset-2">
                        {new Date(m.month + '-01').toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}
                      </p>
                      <span className="text-xs text-foreground-secondary">{m.order_count} orders</span>
                    </div>
                    <SourceBar online={m.revenue_online} business={m.revenue_business} cashSale={m.revenue_cash_sale} offline={m.revenue_offline} />
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                      <div className="flex justify-between"><span className="text-foreground-secondary">Revenue</span><span className="font-medium text-foreground">{formatINR(m.revenue)}</span></div>
                      <div className="flex justify-between"><span className="text-foreground-secondary">Refunds</span><span className="text-red-500">{m.refunds > 0 ? `-${formatINR(m.refunds)}` : '—'}</span></div>
                      <div className="flex justify-between"><span className="text-foreground-secondary">Net Revenue</span><span className="font-medium text-foreground">{formatINR(m.net_revenue)}</span></div>
                      <div className="flex justify-between"><span className="text-foreground-secondary">COGS</span><span className="text-foreground-secondary">{formatINR(m.cogs)}</span></div>
                      <div className="flex justify-between"><span className="text-foreground-secondary">Gross Profit</span><span className="font-medium text-foreground">{formatINR(m.gross_profit)}</span></div>
                      <div className="flex justify-between"><span className="text-foreground-secondary">Op. Expenses</span><span className="text-foreground-secondary">{formatINR(m.operating_expenses)}</span></div>
                      <div className="flex justify-between col-span-2"><span className="text-foreground-secondary">Op. Profit</span><span className={`font-semibold ${m.operating_profit >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>{formatINR(m.operating_profit)}</span></div>
                    </div>
                    <div className="flex items-center gap-2 pt-0.5">
                      <div className="flex-1 bg-surface-secondary rounded-full h-1.5 overflow-hidden">
                        <div className="h-full bg-green-500 rounded-full" style={{ width: `${Math.min(m.gross_margin_pct, 100)}%` }} />
                      </div>
                      <span className="text-xs text-foreground-secondary w-12 text-right">{m.gross_margin_pct}% margin</span>
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}

// ── Cashflow ──────────────────────────────────────────────────────────────────

function CashflowTab({ initialData }: { initialData: any }) {
  const now = new Date()
  const fyStart = now.getMonth() >= 3 ? `${now.getFullYear()}-04-01` : `${now.getFullYear() - 1}-04-01`
  const fyEnd = now.getMonth() >= 3 ? `${now.getFullYear() + 1}-03-31` : `${now.getFullYear()}-03-31`

  const [from, setFrom] = useState(fyStart)
  const [to, setTo] = useState(fyEnd)
  const [data, setData] = useState<any>(initialData)
  const [loading, setLoading] = useState(false)
  const [selectedMonth, setSelectedMonth] = useState<any>(null)

  useEffect(() => { if (initialData !== null) setData(initialData) }, [initialData])

  const load = async () => {
    setLoading(true)
    const res = await fetch(`/api/admin/financial/cashflow?from=${from}&to=${to}`)
    const json = await res.json()
    setData(json)
    setLoading(false)
  }

  const totals = data?.monthly?.reduce(
    (acc: any, m: any) => ({
      cash_in: acc.cash_in + m.cash_in,
      po_payments: acc.po_payments + m.po_payments,
      refunds_out: acc.refunds_out + m.refunds_out,
      cash_out: acc.cash_out + m.cash_out,
      net: acc.net + m.net,
    }),
    { cash_in: 0, po_payments: 0, refunds_out: 0, cash_out: 0, net: 0 }
  )

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
          <div className="pb-0.5">
            <button className={btnPrimary} onClick={load}>{loading ? 'Loading…' : 'Refresh'}</button>
          </div>
        </div>
      </div>

      {!data ? (
        <Skeleton rows={6} />
      ) : data.monthly.length === 0 ? (
        <p className="text-foreground-secondary text-sm text-center py-10">No transactions in this period</p>
      ) : (
        <>
          {selectedMonth && (
            <CashflowMonthModal m={selectedMonth} all={data.monthly} onClose={() => setSelectedMonth(null)} />
          )}
          {/* Summary bar */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <SummaryCard label="Total Cash In" value={formatINR(totals.cash_in)} />
            <SummaryCard label="PO Payments" value={formatINR(totals.po_payments)} />
            <SummaryCard label="Refunds Issued" value={formatINR(totals.refunds_out)} />
            <SummaryCard label="Total Cash Out" value={formatINR(totals.cash_out)} />
            <SummaryCard label="Net" value={formatINR(totals.net)} />
          </div>

          {/* Source legend */}
          <div className="flex flex-wrap gap-3 text-xs text-foreground-secondary">
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-blue-500 inline-block" />Online</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-purple-500 inline-block" />Business</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-green-500 inline-block" />Cash Sale</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-orange-400 inline-block" />Offline</span>
          </div>

          {/* Desktop table */}
          <div className="hidden lg:block overflow-x-auto rounded-xl border border-border-default">
            <table className="w-full text-sm">
              <thead className="bg-surface-secondary">
                <tr>
                  <th className={thCls}>Month</th>
                  <th className={thRight}>Cash In</th>
                  <th className={thRight}>PO Payments</th>
                  <th className={thRight}>Refunds Out</th>
                  <th className={thRight}>Total Out</th>
                  <th className={thRight}>Net</th>
                  <th className={thRight}>Running Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-default">
                {data.monthly.map((m: any) => (
                  <tr key={m.month} className="hover:bg-surface-secondary/40 transition-colors cursor-pointer" onClick={() => setSelectedMonth(m)}>
                    <td className="px-4 py-3 font-medium text-foreground min-w-[110px]">
                      <button className="text-left hover:text-accent-600 dark:hover:text-accent-400 transition-colors underline decoration-dotted underline-offset-2">
                        <div>{new Date(m.month + '-01').toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}</div>
                      </button>
                      <div className="mt-1 w-24">
                        <SourceBar online={m.cash_in_online} business={m.cash_in_business} cashSale={m.cash_in_cash_sale} offline={m.cash_in_offline} />
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right text-green-600 dark:text-green-400 font-medium">{formatINR(m.cash_in)}</td>
                    <td className="px-4 py-3 text-right text-foreground-secondary">{m.po_payments > 0 ? formatINR(m.po_payments) : '—'}</td>
                    <td className="px-4 py-3 text-right text-foreground-secondary">{m.refunds_out > 0 ? formatINR(m.refunds_out) : '—'}</td>
                    <td className="px-4 py-3 text-right text-red-600 dark:text-red-400">{formatINR(m.cash_out)}</td>
                    <td className={`px-4 py-3 text-right font-medium ${m.net >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                      {m.net >= 0 ? '+' : ''}{formatINR(m.net)}
                    </td>
                    <td className={`px-4 py-3 text-right font-semibold ${m.running_balance >= 0 ? 'text-foreground' : 'text-red-600 dark:text-red-400'}`}>
                      {formatINR(m.running_balance)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="lg:hidden rounded-xl border border-border-default divide-y divide-border-default">
            {data.monthly.map((m: any) => (
              <button key={m.month} className="w-full text-left p-4 space-y-2 hover:bg-surface-secondary/40 transition-colors" onClick={() => setSelectedMonth(m)}>
                <p className="font-medium text-foreground text-sm underline decoration-dotted underline-offset-2">
                  {new Date(m.month + '-01').toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}
                </p>
                <SourceBar online={m.cash_in_online} business={m.cash_in_business} cashSale={m.cash_in_cash_sale} offline={m.cash_in_offline} />
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  <div className="flex justify-between"><span className="text-foreground-secondary">Cash In</span><span className="font-medium text-green-600 dark:text-green-400">{formatINR(m.cash_in)}</span></div>
                  <div className="flex justify-between"><span className="text-foreground-secondary">PO Payments</span><span className="text-foreground-secondary">{m.po_payments > 0 ? formatINR(m.po_payments) : '—'}</span></div>
                  <div className="flex justify-between"><span className="text-foreground-secondary">Refunds Out</span><span className="text-foreground-secondary">{m.refunds_out > 0 ? formatINR(m.refunds_out) : '—'}</span></div>
                  <div className="flex justify-between"><span className="text-foreground-secondary">Total Out</span><span className="text-red-600 dark:text-red-400">{formatINR(m.cash_out)}</span></div>
                  <div className="flex justify-between"><span className="text-foreground-secondary">Net</span>
                    <span className={`font-medium ${m.net >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                      {m.net >= 0 ? '+' : ''}{formatINR(m.net)}
                    </span>
                  </div>
                  <div className="flex justify-between"><span className="text-foreground-secondary">Balance</span>
                    <span className={`font-semibold ${m.running_balance >= 0 ? 'text-foreground' : 'text-red-600 dark:text-red-400'}`}>
                      {formatINR(m.running_balance)}
                    </span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ── Transactions ──────────────────────────────────────────────────────────────

const TYPE_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'inflow', label: 'Inflow only' },
  { value: 'outflow', label: 'Outflow only' },
]

function TransactionsTab({ initialData }: { initialData: any }) {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [search, setSearch] = useState('')
  const [type, setType] = useState('all')
  const [data, setData] = useState<any>(initialData)
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 50

  useEffect(() => { if (initialData !== null) { setData(initialData); setPage(1) } }, [initialData])

  const load = useCallback(async (p = page) => {
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
  }, [from, to, search, type, page])

  const handleRefresh = () => { setPage(1); load(1) }

  const totalPages = data?.total ? Math.ceil(data.total / PAGE_SIZE) : 1

  const exportCSV = () => {
    if (!data?.rows?.length) return
    const headers = ['Date', 'Type', 'Party', 'Ref', 'Method', 'Amount', 'Reference', 'Payout ID', 'Payout Status']
    const rows = data.rows.map((r: any) => [
      r.txn_date, r.direction, r.party, r.txn_ref, r.method,
      r.amount, r.reference || '', r.payout_id || '', r.payout_status || '',
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
            <input className={inputCls.replace('py-2.5', 'py-1.5')} value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleRefresh()} placeholder="Supplier, customer, ref..." />
          </div>
          <div className="flex gap-2 pb-0.5">
            <button className={btnPrimary} onClick={handleRefresh}>{loading ? 'Loading…' : 'Refresh'}</button>
            {data?.rows?.length > 0 && <button className={btnSecondary} onClick={exportCSV}>Export CSV</button>}
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
            <SummaryCard label="Net" value={formatINR(data.summary.net)} sub={data.summary.net >= 0 ? 'surplus' : 'deficit'} />
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
                        <td className="px-4 py-3 text-foreground-secondary whitespace-nowrap">{formatDate(r.txn_date)}</td>
                        <td className="px-4 py-3">
                          {r.direction === 'inflow'
                            ? <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">Inflow</span>
                            : <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">Outflow</span>}
                        </td>
                        <td className="px-4 py-3 font-medium text-foreground">
                          {r.direction === 'inflow'
                            ? r.source === 'cash_sale'
                              ? <span>{r.party}</span>
                              : r.user_id
                                ? <Link href={ap(`/admin/customers/${r.user_id}`)} className="hover:text-accent-500 hover:underline">{r.party}</Link>
                                : <Link href={ap(`/admin/orders/${r.id}`)} className="hover:text-accent-500 hover:underline">{r.party}</Link>
                            : r.supplier_id
                              ? <Link href={ap(`/admin/suppliers/${r.supplier_id}`)} className="hover:text-accent-500 hover:underline">{r.party}</Link>
                              : <Link href={ap(`/admin/financial/payables/${r.expense_id}`)} className="hover:text-accent-500 hover:underline">{r.party}</Link>}
                        </td>
                        <td className="px-4 py-3 text-foreground-secondary">
                          {r.direction === 'inflow'
                            ? r.source === 'cash_sale'
                              ? <a href={`/api/admin/cash-sale/${r.id}/receipt`} target="_blank" rel="noopener noreferrer" className="hover:text-accent-500 hover:underline font-mono">{r.txn_ref}</a>
                              : r.invoice_number
                                ? <Link href={ap(`/admin/invoices/${r.id}`)} className="hover:text-accent-500 hover:underline font-mono">{r.txn_ref}</Link>
                                : <Link href={ap(`/admin/orders/${r.id}`)} className="hover:text-accent-500 hover:underline font-mono">{r.txn_ref}</Link>
                            : <Link href={ap(`/admin/financial/payables/${r.expense_id}`)} className="hover:text-accent-500 hover:underline font-mono">{r.txn_ref}</Link>}
                        </td>
                        <td className="px-4 py-3 text-foreground-secondary capitalize">{r.method?.replace('_', ' ')}</td>
                        <td className={`px-4 py-3 text-right font-semibold ${r.direction === 'inflow' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                          {r.direction === 'inflow' ? '+' : '-'}{formatINR(parseFloat(r.amount))}
                        </td>
                        <td className="px-4 py-3 text-xs text-foreground-secondary font-mono">
                          {r.payout_id || r.reference || '—'}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {r.payout_status ? (
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                              r.payout_status === 'processed' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                              r.payout_status === 'failed' || r.payout_status === 'reversed' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' :
                              'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
                            }`}>{r.payout_status}</span>
                          ) : <span className="text-foreground-secondary">—</span>}
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
                        {r.direction === 'inflow'
                          ? r.source === 'cash_sale'
                            ? <span className="font-medium text-foreground text-sm">{r.party}</span>
                            : r.user_id
                              ? <Link href={ap(`/admin/customers/${r.user_id}`)} className="font-medium text-foreground text-sm hover:text-accent-500 hover:underline">{r.party}</Link>
                              : <Link href={ap(`/admin/orders/${r.id}`)} className="font-medium text-foreground text-sm hover:text-accent-500 hover:underline">{r.party}</Link>
                          : r.supplier_id
                            ? <Link href={ap(`/admin/suppliers/${r.supplier_id}`)} className="font-medium text-foreground text-sm hover:text-accent-500 hover:underline">{r.party}</Link>
                            : <Link href={ap(`/admin/financial/payables/${r.expense_id}`)} className="font-medium text-foreground text-sm hover:text-accent-500 hover:underline">{r.party}</Link>}
                        {r.txn_ref && (
                          r.direction === 'inflow'
                            ? r.source === 'cash_sale'
                              ? <a href={`/api/admin/cash-sale/${r.id}/receipt`} target="_blank" rel="noopener noreferrer" className="text-xs text-foreground-secondary font-mono mt-0.5 hover:text-accent-500 hover:underline block">{r.txn_ref}</a>
                              : r.invoice_number
                                ? <Link href={ap(`/admin/invoices/${r.id}`)} className="text-xs text-foreground-secondary font-mono mt-0.5 hover:text-accent-500 hover:underline block">{r.txn_ref}</Link>
                                : <Link href={ap(`/admin/orders/${r.id}`)} className="text-xs text-foreground-secondary font-mono mt-0.5 hover:text-accent-500 hover:underline block">{r.txn_ref}</Link>
                            : <Link href={ap(`/admin/financial/payables/${r.expense_id}`)} className="text-xs text-foreground-secondary font-mono mt-0.5 hover:text-accent-500 hover:underline block">{r.txn_ref}</Link>
                        )}
                      </div>
                      <p className={`font-semibold text-sm shrink-0 ${r.direction === 'inflow' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                        {r.direction === 'inflow' ? '+' : '-'}{formatINR(parseFloat(r.amount))}
                      </p>
                    </div>
                    <div className="flex items-center justify-between gap-2 text-xs text-foreground-secondary">
                      <span>{formatDate(r.txn_date)}</span>
                      {r.method && <span className="capitalize">{r.method.replace('_', ' ')}</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      {r.direction === 'inflow'
                        ? <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">Inflow</span>
                        : <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">Outflow</span>}
                      {r.payout_status && (
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          r.payout_status === 'processed' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                          r.payout_status === 'failed' || r.payout_status === 'reversed' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' :
                          'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
                        }`}>{r.payout_status}</span>
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
                  <p className="text-sm text-foreground-secondary">Page {page} of {totalPages} · {data.total} total</p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => load(page - 1)}
                      disabled={page === 1 || loading}
                      className="px-3 py-1.5 rounded-lg border border-border-default text-sm font-medium text-foreground-secondary hover:bg-surface-secondary disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >Previous</button>
                    <button
                      onClick={() => load(page + 1)}
                      disabled={page === totalPages || loading}
                      className="px-3 py-1.5 rounded-lg border border-border-default text-sm font-medium text-foreground-secondary hover:bg-surface-secondary disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >Next</button>
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

// ── Root ──────────────────────────────────────────────────────────────────────

const TABS: { key: Tab; label: string }[] = [
  { key: 'receivables', label: 'Receivables' },
  { key: 'payables', label: 'Payables' },
  { key: 'transactions', label: 'Transactions' },
  { key: 'pl', label: 'P&L' },
  { key: 'cashflow', label: 'Cashflow' },
]

export default function FinancialClient() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const tabParam = searchParams.get('tab') as Tab | null
  const validTabs: Tab[] = ['receivables', 'payables', 'transactions', 'pl', 'cashflow']
  const [tab, setTab] = useState<Tab>(tabParam && validTabs.includes(tabParam) ? tabParam : 'receivables')

  const now = new Date()
  const fyStart = now.getMonth() >= 3 ? `${now.getFullYear()}-04-01` : `${now.getFullYear() - 1}-04-01`
  const fyEnd = now.getMonth() >= 3 ? `${now.getFullYear() + 1}-03-31` : `${now.getFullYear()}-03-31`

  const [allData, setAllData] = useState<Record<string, any>>({})
  const loaded = useRef(false)

  useEffect(() => {
    if (loaded.current) return
    loaded.current = true

    fetch('/api/admin/financial/payables/sync-payouts', { method: 'POST' }).catch(() => {})

    Promise.allSettled([
      fetch('/api/admin/financial/receivables').then(r => r.json()),
      fetch('/api/admin/financial/payables').then(r => r.json()),
      fetch('/api/admin/financial/transactions').then(r => r.json()),
      fetch(`/api/admin/financial/pl?from=${fyStart}&to=${fyEnd}`).then(r => r.json()),
      fetch(`/api/admin/financial/cashflow?from=${fyStart}&to=${fyEnd}`).then(r => r.json()),
    ]).then(results => {
      const [rec, pay, txn, pl, cf] = results
      setAllData({
        receivables: rec.status === 'fulfilled' && !rec.value?.error ? rec.value : null,
        payables: pay.status === 'fulfilled' && !pay.value?.error ? pay.value : null,
        transactions: txn.status === 'fulfilled' && !txn.value?.error ? txn.value : null,
        pl: pl.status === 'fulfilled' ? pl.value : null,
        cashflow: cf.status === 'fulfilled' ? cf.value : null,
      })
    })
  }, [])

  function handleTabChange(key: Tab) {
    setTab(key)
    router.push(ap(`/admin/financial?tab=${key}`), { scroll: false })
  }

  return (
    <div className="space-y-4">
      <div className="flex border-b border-border-default gap-1">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => handleTabChange(t.key as Tab)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
              tab === t.key
                ? 'border-secondary-500 dark:border-secondary-400 text-secondary-500 dark:text-secondary-400'
                : 'border-transparent text-foreground-secondary hover:text-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div>
        {tab === 'receivables' && <ReceivablesTab initialData={allData.receivables ?? null} />}
        {tab === 'payables' && <PayablesTab initialData={allData.payables ?? null} />}
        {tab === 'transactions' && <TransactionsTab initialData={allData.transactions ?? null} />}
        {tab === 'pl' && <PLTab initialData={allData.pl ?? null} />}
        {tab === 'cashflow' && <CashflowTab initialData={allData.cashflow ?? null} />}
      </div>
    </div>
  )
}
