'use client'

import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import AdminTypeahead from '@/components/admin/AdminTypeahead'
import AdminSelect from '@/components/admin/AdminSelect'

type Tab = 'suppliers' | 'po' | 'stock'

const TABS: { key: Tab; label: string }[] = [
  { key: 'suppliers', label: 'Suppliers' },
  { key: 'po', label: 'Purchase Orders' },
  { key: 'stock', label: 'Stock Ledger' },
]

const inputCls = 'w-full px-3 py-2 rounded-lg border border-border-default bg-surface text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-secondary-500 focus:border-transparent transition-colors placeholder:text-foreground-muted'
const labelCls = 'block text-xs font-medium text-foreground-secondary mb-1'
const btnPrimary = 'px-4 py-2.5 rounded-lg text-sm font-medium bg-secondary-500 hover:bg-secondary-600 dark:bg-secondary-400 dark:hover:bg-secondary-300 text-white dark:text-secondary-900 transition-colors disabled:opacity-50'
const btnSecondary = 'px-4 py-2.5 rounded-lg text-sm font-medium border border-border-default bg-surface hover:bg-surface-secondary text-foreground transition-colors'

const PAGE_SIZE = 20
const STOCK_PAGE_SIZE = 50
const VALUATION_PAGE_SIZE = 50

function formatINR(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)
}

function formatDate(s: string) {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

function fmtINR2(n: number) {
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function SummaryCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className={`rounded-xl border p-4 ${accent ? 'bg-secondary-50 dark:bg-secondary-900/20 border-secondary-200 dark:border-secondary-800/40' : 'bg-surface-elevated border-border-default'}`}>
      <p className="text-xs font-medium text-foreground-secondary mb-1">{label}</p>
      <p className={`text-xl font-bold ${accent ? 'text-secondary-600 dark:text-secondary-400' : 'text-foreground'}`}>{value}</p>
      {sub && <p className="text-xs text-foreground-muted mt-0.5">{sub}</p>}
    </div>
  )
}

function ClientPagination({ page, total, pageSize, onChange }: { page: number; total: number; pageSize: number; onChange: (p: number) => void }) {
  const totalPages = Math.ceil(total / pageSize)
  if (totalPages <= 1) return null

  const start = (page - 1) * pageSize + 1
  const end = Math.min(page * pageSize, total)

  const pages: (number | '…')[] = []
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i)
  } else {
    pages.push(1)
    if (page > 3) pages.push('…')
    for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) pages.push(i)
    if (page < totalPages - 2) pages.push('…')
    pages.push(totalPages)
  }

  const base = 'inline-flex items-center justify-center h-8 min-w-[2rem] px-2 rounded-md text-sm font-medium transition-colors'
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-1 pt-4 border-t border-border-default mt-2">
      <p className="text-xs text-foreground-muted">
        Showing <span className="font-medium text-foreground">{start}–{end}</span> of <span className="font-medium text-foreground">{total}</span>
      </p>
      <div className="flex items-center gap-1">
        <button onClick={() => onChange(page - 1)} disabled={page <= 1}
          className={`${base} border border-border-default ${page <= 1 ? 'opacity-40 pointer-events-none text-foreground-muted' : 'text-foreground-secondary hover:bg-surface-secondary'}`}>‹</button>
        {pages.map((p, i) =>
          p === '…' ? (
            <span key={`e-${i}`} className="px-1 text-foreground-muted text-sm">…</span>
          ) : (
            <button key={p} onClick={() => onChange(p as number)}
              className={`${base} ${p === page ? 'bg-secondary-500 dark:bg-secondary-400 text-white dark:text-secondary-900' : 'border border-border-default text-foreground-secondary hover:bg-surface-secondary'}`}>
              {p}
            </button>
          )
        )}
        <button onClick={() => onChange(page + 1)} disabled={page >= totalPages}
          className={`${base} border border-border-default ${page >= totalPages ? 'opacity-40 pointer-events-none text-foreground-muted' : 'text-foreground-secondary hover:bg-surface-secondary'}`}>›</button>
      </div>
    </div>
  )
}

const STATUS_BADGE: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600 dark:bg-gray-700/40 dark:text-gray-300',
  sent: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  partial: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  received: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  cancelled: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
}

const TYPE_BADGE: Record<string, string> = {
  purchase: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  sale: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  return: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  adjustment: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
}

type Supplier = {
  id: string; name: string; gstin: string | null; contact_name: string | null
  phone: string | null; email: string | null; payment_terms: number
  is_active: boolean; po_count: number
  address: string | null; notes: string | null
  bank_name: string | null; account_number: string | null; ifsc: string | null; upi_id: string | null
}

const emptySupplier = { name: '', gstin: '', contact_name: '', phone: '', email: '', address: '', payment_terms: '30', notes: '', bank_name: '', account_number: '', ifsc: '', upi_id: '' }

function SuppliersTab() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState(emptySupplier)
  const [saving, setSaving] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [ifscLookup, setIfscLookup] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle')

  const lookupIfsc = async (code: string) => {
    const clean = code.trim().toUpperCase()
    if (clean.length !== 11) return
    setIfscLookup('loading')
    try {
      const res = await fetch(`https://ifsc.razorpay.com/${clean}`)
      if (!res.ok) throw new Error()
      const data = await res.json()
      setForm(f => ({ ...f, bank_name: data.BANK || f.bank_name }))
      setIfscLookup('ok')
    } catch {
      setIfscLookup('error')
    }
  }

  const load = useCallback(async (pg = page) => {
    setLoading(true)
    const params = new URLSearchParams({ page: String(pg), limit: String(PAGE_SIZE) })
    if (search) params.set('search', search)
    if (showAll) params.set('all', 'true')
    const res = await fetch(`/api/admin/inventory/suppliers?${params}`)
    const json = await res.json()
    setSuppliers(json?.suppliers || [])
    setTotal(json?.total || 0)
    setLoading(false)
  }, [search, showAll, page])

  useEffect(() => { load(page) }, [load, page])

  function handleSearchChange(v: string) {
    setSearch(v)
    setPage(1)
  }

  async function save() {
    setSaving(true)
    const url = editId ? `/api/admin/inventory/suppliers/${editId}` : '/api/admin/inventory/suppliers'
    const method = editId ? 'PATCH' : 'POST'
    await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
    setSaving(false)
    setShowAdd(false)
    setEditId(null)
    setForm(emptySupplier)
    setIfscLookup('idle')
    load(page)
  }

  async function toggleActive(s: Supplier) {
    await fetch(`/api/admin/inventory/suppliers/${s.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: !s.is_active }),
    })
    load(page)
  }

  function startEdit(s: Supplier) {
    setEditId(s.id)
    setForm({ name: s.name, gstin: s.gstin || '', contact_name: s.contact_name || '', phone: s.phone || '', email: s.email || '', address: s.address || '', notes: s.notes || '', payment_terms: String(s.payment_terms), bank_name: s.bank_name || '', account_number: s.account_number || '', ifsc: s.ifsc || '', upi_id: s.upi_id || '' })
    setIfscLookup('idle')
    setShowAdd(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[200px]">
          <label className={labelCls}>Search suppliers</label>
          <AdminTypeahead
            type="suppliers"
            value={search}
            onChange={handleSearchChange}
            placeholder="Name, GSTIN, contact..."
            inputClassName="w-full px-3 py-2.5 pr-9 bg-surface border border-border-secondary rounded-lg text-sm text-foreground focus:ring-2 focus:ring-accent-500 focus:border-transparent transition-colors hover:border-border-default placeholder:text-foreground-muted"
          />
        </div>
        <div className="flex flex-col">
          <span className={labelCls}>&nbsp;</span>
          <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer py-2.5">
            <input type="checkbox" checked={showAll} onChange={e => { setShowAll(e.target.checked); setPage(1) }} className="accent-secondary-500 w-4 h-4" />
            Show inactive
          </label>
        </div>
        <div className="flex flex-col">
          <span className={labelCls}>&nbsp;</span>
          <button className={btnPrimary} onClick={() => { setShowAdd(v => !v); setEditId(null); setForm(emptySupplier) }}>
            + Add Supplier
          </button>
        </div>
      </div>

      {showAdd && (
        <div className="bg-surface-elevated rounded-xl border border-border-default p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">{editId ? 'Edit Supplier' : 'New Supplier'}</h3>
            <button onClick={() => { setShowAdd(false); setEditId(null) }} className="text-foreground-muted hover:text-foreground">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {([['name', 'Name *'], ['gstin', 'GSTIN'], ['contact_name', 'Contact Name'], ['phone', 'Phone'], ['email', 'Email'], ['payment_terms', 'Payment Terms (days)']] as [keyof typeof emptySupplier, string][]).map(([key, label]) => (
              <div key={key}>
                <label className={labelCls}>{label}</label>
                <input className={inputCls} value={form[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} />
              </div>
            ))}
            <div className="sm:col-span-2 lg:col-span-3">
              <label className={labelCls}>Address</label>
              <textarea className={inputCls} rows={2} value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} />
            </div>
            <div className="sm:col-span-2 lg:col-span-3">
              <label className={labelCls}>Notes</label>
              <textarea className={inputCls} rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>
          <p className="text-xs font-semibold uppercase tracking-wide text-foreground-secondary pt-1">Bank / Payment Details</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className={labelCls}>IFSC Code</label>
              <div className="relative">
                <input
                  className={inputCls}
                  value={form.ifsc}
                  onChange={e => { setForm(f => ({ ...f, ifsc: e.target.value.toUpperCase() })); setIfscLookup('idle') }}
                  onBlur={e => lookupIfsc(e.target.value)}
                  placeholder="e.g. HDFC0001234"
                  maxLength={11}
                />
                {ifscLookup === 'loading' && <span className="absolute right-2 top-2.5 text-xs text-foreground-secondary">…</span>}
                {ifscLookup === 'ok' && <span className="absolute right-2 top-2.5 text-xs text-green-600 dark:text-green-400">✓</span>}
                {ifscLookup === 'error' && <span className="absolute right-2 top-2.5 text-xs text-red-500">?</span>}
              </div>
            </div>
            <div>
              <label className={labelCls}>Bank Name</label>
              <input className={inputCls + ' bg-surface-secondary/60 cursor-default'} value={form.bank_name} readOnly placeholder="Auto-filled from IFSC" />
            </div>
            <div>
              <label className={labelCls}>Account Number</label>
              <input className={inputCls} value={form.account_number} onChange={e => setForm(f => ({ ...f, account_number: e.target.value }))} />
            </div>
            <div>
              <label className={labelCls}>UPI ID</label>
              <input className={inputCls} value={form.upi_id} onChange={e => setForm(f => ({ ...f, upi_id: e.target.value }))} placeholder="e.g. supplier@upi" />
            </div>
          </div>
          <div className="flex gap-3 pt-1">
            <button className={btnPrimary} onClick={save} disabled={saving || !form.name}>{saving ? 'Saving...' : 'Save Supplier'}</button>
            <button className={btnSecondary} onClick={() => { setShowAdd(false); setEditId(null) }}>Cancel</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-6 h-6 border-2 border-secondary-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="bg-surface-elevated rounded-xl border border-border-default overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-secondary border-b border-border-default">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-secondary uppercase tracking-wide">Name</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-secondary uppercase tracking-wide">GSTIN</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-secondary uppercase tracking-wide hidden sm:table-cell">Contact</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-secondary uppercase tracking-wide hidden md:table-cell">Phone</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-foreground-secondary uppercase tracking-wide hidden lg:table-cell">Terms</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-foreground-secondary uppercase tracking-wide">POs</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-foreground-secondary uppercase tracking-wide">Status</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-foreground-secondary uppercase tracking-wide">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-default">
                {suppliers.length === 0 && (
                  <tr><td colSpan={8} className="py-12 text-center text-foreground-secondary text-sm">
                    {search ? `No suppliers matching "${search}"` : 'No suppliers yet'}
                  </td></tr>
                )}
                {suppliers.map(s => (
                  <tr key={s.id} className="hover:bg-surface-secondary/50 transition-colors">
                    <td className="px-4 py-3 font-medium text-foreground">{s.name}</td>
                    <td className="px-4 py-3 font-mono text-xs text-foreground-secondary">{s.gstin || '—'}</td>
                    <td className="px-4 py-3 text-foreground-secondary hidden sm:table-cell">{s.contact_name || '—'}</td>
                    <td className="px-4 py-3 text-foreground-secondary hidden md:table-cell">{s.phone || '—'}</td>
                    <td className="px-4 py-3 text-right text-foreground-secondary hidden lg:table-cell">{s.payment_terms}d</td>
                    <td className="px-4 py-3 text-right text-foreground-secondary">{s.po_count}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${s.is_active ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-gray-100 text-gray-500 dark:bg-gray-700/40 dark:text-gray-400'}`}>
                        {s.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-3">
                        <button className="text-xs text-secondary-500 dark:text-secondary-400 hover:underline font-medium" onClick={() => startEdit(s)}>Edit</button>
                        <button className="text-xs text-foreground-secondary hover:text-foreground hover:underline" onClick={() => toggleActive(s)}>
                          {s.is_active ? 'Deactivate' : 'Activate'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 pb-4">
            <ClientPagination page={page} total={total} pageSize={PAGE_SIZE} onChange={p => { setPage(p); setLoading(true) }} />
          </div>
        </div>
      )}
    </div>
  )
}

type PO = {
  id: string; po_number: string; supplier_id: string; supplier_name: string
  status: string; order_date: string; expected_date: string | null
  item_count: number; total_amount: string
}

type POItem = {
  id: string; product_id: string; variant_id: string | null
  product_name: string; variant_name: string | null; sku: string | null
  quantity: string; unit_cost: string; tax_rate: string; total_cost: string; quantity_received: string
}

type POLineItem = {
  id: string; product_id: string; variant_id: string; product_name: string
  sku: string; quantity: string; unit_cost: string; tax_rate: string; hsn_code: string; mrp: number
}

type PickerProduct = {
  product_id: string; variant_id: string | null; name: string; variant_name: string | null
  sku: string; base_price: number | null; gst_percentage: number | null; hsn_code: string | null; mrp: number | null
}

type POSearchMode = 'name' | 'sku' | 'category'

function newPOLineItem(): POLineItem {
  return { id: Math.random().toString(36).slice(2), product_id: '', variant_id: '', product_name: '', sku: '', quantity: '1', unit_cost: '', tax_rate: '0', hsn_code: '', mrp: 0 }
}

function decodePOLineItemId(encoded: string) {
  const [product_id, variant_id_raw, , gst_raw, hsn_raw] = encoded.split('|')
  return { product_id, variant_id: variant_id_raw || '', tax_rate: gst_raw ? String(Math.round(parseFloat(gst_raw))) : '0', hsn_code: hsn_raw || '' }
}

function POTab() {
  const [pos, setPOs] = useState<PO[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [viewPO, setViewPO] = useState<{ po: any; items: POItem[] } | null>(null)
  const [receiveMode, setReceiveMode] = useState<{ po: any } | null>(null)
  const [newPO, setNewPO] = useState({ supplier_id: '', order_date: '', expected_date: '', notes: '', status: 'draft' })
  const [lineItems, setLineItems] = useState<POLineItem[]>([newPOLineItem()])
  const [searchModes, setSearchModes] = useState<Record<string, POSearchMode>>({})
  const [nameInputs, setNameInputs] = useState<Record<string, string>>({})
  const [skuInputs, setSkuInputs] = useState<Record<string, string>>({})
  const [categoryIds, setCategoryIds] = useState<Record<string, string>>({})
  const [poCategories, setPoCategories] = useState<{ id: string; name: string }[]>([])
  const [poPickerOpen, setPoPickerOpen] = useState(false)
  const [poPickerItemId, setPoPickerItemId] = useState<string | null>(null)
  const [poPickerCatId, setPoPickerCatId] = useState('')
  const [poPickerSearch, setPoPickerSearch] = useState('')
  const [poPickerResults, setPoPickerResults] = useState<PickerProduct[]>([])
  const [poPickerLoading, setPoPickerLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [receiveItems, setReceiveItems] = useState<any[]>([])
  const [receiveNotes, setReceiveNotes] = useState('')
  const [receiveSaving, setReceiveSaving] = useState(false)

  const load = useCallback(async (pg = page) => {
    setLoading(true)
    const params = new URLSearchParams({ page: String(pg), limit: String(PAGE_SIZE) })
    if (search) params.set('search', search)
    if (statusFilter) params.set('status', statusFilter)
    const res = await fetch(`/api/admin/inventory/po?${params}`)
    const json = await res.json()
    setPOs(json?.purchase_orders || [])
    setTotal(json?.total || 0)
    setLoading(false)
  }, [search, statusFilter, page])

  useEffect(() => { load(page) }, [load, page])

  useEffect(() => {
    if (showCreate && suppliers.length === 0) {
      fetch('/api/admin/inventory/suppliers?limit=1000').then(r => r.json()).then(j => setSuppliers(j?.suppliers || []))
    }
    if (showCreate && poCategories.length === 0) {
      fetch('/api/categories').then(r => r.json()).then(d => setPoCategories((d.categories || d || []).map((c: any) => ({ id: c.id, name: c.name }))))
    }
  }, [showCreate, suppliers.length, poCategories.length])

  async function loadPoPickerProducts(catId: string, q: string) {
    if (!catId) return
    setPoPickerLoading(true)
    try {
      const params = new URLSearchParams({ limit: '10000', category_id: catId })
      if (q.trim()) params.set('q', q.trim())
      const res = await fetch(`/api/admin/labels/products?${params}`, { credentials: 'include' })
      const json = await res.json()
      setPoPickerResults(json?.products || [])
    } catch { setPoPickerResults([]) }
    finally { setPoPickerLoading(false) }
  }

  function openPOPicker(itemId: string, catId: string) {
    setPoPickerItemId(itemId)
    setPoPickerCatId(catId)
    setPoPickerSearch('')
    setPoPickerResults([])
    setPoPickerOpen(true)
    loadPoPickerProducts(catId, '')
  }

  function applyPOPickerProduct(p: PickerProduct) {
    if (!poPickerItemId) return
    const displayName = p.variant_name ? `${p.name} — ${p.variant_name}` : p.name
    setLineItems(items => items.map(it => it.id !== poPickerItemId ? it : {
      ...it,
      product_id: p.product_id,
      product_name: displayName,
      sku: p.sku || '',
      variant_id: p.variant_id || '',
      tax_rate: p.gst_percentage != null ? String(Math.round(Number(p.gst_percentage))) : '0',
      hsn_code: p.hsn_code || '',
      mrp: Number(p.mrp) || 0,
    }))
    setPoPickerOpen(false)
    setPoPickerItemId(null)
  }

  function clearPOProduct(itemId: string) {
    setLineItems(items => items.map(it => it.id !== itemId ? it : {
      ...it, product_id: '', product_name: '', sku: '', variant_id: '', tax_rate: '0', hsn_code: '', mrp: 0,
    }))
    setNameInputs(p => { const n = { ...p }; delete n[itemId]; return n })
    setSkuInputs(p => { const n = { ...p }; delete n[itemId]; return n })
    setSearchModes(p => { const n = { ...p }; delete n[itemId]; return n })
  }

  async function createPO() {
    setSaving(true)
    const items = lineItems
      .filter(it => it.product_id && parseFloat(it.quantity) > 0)
      .map(it => ({
        product_id: it.product_id, variant_id: it.variant_id || null,
        product_name: it.product_name, sku: it.sku,
        quantity: parseFloat(it.quantity),
        unit_cost: parseFloat(it.unit_cost) || 0,
        tax_rate: parseFloat(it.tax_rate) || 0,
        hsn_code: it.hsn_code,
      }))
    const res = await fetch('/api/admin/inventory/po', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...newPO, items }) })
    const json = await res.json()
    setSaving(false)
    if (json.success) {
      setShowCreate(false)
      setNewPO({ supplier_id: '', order_date: '', expected_date: '', notes: '', status: 'draft' })
      setLineItems([newPOLineItem()])
      setNameInputs({}); setSkuInputs({}); setCategoryIds({}); setSearchModes({})
      load(1); setPage(1)
    }
  }

  async function openPO(id: string) {
    const res = await fetch(`/api/admin/inventory/po/${id}`)
    const json = await res.json()
    setViewPO({ po: json.purchase_order, items: json.items || [] })
  }

  async function openReceive(id: string) {
    const res = await fetch(`/api/admin/inventory/po/${id}`)
    const json = await res.json()
    const items = (json.items || []).map((it: POItem) => ({
      ...it,
      receive_qty: String(Math.max(0, parseFloat(it.quantity) - parseFloat(it.quantity_received || '0'))),
      receive_cost: it.unit_cost,
    }))
    setReceiveMode({ po: json.purchase_order })
    setReceiveItems(items)
    setReceiveNotes('')
  }

  async function submitReceive() {
    if (!receiveMode) return
    setReceiveSaving(true)
    const items = receiveItems.filter(it => parseFloat(it.receive_qty) > 0).map(it => ({
      po_item_id: it.id, product_id: it.product_id, variant_id: it.variant_id || null,
      quantity_received: parseFloat(it.receive_qty), unit_cost: parseFloat(it.receive_cost),
    }))
    const res = await fetch(`/api/admin/inventory/po/${receiveMode.po.id}/receive`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items, notes: receiveNotes }),
    })
    const json = await res.json()
    setReceiveSaving(false)
    if (json.success) { setReceiveMode(null); load(page) }
  }

  const taxableValue = lineItems.reduce((s, it) => s + (parseFloat(it.quantity) || 0) * (parseFloat(it.unit_cost) || 0), 0)
  const cgst = lineItems.reduce((s, it) => s + (parseFloat(it.quantity) || 0) * (parseFloat(it.unit_cost) || 0) * (parseFloat(it.tax_rate) || 0) / 200, 0)
  const sgst = cgst
  const rawTotal = taxableValue + cgst + sgst
  const poTotal = Math.round(rawTotal)
  const roundOff = poTotal - rawTotal
  const openCount = pos.filter(p => ['draft', 'sent', 'partial'].includes(p.status)).length
  const pendingValue = pos.filter(p => ['draft', 'sent', 'partial'].includes(p.status)).reduce((s, p) => s + parseFloat(p.total_amount || '0'), 0)

  if (receiveMode) {
    return (
      <div className="space-y-5">
        <div className="flex items-center gap-3">
          <button className={btnSecondary} onClick={() => setReceiveMode(null)}>
            <span className="flex items-center gap-1.5">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
              Back
            </span>
          </button>
          <div>
            <h3 className="font-semibold text-foreground">Receive Goods — {receiveMode.po.po_number}</h3>
            <p className="text-xs text-foreground-secondary mt-0.5">Supplier: {receiveMode.po.supplier_name}</p>
          </div>
        </div>
        <div className="bg-surface-elevated rounded-xl border border-border-default overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-secondary border-b border-border-default">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-secondary uppercase tracking-wide">Product</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-foreground-secondary uppercase tracking-wide">Ordered</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-foreground-secondary uppercase tracking-wide">Prev. Received</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-foreground-secondary uppercase tracking-wide">Receive Now</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-foreground-secondary uppercase tracking-wide">Unit Cost (₹)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-default">
                {receiveItems.map((it, idx) => (
                  <tr key={it.id} className="hover:bg-surface-secondary/50 transition-colors">
                    <td className="px-4 py-3 text-foreground">
                      <p className="font-medium">{it.product_name}{it.variant_name && <span className="text-foreground-secondary font-normal"> / {it.variant_name}</span>}</p>
                      {it.sku && <p className="text-xs text-foreground-muted font-mono mt-0.5">{it.sku}</p>}
                    </td>
                    <td className="px-4 py-3 text-right text-foreground-secondary">{parseFloat(it.quantity)}</td>
                    <td className="px-4 py-3 text-right text-foreground-secondary">{parseFloat(it.quantity_received || '0')}</td>
                    <td className="px-4 py-3 text-right">
                      <input type="number" min="0" step="0.001" className="w-24 px-2 py-1.5 rounded-lg border border-border-default bg-surface text-foreground text-sm text-right focus:outline-none focus:ring-2 focus:ring-secondary-500 focus:border-transparent" value={it.receive_qty}
                        onChange={e => setReceiveItems(items => items.map((r, i) => i === idx ? { ...r, receive_qty: e.target.value } : r))} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <input type="number" min="0" step="0.01" className="w-28 px-2 py-1.5 rounded-lg border border-border-default bg-surface text-foreground text-sm text-right focus:outline-none focus:ring-2 focus:ring-secondary-500 focus:border-transparent" value={it.receive_cost}
                        onChange={e => setReceiveItems(items => items.map((r, i) => i === idx ? { ...r, receive_cost: e.target.value } : r))} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div>
          <label className={labelCls}>Notes</label>
          <textarea className={inputCls} rows={2} value={receiveNotes} onChange={e => setReceiveNotes(e.target.value)} />
        </div>
        <div className="flex gap-3">
          <button className={btnPrimary} onClick={submitReceive} disabled={receiveSaving}>{receiveSaving ? 'Saving...' : 'Confirm Receipt'}</button>
          <button className={btnSecondary} onClick={() => setReceiveMode(null)}>Cancel</button>
        </div>
      </div>
    )
  }

  if (viewPO) {
    return (
      <div className="space-y-5">
        <div className="flex items-center gap-3">
          <button className={btnSecondary} onClick={() => setViewPO(null)}>
            <span className="flex items-center gap-1.5">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
              Back
            </span>
          </button>
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-foreground">{viewPO.po.po_number}</h3>
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[viewPO.po.status] || ''}`}>{viewPO.po.status}</span>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <SummaryCard label="Supplier" value={viewPO.po.supplier_name} />
          <SummaryCard label="Order Date" value={formatDate(viewPO.po.order_date)} />
          <SummaryCard label="Expected" value={viewPO.po.expected_date ? formatDate(viewPO.po.expected_date) : '—'} />
          <SummaryCard label="Subtotal" value={formatINR(parseFloat(viewPO.po.subtotal))} />
          <SummaryCard label="Tax" value={formatINR(parseFloat(viewPO.po.tax_amount))} />
          <SummaryCard label="Total" value={formatINR(parseFloat(viewPO.po.total_amount))} accent />
        </div>
        <div className="bg-surface-elevated rounded-xl border border-border-default overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-secondary border-b border-border-default">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-secondary uppercase tracking-wide">Product</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-secondary uppercase tracking-wide hidden sm:table-cell">SKU</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-foreground-secondary uppercase tracking-wide">Qty</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-foreground-secondary uppercase tracking-wide">Unit Cost</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-foreground-secondary uppercase tracking-wide hidden sm:table-cell">Tax %</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-foreground-secondary uppercase tracking-wide">Total</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-foreground-secondary uppercase tracking-wide">Received</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-default">
                {viewPO.items.map(it => (
                  <tr key={it.id} className="hover:bg-surface-secondary/50 transition-colors">
                    <td className="px-4 py-3 text-foreground">
                      <p className="font-medium">{it.product_name}{it.variant_name && <span className="text-foreground-secondary font-normal"> / {it.variant_name}</span>}</p>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-foreground-secondary hidden sm:table-cell">{it.sku || '—'}</td>
                    <td className="px-4 py-3 text-right text-foreground-secondary">{parseFloat(it.quantity)}</td>
                    <td className="px-4 py-3 text-right text-foreground">{formatINR(parseFloat(it.unit_cost))}</td>
                    <td className="px-4 py-3 text-right text-foreground-secondary hidden sm:table-cell">{it.tax_rate}%</td>
                    <td className="px-4 py-3 text-right font-semibold text-foreground">{formatINR(parseFloat(it.total_cost))}</td>
                    <td className="px-4 py-3 text-right">
                      <span className={`text-xs font-medium ${parseFloat(it.quantity_received || '0') >= parseFloat(it.quantity) ? 'text-green-600 dark:text-green-400' : parseFloat(it.quantity_received || '0') > 0 ? 'text-yellow-600 dark:text-yellow-400' : 'text-foreground-secondary'}`}>
                        {parseFloat(it.quantity_received || '0')} / {parseFloat(it.quantity)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <SummaryCard label="Open POs" value={String(openCount)} sub="draft · sent · partial" />
        <SummaryCard label="Pending Value" value={formatINR(pendingValue)} accent />
      </div>

      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[200px]">
          <label className={labelCls}>Search</label>
          <AdminTypeahead
            type="purchase_orders"
            value={search}
            onChange={v => { setSearch(v); setPage(1) }}
            placeholder="PO number, supplier..."
            inputClassName="w-full px-3 py-2.5 pr-9 bg-surface border border-border-secondary rounded-lg text-sm text-foreground focus:ring-2 focus:ring-accent-500 focus:border-transparent transition-colors hover:border-border-default placeholder:text-foreground-muted"
          />
        </div>
        <div className="w-44">
          <label className={labelCls}>Status</label>
          <AdminSelect
            value={statusFilter}
            onChange={v => { setStatusFilter(v); setPage(1) }}
            placeholder="All statuses"
            options={[
              { value: '', label: 'All statuses' },
              { value: 'draft', label: 'Draft' },
              { value: 'sent', label: 'Sent' },
              { value: 'partial', label: 'Partial' },
              { value: 'received', label: 'Received' },
              { value: 'cancelled', label: 'Cancelled' },
            ]}
          />
        </div>
        <div className="flex flex-col">
          <span className={labelCls}>&nbsp;</span>
          <button className={btnPrimary} onClick={() => setShowCreate(v => !v)}>
            {showCreate ? 'Cancel' : '+ Create PO'}
          </button>
        </div>
      </div>

      {showCreate && (
        <div className="bg-surface-elevated rounded-xl border border-border-default p-5 space-y-5">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">New Purchase Order</h3>
            <button onClick={() => setShowCreate(false)} className="text-foreground-muted hover:text-foreground">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className={labelCls}>Supplier <span className="text-red-500">*</span></label>
              <AdminSelect
                value={newPO.supplier_id}
                onChange={v => setNewPO(p => ({ ...p, supplier_id: v }))}
                placeholder="Select supplier"
                options={[{ value: '', label: 'Select supplier' }, ...suppliers.map(s => ({ value: s.id, label: s.name }))]}
              />
            </div>
            <div>
              <label className={labelCls}>Order Date</label>
              <input type="date" className={inputCls} value={newPO.order_date} onChange={e => setNewPO(p => ({ ...p, order_date: e.target.value }))} />
            </div>
            <div>
              <label className={labelCls}>Expected Date</label>
              <input type="date" className={inputCls} value={newPO.expected_date} onChange={e => setNewPO(p => ({ ...p, expected_date: e.target.value }))} />
            </div>
            <div>
              <label className={labelCls}>Status</label>
              <AdminSelect
                value={newPO.status}
                onChange={v => setNewPO(p => ({ ...p, status: v }))}
                options={[{ value: 'draft', label: 'Draft' }, { value: 'sent', label: 'Sent to Supplier' }]}
              />
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>Notes</label>
              <input className={inputCls} value={newPO.notes} onChange={e => setNewPO(p => ({ ...p, notes: e.target.value }))} placeholder="Optional notes..." />
            </div>
          </div>

          <div className="border border-border-default rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-foreground">Line Items</h2>
              <button type="button" onClick={() => setLineItems(items => [...items, newPOLineItem()])}
                className="flex items-center gap-1 text-xs text-secondary-500 dark:text-secondary-300 font-semibold hover:text-secondary-600 dark:hover:text-secondary-200 transition-colors">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                Add Item
              </button>
            </div>

            <div className="space-y-3">
              {lineItems.map((it, idx) => {
                const mode = searchModes[it.id] ?? 'name'
                const hasProduct = !!it.product_name
                return (
                  <div key={it.id} className="border border-border-default rounded-lg p-3 space-y-3 bg-surface">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-foreground-muted uppercase tracking-wide">Item {idx + 1}</span>
                      {lineItems.length > 1 && (
                        <button type="button" className="text-xs text-red-500 hover:text-red-600 font-medium"
                          onClick={() => setLineItems(items => items.filter(r => r.id !== it.id))}>Remove</button>
                      )}
                    </div>

                    {hasProduct ? (
                      <div className="flex items-center justify-between gap-2 px-3 py-2 bg-surface-secondary rounded-lg border border-border-default">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">{it.product_name}</p>
                          {it.sku && <p className="text-xs text-foreground-muted mt-0.5 font-mono">{it.sku}</p>}
                        </div>
                        <button type="button" onClick={() => clearPOProduct(it.id)}
                          className="shrink-0 text-xs text-secondary-500 dark:text-secondary-300 font-semibold hover:text-secondary-600 transition-colors">
                          Change
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <div className="flex gap-1 p-1 bg-surface-secondary rounded-lg w-fit">
                          {(['name', 'sku', 'category'] as POSearchMode[]).map(m => (
                            <button key={m} type="button"
                              onClick={() => {
                                setSearchModes(p => ({ ...p, [it.id]: m }))
                                setNameInputs(p => { const n = { ...p }; delete n[it.id]; return n })
                                setSkuInputs(p => { const n = { ...p }; delete n[it.id]; return n })
                              }}
                              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${mode === m ? 'bg-secondary-500 dark:bg-secondary-400 text-white dark:text-secondary-900 shadow-sm' : 'text-foreground-secondary hover:text-foreground'}`}>
                              {m === 'name' ? 'Name' : m === 'sku' ? 'SKU' : 'Category'}
                            </button>
                          ))}
                        </div>

                        {mode === 'name' && (
                          <AdminTypeahead type="po_line_items" value={nameInputs[it.id] ?? ''}
                            onChange={v => setNameInputs(p => ({ ...p, [it.id]: v }))}
                            onSelect={s => {
                              const d = decodePOLineItemId(s.id)
                              const sku = s.sublabel?.split(' · ')[0] ?? ''
                              setLineItems(items => items.map(r => r.id !== it.id ? r : { ...r, product_id: d.product_id, product_name: s.label, sku, variant_id: d.variant_id, tax_rate: d.tax_rate, hsn_code: d.hsn_code }))
                            }}
                            inputClassName={inputCls} placeholder="Search by product name..." />
                        )}
                        {mode === 'sku' && (
                          <AdminTypeahead type="po_line_items" value={skuInputs[it.id] ?? ''}
                            onChange={v => setSkuInputs(p => ({ ...p, [it.id]: v }))}
                            onSelect={s => {
                              const d = decodePOLineItemId(s.id)
                              const sku = s.sublabel?.split(' · ')[0] ?? ''
                              setLineItems(items => items.map(r => r.id !== it.id ? r : { ...r, product_id: d.product_id, product_name: s.label, sku, variant_id: d.variant_id, tax_rate: d.tax_rate, hsn_code: d.hsn_code }))
                            }}
                            inputClassName={inputCls + ' font-mono'} placeholder="e.g. JFS-1234" />
                        )}
                        {mode === 'category' && (
                          <div className="flex gap-2">
                            <div className="flex-1">
                              <AdminSelect value={categoryIds[it.id] ?? ''} onChange={v => setCategoryIds(p => ({ ...p, [it.id]: v }))}
                                placeholder="— Select category —"
                                options={poCategories.map(c => ({ value: c.id, label: c.name }))} />
                            </div>
                            <button type="button" disabled={!categoryIds[it.id]}
                              onClick={() => openPOPicker(it.id, categoryIds[it.id] ?? '')}
                              className="px-3 py-2 bg-secondary-500 hover:bg-secondary-600 dark:bg-secondary-400 dark:hover:bg-secondary-300 dark:text-secondary-900 disabled:opacity-40 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap">
                              Select Product
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <div>
                        <label className={labelCls}>HSN Code</label>
                        <input type="text" value={it.hsn_code}
                          onChange={e => setLineItems(items => items.map(r => r.id !== it.id ? r : { ...r, hsn_code: e.target.value }))}
                          className={inputCls + ' font-mono'} placeholder="9999" />
                      </div>
                      <div>
                        <label className={labelCls}>Tax %</label>
                        <AdminSelect value={it.tax_rate}
                          onChange={v => setLineItems(items => items.map(r => r.id !== it.id ? r : { ...r, tax_rate: v }))}
                          options={[{ value: '0', label: '0%' }, { value: '5', label: '5%' }, { value: '12', label: '12%' }, { value: '18', label: '18%' }, { value: '28', label: '28%' }]} />
                      </div>
                      <div>
                        <label className={labelCls}>Quantity <span className="text-red-500">*</span></label>
                        <input type="number" min="0.001" step="0.001" className={inputCls} value={it.quantity}
                          onChange={e => setLineItems(items => items.map(r => r.id !== it.id ? r : { ...r, quantity: e.target.value }))} />
                      </div>
                      <div>
                        <label className={labelCls}>Unit Cost (₹) <span className="text-red-500">*</span></label>
                        <input type="number" min="0" step="0.01" className={inputCls} value={it.unit_cost}
                          onChange={e => setLineItems(items => items.map(r => r.id !== it.id ? r : { ...r, unit_cost: e.target.value }))} />
                      </div>
                    </div>

                    {it.unit_cost && (
                      <p className="text-xs text-foreground-secondary text-right">
                        Line total: <span className="font-semibold text-foreground">₹{fmtINR2((parseFloat(it.quantity) || 0) * (parseFloat(it.unit_cost) || 0) * (1 + (parseFloat(it.tax_rate) || 0) / 100))}</span>
                        {parseFloat(it.tax_rate) > 0 && <span className="ml-1 text-foreground-muted">(incl. {it.tax_rate}% GST)</span>}
                      </p>
                    )}
                  </div>
                )
              })}
            </div>

            {lineItems.some(it => it.unit_cost) && (
              <div className="border-t border-border-default pt-3 mt-3 flex justify-end">
                <div className="text-right space-y-1 min-w-[220px]">
                  <div className="flex justify-between text-xs text-foreground-secondary"><span>Taxable Value</span><span>₹{fmtINR2(taxableValue)}</span></div>
                  <div className="flex justify-between text-xs text-foreground-secondary"><span>CGST</span><span>₹{fmtINR2(cgst)}</span></div>
                  <div className="flex justify-between text-xs text-foreground-secondary"><span>SGST</span><span>₹{fmtINR2(sgst)}</span></div>
                  {Math.abs(roundOff) >= 0.005 && (
                    <div className="flex justify-between text-xs text-foreground-secondary"><span>Round Off</span><span>{roundOff > 0 ? '+' : ''}₹{fmtINR2(roundOff)}</span></div>
                  )}
                  <div className="flex justify-between text-sm font-bold text-foreground border-t border-border-default pt-1 mt-1"><span>Total</span><span>{formatINR(poTotal)}</span></div>
                </div>
              </div>
            )}
          </div>

          <div className="flex gap-3">
            <button className={btnPrimary} onClick={createPO} disabled={saving || !newPO.supplier_id}>{saving ? 'Creating...' : 'Create PO'}</button>
            <button className={btnSecondary} onClick={() => setShowCreate(false)}>Cancel</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-6 h-6 border-2 border-secondary-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="bg-surface-elevated rounded-xl border border-border-default overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-secondary border-b border-border-default">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-secondary uppercase tracking-wide">PO #</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-secondary uppercase tracking-wide">Supplier</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-secondary uppercase tracking-wide hidden sm:table-cell">Date</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-secondary uppercase tracking-wide hidden md:table-cell">Expected</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-foreground-secondary uppercase tracking-wide hidden lg:table-cell">Items</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-foreground-secondary uppercase tracking-wide">Total</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-foreground-secondary uppercase tracking-wide">Status</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-foreground-secondary uppercase tracking-wide">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-default">
                {pos.length === 0 && (
                  <tr><td colSpan={8} className="py-12 text-center text-foreground-secondary text-sm">
                    {search || statusFilter ? 'No purchase orders match your filters' : 'No purchase orders yet'}
                  </td></tr>
                )}
                {pos.map(po => (
                  <tr key={po.id} className="hover:bg-surface-secondary/50 transition-colors">
                    <td className="px-4 py-3 font-mono text-xs text-foreground-secondary font-medium">{po.po_number}</td>
                    <td className="px-4 py-3 font-medium text-foreground">{po.supplier_name}</td>
                    <td className="px-4 py-3 text-foreground-secondary whitespace-nowrap hidden sm:table-cell">{formatDate(po.order_date)}</td>
                    <td className="px-4 py-3 text-foreground-secondary whitespace-nowrap hidden md:table-cell">{po.expected_date ? formatDate(po.expected_date) : '—'}</td>
                    <td className="px-4 py-3 text-right text-foreground-secondary hidden lg:table-cell">{po.item_count}</td>
                    <td className="px-4 py-3 text-right font-semibold text-foreground">{formatINR(parseFloat(po.total_amount))}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium capitalize ${STATUS_BADGE[po.status] || ''}`}>{po.status}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-3">
                        <button className="text-xs text-secondary-500 dark:text-secondary-400 hover:underline font-medium" onClick={() => openPO(po.id)}>View</button>
                        {['draft', 'sent', 'partial'].includes(po.status) && (
                          <button className="text-xs text-green-600 dark:text-green-400 hover:underline font-medium" onClick={() => openReceive(po.id)}>Receive</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 pb-4">
            <ClientPagination page={page} total={total} pageSize={PAGE_SIZE} onChange={p => { setPage(p); setLoading(true) }} />
          </div>
        </div>
      )}

      {poPickerOpen && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-surface-elevated border border-border-default rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border-default shrink-0">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Select Product</h3>
                <p className="text-xs text-foreground-muted mt-0.5">{poCategories.find(c => c.id === poPickerCatId)?.name || 'All products'}</p>
              </div>
              <button type="button" onClick={() => setPoPickerOpen(false)} className="p-1.5 text-foreground-secondary hover:text-foreground transition-colors rounded-lg hover:bg-surface-secondary">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="px-5 py-3 border-b border-border-default shrink-0">
              <input type="text" value={poPickerSearch}
                onChange={e => { setPoPickerSearch(e.target.value); loadPoPickerProducts(poPickerCatId, e.target.value) }}
                className={inputCls} placeholder="Filter by name or SKU…" autoFocus />
            </div>
            <div className="overflow-y-auto flex-1">
              {poPickerLoading ? (
                <div className="p-8 text-center text-foreground-muted text-sm">Loading…</div>
              ) : poPickerResults.length === 0 ? (
                <div className="p-8 text-center text-foreground-muted text-sm">No products found in this category.</div>
              ) : (() => {
                const groups: { productId: string; name: string; items: PickerProduct[] }[] = []
                for (const p of poPickerResults) {
                  const g = groups.find(g => g.productId === p.product_id)
                  if (g) g.items.push(p)
                  else groups.push({ productId: p.product_id, name: p.name, items: [p] })
                }
                return (
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-surface-secondary border-b border-border-default">
                      <tr>
                        <th className="px-4 py-2.5 text-left text-xs font-semibold text-foreground-secondary">Product / Variant</th>
                        <th className="px-4 py-2.5 text-left text-xs font-semibold text-foreground-secondary">SKU</th>
                        <th className="px-4 py-2.5 text-right text-xs font-semibold text-foreground-secondary">Price</th>
                      </tr>
                    </thead>
                    <tbody>
                      {groups.map(g => (
                        <>
                          {g.items.length > 1 && (
                            <tr key={`${g.productId}-header`}>
                              <td colSpan={3} className="px-4 pt-3 pb-1 text-xs font-semibold text-foreground-muted uppercase tracking-wider bg-surface-secondary">{g.name}</td>
                            </tr>
                          )}
                          {g.items.map(p => (
                            <tr key={`${p.product_id}-${p.variant_id || ''}`}
                              onClick={() => applyPOPickerProduct(p)}
                              className="border-t border-border-default hover:bg-surface-secondary cursor-pointer transition-colors">
                              <td className="px-4 py-2.5">
                                {g.items.length > 1 ? <span className="text-foreground pl-2">{p.variant_name || p.name}</span> : <span className="font-medium text-foreground">{p.name}</span>}
                              </td>
                              <td className="px-4 py-2.5 font-mono text-xs text-foreground-muted">{p.sku}</td>
                              <td className="px-4 py-2.5 text-right font-medium text-foreground">{p.base_price != null ? `₹${p.base_price}` : '—'}</td>
                            </tr>
                          ))}
                        </>
                      ))}
                    </tbody>
                  </table>
                )
              })()}
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}

type StockTransaction = {
  id: string; created_at: string; transaction_type: string
  quantity_change: number; quantity_after: number
  reference_type: string; reference_id: string; notes: string | null
  product_id: string; product_name: string; product_sku: string | null
  variant_id: string | null; variant_name: string | null
}

function StockTab() {
  const [transactions, setTransactions] = useState<StockTransaction[]>([])
  const [txTotal, setTxTotal] = useState(0)
  const [txPage, setTxPage] = useState(1)
  const [valuation, setValuation] = useState<{ products: any[]; totalValue: number } | null>(null)
  const [valPage, setValPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [view, setView] = useState<'ledger' | 'valuation'>('ledger')

  const loadLedger = useCallback(async (pg = txPage) => {
    setLoading(true)
    const params = new URLSearchParams({ view: 'ledger', page: String(pg), limit: String(STOCK_PAGE_SIZE) })
    if (search) params.set('search', search)
    if (from) params.set('from', from)
    if (to) params.set('to', to)
    const res = await fetch(`/api/admin/inventory/stock?${params}`)
    const json = await res.json()
    setTransactions(json?.transactions || [])
    setTxTotal(json?.total || 0)
    setLoading(false)
  }, [search, from, to, txPage])

  const loadValuation = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/admin/inventory/stock?view=valuation')
    const json = await res.json()
    setValuation(json)
    setLoading(false)
  }, [])

  useEffect(() => {
    if (view === 'ledger') loadLedger(txPage)
    else loadValuation()
  }, [view, loadLedger, loadValuation, txPage])

  const valRows = valuation?.products || []
  const valTotalPages = Math.ceil(valRows.length / VALUATION_PAGE_SIZE)
  const valSlice = valRows.slice((valPage - 1) * VALUATION_PAGE_SIZE, valPage * VALUATION_PAGE_SIZE)

  return (
    <div className="space-y-5">
      <div className="flex gap-1 border-b border-border-default">
        {(['ledger', 'valuation'] as const).map(v => (
          <button key={v} onClick={() => setView(v)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${view === v ? 'border-secondary-500 dark:border-secondary-400 text-secondary-500 dark:text-secondary-400' : 'border-transparent text-foreground-secondary hover:text-foreground'}`}>
            {v === 'ledger' ? 'Stock Ledger' : 'Valuation'}
          </button>
        ))}
      </div>

      {view === 'ledger' ? (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex-1 min-w-[200px]">
              <label className={labelCls}>Search product</label>
              <AdminTypeahead type="products" value={search}
                onChange={v => { setSearch(v); setTxPage(1) }}
                placeholder="Name, SKU..."
                inputClassName="w-full px-3 py-2.5 pr-9 bg-surface border border-border-secondary rounded-lg text-sm text-foreground focus:ring-2 focus:ring-accent-500 focus:border-transparent transition-colors hover:border-border-default placeholder:text-foreground-muted" />
            </div>
            <div>
              <label className={labelCls}>From</label>
              <input type="date" className="px-3 py-2.5 rounded-lg border border-border-secondary bg-surface text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-transparent hover:border-border-default w-36" value={from} onChange={e => { setFrom(e.target.value); setTxPage(1) }} />
            </div>
            <div>
              <label className={labelCls}>To</label>
              <input type="date" className="px-3 py-2.5 rounded-lg border border-border-secondary bg-surface text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-transparent hover:border-border-default w-36" value={to} onChange={e => { setTo(e.target.value); setTxPage(1) }} />
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="w-6 h-6 border-2 border-secondary-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <div className="bg-surface-elevated rounded-xl border border-border-default overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-surface-secondary border-b border-border-default">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-secondary uppercase tracking-wide">Date</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-secondary uppercase tracking-wide">Product</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-secondary uppercase tracking-wide">Type</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-foreground-secondary uppercase tracking-wide">Change</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-foreground-secondary uppercase tracking-wide">Balance</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-secondary uppercase tracking-wide hidden md:table-cell">Reference</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-default">
                    {transactions.length === 0 && (
                      <tr><td colSpan={6} className="py-12 text-center text-foreground-secondary text-sm">
                        {search || from || to ? 'No transactions match your filters' : 'No stock transactions yet'}
                      </td></tr>
                    )}
                    {transactions.map(tx => (
                      <tr key={tx.id} className="hover:bg-surface-secondary/50 transition-colors">
                        <td className="px-4 py-3 text-foreground-secondary whitespace-nowrap text-xs">
                          {new Date(tx.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                        </td>
                        <td className="px-4 py-3 text-foreground">
                          <p className="font-medium">{tx.product_name}{tx.variant_name && <span className="text-foreground-secondary font-normal"> / {tx.variant_name}</span>}</p>
                          {tx.product_sku && <p className="text-xs text-foreground-muted font-mono mt-0.5">{tx.product_sku}</p>}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${TYPE_BADGE[tx.transaction_type] || ''}`}>{tx.transaction_type}</span>
                        </td>
                        <td className={`px-4 py-3 text-right font-mono font-semibold ${tx.quantity_change > 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                          {tx.quantity_change > 0 ? '+' : ''}{tx.quantity_change}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-foreground font-medium">{tx.quantity_after}</td>
                        <td className="px-4 py-3 text-xs text-foreground-secondary font-mono hidden md:table-cell">{tx.reference_type}/{tx.reference_id.slice(0, 8)}…</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="px-4 pb-4">
                <ClientPagination page={txPage} total={txTotal} pageSize={STOCK_PAGE_SIZE} onChange={p => { setTxPage(p); setLoading(true) }} />
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="w-6 h-6 border-2 border-secondary-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : valuation ? (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                <SummaryCard label="Total Stock Value" value={formatINR(valuation.totalValue)} sub={`${valuation.products.length} SKUs`} accent />
              </div>
              <div className="bg-surface-elevated rounded-xl border border-border-default overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-surface-secondary border-b border-border-default">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-secondary uppercase tracking-wide">Product</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-secondary uppercase tracking-wide hidden sm:table-cell">Variant</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-secondary uppercase tracking-wide hidden md:table-cell">SKU</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-foreground-secondary uppercase tracking-wide">Stock</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-foreground-secondary uppercase tracking-wide">Price ex-GST</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-foreground-secondary uppercase tracking-wide">Stock Value</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border-default">
                      {valSlice.map((p, i) => {
                        return (
                          <tr key={i} className="hover:bg-surface-secondary/50 transition-colors">
                            <td className="px-4 py-3 font-medium text-foreground">{p.name}</td>
                            <td className="px-4 py-3 text-foreground-secondary hidden sm:table-cell">{p.variant_name || '—'}</td>
                            <td className="px-4 py-3 font-mono text-xs text-foreground-secondary hidden md:table-cell">{p.sku || '—'}</td>
                            <td className="px-4 py-3 text-right text-foreground-secondary">{parseFloat(p.inventory_quantity || '0')}</td>
                            <td className="px-4 py-3 text-right text-foreground">{formatINR(parseFloat(p.cost_price || '0'))}</td>
                            <td className="px-4 py-3 text-right font-semibold text-foreground">{formatINR(parseFloat(p.stock_value || '0'))}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="px-4 pb-4">
                  <ClientPagination page={valPage} total={valRows.length} pageSize={VALUATION_PAGE_SIZE} onChange={setValPage} />
                </div>
              </div>
            </>
          ) : null}
        </div>
      )}
    </div>
  )
}

export default function InventoryClient() {
  const [tab, setTab] = useState<Tab>('suppliers')

  return (
    <div className="space-y-5">
      <div className="flex border-b border-border-default gap-1">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${tab === t.key ? 'border-secondary-500 dark:border-secondary-400 text-secondary-500 dark:text-secondary-400' : 'border-transparent text-foreground-secondary hover:text-foreground'}`}>
            {t.label}
          </button>
        ))}
      </div>
      <div>
        {tab === 'suppliers' && <SuppliersTab />}
        {tab === 'po' && <POTab />}
        {tab === 'stock' && <StockTab />}
      </div>
    </div>
  )
}
