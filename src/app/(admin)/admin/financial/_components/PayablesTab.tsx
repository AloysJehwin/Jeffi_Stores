'use client'

import { useState, useCallback, useEffect } from 'react'
import Link from 'next/link'
import AdminTypeahead from '@/components/admin/AdminTypeahead'
import { ap } from '@/lib/shared/admin-path'
import DatePicker from '@/components/ui/DatePicker'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import {
  inputCls,
  labelCls,
  btnPrimary,
  btnSecondary,
  Skeleton,
  SummaryCard,
  StatusBadge,
  formatDate,
  formatINR,
  thCls,
  thRight,
  thCenter,
} from './shared'
import { PayablesPayModal } from './PayablesPayModal'

export function PayablesTab({ initialData }: { initialData: any }) {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [search, setSearch] = useState('')
  const [data, setData] = useState<any>(initialData)
  const [loading, setLoading] = useState(false)
  const [showAddForm, setShowAddForm] = useState(false)
  const [addForm, setAddForm] = useState({
    supplier_name: '',
    amount: '',
    tax_amount: '',
    expense_date: '',
    due_date: '',
    description: '',
    supplier_gstin: '',
    notes: '',
  })
  const [saving, setSaving] = useState(false)
  const [payModal, setPayModal] = useState<any | null>(null)
  const [payTab, setPayTab] = useState<'manual' | 'razorpayx'>('manual')
  const [payForm, setPayForm] = useState({
    amount: '',
    payment_date: new Date().toISOString().slice(0, 10),
    payment_method: 'bank_transfer',
    reference: '',
  })
  const [rzpForm, setRzpForm] = useState({ mode: 'IMPS', amount: '', notes: '' })
  const [paying, setPaying] = useState(false)
  const [payoutResult, setPayoutResult] = useState<any>(null)
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
      const res = await fetch(`/api/admin/financial/payables?${params}`)
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
    setAddForm({
      supplier_name: '',
      amount: '',
      tax_amount: '',
      expense_date: '',
      due_date: '',
      description: '',
      supplier_gstin: '',
      notes: '',
    })
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

  const closePayModal = () => {
    setPayModal(null)
    setPayoutResult(null)
  }

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
            <button className={btnPrimary} onClick={handleRefresh}>
              {loading ? 'Loading…' : 'Refresh'}
            </button>
            {canWrite && (
              <span className="hidden md:contents">
                <button className={btnSecondary} onClick={() => setShowAddForm(v => !v)}>
                  + Add Bill
                </button>
              </span>
            )}
          </div>
        </div>
      </div>

      {showAddForm && (
        <div className="bg-surface-elevated rounded-xl border border-border-default p-5 space-y-4">
          <h3 className="text-sm font-semibold text-foreground">New Supplier Bill</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className={labelCls}>Supplier Name *</label>
              <input
                className={inputCls}
                value={addForm.supplier_name}
                onChange={e => setAddForm(f => ({ ...f, supplier_name: e.target.value }))}
              />
            </div>
            <div>
              <label className={labelCls}>GSTIN</label>
              <input
                className={inputCls + ' font-mono'}
                value={addForm.supplier_gstin}
                onChange={e => setAddForm(f => ({ ...f, supplier_gstin: e.target.value.toUpperCase() }))}
                maxLength={15}
                placeholder="00XXXXX0000X0Z0"
              />
            </div>
            <div>
              <label className={labelCls}>Description</label>
              <input
                className={inputCls}
                value={addForm.description}
                onChange={e => setAddForm(f => ({ ...f, description: e.target.value }))}
              />
            </div>
            <div>
              <label className={labelCls}>Amount (excl. tax) *</label>
              <input
                type="number"
                step="0.01"
                className={inputCls}
                value={addForm.amount}
                onChange={e => setAddForm(f => ({ ...f, amount: e.target.value }))}
              />
            </div>
            <div>
              <label className={labelCls}>Tax Amount</label>
              <input
                type="number"
                step="0.01"
                className={inputCls}
                value={addForm.tax_amount}
                onChange={e => setAddForm(f => ({ ...f, tax_amount: e.target.value }))}
              />
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
              <input
                className={inputCls}
                value={addForm.notes}
                onChange={e => setAddForm(f => ({ ...f, notes: e.target.value }))}
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button className={btnPrimary} onClick={submitBill} disabled={saving}>
              {saving ? 'Saving…' : 'Save Bill'}
            </button>
            <button className={btnSecondary} onClick={() => setShowAddForm(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {!data ? (
        <Skeleton />
      ) : (
        data.summary && (
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
                              {r.supplier_id ? (
                                <Link
                                  href={ap(`/admin/suppliers/${r.supplier_id}`)}
                                  className="font-medium text-foreground hover:text-accent-500 hover:underline"
                                >
                                  {r.supplier_name}
                                </Link>
                              ) : (
                                <span className="font-medium text-foreground">{r.supplier_name}</span>
                              )}
                              {r.description && (
                                <div className="text-xs text-foreground-secondary">{r.description}</div>
                              )}
                            </td>
                            <td className="px-4 py-3 text-foreground-secondary">
                              <Link
                                href={ap(`/admin/financial/payables/${r.id}`)}
                                className="font-mono hover:text-accent-500 hover:underline"
                              >
                                {r.expense_number}
                              </Link>
                            </td>
                            <td className="px-4 py-3 text-foreground-secondary whitespace-nowrap">
                              {formatDate(r.expense_date)}
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap">
                              {r.due_date ? (
                                <span
                                  className={
                                    r.days_overdue
                                      ? 'text-red-600 dark:text-red-400 font-medium'
                                      : 'text-foreground-secondary'
                                  }
                                >
                                  {formatDate(r.due_date)}
                                  {r.days_overdue ? ` (${r.days_overdue}d overdue)` : ''}
                                </span>
                              ) : (
                                <span className="text-foreground-secondary">—</span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-right font-medium text-foreground">
                              {formatINR(parseFloat(r.total_amount))}
                            </td>
                            <td className="px-4 py-3 text-right text-foreground-secondary">
                              {formatINR(parseFloat(r.paid_amount))}
                            </td>
                            <td className="px-4 py-3 text-center">
                              <StatusBadge status={r.status} />
                            </td>
                            <td className="px-4 py-3 text-center">
                              {canWrite && (
                                <button
                                  className="px-3 py-1 rounded-lg text-xs font-medium bg-secondary-500 hover:bg-secondary-600 dark:bg-secondary-400 dark:hover:bg-secondary-300 text-white dark:text-secondary-900 transition-colors"
                                  onClick={() => openPayModal(r)}
                                >
                                  Pay
                                </button>
                              )}
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
                            {r.supplier_id ? (
                              <Link
                                href={ap(`/admin/suppliers/${r.supplier_id}`)}
                                className="font-medium text-foreground text-sm hover:text-accent-500 hover:underline"
                              >
                                {r.supplier_name}
                              </Link>
                            ) : (
                              <span className="font-medium text-foreground text-sm">{r.supplier_name}</span>
                            )}
                            {r.description && (
                              <p className="text-xs text-foreground-secondary mt-0.5">{r.description}</p>
                            )}
                          </div>
                          <div className="text-right shrink-0">
                            <p className="font-semibold text-foreground text-sm">
                              {formatINR(parseFloat(r.total_amount))}
                            </p>
                            {parseFloat(r.paid_amount) > 0 && (
                              <p className="text-xs text-foreground-secondary mt-0.5">
                                Paid {formatINR(parseFloat(r.paid_amount))}
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center justify-between gap-2 text-xs text-foreground-secondary">
                          <Link
                            href={ap(`/admin/financial/payables/${r.id}`)}
                            className="font-mono hover:text-accent-500 hover:underline"
                          >
                            {r.expense_number}
                          </Link>
                          <span>{formatDate(r.expense_date)}</span>
                        </div>
                        {r.due_date && (
                          <p
                            className={`text-xs ${r.days_overdue ? 'text-red-600 dark:text-red-400 font-medium' : 'text-foreground-secondary'}`}
                          >
                            Due {formatDate(r.due_date)}
                            {r.days_overdue ? ` · ${r.days_overdue}d overdue` : ''}
                          </p>
                        )}
                        <div className="flex items-center justify-between gap-2">
                          <StatusBadge status={r.status} />
                          {canWrite && (
                            <button
                              className="px-4 py-1.5 rounded-lg text-xs font-medium bg-secondary-500 hover:bg-secondary-600 dark:bg-secondary-400 text-white dark:text-secondary-900 transition-colors"
                              onClick={() => openPayModal(r)}
                            >
                              Pay
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  })}
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
        )
      )}

      {payModal && (
        <PayablesPayModal
          payModal={payModal}
          payTab={payTab}
          setPayTab={setPayTab}
          payForm={payForm}
          setPayForm={setPayForm}
          rzpForm={rzpForm}
          setRzpForm={setRzpForm}
          paying={paying}
          payoutResult={payoutResult}
          setPayoutResult={setPayoutResult}
          hasBank={hasBank}
          hasUpi={hasUpi}
          submitPayment={submitPayment}
          submitPayout={submitPayout}
          closePayModal={closePayModal}
        />
      )}
    </div>
  )
}
