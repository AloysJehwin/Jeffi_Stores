'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import AdminSelect from '@/components/admin/AdminSelect'
import { ap } from '@/lib/shared/admin-path'
import { useCanWrite, RequireWrite } from '@/contexts/AdminScopesContext'

interface Customer {
  id: string
  email: string
  first_name: string
  last_name: string | null
  phone: string | null
  created_at: string
  company_name: string
  gst_number: string
  business_address: string
  industry: string
  approval_status: string
  approved_at: string | null
  rejection_note: string | null
}

interface Discount {
  id: string
  category_id: string
  category_name: string
  discount_pct: number
}

interface Category {
  id: string
  name: string
}

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-yellow-400/20 text-yellow-300',
  approved: 'bg-green-400/20 text-green-300',
  rejected: 'bg-red-400/20 text-red-300',
}

export default function BusinessCustomerDetailClient({ id }: { id: string }) {
  const canWrite = useCanWrite('business_customers:write')
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [discounts, setDiscounts] = useState<Discount[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [rejectionNote, setRejectionNote] = useState('')
  const [showRejectForm, setShowRejectForm] = useState(false)
  const [newCategoryId, setNewCategoryId] = useState('')
  const [newDiscountPct, setNewDiscountPct] = useState('')
  const [savingDiscount, setSavingDiscount] = useState<string | null>(null)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3000)
  }

  useEffect(() => {
    Promise.all([
      fetch(`/api/admin/business/customers/${id}`, { credentials: 'include' }).then(r => r.json()),
      fetch('/api/categories').then(r => r.json()),
    ])
      .then(([data, catData]) => {
        setCustomer(data.customer)
        setDiscounts(data.discounts || [])
        setCategories(catData.categories || [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [id])

  const handleApprove = async () => {
    setActionLoading(true)
    const res = await fetch(`/api/admin/business/customers/${id}/approve`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'approve' }),
    })
    if (res.ok) {
      setCustomer(c => (c ? { ...c, approval_status: 'approved' } : c))
      showToast('Account approved')
    } else {
      showToast('Failed to approve', 'error')
    }
    setActionLoading(false)
  }

  const handleReject = async () => {
    setActionLoading(true)
    const res = await fetch(`/api/admin/business/customers/${id}/approve`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reject', rejectionNote }),
    })
    if (res.ok) {
      setCustomer(c => (c ? { ...c, approval_status: 'rejected', rejection_note: rejectionNote } : c))
      setShowRejectForm(false)
      showToast('Account rejected')
    } else {
      showToast('Failed to reject', 'error')
    }
    setActionLoading(false)
  }

  const handleDiscountChange = async (categoryId: string, pct: number) => {
    setSavingDiscount(categoryId)
    const res = await fetch('/api/admin/business/discounts', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: id, categoryId, discountPct: pct }),
    })
    if (res.ok) {
      if (pct === 0) {
        setDiscounts(d => d.filter(x => x.category_id !== categoryId))
      } else {
        setDiscounts(d => {
          const exists = d.find(x => x.category_id === categoryId)
          if (exists) return d.map(x => (x.category_id === categoryId ? { ...x, discount_pct: pct } : x))
          const cat = categories.find(c => c.id === categoryId)
          return [
            ...d,
            { id: crypto.randomUUID(), category_id: categoryId, category_name: cat?.name || '', discount_pct: pct },
          ]
        })
      }
      showToast('Discount saved')
    } else {
      showToast('Failed to save discount', 'error')
    }
    setSavingDiscount(null)
  }

  const handleAddDiscount = async () => {
    const pct = parseFloat(newDiscountPct)
    if (!newCategoryId || isNaN(pct) || pct < 0 || pct > 100) return
    await handleDiscountChange(newCategoryId, pct)
    setNewCategoryId('')
    setNewDiscountPct('')
  }

  if (loading) {
    return (
      <div className="p-4 sm:p-6 max-w-full space-y-5 animate-fade-in">
        {/* Breadcrumb */}
        <div className="h-4 w-48 bg-surface-secondary rounded animate-pulse" />
        {/* Header card */}
        <div className="bg-surface-elevated rounded-2xl border border-border-default p-6 space-y-5">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
            <div className="w-14 h-14 rounded-xl bg-surface-secondary animate-pulse shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="h-6 w-48 bg-surface-secondary rounded animate-pulse" />
              <div className="h-4 w-36 bg-surface-secondary rounded animate-pulse" />
            </div>
            <div className="space-y-1 text-right">
              <div className="h-3 w-12 bg-surface-secondary rounded animate-pulse" />
              <div className="h-4 w-24 bg-surface-secondary rounded animate-pulse" />
            </div>
          </div>
          {/* Stats row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="rounded-xl border border-border-default p-3.5 space-y-2 animate-pulse"
                style={{ animationDelay: `${i * 50}ms` }}
              >
                <div className="h-3 w-16 bg-surface-secondary rounded" />
                <div className="h-4 w-20 bg-surface-secondary rounded" />
              </div>
            ))}
          </div>
        </div>
        {/* Main grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="lg:col-span-2 space-y-5">
            {/* Business profile card */}
            <div className="bg-surface-elevated rounded-xl border border-border-default p-5 space-y-4">
              <div className="h-3 w-28 bg-surface-secondary rounded animate-pulse" />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="space-y-1 animate-pulse" style={{ animationDelay: `${i * 40}ms` }}>
                    <div className="h-3 w-20 bg-surface-secondary rounded" />
                    <div className="h-4 w-32 bg-surface-secondary rounded" />
                  </div>
                ))}
              </div>
            </div>
            {/* Discounts card */}
            <div className="bg-surface-elevated rounded-xl border border-border-default p-5 space-y-4">
              <div className="h-3 w-36 bg-surface-secondary rounded animate-pulse" />
              {Array.from({ length: 3 }).map((_, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between py-3 border-b border-border-default animate-pulse"
                  style={{ animationDelay: `${i * 50}ms` }}
                >
                  <div className="h-4 w-32 bg-surface-secondary rounded" />
                  <div className="h-8 w-24 bg-surface-secondary rounded-lg" />
                </div>
              ))}
            </div>
          </div>
          {/* Approval card */}
          <div>
            <div className="bg-surface-elevated rounded-xl border border-border-default p-5 space-y-4">
              <div className="h-3 w-20 bg-surface-secondary rounded animate-pulse" />
              <div className="h-16 bg-surface-secondary rounded-lg animate-pulse" />
              <div className="h-9 bg-surface-secondary rounded-lg animate-pulse" />
              <div className="h-9 bg-surface-secondary rounded-lg animate-pulse" />
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (!customer) {
    return <div className="p-6 text-center text-foreground-muted">Customer not found.</div>
  }

  const initials =
    [customer.first_name?.[0], customer.last_name?.[0]].filter(Boolean).join('').toUpperCase() ||
    customer.company_name?.[0]?.toUpperCase() ||
    '?'
  const availableCategories = categories.filter(c => !discounts.find(d => d.category_id === c.id))

  return (
    <div className="p-4 sm:p-6 max-w-full space-y-5">
      {toast && (
        <div
          className={`fixed top-4 right-4 z-50 px-4 py-2 rounded-lg shadow-lg text-sm font-medium text-white ${toast.type === 'error' ? 'bg-red-600' : 'bg-green-600'}`}
        >
          {toast.msg}
        </div>
      )}

      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-foreground-secondary">
        <Link
          href={ap('/admin/business/customers')}
          className="text-accent-500 hover:text-accent-600 transition-colors"
        >
          Business Customers
        </Link>
        <span>/</span>
        <span className="text-foreground">{customer.company_name}</span>
      </div>

      {/* Header card */}
      <div className="bg-zinc-800 dark:bg-zinc-900 rounded-2xl p-6 text-white shadow-md border border-zinc-700 dark:border-zinc-800">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
          <div className="w-14 h-14 rounded-xl bg-zinc-600 dark:bg-zinc-700 flex items-center justify-center text-xl font-bold shrink-0">
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold">{customer.company_name}</h1>
              <span
                className={`px-2.5 py-0.5 text-xs font-semibold rounded-full ${STATUS_STYLES[customer.approval_status] || 'bg-zinc-500/20 text-zinc-300'}`}
              >
                {customer.approval_status.charAt(0).toUpperCase() + customer.approval_status.slice(1)}
              </span>
            </div>
            <p className="text-zinc-400 text-sm mt-0.5">{customer.email}</p>
            {customer.phone && <p className="text-zinc-500 text-xs mt-0.5">+91 {customer.phone}</p>}
          </div>
          <div className="text-right text-xs text-zinc-500 shrink-0">
            <p>Joined</p>
            <p className="text-zinc-300 font-medium mt-0.5">
              {new Date(customer.created_at).toLocaleDateString('en-IN', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              })}
            </p>
          </div>
        </div>

        {/* Stats row */}
        <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'GST Number', value: customer.gst_number || '—' },
            { label: 'Industry', value: customer.industry || '—' },
            { label: 'Contact', value: `${customer.first_name} ${customer.last_name || ''}`.trim() },
            { label: 'Discounts Set', value: String(discounts.length) },
          ].map(({ label, value }) => (
            <div key={label} className="bg-white/5 rounded-xl p-3.5 border border-white/10">
              <p className="text-zinc-400 text-xs mb-1">{label}</p>
              <p className="text-white font-semibold text-sm truncate">{value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Main grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Left — profile + address */}
        <div className="lg:col-span-2 space-y-5">
          {/* Business info */}
          <div className="bg-surface-elevated rounded-xl border border-border-default p-5">
            <h2 className="text-xs font-semibold text-foreground-muted uppercase tracking-wide mb-4">
              Business Profile
            </h2>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4 text-sm">
              {[
                ['Company Name', customer.company_name],
                ['GST Number', customer.gst_number],
                ['Industry', customer.industry],
                ['Phone', customer.phone ? `+91 ${customer.phone}` : '—'],
                ['Email', customer.email],
                ['Contact Person', `${customer.first_name} ${customer.last_name || ''}`.trim()],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-foreground-muted text-xs mb-0.5">{label}</dt>
                  <dd className="text-foreground font-medium">{value}</dd>
                </div>
              ))}
              <div className="sm:col-span-2">
                <dt className="text-foreground-muted text-xs mb-0.5">Business Address</dt>
                <dd className="text-foreground font-medium">{customer.business_address || '—'}</dd>
              </div>
            </dl>
          </div>

          {/* Discounts */}
          <div className="bg-surface-elevated rounded-xl border border-border-default p-5">
            <h2 className="text-xs font-semibold text-foreground-muted uppercase tracking-wide mb-4">
              Category Discounts
            </h2>

            {discounts.length > 0 ? (
              <div className="divide-y divide-border-default mb-4">
                {discounts.map(d => (
                  <div key={d.category_id} className="flex items-center justify-between py-3 gap-4">
                    <span className="text-sm font-medium text-foreground flex-1">{d.category_name}</span>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        defaultValue={d.discount_pct}
                        min={0}
                        max={100}
                        step={0.5}
                        disabled={!canWrite}
                        onBlur={e => {
                          const val = parseFloat(e.target.value)
                          if (!isNaN(val) && val !== d.discount_pct) handleDiscountChange(d.category_id, val)
                        }}
                        className="w-20 px-2 py-1.5 text-sm rounded-lg border border-border-default bg-surface focus:outline-none focus:ring-2 focus:ring-accent-500 text-right disabled:opacity-60"
                      />
                      <span className="text-sm text-foreground-secondary">%</span>
                      {savingDiscount === d.category_id && <span className="text-xs text-accent-500">Saving…</span>}
                      <RequireWrite scope="business_customers:write">
                        <button
                          onClick={() => handleDiscountChange(d.category_id, 0)}
                          className="text-xs text-red-500 hover:text-red-700 font-medium px-2 py-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                        >
                          Remove
                        </button>
                      </RequireWrite>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-foreground-muted mb-4">No category discounts set yet.</p>
            )}

            {availableCategories.length > 0 && (
              <RequireWrite scope="business_customers:write">
                <div className="flex items-end gap-3 pt-4 border-t border-border-default">
                  <div className="flex-1">
                    <AdminSelect
                      label="Category"
                      value={newCategoryId}
                      onChange={setNewCategoryId}
                      placeholder="Select category…"
                      options={availableCategories.map(c => ({ value: c.id, label: c.name }))}
                      sm
                    />
                  </div>
                  <div className="w-28">
                    <label className="block text-xs font-medium text-foreground-secondary mb-1.5">Discount %</label>
                    <input
                      type="number"
                      value={newDiscountPct}
                      onChange={e => setNewDiscountPct(e.target.value)}
                      placeholder="e.g. 10"
                      min={0}
                      max={100}
                      step={0.5}
                      className="w-full field-normal border border-border-default bg-surface focus:outline-none focus:ring-2 focus:ring-accent-500 text-right"
                    />
                  </div>
                  <button
                    onClick={handleAddDiscount}
                    disabled={!newCategoryId || !newDiscountPct}
                    className="px-4 py-2 text-sm font-semibold bg-accent-500 text-white rounded-lg hover:bg-accent-600 transition-colors disabled:opacity-50 mb-0.5"
                  >
                    Add
                  </button>
                </div>
              </RequireWrite>
            )}
          </div>
        </div>

        {/* Right — approval */}
        <div className="space-y-5">
          <div className="bg-surface-elevated rounded-xl border border-border-default p-5">
            <h2 className="text-xs font-semibold text-foreground-muted uppercase tracking-wide mb-4">Approval</h2>

            {customer.approval_status === 'pending' && (
              <div className="space-y-3">
                <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-3 text-sm text-yellow-700 dark:text-yellow-400">
                  This account is awaiting your review.
                </div>
                <RequireWrite scope="business_customers:write">
                  <button
                    onClick={handleApprove}
                    disabled={actionLoading}
                    className="w-full px-4 py-2 bg-green-600 text-white text-sm font-semibold rounded-lg hover:bg-green-700 transition-colors disabled:opacity-60"
                  >
                    Approve Account
                  </button>
                  {!showRejectForm ? (
                    <button
                      onClick={() => setShowRejectForm(true)}
                      className="w-full px-4 py-2 border border-red-400 text-red-600 dark:text-red-400 text-sm font-semibold rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                    >
                      Reject Account
                    </button>
                  ) : (
                    <div className="space-y-2">
                      <textarea
                        value={rejectionNote}
                        onChange={e => setRejectionNote(e.target.value)}
                        placeholder="Rejection reason (optional)"
                        rows={3}
                        className="w-full field-normal border border-border-default bg-surface focus:outline-none focus:ring-2 focus:ring-accent-500 resize-none"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={handleReject}
                          disabled={actionLoading}
                          className="flex-1 px-3 py-2 bg-red-600 text-white text-sm font-semibold rounded-lg hover:bg-red-700 transition-colors disabled:opacity-60"
                        >
                          Confirm Reject
                        </button>
                        <button
                          onClick={() => setShowRejectForm(false)}
                          className="px-3 py-2 border border-border-default text-sm rounded-lg hover:bg-surface-secondary transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </RequireWrite>
              </div>
            )}

            {customer.approval_status === 'approved' && (
              <div className="space-y-3">
                <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-3 text-sm text-green-700 dark:text-green-400">
                  Approved
                  {customer.approved_at
                    ? ` on ${new Date(customer.approved_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`
                    : ''}
                </div>
                <RequireWrite scope="business_customers:write">
                  {!showRejectForm ? (
                    <button
                      onClick={() => setShowRejectForm(true)}
                      className="w-full px-4 py-2 border border-red-400 text-red-600 dark:text-red-400 text-sm font-semibold rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                    >
                      Revoke &amp; Reject
                    </button>
                  ) : (
                    <div className="space-y-2">
                      <textarea
                        value={rejectionNote}
                        onChange={e => setRejectionNote(e.target.value)}
                        placeholder="Rejection reason (optional)"
                        rows={3}
                        className="w-full field-normal border border-border-default bg-surface focus:outline-none focus:ring-2 focus:ring-accent-500 resize-none"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={handleReject}
                          disabled={actionLoading}
                          className="flex-1 px-3 py-2 bg-red-600 text-white text-sm font-semibold rounded-lg hover:bg-red-700 transition-colors disabled:opacity-60"
                        >
                          Confirm Reject
                        </button>
                        <button
                          onClick={() => setShowRejectForm(false)}
                          className="px-3 py-2 border border-border-default text-sm rounded-lg hover:bg-surface-secondary transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </RequireWrite>
              </div>
            )}

            {customer.approval_status === 'rejected' && (
              <div className="space-y-3">
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 text-sm text-red-700 dark:text-red-400">
                  Account rejected
                  {customer.rejection_note && (
                    <p className="mt-1 font-normal text-foreground-secondary">{customer.rejection_note}</p>
                  )}
                </div>
                <RequireWrite scope="business_customers:write">
                  <button
                    onClick={handleApprove}
                    disabled={actionLoading}
                    className="w-full px-4 py-2 bg-green-600 text-white text-sm font-semibold rounded-lg hover:bg-green-700 transition-colors disabled:opacity-60"
                  >
                    Approve Instead
                  </button>
                </RequireWrite>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
