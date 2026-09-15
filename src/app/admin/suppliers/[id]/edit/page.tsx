'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import { Check } from 'lucide-react'
import { ap } from '@/lib/admin-path'
import { RequireWrite } from '@/contexts/AdminScopesContext'

const inputCls = 'w-full px-3 py-2 rounded-lg border border-border-default bg-surface text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-secondary-500 focus:border-transparent transition-colors placeholder:text-foreground-muted'
const labelCls = 'block text-xs font-medium text-foreground-secondary mb-1'
const btnPrimary = 'control-md border border-transparent bg-secondary-500 hover:bg-secondary-600 dark:bg-secondary-400 dark:hover:bg-secondary-300 text-white dark:text-secondary-900 font-medium transition-colors disabled:opacity-50'
const btnSecondary = 'control-md border border-border-default bg-surface hover:bg-surface-secondary text-foreground font-medium transition-colors'

const emptyForm = { name: '', gstin: '', contact_name: '', phone: '', email: '', address: '', payment_terms: '30', notes: '', bank_name: '', account_number: '', ifsc: '', upi_id: '' }

export default function EditSupplierPage() {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const id = params.id
  const [form, setForm] = useState(emptyForm)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [hasDraft, setHasDraft] = useState(false)
  const [error, setError] = useState('')
  const [ifscLookup, setIfscLookup] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle')

  useEffect(() => {
    Promise.all([
      fetch(`/api/admin/suppliers/${id}`).then(r => r.json()),
      fetch(`/api/admin/suppliers/${id}/draft`, { credentials: 'include' }).then(r => r.json()),
    ]).then(([supplierJson, draftJson]) => {
      const s = supplierJson.supplier
      if (!s) { setError('Supplier not found'); return }
      const live = {
        name: s.name || '',
        gstin: s.gstin || '',
        contact_name: s.contact_name || '',
        phone: (s.phone || '').replace(/^\+?91/, '').replace(/\D/g, '').slice(-10),
        email: s.email || '',
        address: s.address || '',
        payment_terms: String(s.payment_terms ?? '30'),
        notes: s.notes || '',
        bank_name: s.bank_name || '',
        account_number: s.account_number || '',
        ifsc: s.ifsc || '',
        upi_id: s.upi_id || '',
      }
      const df = draftJson.draft_fields
      if (df) {
        setHasDraft(true)
        setForm({
          name: df.name ?? live.name,
          gstin: df.gstin ?? live.gstin,
          contact_name: df.contact_name ?? live.contact_name,
          phone: df.phone ?? live.phone,
          email: df.email ?? live.email,
          address: df.address ?? live.address,
          payment_terms: df.payment_terms ?? live.payment_terms,
          notes: df.notes ?? live.notes,
          bank_name: df.bank_name ?? live.bank_name,
          account_number: df.account_number ?? live.account_number,
          ifsc: df.ifsc ?? live.ifsc,
          upi_id: df.upi_id ?? live.upi_id,
        })
      } else {
        setForm(live)
      }
    }).catch(() => setError('Failed to load supplier')).finally(() => setLoading(false))

    // Auto-create draft on first visit
    fetch(`/api/admin/suppliers/${id}/draft`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
      .then(() => setHasDraft(true))
  }, [id])

  async function lookupIfsc(code: string) {
    const clean = code.trim().toUpperCase()
    if (clean.length !== 11) return
    setIfscLookup('loading')
    try {
      const res = await fetch(`https://ifsc.razorpay.com/${clean}`)
      if (!res.ok) throw new Error()
      const data = await res.json()
      setForm(f => ({ ...f, bank_name: data.BANK || f.bank_name }))
      setIfscLookup('ok')
    } catch { setIfscLookup('error') }
  }

  async function saveDraft() {
    if (!form.name.trim()) { setError('Supplier name is required'); return }
    setError('')
    setSaving(true)
    try {
      const res = await fetch(`/api/admin/suppliers/${id}/draft`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!res.ok) { const j = await res.json(); setError(j.error || 'Failed to save draft'); return }
      setHasDraft(true)
      router.push(ap('/admin/inventory?tab=suppliers'))
    } finally { setSaving(false) }
  }

  async function publish() {
    if (!form.name.trim()) { setError('Supplier name is required'); return }
    setError('')
    setPublishing(true)
    try {
      // Save latest form to draft first, then publish
      await fetch(`/api/admin/suppliers/${id}/draft`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const res = await fetch(`/api/admin/suppliers/${id}/draft`, { method: 'POST', credentials: 'include' })
      if (!res.ok) { const j = await res.json(); setError(j.error || 'Failed to publish'); return }
      router.push(ap('/admin/inventory?tab=suppliers'))
    } finally { setPublishing(false) }
  }

  async function discardDraft() {
    await fetch(`/api/admin/suppliers/${id}/draft`, { method: 'DELETE', credentials: 'include' })
    setHasDraft(false)
    // Reload from live
    const res = await fetch(`/api/admin/suppliers/${id}`)
    const json = await res.json()
    const s = json.supplier
    if (s) setForm({
      name: s.name || '', gstin: s.gstin || '', contact_name: s.contact_name || '',
      phone: (s.phone || '').replace(/^\+?91/, '').replace(/\D/g, '').slice(-10),
      email: s.email || '', address: s.address || '', payment_terms: String(s.payment_terms ?? '30'),
      notes: s.notes || '', bank_name: s.bank_name || '', account_number: s.account_number || '',
      ifsc: s.ifsc || '', upi_id: s.upi_id || '',
    })
  }

  if (loading) return null

  return (
    <div className="p-4 sm:p-6">
      <div className="flex items-center gap-3 mb-6">
        <Link href={ap('/admin/inventory?tab=suppliers')} className="p-1.5 text-foreground-secondary hover:text-foreground rounded-lg hover:bg-surface-secondary transition-colors">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-foreground">{hasDraft ? 'Edit Draft' : 'Edit Supplier'}</h1>
          <p className="text-foreground-secondary text-sm mt-0.5">{form.name}</p>
        </div>
      </div>

      {hasDraft && (
        <div className="mb-6 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 px-4 py-3 flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">Draft pending</p>
            <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">Changes are saved to draft. The live supplier stays unchanged until you publish.</p>
          </div>
          <RequireWrite scope="inventory">
            <button type="button" onClick={discardDraft} className="text-xs text-amber-600 hover:underline ml-4">Discard draft</button>
          </RequireWrite>
        </div>
      )}

      <form onSubmit={e => { e.preventDefault(); saveDraft() }} className="space-y-6">
        <div className="bg-surface-elevated rounded-xl border border-border-default p-5 space-y-4">
          <h2 className="text-sm font-semibold text-foreground">Basic Information</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className={labelCls}>Name <span className="text-red-500">*</span></label>
              <input className={inputCls} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Supplier or company name" />
            </div>
            <div>
              <label className={labelCls}>GSTIN</label>
              <input className={inputCls + ' font-mono'} value={form.gstin} onChange={e => setForm(f => ({ ...f, gstin: e.target.value.toUpperCase() }))} placeholder="00XXXXX0000X0Z0" maxLength={15} />
            </div>
            <div>
              <label className={labelCls}>Payment Terms (days)</label>
              <input type="number" min="0" className={inputCls} value={form.payment_terms} onChange={e => setForm(f => ({ ...f, payment_terms: e.target.value }))} placeholder="30" />
            </div>
            <div>
              <label className={labelCls}>Contact Name</label>
              <input className={inputCls} value={form.contact_name} onChange={e => setForm(f => ({ ...f, contact_name: e.target.value }))} />
            </div>
            <div>
              <label className={labelCls}>Phone</label>
              <div className="flex">
                <span className="inline-flex items-center px-3 rounded-l-lg border border-r-0 border-border-default bg-surface-secondary text-foreground-secondary text-sm select-none">+91</span>
                <input type="tel" inputMode="numeric" maxLength={10} className={inputCls + ' rounded-l-none'} value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value.replace(/\D/g, '').slice(0, 10) }))} placeholder="XXXXXXXXXX" />
              </div>
            </div>
            <div>
              <label className={labelCls}>Email</label>
              <input type="email" className={inputCls} value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
            </div>
            <div className="sm:col-span-2 lg:col-span-3">
              <label className={labelCls}>Address</label>
              <textarea className={inputCls} rows={2} value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} />
            </div>
            <div className="sm:col-span-2 lg:col-span-3">
              <label className={labelCls}>Notes</label>
              <textarea className={inputCls} rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>
        </div>

        <div className="bg-surface-elevated rounded-xl border border-border-default p-5 space-y-4">
          <h2 className="text-sm font-semibold text-foreground">Bank & Payment Details</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className={labelCls}>IFSC Code</label>
              <div className="relative">
                <input className={inputCls} value={form.ifsc}
                  onChange={e => { setForm(f => ({ ...f, ifsc: e.target.value.toUpperCase() })); setIfscLookup('idle') }}
                  onBlur={e => lookupIfsc(e.target.value)} placeholder="e.g. HDFC0001234" maxLength={11} />
                {ifscLookup === 'loading' && <span className="absolute right-2 top-2.5 text-xs text-foreground-secondary">…</span>}
                {ifscLookup === 'ok' && <Check className="absolute right-2 top-2.5 w-4 h-4 text-green-600 dark:text-green-400" />}
                {ifscLookup === 'error' && <span className="absolute right-2 top-2.5 text-xs text-red-500">?</span>}
              </div>
            </div>
            <div>
              <label className={labelCls}>Bank Name</label>
              <input className={inputCls + ' bg-surface-secondary/60'} value={form.bank_name} onChange={e => setForm(f => ({ ...f, bank_name: e.target.value }))} placeholder="Auto-filled from IFSC" />
            </div>
            <div>
              <label className={labelCls}>Account Number</label>
              <input className={inputCls} value={form.account_number} onChange={e => setForm(f => ({ ...f, account_number: e.target.value }))} />
            </div>
            <div>
              <label className={labelCls}>UPI ID</label>
              <input className={inputCls} value={form.upi_id} onChange={e => setForm(f => ({ ...f, upi_id: e.target.value }))} placeholder="supplier@upi" />
            </div>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 text-sm text-red-700 dark:text-red-300">
            {error}
          </div>
        )}

        <div className="flex gap-3">
          <RequireWrite scope="inventory">
            <button type="submit" disabled={saving || !form.name.trim()} className={btnPrimary}>
              {saving ? 'Saving…' : 'Save Draft'}
            </button>
            <button type="button" onClick={publish} disabled={publishing || !form.name.trim()} className="px-4 py-2 rounded-lg text-sm font-medium bg-green-600 hover:bg-green-700 text-white transition-colors disabled:opacity-50">
              {publishing ? 'Publishing…' : 'Publish'}
            </button>
          </RequireWrite>
          <Link href={ap('/admin/inventory?tab=suppliers')} className={btnSecondary}>
            Cancel
          </Link>
        </div>
      </form>
    </div>
  )
}
