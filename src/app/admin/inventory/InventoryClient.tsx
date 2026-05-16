'use client'

import { useState, useEffect, useCallback } from 'react'
import AdminTypeahead from '@/components/admin/AdminTypeahead'
import AdminSelect from '@/components/admin/AdminSelect'

type Tab = 'suppliers' | 'po' | 'stock'

const TABS: { key: Tab; label: string }[] = [
  { key: 'suppliers', label: 'Suppliers' },
  { key: 'po', label: 'Purchase Orders' },
  { key: 'stock', label: 'Stock Ledger' },
]

const inputCls = 'w-full px-2 py-1.5 rounded border border-border-default bg-surface-secondary text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-secondary-500 dark:focus:ring-secondary-400'
const labelCls = 'block text-xs font-medium text-foreground-secondary mb-1'
const btnPrimary = 'px-3 py-1.5 rounded text-sm font-medium bg-secondary-500 hover:bg-secondary-600 dark:bg-secondary-400 dark:hover:bg-secondary-300 text-white dark:text-secondary-900 transition-colors'
const btnSecondary = 'px-3 py-1.5 rounded text-sm font-medium border border-border-default bg-surface hover:bg-surface-secondary text-foreground transition-colors'

function formatINR(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)
}

function formatDate(s: string) {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
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

const STATUS_BADGE: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700 dark:bg-gray-700/40 dark:text-gray-300',
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
}

const emptySupplier = { name: '', gstin: '', contact_name: '', phone: '', email: '', address: '', payment_terms: '30', notes: '' }

function SuppliersTab() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState(emptySupplier)
  const [saving, setSaving] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [showAll, setShowAll] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (search) params.set('search', search)
    if (showAll) params.set('all', 'true')
    const res = await fetch(`/api/admin/inventory/suppliers?${params}`)
    const json = await res.json()
    setSuppliers(json?.suppliers || [])
    setLoading(false)
  }, [search, showAll])

  useEffect(() => { load() }, [load])

  async function save() {
    setSaving(true)
    const url = editId ? `/api/admin/inventory/suppliers/${editId}` : '/api/admin/inventory/suppliers'
    const method = editId ? 'PATCH' : 'POST'
    await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
    setSaving(false)
    setShowAdd(false)
    setEditId(null)
    setForm(emptySupplier)
    load()
  }

  async function toggleActive(s: Supplier) {
    await fetch(`/api/admin/inventory/suppliers/${s.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: !s.is_active }),
    })
    load()
  }

  function startEdit(s: Supplier) {
    setEditId(s.id)
    setForm({ name: s.name, gstin: s.gstin || '', contact_name: s.contact_name || '', phone: s.phone || '', email: s.email || '', address: '', notes: '', payment_terms: String(s.payment_terms) })
    setShowAdd(true)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-end">
        <div className="flex-1 min-w-[180px]">
          <label className={labelCls}>Search</label>
          <AdminTypeahead
            type="suppliers"
            value={search}
            onChange={setSearch}
            placeholder="Name, GSTIN, contact..."
          />
        </div>
        <label className="flex items-center gap-1.5 text-sm text-foreground cursor-pointer pb-0.5">
          <input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} className="accent-secondary-500" />
          Show inactive
        </label>
        <button className={btnSecondary} onClick={() => { setShowAdd(v => !v); setEditId(null); setForm(emptySupplier) }}>
          + Add Supplier
        </button>
      </div>

      {showAdd && (
        <div className="bg-surface-elevated rounded-lg border border-border-default p-4 space-y-3">
          <h3 className="text-sm font-semibold text-foreground">{editId ? 'Edit Supplier' : 'New Supplier'}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
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
          <div className="flex gap-2">
            <button className={btnPrimary} onClick={save} disabled={saving || !form.name}>{saving ? 'Saving...' : 'Save Supplier'}</button>
            <button className={btnSecondary} onClick={() => { setShowAdd(false); setEditId(null) }}>Cancel</button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-foreground-secondary py-8 text-center">Loading...</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border-default">
          <table className="w-full text-sm">
            <thead className="bg-surface-secondary text-foreground-secondary text-xs">
              <tr>
                <th className="px-3 py-2 text-left">Name</th>
                <th className="px-3 py-2 text-left">GSTIN</th>
                <th className="px-3 py-2 text-left">Contact</th>
                <th className="px-3 py-2 text-left">Phone</th>
                <th className="px-3 py-2 text-right">Terms</th>
                <th className="px-3 py-2 text-right">POs</th>
                <th className="px-3 py-2 text-center">Status</th>
                <th className="px-3 py-2 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-default">
              {suppliers.length === 0 && (
                <tr><td colSpan={8} className="py-8 text-center text-foreground-secondary">No suppliers found</td></tr>
              )}
              {suppliers.map(s => (
                <tr key={s.id} className="hover:bg-surface-secondary/50">
                  <td className="px-3 py-2 font-medium text-foreground">{s.name}</td>
                  <td className="px-3 py-2 text-foreground-secondary">{s.gstin || '—'}</td>
                  <td className="px-3 py-2 text-foreground-secondary">{s.contact_name || '—'}</td>
                  <td className="px-3 py-2 text-foreground-secondary">{s.phone || '—'}</td>
                  <td className="px-3 py-2 text-right text-foreground-secondary">{s.payment_terms}d</td>
                  <td className="px-3 py-2 text-right text-foreground-secondary">{s.po_count}</td>
                  <td className="px-3 py-2 text-center">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${s.is_active ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-gray-100 text-gray-500 dark:bg-gray-700/40 dark:text-gray-400'}`}>
                      {s.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-center space-x-3">
                    <button className="text-xs text-secondary-500 dark:text-secondary-400 hover:underline" onClick={() => startEdit(s)}>Edit</button>
                    <button className="text-xs text-foreground-secondary hover:underline" onClick={() => toggleActive(s)}>
                      {s.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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

type Product = { id: string; name: string; sku: string | null; has_variants: boolean; stock_quantity: number }

function POTab() {
  const [pos, setPOs] = useState<PO[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [viewPO, setViewPO] = useState<{ po: any; items: POItem[] } | null>(null)
  const [receiveMode, setReceiveMode] = useState<{ po: any } | null>(null)
  const [newPO, setNewPO] = useState({ supplier_id: '', order_date: '', expected_date: '', notes: '', status: 'draft' })
  const [lineItems, setLineItems] = useState<any[]>([{ product_id: '', variant_id: '', product_name: '', sku: '', quantity: '1', unit_cost: '', tax_rate: '0' }])
  const [productSearch, setProductSearch] = useState<Record<number, string>>({})
  const [productResults, setProductResults] = useState<Record<number, Product[]>>({})
  const [saving, setSaving] = useState(false)
  const [receiveItems, setReceiveItems] = useState<any[]>([])
  const [receiveNotes, setReceiveNotes] = useState('')
  const [receiveSaving, setReceiveSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (search) params.set('search', search)
    if (statusFilter) params.set('status', statusFilter)
    const res = await fetch(`/api/admin/inventory/po?${params}`)
    const json = await res.json()
    setPOs(json?.purchase_orders || [])
    setLoading(false)
  }, [search, statusFilter])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (showCreate && suppliers.length === 0) {
      fetch('/api/admin/inventory/suppliers').then(r => r.json()).then(j => setSuppliers(j?.suppliers || []))
    }
  }, [showCreate, suppliers.length])

  async function searchProducts(idx: number, term: string) {
    setProductSearch(p => ({ ...p, [idx]: term }))
    if (term.length < 2) { setProductResults(p => ({ ...p, [idx]: [] })); return }
    const res = await fetch(`/api/admin/products?search=${encodeURIComponent(term)}&limit=10`)
    const json = await res.json()
    setProductResults(p => ({ ...p, [idx]: json?.products || [] }))
  }

  function selectProduct(idx: number, product: Product) {
    setLineItems(items => items.map((it, i) => i === idx ? { ...it, product_id: product.id, product_name: product.name, sku: product.sku || '', variant_id: '' } : it))
    setProductSearch(p => ({ ...p, [idx]: product.name }))
    setProductResults(p => ({ ...p, [idx]: [] }))
  }

  async function createPO() {
    setSaving(true)
    const items = lineItems.filter(it => it.product_id && parseFloat(it.quantity) > 0)
    const res = await fetch('/api/admin/inventory/po', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...newPO, items }) })
    const json = await res.json()
    setSaving(false)
    if (json.success) {
      setShowCreate(false)
      setNewPO({ supplier_id: '', order_date: '', expected_date: '', notes: '', status: 'draft' })
      setLineItems([{ product_id: '', variant_id: '', product_name: '', sku: '', quantity: '1', unit_cost: '', tax_rate: '0' }])
      load()
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
    if (json.success) { setReceiveMode(null); load() }
  }

  const openCount = pos.filter(p => ['draft', 'sent', 'partial'].includes(p.status)).length
  const pendingValue = pos.filter(p => ['draft', 'sent', 'partial'].includes(p.status)).reduce((s, p) => s + parseFloat(p.total_amount || '0'), 0)

  if (receiveMode) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <button className={btnSecondary} onClick={() => setReceiveMode(null)}>← Back</button>
          <div>
            <h3 className="font-semibold text-foreground">Receive Goods — {receiveMode.po.po_number}</h3>
            <p className="text-xs text-foreground-secondary">Supplier: {receiveMode.po.supplier_name}</p>
          </div>
        </div>
        <div className="overflow-x-auto rounded-lg border border-border-default">
          <table className="w-full text-sm">
            <thead className="bg-surface-secondary text-foreground-secondary text-xs">
              <tr>
                <th className="px-3 py-2 text-left">Product</th>
                <th className="px-3 py-2 text-right">Ordered</th>
                <th className="px-3 py-2 text-right">Prev. Received</th>
                <th className="px-3 py-2 text-right">Receive Now</th>
                <th className="px-3 py-2 text-right">Unit Cost (₹)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-default">
              {receiveItems.map((it, idx) => (
                <tr key={it.id} className="hover:bg-surface-secondary/50">
                  <td className="px-3 py-2 text-foreground">
                    {it.product_name}
                    {it.variant_name && <span className="text-foreground-secondary"> / {it.variant_name}</span>}
                    {it.sku && <div className="text-xs text-foreground-secondary">{it.sku}</div>}
                  </td>
                  <td className="px-3 py-2 text-right text-foreground-secondary">{parseFloat(it.quantity)}</td>
                  <td className="px-3 py-2 text-right text-foreground-secondary">{parseFloat(it.quantity_received || '0')}</td>
                  <td className="px-3 py-2 text-right">
                    <input type="number" min="0" step="0.001" className={inputCls + ' w-24 text-right'} value={it.receive_qty}
                      onChange={e => setReceiveItems(items => items.map((r, i) => i === idx ? { ...r, receive_qty: e.target.value } : r))} />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <input type="number" min="0" step="0.01" className={inputCls + ' w-28 text-right'} value={it.receive_cost}
                      onChange={e => setReceiveItems(items => items.map((r, i) => i === idx ? { ...r, receive_cost: e.target.value } : r))} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div>
          <label className={labelCls}>Notes</label>
          <textarea className={inputCls} rows={2} value={receiveNotes} onChange={e => setReceiveNotes(e.target.value)} />
        </div>
        <div className="flex gap-2">
          <button className={btnPrimary} onClick={submitReceive} disabled={receiveSaving}>{receiveSaving ? 'Saving...' : 'Confirm Receipt'}</button>
          <button className={btnSecondary} onClick={() => setReceiveMode(null)}>Cancel</button>
        </div>
      </div>
    )
  }

  if (viewPO) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <button className={btnSecondary} onClick={() => setViewPO(null)}>← Back</button>
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-foreground">{viewPO.po.po_number}</h3>
            <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_BADGE[viewPO.po.status] || ''}`}>{viewPO.po.status}</span>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <SummaryCard label="Supplier" value={viewPO.po.supplier_name} />
          <SummaryCard label="Order Date" value={formatDate(viewPO.po.order_date)} />
          <SummaryCard label="Expected" value={viewPO.po.expected_date ? formatDate(viewPO.po.expected_date) : '—'} />
          <SummaryCard label="Subtotal" value={formatINR(parseFloat(viewPO.po.subtotal))} />
          <SummaryCard label="Tax" value={formatINR(parseFloat(viewPO.po.tax_amount))} />
          <SummaryCard label="Total" value={formatINR(parseFloat(viewPO.po.total_amount))} />
        </div>
        <div className="overflow-x-auto rounded-lg border border-border-default">
          <table className="w-full text-sm">
            <thead className="bg-surface-secondary text-foreground-secondary text-xs">
              <tr>
                <th className="px-3 py-2 text-left">Product</th>
                <th className="px-3 py-2 text-left">SKU</th>
                <th className="px-3 py-2 text-right">Qty</th>
                <th className="px-3 py-2 text-right">Unit Cost</th>
                <th className="px-3 py-2 text-right">Tax %</th>
                <th className="px-3 py-2 text-right">Total</th>
                <th className="px-3 py-2 text-right">Received</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-default">
              {viewPO.items.map(it => (
                <tr key={it.id} className="hover:bg-surface-secondary/50">
                  <td className="px-3 py-2 text-foreground">
                    {it.product_name}
                    {it.variant_name && <span className="text-foreground-secondary"> / {it.variant_name}</span>}
                  </td>
                  <td className="px-3 py-2 text-foreground-secondary">{it.sku || '—'}</td>
                  <td className="px-3 py-2 text-right text-foreground-secondary">{parseFloat(it.quantity)}</td>
                  <td className="px-3 py-2 text-right text-foreground">{formatINR(parseFloat(it.unit_cost))}</td>
                  <td className="px-3 py-2 text-right text-foreground-secondary">{it.tax_rate}%</td>
                  <td className="px-3 py-2 text-right font-medium text-foreground">{formatINR(parseFloat(it.total_cost))}</td>
                  <td className="px-3 py-2 text-right text-foreground-secondary">{parseFloat(it.quantity_received || '0')} / {parseFloat(it.quantity)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <SummaryCard label="Open POs" value={String(openCount)} sub="draft, sent, partial" />
        <SummaryCard label="Pending Value" value={formatINR(pendingValue)} />
      </div>

      <div className="flex flex-wrap gap-2 items-end">
        <div className="flex-1 min-w-[180px]">
          <label className={labelCls}>Search</label>
          <AdminTypeahead
            type="purchase_orders"
            value={search}
            onChange={setSearch}
            placeholder="PO number, supplier..."
          />
        </div>
        <div>
          <label className={labelCls}>Status</label>
          <AdminSelect
            value={statusFilter}
            onChange={setStatusFilter}
            placeholder="All"
            options={[
              { value: '', label: 'All' },
              { value: 'draft', label: 'Draft' },
              { value: 'sent', label: 'Sent' },
              { value: 'partial', label: 'Partial' },
              { value: 'received', label: 'Received' },
              { value: 'cancelled', label: 'Cancelled' },
            ]}
          />
        </div>
        <div>
          <div className={labelCls}>&nbsp;</div>
          <button className={btnSecondary} onClick={() => setShowCreate(v => !v)}>+ Create PO</button>
        </div>
      </div>

      {showCreate && (
        <div className="bg-surface-elevated rounded-lg border border-border-default p-4 space-y-4">
          <h3 className="text-sm font-semibold text-foreground">New Purchase Order</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <div>
              <label className={labelCls}>Supplier *</label>
              <select className={inputCls} value={newPO.supplier_id} onChange={e => setNewPO(p => ({ ...p, supplier_id: e.target.value }))}>
                <option value="">Select supplier</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
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
              <select className={inputCls} value={newPO.status} onChange={e => setNewPO(p => ({ ...p, status: e.target.value }))}>
                <option value="draft">Draft</option>
                <option value="sent">Sent to Supplier</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>Notes</label>
              <input className={inputCls} value={newPO.notes} onChange={e => setNewPO(p => ({ ...p, notes: e.target.value }))} />
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-semibold text-foreground-secondary uppercase tracking-wide">Line Items</p>
            {lineItems.map((it, idx) => (
              <div key={idx} className="grid grid-cols-[1fr_80px_110px_80px_auto_auto] gap-2 items-end bg-surface-secondary rounded p-2">
                <div className="relative">
                  <label className={labelCls}>Product</label>
                  <input className={inputCls} placeholder="Search product..." value={productSearch[idx] ?? it.product_name}
                    onChange={e => searchProducts(idx, e.target.value)} />
                  {(productResults[idx] || []).length > 0 && (
                    <div className="absolute z-10 w-full mt-1 bg-surface-elevated border border-border-default rounded shadow-lg max-h-40 overflow-y-auto">
                      {(productResults[idx] || []).map(p => (
                        <button key={p.id} className="w-full text-left px-3 py-2 text-sm hover:bg-surface-secondary text-foreground" onClick={() => selectProduct(idx, p)}>
                          {p.name}{p.sku ? ` (${p.sku})` : ''}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <label className={labelCls}>Qty</label>
                  <input type="number" min="0.001" step="0.001" className={inputCls + ' text-right'} value={it.quantity}
                    onChange={e => setLineItems(items => items.map((r, i) => i === idx ? { ...r, quantity: e.target.value } : r))} />
                </div>
                <div>
                  <label className={labelCls}>Unit Cost (₹)</label>
                  <input type="number" min="0" step="0.01" className={inputCls + ' text-right'} value={it.unit_cost}
                    onChange={e => setLineItems(items => items.map((r, i) => i === idx ? { ...r, unit_cost: e.target.value } : r))} />
                </div>
                <div>
                  <label className={labelCls}>Tax %</label>
                  <input type="number" min="0" step="0.01" className={inputCls + ' text-right'} value={it.tax_rate}
                    onChange={e => setLineItems(items => items.map((r, i) => i === idx ? { ...r, tax_rate: e.target.value } : r))} />
                </div>
                <div className="text-sm font-medium text-foreground text-right whitespace-nowrap pb-1.5">
                  {formatINR(parseFloat(it.quantity || '0') * parseFloat(it.unit_cost || '0') * (1 + parseFloat(it.tax_rate || '0') / 100))}
                </div>
                {lineItems.length > 1 && (
                  <button className="text-red-500 text-xs hover:underline pb-1.5" onClick={() => setLineItems(items => items.filter((_, i) => i !== idx))}>Remove</button>
                )}
              </div>
            ))}
            <button className="text-sm text-secondary-500 dark:text-secondary-400 hover:underline" onClick={() => setLineItems(items => [...items, { product_id: '', variant_id: '', product_name: '', sku: '', quantity: '1', unit_cost: '', tax_rate: '0' }])}>
              + Add line
            </button>
          </div>

          <div className="flex gap-2">
            <button className={btnPrimary} onClick={createPO} disabled={saving || !newPO.supplier_id}>{saving ? 'Creating...' : 'Create PO'}</button>
            <button className={btnSecondary} onClick={() => setShowCreate(false)}>Cancel</button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-foreground-secondary py-8 text-center">Loading...</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border-default">
          <table className="w-full text-sm">
            <thead className="bg-surface-secondary text-foreground-secondary text-xs">
              <tr>
                <th className="px-3 py-2 text-left">PO #</th>
                <th className="px-3 py-2 text-left">Supplier</th>
                <th className="px-3 py-2 text-left">Date</th>
                <th className="px-3 py-2 text-left">Expected</th>
                <th className="px-3 py-2 text-right">Items</th>
                <th className="px-3 py-2 text-right">Total</th>
                <th className="px-3 py-2 text-center">Status</th>
                <th className="px-3 py-2 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-default">
              {pos.length === 0 && (
                <tr><td colSpan={8} className="py-8 text-center text-foreground-secondary">No purchase orders found</td></tr>
              )}
              {pos.map(po => (
                <tr key={po.id} className="hover:bg-surface-secondary/50">
                  <td className="px-3 py-2 font-mono text-xs text-foreground-secondary">{po.po_number}</td>
                  <td className="px-3 py-2 text-foreground">{po.supplier_name}</td>
                  <td className="px-3 py-2 text-foreground-secondary whitespace-nowrap">{formatDate(po.order_date)}</td>
                  <td className="px-3 py-2 text-foreground-secondary whitespace-nowrap">{po.expected_date ? formatDate(po.expected_date) : '—'}</td>
                  <td className="px-3 py-2 text-right text-foreground-secondary">{po.item_count}</td>
                  <td className="px-3 py-2 text-right font-medium text-foreground">{formatINR(parseFloat(po.total_amount))}</td>
                  <td className="px-3 py-2 text-center">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_BADGE[po.status] || ''}`}>{po.status}</span>
                  </td>
                  <td className="px-3 py-2 text-center space-x-3">
                    <button className="text-xs text-secondary-500 dark:text-secondary-400 hover:underline" onClick={() => openPO(po.id)}>View</button>
                    {['draft', 'sent', 'partial'].includes(po.status) && (
                      <button className="text-xs text-green-600 dark:text-green-400 hover:underline" onClick={() => openReceive(po.id)}>Receive</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
  const [valuation, setValuation] = useState<{ products: any[]; totalValue: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [view, setView] = useState<'ledger' | 'valuation'>('ledger')
  const [editingCost, setEditingCost] = useState<Record<string, string>>({})
  const [savingCost, setSavingCost] = useState<string | null>(null)

  const loadLedger = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams({ view: 'ledger' })
    if (search) params.set('search', search)
    if (from) params.set('from', from)
    if (to) params.set('to', to)
    const res = await fetch(`/api/admin/inventory/stock?${params}`)
    const json = await res.json()
    setTransactions(json?.transactions || [])
    setLoading(false)
  }, [search, from, to])

  const loadValuation = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/admin/inventory/stock?view=valuation')
    const json = await res.json()
    setValuation(json)
    setLoading(false)
  }, [])

  useEffect(() => {
    if (view === 'ledger') loadLedger()
    else loadValuation()
  }, [view, loadLedger, loadValuation])

  return (
    <div className="space-y-4">
      <div className="flex gap-1 border-b border-border-default -mb-4 pb-0">
        {(['ledger', 'valuation'] as const).map(v => (
          <button key={v} onClick={() => setView(v)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${view === v ? 'border-secondary-500 dark:border-secondary-400 text-secondary-500 dark:text-secondary-400' : 'border-transparent text-foreground-secondary hover:text-foreground'}`}>
            {v.charAt(0).toUpperCase() + v.slice(1)}
          </button>
        ))}
      </div>

      <div className="pt-2">
        {view === 'ledger' ? (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2 items-end">
              <div className="flex-1 min-w-[180px]">
                <label className={labelCls}>Search product</label>
                <AdminTypeahead
                  type="products"
                  value={search}
                  onChange={setSearch}
                  placeholder="Name, SKU..."
                />
              </div>
              <div>
                <label className={labelCls}>From</label>
                <input type="date" className={inputCls + ' w-36'} value={from} onChange={e => setFrom(e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>To</label>
                <input type="date" className={inputCls + ' w-36'} value={to} onChange={e => setTo(e.target.value)} />
              </div>
            </div>
            {loading ? (
              <p className="text-sm text-foreground-secondary py-8 text-center">Loading...</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border-default">
                <table className="w-full text-sm">
                  <thead className="bg-surface-secondary text-foreground-secondary text-xs">
                    <tr>
                      <th className="px-3 py-2 text-left">Date</th>
                      <th className="px-3 py-2 text-left">Product</th>
                      <th className="px-3 py-2 text-left">Type</th>
                      <th className="px-3 py-2 text-right">Change</th>
                      <th className="px-3 py-2 text-right">Balance</th>
                      <th className="px-3 py-2 text-left">Reference</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-default">
                    {transactions.length === 0 && (
                      <tr><td colSpan={6} className="py-8 text-center text-foreground-secondary">No transactions found</td></tr>
                    )}
                    {transactions.map(tx => (
                      <tr key={tx.id} className="hover:bg-surface-secondary/50">
                        <td className="px-3 py-2 text-foreground-secondary whitespace-nowrap text-xs">
                          {new Date(tx.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                        </td>
                        <td className="px-3 py-2 text-foreground">
                          {tx.product_name}
                          {tx.variant_name && <span className="text-foreground-secondary"> / {tx.variant_name}</span>}
                          {tx.product_sku && <div className="text-xs text-foreground-secondary">{tx.product_sku}</div>}
                        </td>
                        <td className="px-3 py-2">
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${TYPE_BADGE[tx.transaction_type] || ''}`}>{tx.transaction_type}</span>
                        </td>
                        <td className={`px-3 py-2 text-right font-mono font-medium ${tx.quantity_change > 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                          {tx.quantity_change > 0 ? '+' : ''}{tx.quantity_change}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-foreground">{tx.quantity_after}</td>
                        <td className="px-3 py-2 text-xs text-foreground-secondary font-mono">{tx.reference_type}/{tx.reference_id.slice(0, 8)}…</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {loading ? (
              <p className="text-sm text-foreground-secondary py-8 text-center">Loading...</p>
            ) : valuation ? (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  <SummaryCard
                    label="Total Stock Value"
                    value={formatINR(valuation.totalValue)}
                    sub={`${valuation.products.length} SKUs`}
                  />
                </div>
                {valuation.totalValue === 0 && valuation.products.length > 0 && (
                  <div className="rounded-lg border border-yellow-200 bg-yellow-50 dark:border-yellow-800/40 dark:bg-yellow-900/10 px-4 py-3 text-sm text-yellow-800 dark:text-yellow-300">
                    Cost prices are not set — valuation shows ₹0. Enter cost prices below to calculate stock value. These are used for P&amp;L gross margin too.
                  </div>
                )}
                <div className="overflow-x-auto rounded-lg border border-border-default">
                  <table className="w-full text-sm">
                    <thead className="bg-surface-secondary text-foreground-secondary text-xs">
                      <tr>
                        <th className="px-3 py-2 text-left">Product</th>
                        <th className="px-3 py-2 text-left">Variant</th>
                        <th className="px-3 py-2 text-left">SKU</th>
                        <th className="px-3 py-2 text-right">Stock Qty</th>
                        <th className="px-3 py-2 text-right">Avg Cost (₹)</th>
                        <th className="px-3 py-2 text-right">Stock Value</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border-default">
                      {valuation.products.map((p, i) => {
                        const rowKey = p.variant_id ? `v-${p.variant_id}` : `p-${p.id}`
                        const isEditing = rowKey in editingCost
                        const isSaving = savingCost === rowKey

                        async function saveCost() {
                          const val = parseFloat(editingCost[rowKey])
                          if (isNaN(val)) return
                          setSavingCost(rowKey)
                          await fetch('/api/admin/inventory/cost', {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ product_id: p.id, variant_id: p.variant_id || null, cost_price: val }),
                          })
                          setSavingCost(null)
                          setEditingCost(ec => { const next = { ...ec }; delete next[rowKey]; return next })
                          loadValuation()
                        }

                        return (
                          <tr key={i} className="hover:bg-surface-secondary/50">
                            <td className="px-3 py-2 font-medium text-foreground">{p.name}</td>
                            <td className="px-3 py-2 text-foreground-secondary">{p.variant_name || '—'}</td>
                            <td className="px-3 py-2 text-foreground-secondary font-mono text-xs">{p.sku || '—'}</td>
                            <td className="px-3 py-2 text-right text-foreground-secondary">{parseFloat(p.stock_quantity || '0')}</td>
                            <td className="px-3 py-2 text-right">
                              {isEditing ? (
                                <div className="flex items-center justify-end gap-1">
                                  <input
                                    type="number" min="0" step="0.01" autoFocus
                                    className={inputCls + ' w-24 text-right'}
                                    value={editingCost[rowKey]}
                                    onChange={e => setEditingCost(ec => ({ ...ec, [rowKey]: e.target.value }))}
                                    onKeyDown={e => { if (e.key === 'Enter') saveCost(); if (e.key === 'Escape') setEditingCost(ec => { const next = { ...ec }; delete next[rowKey]; return next }) }}
                                  />
                                  <button className="text-xs text-secondary-500 dark:text-secondary-400 hover:underline" onClick={saveCost} disabled={isSaving}>
                                    {isSaving ? '...' : 'Save'}
                                  </button>
                                </div>
                              ) : (
                                <button
                                  className={`text-right w-full hover:text-secondary-500 dark:hover:text-secondary-400 transition-colors ${parseFloat(p.cost_price || '0') === 0 ? 'text-yellow-600 dark:text-yellow-400' : 'text-foreground'}`}
                                  onClick={() => setEditingCost(ec => ({ ...ec, [rowKey]: String(parseFloat(p.cost_price || '0')) }))}
                                  title="Click to edit"
                                >
                                  {parseFloat(p.cost_price || '0') === 0 ? '— set cost' : formatINR(parseFloat(p.cost_price))}
                                </button>
                              )}
                            </td>
                            <td className="px-3 py-2 text-right font-medium text-foreground">{formatINR(parseFloat(p.stock_value || '0'))}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            ) : null}
          </div>
        )}
      </div>
    </div>
  )
}

export default function InventoryClient() {
  const [tab, setTab] = useState<Tab>('suppliers')

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
        {tab === 'suppliers' && <SuppliersTab />}
        {tab === 'po' && <POTab />}
        {tab === 'stock' && <StockTab />}
      </div>
    </div>
  )
}
