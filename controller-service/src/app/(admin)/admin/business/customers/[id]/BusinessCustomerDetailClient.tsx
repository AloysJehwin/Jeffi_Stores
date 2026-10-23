'use client'

import { useState, useEffect } from 'react'
import AdminSelect from '@/components/admin/AdminSelect'
import { ap } from '@/lib/shared/admin-path'
import { useCanWrite, RequireWrite } from '@/contexts/AdminScopesContext'
import { Card, DetailHeader, DetailSkeleton, EmptyState, EntityPage, Field, Fields, Kpi, KpiGrid, StatusBadge, TextArea, fieldInputCls, useActionToast } from '@/components/admin/kit'
import { APPROVAL_STATUS, fmtDay } from '../../_status'

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
  const toast = useActionToast()
  const showToast = (msg: string, type: 'success' | 'error' = 'success') => (type === 'error' ? toast.error(msg) : toast.success(msg))

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
      <div className="p-4 sm:p-6">
        <DetailSkeleton kpis={4} />
      </div>
    )
  }

  if (!customer) {
    return (
      <div className="p-4 sm:p-6">
        <EmptyState title="Customer not found." />
      </div>
    )
  }

  const initials =
    [customer.first_name?.[0], customer.last_name?.[0]].filter(Boolean).join('').toUpperCase() ||
    customer.company_name?.[0]?.toUpperCase() ||
    '?'
  const availableCategories = categories.filter(c => !discounts.find(d => d.category_id === c.id))
  const contact = `${customer.first_name} ${customer.last_name || ''}`.trim()

  const rejectForm = (
    <div className="space-y-2">
      <TextArea value={rejectionNote} onChange={e => setRejectionNote(e.target.value)} placeholder="Rejection reason (optional)" rows={3} className="resize-none" />
      <div className="flex gap-2">
        <button onClick={handleReject} disabled={actionLoading} className="control-md flex-1 bg-red-600 font-semibold text-white hover:bg-red-700 disabled:opacity-60">
          Confirm Reject
        </button>
        <button onClick={() => setShowRejectForm(false)} className="control-md border border-border-default text-foreground hover:bg-surface-secondary">
          Cancel
        </button>
      </div>
    </div>
  )
  const rejectButton = (label: string) => (
    <button onClick={() => setShowRejectForm(true)} className="control-md w-full border border-red-500/40 font-semibold text-red-600 hover:bg-red-500/10 dark:text-red-400">
      {label}
    </button>
  )
  const approveButton = (label: string) => (
    <button onClick={handleApprove} disabled={actionLoading} className="control-md w-full bg-green-600 font-semibold text-white hover:bg-green-700 disabled:opacity-60">
      {label}
    </button>
  )

  return (
    <EntityPage
      header={
        <DetailHeader
          back={{ href: ap('/admin/business/customers'), label: 'Business Customers' }}
          media={<div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-secondary text-sm font-bold text-foreground">{initials}</div>}
          title={customer.company_name}
          status={<StatusBadge status={customer.approval_status} map={APPROVAL_STATUS} />}
          subtitle={customer.email}
          identifiers={[
            ...(customer.phone ? [{ label: 'Phone', value: `+91 ${customer.phone}` }] : []),
            { label: 'Joined', value: fmtDay(customer.created_at) },
          ]}
        />
      }
      kpis={
        <KpiGrid>
          <Kpi label="GST number" value={customer.gst_number || '-'} />
          <Kpi label="Industry" value={customer.industry || '-'} />
          <Kpi label="Contact" value={contact || '-'} />
          <Kpi label="Discounts set" value={String(discounts.length)} highlight={discounts.length > 0} />
        </KpiGrid>
      }
      main={
        <>
          <Card title="Business profile">
            <Fields>
              <Field label="Company name" value={customer.company_name} />
              <Field label="GST number" value={customer.gst_number} mono copy={customer.gst_number || undefined} />
              <Field label="Industry" value={customer.industry} />
              <Field label="Phone" value={customer.phone ? `+91 ${customer.phone}` : null} />
              <Field label="Email" value={customer.email} />
              <Field label="Contact person" value={contact} />
              <Field span={2} label="Business address" value={customer.business_address} />
            </Fields>
          </Card>

          <Card title="Category discounts" hint="Percent off the customer price per category">
            {discounts.length > 0 ? (
              <div className="divide-y divide-border-default">
                {discounts.map(d => (
                  <div key={d.category_id} className="flex flex-wrap items-center justify-between gap-4 py-3">
                    <span className="flex-1 text-sm font-medium text-foreground">{d.category_name}</span>
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
                        className={`${fieldInputCls} w-20 text-right tabular-nums`}
                      />
                      <span className="text-sm text-foreground-secondary">%</span>
                      {savingDiscount === d.category_id && <span className="text-xs text-accent-500">Saving...</span>}
                      <RequireWrite scope="business_customers:write">
                        <button onClick={() => handleDiscountChange(d.category_id, 0)} className="control-sm text-xs font-medium text-red-600 hover:bg-red-500/10 dark:text-red-400">
                          Remove
                        </button>
                      </RequireWrite>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-foreground-muted">No category discounts set yet.</p>
            )}

            {availableCategories.length > 0 && (
              <RequireWrite scope="business_customers:write">
                <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-border-default pt-4">
                  <div className="w-full sm:min-w-[200px] sm:flex-1 sm:w-auto">
                    <AdminSelect
                      label="Category"
                      value={newCategoryId}
                      onChange={setNewCategoryId}
                      placeholder="Select category..."
                      options={availableCategories.map(c => ({ value: c.id, label: c.name }))}
                      sm
                    />
                  </div>
                  <div className="flex w-full gap-2 sm:w-auto">
                    <div className="w-28">
                      <label className="mb-1.5 block text-xs font-medium text-foreground-secondary">Discount %</label>
                      <input
                        type="number"
                        value={newDiscountPct}
                        onChange={e => setNewDiscountPct(e.target.value)}
                        placeholder="e.g. 10"
                        min={0}
                        max={100}
                        step={0.5}
                        className={`${fieldInputCls} text-right tabular-nums`}
                      />
                    </div>
                    <button onClick={handleAddDiscount} disabled={!newCategoryId || !newDiscountPct} className="control-md flex-1 self-end bg-accent-500 font-semibold text-white hover:bg-accent-600 disabled:opacity-50 sm:flex-none">
                      Add
                    </button>
                  </div>
                </div>
              </RequireWrite>
            )}
          </Card>
        </>
      }
      aside={
        <Card title="Approval">
          {customer.approval_status === 'pending' && (
            <div className="space-y-3">
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm text-amber-700 dark:text-amber-400">This account is awaiting your review.</div>
              <RequireWrite scope="business_customers:write">
                {approveButton('Approve Account')}
                {!showRejectForm ? rejectButton('Reject Account') : rejectForm}
              </RequireWrite>
            </div>
          )}

          {customer.approval_status === 'approved' && (
            <div className="space-y-3">
              <div className="rounded-lg border border-green-500/40 bg-green-500/5 p-3 text-sm text-green-700 dark:text-green-400">
                Approved{customer.approved_at ? ` on ${fmtDay(customer.approved_at)}` : ''}
              </div>
              <RequireWrite scope="business_customers:write">{!showRejectForm ? rejectButton('Revoke & Reject') : rejectForm}</RequireWrite>
            </div>
          )}

          {customer.approval_status === 'rejected' && (
            <div className="space-y-3">
              <div className="rounded-lg border border-red-500/40 bg-red-500/5 p-3 text-sm text-red-600 dark:text-red-400">
                Account rejected
                {customer.rejection_note && <p className="mt-1 font-normal text-foreground-secondary">{customer.rejection_note}</p>}
              </div>
              <RequireWrite scope="business_customers:write">{approveButton('Approve Instead')}</RequireWrite>
            </div>
          )}
        </Card>
      }
    />
  )
}
