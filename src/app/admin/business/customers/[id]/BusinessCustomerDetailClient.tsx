'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

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
  pending: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  approved: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  rejected: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
}

export default function BusinessCustomerDetailClient({ id }: { id: string }) {
  const router = useRouter()
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
  const [toast, setToast] = useState<string | null>(null)

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  useEffect(() => {
    Promise.all([
      fetch(`/api/admin/business/customers/${id}`).then(r => r.json()),
      fetch('/api/categories').then(r => r.json()),
    ]).then(([data, catData]) => {
      setCustomer(data.customer)
      setDiscounts(data.discounts || [])
      setCategories(catData.categories || [])
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [id])

  const handleApprove = async () => {
    setActionLoading(true)
    const res = await fetch(`/api/admin/business/customers/${id}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'approve' }),
    })
    if (res.ok) {
      setCustomer(c => c ? { ...c, approval_status: 'approved' } : c)
      showToast('Account approved')
    }
    setActionLoading(false)
  }

  const handleReject = async () => {
    setActionLoading(true)
    const res = await fetch(`/api/admin/business/customers/${id}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reject', rejectionNote }),
    })
    if (res.ok) {
      setCustomer(c => c ? { ...c, approval_status: 'rejected', rejection_note: rejectionNote } : c)
      setShowRejectForm(false)
      showToast('Account rejected')
    }
    setActionLoading(false)
  }

  const handleDiscountChange = async (categoryId: string, pct: number) => {
    setSavingDiscount(categoryId)
    const res = await fetch('/api/admin/business/discounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: id, categoryId, discountPct: pct }),
    })
    if (res.ok) {
      if (pct === 0) {
        setDiscounts(d => d.filter(x => x.category_id !== categoryId))
      } else {
        setDiscounts(d => {
          const exists = d.find(x => x.category_id === categoryId)
          if (exists) return d.map(x => x.category_id === categoryId ? { ...x, discount_pct: pct } : x)
          const cat = categories.find(c => c.id === categoryId)
          return [...d, { id: crypto.randomUUID(), category_id: categoryId, category_name: cat?.name || '', discount_pct: pct }]
        })
      }
      showToast('Discount saved')
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
      <div className="p-6 flex items-center justify-center py-16">
        <div className="animate-spin w-8 h-8 border-4 border-accent-500 border-t-transparent rounded-full" />
      </div>
    )
  }

  if (!customer) {
    return <div className="p-6 text-center text-foreground-muted">Customer not found.</div>
  }

  const availableCategories = categories.filter(c => !discounts.find(d => d.category_id === c.id))

  return (
    <div className="p-4 sm:p-6 max-w-4xl">
      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-green-600 text-white px-4 py-2 rounded-lg shadow-lg text-sm font-medium">
          {toast}
        </div>
      )}

      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <button onClick={() => router.back()} className="text-sm text-foreground-muted hover:text-foreground mb-2 flex items-center gap-1">
            ← Back
          </button>
          <h1 className="text-2xl font-bold text-foreground">{customer.company_name}</h1>
          <p className="text-sm text-foreground-secondary mt-0.5">{customer.email}</p>
        </div>
        <span className={`px-3 py-1 text-sm font-semibold rounded-full ${STATUS_STYLES[customer.approval_status] || ''}`}>
          {customer.approval_status.charAt(0).toUpperCase() + customer.approval_status.slice(1)}
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        {/* Profile */}
        <div className="bg-surface-elevated rounded-lg border border-border-default p-5">
          <h2 className="text-sm font-semibold text-foreground-secondary uppercase tracking-wide mb-4">Business Profile</h2>
          <dl className="space-y-3 text-sm">
            {[
              ['Company', customer.company_name],
              ['GST Number', customer.gst_number],
              ['Industry', customer.industry],
              ['Address', customer.business_address],
              ['Contact', `${customer.first_name} ${customer.last_name || ''}`],
              ['Phone', customer.phone || '—'],
              ['Joined', new Date(customer.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })],
            ].map(([label, value]) => (
              <div key={label} className="flex gap-3">
                <dt className="text-foreground-muted w-24 shrink-0">{label}</dt>
                <dd className="text-foreground font-medium flex-1">{value}</dd>
              </div>
            ))}
          </dl>
        </div>

        {/* Actions */}
        <div className="bg-surface-elevated rounded-lg border border-border-default p-5">
          <h2 className="text-sm font-semibold text-foreground-secondary uppercase tracking-wide mb-4">Approval</h2>
          {customer.approval_status === 'pending' && (
            <div className="space-y-3">
              <button
                onClick={handleApprove}
                disabled={actionLoading}
                className="w-full px-4 py-2.5 bg-green-600 text-white text-sm font-semibold rounded-lg hover:bg-green-700 transition-colors disabled:opacity-60"
              >
                Approve Account
              </button>
              {!showRejectForm ? (
                <button
                  onClick={() => setShowRejectForm(true)}
                  className="w-full px-4 py-2.5 border border-red-400 text-red-600 dark:text-red-400 text-sm font-semibold rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
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
                    className="w-full px-3 py-2 text-sm rounded-lg border border-border-default bg-surface focus:outline-none focus:ring-2 focus:ring-accent-500 resize-none"
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
            </div>
          )}
          {customer.approval_status === 'approved' && (
            <div className="space-y-3">
              <p className="text-sm text-green-700 dark:text-green-400 font-medium">
                Account approved {customer.approved_at ? `on ${new Date(customer.approved_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}
              </p>
              {!showRejectForm ? (
                <button
                  onClick={() => setShowRejectForm(true)}
                  className="w-full px-4 py-2.5 border border-red-400 text-red-600 dark:text-red-400 text-sm font-semibold rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
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
                    className="w-full px-3 py-2 text-sm rounded-lg border border-border-default bg-surface focus:outline-none focus:ring-2 focus:ring-accent-500 resize-none"
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
            </div>
          )}
          {customer.approval_status === 'rejected' && (
            <div className="space-y-3">
              <p className="text-sm text-red-600 dark:text-red-400 font-medium">Account rejected</p>
              {customer.rejection_note && (
                <p className="text-sm text-foreground-secondary bg-red-50 dark:bg-red-900/20 rounded-lg p-3">{customer.rejection_note}</p>
              )}
              <button
                onClick={handleApprove}
                disabled={actionLoading}
                className="w-full px-4 py-2.5 bg-green-600 text-white text-sm font-semibold rounded-lg hover:bg-green-700 transition-colors disabled:opacity-60"
              >
                Approve Instead
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Discounts */}
      <div className="bg-surface-elevated rounded-lg border border-border-default p-5">
        <h2 className="text-sm font-semibold text-foreground-secondary uppercase tracking-wide mb-4">Category Discounts</h2>
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
                    onBlur={e => {
                      const val = parseFloat(e.target.value)
                      if (!isNaN(val) && val !== d.discount_pct) {
                        handleDiscountChange(d.category_id, val)
                      }
                    }}
                    className="w-20 px-2 py-1.5 text-sm rounded-lg border border-border-default bg-surface focus:outline-none focus:ring-2 focus:ring-accent-500 text-right"
                  />
                  <span className="text-sm text-foreground-secondary">%</span>
                  {savingDiscount === d.category_id && (
                    <span className="text-xs text-accent-500">Saving…</span>
                  )}
                  <button
                    onClick={() => handleDiscountChange(d.category_id, 0)}
                    className="text-xs text-red-500 hover:text-red-700 font-medium px-2 py-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                    title="Remove discount"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-foreground-muted mb-4">No category discounts set. Add one below.</p>
        )}

        {/* Add new discount */}
        {availableCategories.length > 0 && (
          <div className="flex items-center gap-3 pt-3 border-t border-border-default">
            <select
              value={newCategoryId}
              onChange={e => setNewCategoryId(e.target.value)}
              className="flex-1 px-3 py-2 text-sm rounded-lg border border-border-default bg-surface focus:outline-none focus:ring-2 focus:ring-accent-500"
            >
              <option value="">Select category…</option>
              {availableCategories.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <input
              type="number"
              value={newDiscountPct}
              onChange={e => setNewDiscountPct(e.target.value)}
              placeholder="% off"
              min={0}
              max={100}
              step={0.5}
              className="w-24 px-3 py-2 text-sm rounded-lg border border-border-default bg-surface focus:outline-none focus:ring-2 focus:ring-accent-500 text-right"
            />
            <button
              onClick={handleAddDiscount}
              disabled={!newCategoryId || !newDiscountPct}
              className="px-4 py-2 text-sm font-semibold bg-accent-500 text-white rounded-lg hover:bg-accent-600 transition-colors disabled:opacity-50"
            >
              Add
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
