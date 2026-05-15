'use client'

import { useState, useCallback } from 'react'
import AdminTypeahead from '@/components/admin/AdminTypeahead'

type Tab = 'receivables' | 'payables' | 'pl' | 'cashflow'

const inputCls = 'w-full px-2 py-1.5 rounded border border-border-default bg-surface-secondary text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-secondary-500 dark:focus:ring-secondary-400'
const labelCls = 'block text-xs font-medium text-foreground-secondary mb-1'
const btnPrimary = 'px-3 py-1.5 rounded text-sm font-medium bg-secondary-500 hover:bg-secondary-600 dark:bg-secondary-400 dark:hover:bg-secondary-300 text-white dark:text-secondary-900 transition-colors'
const btnSecondary = 'px-3 py-1.5 rounded text-sm font-medium border border-border-default bg-surface hover:bg-surface-secondary text-foreground transition-colors'

function formatINR(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)
}

function formatDate(s: string) {
  if (!s) return ''
  return new Date(s).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

function agingBadge(bucket: string) {
  if (bucket === '0-30') return <span className="px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">{bucket}d</span>
  if (bucket === '31-60') return <span className="px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400">{bucket}d</span>
  return <span className="px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">60+d</span>
}

function SummaryCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-surface-elevated rounded-lg border border-border-default p-4">
      <p className="text-xs text-foreground-secondary mb-1">{label}</p>
      <p className="text-xl font-bold text-foreground">{value}</p>
      {sub && <p className="text-xs text-foreground-secondary mt-0.5">{sub}</p>}
    </div>
  )
}

function ReceivablesTab() {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [search, setSearch] = useState('')
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [markingPaid, setMarkingPaid] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (from) params.set('from', from)
    if (to) params.set('to', to)
    if (search) params.set('search', search)
    const res = await fetch(`/api/admin/financial/receivables?${params}`)
    const json = await res.json()
    setData(json?.error ? null : json)
    setLoading(false)
  }, [from, to, search])

  const markPaid = async (orderId: string) => {
    setMarkingPaid(orderId)
    await fetch(`/api/admin/orders/${orderId}/payment-status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payment_status: 'paid' }),
    })
    await load()
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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-end">
        <div>
          <label className={labelCls}>From</label>
          <input type="date" className={inputCls + ' w-36'} value={from} onChange={e => setFrom(e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>To</label>
          <input type="date" className={inputCls + ' w-36'} value={to} onChange={e => setTo(e.target.value)} />
        </div>
        <div className="flex-1 min-w-[180px]">
          <label className={labelCls}>Search customer / invoice</label>
          <AdminTypeahead
            type="receivables"
            value={search}
            onChange={setSearch}
            onEnter={load}
            placeholder="Name, invoice #..."
          />
        </div>
        <button className={btnPrimary} onClick={load}>{loading ? 'Loading...' : 'Load'}</button>
        {data?.rows?.length > 0 && <button className={btnSecondary} onClick={exportCSV}>Export CSV</button>}
      </div>

      {data && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <SummaryCard label="Total Outstanding" value={formatINR(data.summary.total)} />
            <SummaryCard label="0–30 Days" value={formatINR(data.summary.bucket_0_30)} sub="current" />
            <SummaryCard label="31–60 Days" value={formatINR(data.summary.bucket_31_60)} sub="aging" />
            <SummaryCard label="60+ Days" value={formatINR(data.summary.bucket_60plus)} sub="overdue" />
          </div>

          {data.rows.length === 0 ? (
            <p className="text-foreground-secondary text-sm text-center py-8">No outstanding receivables</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border-default">
              <table className="w-full text-sm">
                <thead className="bg-surface-secondary text-foreground-secondary text-xs">
                  <tr>
                    <th className="px-3 py-2 text-left">Customer</th>
                    <th className="px-3 py-2 text-left">Invoice #</th>
                    <th className="px-3 py-2 text-left">Date</th>
                    <th className="px-3 py-2 text-right">Amount</th>
                    <th className="px-3 py-2 text-center">Age</th>
                    <th className="px-3 py-2 text-center">Status</th>
                    <th className="px-3 py-2 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-default">
                  {data.rows.map((r: any) => (
                    <tr key={r.order_id} className="hover:bg-surface-secondary/50">
                      <td className="px-3 py-2">
                        <div className="font-medium text-foreground">{r.customer_name}</div>
                        {r.customer_phone && <div className="text-xs text-foreground-secondary">{r.customer_phone}</div>}
                      </td>
                      <td className="px-3 py-2 text-foreground-secondary">{r.invoice_number || r.order_number}</td>
                      <td className="px-3 py-2 text-foreground-secondary whitespace-nowrap">{formatDate(r.invoice_date)}</td>
                      <td className="px-3 py-2 text-right font-medium text-foreground">{formatINR(parseFloat(r.total_amount))}</td>
                      <td className="px-3 py-2 text-center">{agingBadge(r.aging_bucket)}</td>
                      <td className="px-3 py-2 text-center">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${r.payment_status === 'partial' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'}`}>
                          {r.payment_status}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-center">
                        <button
                          className="px-2 py-1 rounded text-xs font-medium bg-green-600 hover:bg-green-700 text-white disabled:opacity-50"
                          disabled={markingPaid === r.order_id}
                          onClick={() => markPaid(r.order_id)}
                        >
                          {markingPaid === r.order_id ? '...' : 'Mark Paid'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function PayablesTab() {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [search, setSearch] = useState('')
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [showAddForm, setShowAddForm] = useState(false)
  const [addForm, setAddForm] = useState({ supplier_name: '', amount: '', tax_amount: '', expense_date: '', due_date: '', description: '', supplier_gstin: '', notes: '' })
  const [saving, setSaving] = useState(false)
  const [payModal, setPayModal] = useState<{ id: string; supplier: string; remaining: number } | null>(null)
  const [payForm, setPayForm] = useState({ amount: '', payment_date: new Date().toISOString().slice(0, 10), payment_method: 'bank_transfer', reference: '' })
  const [paying, setPaying] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (from) params.set('from', from)
    if (to) params.set('to', to)
    if (search) params.set('search', search)
    const res = await fetch(`/api/admin/financial/payables?${params}`)
    const json = await res.json()
    setData(json?.error ? null : json)
    setLoading(false)
  }, [from, to, search])

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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-end">
        <div>
          <label className={labelCls}>From</label>
          <input type="date" className={inputCls + ' w-36'} value={from} onChange={e => setFrom(e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>To</label>
          <input type="date" className={inputCls + ' w-36'} value={to} onChange={e => setTo(e.target.value)} />
        </div>
        <div className="flex-1 min-w-[180px]">
          <label className={labelCls}>Search supplier / bill #</label>
          <AdminTypeahead
            type="payables"
            value={search}
            onChange={setSearch}
            onEnter={load}
            placeholder="Supplier name, bill #..."
          />
        </div>
        <button className={btnPrimary} onClick={load}>{loading ? 'Loading...' : 'Load'}</button>
        <button className={btnSecondary} onClick={() => setShowAddForm(v => !v)}>+ Add Bill</button>
      </div>

      {showAddForm && (
        <div className="bg-surface-elevated rounded-lg border border-border-default p-4 space-y-3">
          <h3 className="text-sm font-semibold text-foreground">New Supplier Bill</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <div>
              <label className={labelCls}>Supplier Name *</label>
              <input className={inputCls} value={addForm.supplier_name} onChange={e => setAddForm(f => ({ ...f, supplier_name: e.target.value }))} />
            </div>
            <div>
              <label className={labelCls}>GSTIN</label>
              <input className={inputCls} value={addForm.supplier_gstin} onChange={e => setAddForm(f => ({ ...f, supplier_gstin: e.target.value }))} />
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
              <input type="date" className={inputCls} value={addForm.expense_date} onChange={e => setAddForm(f => ({ ...f, expense_date: e.target.value }))} />
            </div>
            <div>
              <label className={labelCls}>Due Date</label>
              <input type="date" className={inputCls} value={addForm.due_date} onChange={e => setAddForm(f => ({ ...f, due_date: e.target.value }))} />
            </div>
            <div>
              <label className={labelCls}>Notes</label>
              <input className={inputCls} value={addForm.notes} onChange={e => setAddForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>
          <div className="flex gap-2">
            <button className={btnPrimary} onClick={submitBill} disabled={saving}>{saving ? 'Saving...' : 'Save Bill'}</button>
            <button className={btnSecondary} onClick={() => setShowAddForm(false)}>Cancel</button>
          </div>
        </div>
      )}

      {data && data.summary && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <SummaryCard label="Total Payable" value={formatINR(data.summary.total_payable)} />
            <SummaryCard label="Due This Week" value={formatINR(data.summary.due_this_week)} />
            <SummaryCard label="Overdue" value={formatINR(data.summary.overdue)} sub="past due date" />
          </div>

          {data.rows.length === 0 ? (
            <p className="text-foreground-secondary text-sm text-center py-8">No outstanding payables</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border-default">
              <table className="w-full text-sm">
                <thead className="bg-surface-secondary text-foreground-secondary text-xs">
                  <tr>
                    <th className="px-3 py-2 text-left">Supplier</th>
                    <th className="px-3 py-2 text-left">Bill #</th>
                    <th className="px-3 py-2 text-left">Bill Date</th>
                    <th className="px-3 py-2 text-left">Due Date</th>
                    <th className="px-3 py-2 text-right">Amount</th>
                    <th className="px-3 py-2 text-right">Paid</th>
                    <th className="px-3 py-2 text-center">Status</th>
                    <th className="px-3 py-2 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-default">
                  {data.rows.map((r: any) => {
                    const remaining = parseFloat(r.total_amount) - parseFloat(r.paid_amount)
                    return (
                      <tr key={r.id} className="hover:bg-surface-secondary/50">
                        <td className="px-3 py-2">
                          <div className="font-medium text-foreground">{r.supplier_name}</div>
                          {r.description && <div className="text-xs text-foreground-secondary">{r.description}</div>}
                        </td>
                        <td className="px-3 py-2 text-foreground-secondary">{r.expense_number}</td>
                        <td className="px-3 py-2 text-foreground-secondary whitespace-nowrap">{formatDate(r.expense_date)}</td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {r.due_date ? (
                            <span className={r.days_overdue ? 'text-red-600 dark:text-red-400 font-medium' : 'text-foreground-secondary'}>
                              {formatDate(r.due_date)}
                              {r.days_overdue ? ` (${r.days_overdue}d overdue)` : ''}
                            </span>
                          ) : <span className="text-foreground-secondary">—</span>}
                        </td>
                        <td className="px-3 py-2 text-right font-medium text-foreground">{formatINR(parseFloat(r.total_amount))}</td>
                        <td className="px-3 py-2 text-right text-foreground-secondary">{formatINR(parseFloat(r.paid_amount))}</td>
                        <td className="px-3 py-2 text-center">
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${r.status === 'paid' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : r.status === 'partial' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'}`}>
                            {r.status}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-center">
                          <button
                            className="px-2 py-1 rounded text-xs font-medium bg-secondary-500 hover:bg-secondary-600 dark:bg-secondary-400 dark:hover:bg-secondary-300 text-white dark:text-secondary-900"
                            onClick={() => { setPayModal({ id: r.id, supplier: r.supplier_name, remaining }); setPayForm(f => ({ ...f, amount: remaining.toFixed(2) })) }}
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
          )}
        </>
      )}

      {payModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-surface-elevated rounded-xl border border-border-default p-6 w-full max-w-sm space-y-4">
            <h3 className="text-base font-semibold text-foreground">Record Payment</h3>
            <p className="text-sm text-foreground-secondary">{payModal.supplier} — remaining {formatINR(payModal.remaining)}</p>
            <div>
              <label className={labelCls}>Amount *</label>
              <input type="number" step="0.01" className={inputCls} value={payForm.amount} onChange={e => setPayForm(f => ({ ...f, amount: e.target.value }))} />
            </div>
            <div>
              <label className={labelCls}>Payment Date *</label>
              <input type="date" className={inputCls} value={payForm.payment_date} onChange={e => setPayForm(f => ({ ...f, payment_date: e.target.value }))} />
            </div>
            <div>
              <label className={labelCls}>Method</label>
              <select className={inputCls} value={payForm.payment_method} onChange={e => setPayForm(f => ({ ...f, payment_method: e.target.value }))}>
                <option value="bank_transfer">Bank Transfer</option>
                <option value="upi">UPI</option>
                <option value="cash">Cash</option>
                <option value="cheque">Cheque</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Reference / UTR</label>
              <input className={inputCls} value={payForm.reference} onChange={e => setPayForm(f => ({ ...f, reference: e.target.value }))} />
            </div>
            <div className="flex gap-2">
              <button className={btnPrimary} onClick={submitPayment} disabled={paying}>{paying ? 'Saving...' : 'Record Payment'}</button>
              <button className={btnSecondary} onClick={() => setPayModal(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function PLTab() {
  const now = new Date()
  const fyStart = now.getMonth() >= 3 ? `${now.getFullYear()}-04-01` : `${now.getFullYear() - 1}-04-01`
  const fyEnd = now.getMonth() >= 3 ? `${now.getFullYear() + 1}-03-31` : `${now.getFullYear()}-03-31`

  const [from, setFrom] = useState(fyStart)
  const [to, setTo] = useState(fyEnd)
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(false)

  const load = async () => {
    setLoading(true)
    const res = await fetch(`/api/admin/financial/pl?from=${from}&to=${to}`)
    const json = await res.json()
    setData(json)
    setLoading(false)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-end">
        <div>
          <label className={labelCls}>From</label>
          <input type="date" className={inputCls + ' w-36'} value={from} onChange={e => setFrom(e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>To</label>
          <input type="date" className={inputCls + ' w-36'} value={to} onChange={e => setTo(e.target.value)} />
        </div>
        <button className={btnPrimary} onClick={load}>{loading ? 'Loading...' : 'Load'}</button>
      </div>

      {data && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <SummaryCard label="Revenue" value={formatINR(data.totals.revenue)} sub={`${data.totals.order_count} orders`} />
            <SummaryCard label="COGS" value={formatINR(data.totals.cogs)} />
            <SummaryCard label="Gross Profit" value={formatINR(data.totals.gross_profit)} />
            <SummaryCard label="Gross Margin" value={`${data.totals.gross_margin_pct}%`} />
            <SummaryCard label="GST Collected" value={formatINR(data.totals.tax_collected)} />
          </div>

          {data.monthly.length === 0 ? (
            <p className="text-foreground-secondary text-sm text-center py-8">No paid orders in this period</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border-default">
              <table className="w-full text-sm">
                <thead className="bg-surface-secondary text-foreground-secondary text-xs">
                  <tr>
                    <th className="px-3 py-2 text-left">Month</th>
                    <th className="px-3 py-2 text-right">Revenue</th>
                    <th className="px-3 py-2 text-right">COGS</th>
                    <th className="px-3 py-2 text-right">Gross Profit</th>
                    <th className="px-3 py-2 text-left">Margin</th>
                    <th className="px-3 py-2 text-right">GST</th>
                    <th className="px-3 py-2 text-right">Orders</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-default">
                  {data.monthly.map((m: any) => (
                    <tr key={m.month} className="hover:bg-surface-secondary/50">
                      <td className="px-3 py-2 font-medium text-foreground">
                        {new Date(m.month + '-01').toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}
                      </td>
                      <td className="px-3 py-2 text-right text-foreground">{formatINR(m.revenue)}</td>
                      <td className="px-3 py-2 text-right text-foreground-secondary">{formatINR(m.cogs)}</td>
                      <td className="px-3 py-2 text-right text-foreground">{formatINR(m.gross_profit)}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 bg-surface-secondary rounded-full h-2 overflow-hidden">
                            <div className="h-full bg-green-500 rounded-full" style={{ width: `${Math.min(m.gross_margin_pct, 100)}%` }} />
                          </div>
                          <span className="text-xs text-foreground-secondary w-10 text-right">{m.gross_margin_pct}%</span>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right text-foreground-secondary">{formatINR(m.tax_collected)}</td>
                      <td className="px-3 py-2 text-right text-foreground-secondary">{m.order_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function CashflowTab() {
  const now = new Date()
  const fyStart = now.getMonth() >= 3 ? `${now.getFullYear()}-04-01` : `${now.getFullYear() - 1}-04-01`
  const fyEnd = now.getMonth() >= 3 ? `${now.getFullYear() + 1}-03-31` : `${now.getFullYear()}-03-31`

  const [from, setFrom] = useState(fyStart)
  const [to, setTo] = useState(fyEnd)
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(false)

  const load = async () => {
    setLoading(true)
    const res = await fetch(`/api/admin/financial/cashflow?from=${from}&to=${to}`)
    const json = await res.json()
    setData(json)
    setLoading(false)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-end">
        <div>
          <label className={labelCls}>From</label>
          <input type="date" className={inputCls + ' w-36'} value={from} onChange={e => setFrom(e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>To</label>
          <input type="date" className={inputCls + ' w-36'} value={to} onChange={e => setTo(e.target.value)} />
        </div>
        <button className={btnPrimary} onClick={load}>{loading ? 'Loading...' : 'Load'}</button>
      </div>

      {data && (
        data.monthly.length === 0 ? (
          <p className="text-foreground-secondary text-sm text-center py-8">No transactions in this period</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border-default">
            <table className="w-full text-sm">
              <thead className="bg-surface-secondary text-foreground-secondary text-xs">
                <tr>
                  <th className="px-3 py-2 text-left">Month</th>
                  <th className="px-3 py-2 text-right">Cash In</th>
                  <th className="px-3 py-2 text-right">Cash Out</th>
                  <th className="px-3 py-2 text-right">Net</th>
                  <th className="px-3 py-2 text-right">Running Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-default">
                {data.monthly.map((m: any) => (
                  <tr key={m.month} className="hover:bg-surface-secondary/50">
                    <td className="px-3 py-2 font-medium text-foreground">
                      {new Date(m.month + '-01').toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}
                    </td>
                    <td className="px-3 py-2 text-right text-green-600 dark:text-green-400 font-medium">{formatINR(m.cash_in)}</td>
                    <td className="px-3 py-2 text-right text-red-600 dark:text-red-400">{formatINR(m.cash_out)}</td>
                    <td className={`px-3 py-2 text-right font-medium ${m.net >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                      {m.net >= 0 ? '+' : ''}{formatINR(m.net)}
                    </td>
                    <td className={`px-3 py-2 text-right font-semibold ${m.running_balance >= 0 ? 'text-foreground' : 'text-red-600 dark:text-red-400'}`}>
                      {formatINR(m.running_balance)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  )
}

const TABS: { key: Tab; label: string }[] = [
  { key: 'receivables', label: 'Receivables' },
  { key: 'payables', label: 'Payables' },
  { key: 'pl', label: 'P&L' },
  { key: 'cashflow', label: 'Cashflow' },
]

export default function FinancialClient() {
  const [tab, setTab] = useState<Tab>('receivables')

  return (
    <div className="space-y-4">
      <div className="flex border-b border-border-default gap-1">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
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
        {tab === 'receivables' && <ReceivablesTab />}
        {tab === 'payables' && <PayablesTab />}
        {tab === 'pl' && <PLTab />}
        {tab === 'cashflow' && <CashflowTab />}
      </div>
    </div>
  )
}
