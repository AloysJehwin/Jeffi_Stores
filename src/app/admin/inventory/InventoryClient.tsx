'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import AdminTypeahead from '@/components/admin/AdminTypeahead'
import AdminSelect from '@/components/admin/AdminSelect'
import HoverCard from '@/components/ui/HoverCard'
import SortableHeader, { sortOptions, type SortDir } from '@/components/admin/SortableHeader'

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
    <div className="flex flex-wrap items-center justify-between gap-2 px-1 pt-4 border-t border-border-default mt-2">
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

function SuppliersTab() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [sortCol, setSortCol] = useState<string | undefined>(undefined)
  const [sortDir, setSortDir] = useState<SortDir | undefined>(undefined)

  const SUPPLIER_SORT_KEYS: Record<string, string> = {
    name: 'name', gstin: 'gstin', contact: 'contact_name',
    phone: 'phone', terms: 'payment_terms', pos: 'po_count', status: 'is_active',
  }

  const sortedSuppliers = sortCol && SUPPLIER_SORT_KEYS[sortCol]
    ? [...suppliers].sort((a: any, b: any) => {
        const k = SUPPLIER_SORT_KEYS[sortCol]
        const cmp = String(a[k] ?? '').localeCompare(String(b[k] ?? ''), 'en', { numeric: true })
        return sortDir === 'asc' ? cmp : -cmp
      })
    : suppliers

  function handleSort(col: string, dir: SortDir) { setSortCol(col); setSortDir(dir) }

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

  async function toggleActive(s: Supplier) {
    await fetch(`/api/admin/inventory/suppliers/${s.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: !s.is_active }),
    })
    load(page)
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
          <Link href="/admin/suppliers/new" className={btnPrimary}>
            + Add Supplier
          </Link>
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
                  <SortableHeader label="Name" column="name" options={sortOptions('text')} currentSort={sortCol} currentDir={sortDir} onSort={handleSort} />
                  <SortableHeader label="GSTIN" column="gstin" options={sortOptions('text')} currentSort={sortCol} currentDir={sortDir} onSort={handleSort} />
                  <SortableHeader label="Contact" column="contact" options={sortOptions('text')} currentSort={sortCol} currentDir={sortDir} onSort={handleSort} className="hidden sm:table-cell" />
                  <SortableHeader label="Phone" column="phone" options={sortOptions('text')} currentSort={sortCol} currentDir={sortDir} onSort={handleSort} className="hidden md:table-cell" />
                  <SortableHeader label="Terms" column="terms" options={sortOptions('number')} currentSort={sortCol} currentDir={sortDir} onSort={handleSort} className="hidden lg:table-cell" align="right" />
                  <SortableHeader label="POs" column="pos" options={sortOptions('number')} currentSort={sortCol} currentDir={sortDir} onSort={handleSort} align="right" />
                  <SortableHeader label="Status" column="status" options={sortOptions('text')} currentSort={sortCol} currentDir={sortDir} onSort={handleSort} />
                  <th className="px-4 py-3 text-right text-xs font-semibold text-foreground-secondary uppercase tracking-wide">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-default">
                {suppliers.length === 0 && (
                  <tr><td colSpan={8} className="py-12 text-center text-foreground-secondary text-sm">
                    {search ? `No suppliers matching "${search}"` : 'No suppliers yet'}
                  </td></tr>
                )}
                {sortedSuppliers.map(s => (
                  <tr key={s.id} className="hover:bg-surface-secondary/50 transition-colors">
                    <td className="px-4 py-3 font-medium text-foreground">
                      <Link href={`/admin/suppliers/${s.id}`} className="hover:text-accent-500 hover:underline">{s.name}</Link>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-foreground-secondary">{s.gstin || '—'}</td>
                    <td className="px-4 py-3 text-foreground-secondary hidden sm:table-cell">{s.contact_name || '—'}</td>
                    <td className="px-4 py-3 text-foreground-secondary hidden md:table-cell">{s.phone ? `+91 ${s.phone}` : '—'}</td>
                    <td className="px-4 py-3 text-right text-foreground-secondary hidden lg:table-cell">{s.payment_terms}d</td>
                    <td className="px-4 py-3 text-right text-foreground-secondary">{s.po_count}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${s.is_active ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-gray-100 text-gray-500 dark:bg-gray-700/40 dark:text-gray-400'}`}>
                        {s.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-3">
                        <Link href={`/admin/suppliers/${s.id}/edit`} className="text-xs text-secondary-500 dark:text-secondary-400 hover:underline font-medium">Edit</Link>
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

function POTab({ initialPO }: { initialPO?: string }) {
  const [pos, setPOs] = useState<PO[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [viewPO, setViewPO] = useState<{ po: any; items: POItem[] } | null>(null)
  const [receiveMode, setReceiveMode] = useState<{ po: any } | null>(null)
  const [poCategories, setPoCategories] = useState<{ id: string; name: string }[]>([])
  const [saving, setSaving] = useState(false)
  const [receiveItems, setReceiveItems] = useState<any[]>([])
  const [receiveNotes, setReceiveNotes] = useState('')
  const [receiveSaving, setReceiveSaving] = useState(false)
  const [poSortCol, setPoSortCol] = useState<string | undefined>(undefined)
  const [poSortDir, setPoSortDir] = useState<SortDir | undefined>(undefined)

  const PO_SORT_KEYS: Record<string, keyof PO> = {
    po_number: 'po_number', supplier: 'supplier_name', date: 'order_date',
    expected: 'expected_date', items: 'item_count', total: 'total_amount', status: 'status',
  }

  const sortedPOs = poSortCol && PO_SORT_KEYS[poSortCol]
    ? [...pos].sort((a, b) => {
        const k = PO_SORT_KEYS[poSortCol]
        const cmp = String(a[k] ?? '').localeCompare(String(b[k] ?? ''), 'en', { numeric: true })
        return poSortDir === 'asc' ? cmp : -cmp
      })
    : pos

  function handlePoSort(col: string, dir: SortDir) { setPoSortCol(col); setPoSortDir(dir) }

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
    if (initialPO && pos.length > 0 && !viewPO) {
      const match = pos.find(p => p.po_number === initialPO)
      if (match) openPO(match.id)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPO, pos.length])

  useEffect(() => {
    if (suppliers.length === 0) {
      fetch('/api/admin/inventory/suppliers?limit=1000').then(r => r.json()).then(j => setSuppliers(j?.suppliers || []))
    }
    if (poCategories.length === 0) {
      fetch('/api/categories').then(r => r.json()).then(d => setPoCategories((d.categories || d || []).map((c: any) => ({ id: c.id, name: c.name }))))
    }
  }, [])

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

  async function sendPO(id: string) {
    await fetch(`/api/admin/inventory/po/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'sent' }),
    })
    load(page)
    if (viewPO?.po.id === id) {
      const res = await fetch(`/api/admin/inventory/po/${id}`)
      const json = await res.json()
      setViewPO({ po: json.purchase_order, items: json.items || [] })
    }
  }

  async function cancelPO(id: string) {
    if (!confirm('Cancel this purchase order?')) return
    await fetch(`/api/admin/inventory/po/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'cancelled' }),
    })
    load(page)
    if (viewPO?.po.id === id) setViewPO(null)
  }

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
        {viewPO.po.status === 'draft' && (
          <div className="flex gap-3 pt-2">
            <button className={btnPrimary} onClick={() => sendPO(viewPO.po.id)}>Mark as Sent</button>
            <button className="px-4 py-2 rounded-lg text-sm font-medium bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-900/20 dark:text-red-400 dark:hover:bg-red-900/30 transition-colors" onClick={() => cancelPO(viewPO.po.id)}>Cancel PO</button>
          </div>
        )}
        {['sent', 'partial'].includes(viewPO.po.status) && (
          <div className="flex gap-3 pt-2">
            <button className={btnPrimary} onClick={() => { setViewPO(null); openReceive(viewPO.po.id) }}>Record Receipt</button>
          </div>
        )}
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
          <Link href="/admin/inventory/po/new" className={btnPrimary}>
            + Create PO
          </Link>
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
                  <SortableHeader label="PO #" column="po_number" options={sortOptions('text')} currentSort={poSortCol} currentDir={poSortDir} onSort={handlePoSort} />
                  <SortableHeader label="Supplier" column="supplier" options={sortOptions('text')} currentSort={poSortCol} currentDir={poSortDir} onSort={handlePoSort} />
                  <SortableHeader label="Date" column="date" options={sortOptions('date')} currentSort={poSortCol} currentDir={poSortDir} onSort={handlePoSort} className="hidden sm:table-cell" />
                  <SortableHeader label="Expected" column="expected" options={sortOptions('date')} currentSort={poSortCol} currentDir={poSortDir} onSort={handlePoSort} className="hidden md:table-cell" />
                  <SortableHeader label="Items" column="items" options={sortOptions('number')} currentSort={poSortCol} currentDir={poSortDir} onSort={handlePoSort} className="hidden lg:table-cell" align="right" />
                  <SortableHeader label="Total" column="total" options={sortOptions('number')} currentSort={poSortCol} currentDir={poSortDir} onSort={handlePoSort} align="right" />
                  <SortableHeader label="Status" column="status" options={sortOptions('text')} currentSort={poSortCol} currentDir={poSortDir} onSort={handlePoSort} />
                  <th className="px-4 py-3 text-right text-xs font-semibold text-foreground-secondary uppercase tracking-wide">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-default">
                {pos.length === 0 && (
                  <tr><td colSpan={8} className="py-12 text-center text-foreground-secondary text-sm">
                    {search || statusFilter ? 'No purchase orders match your filters' : 'No purchase orders yet'}
                  </td></tr>
                )}
                {sortedPOs.map(po => (
                  <tr key={po.id} className="hover:bg-surface-secondary/50 transition-colors">
                    <td className="px-4 py-3 font-mono text-xs text-foreground-secondary font-medium">{po.po_number}</td>
                    <td className="px-4 py-3 font-medium text-foreground">
                      <Link href={`/admin/suppliers/${po.supplier_id}`} className="hover:text-accent-500 hover:underline">{po.supplier_name}</Link>
                    </td>
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
                        {po.status === 'draft' && (
                          <button className="text-xs text-accent-500 hover:underline font-medium" onClick={() => sendPO(po.id)}>Send</button>
                        )}
                        {['sent', 'partial'].includes(po.status) && (
                          <button className="text-xs text-green-600 dark:text-green-400 hover:underline font-medium" onClick={() => openReceive(po.id)}>Receive</button>
                        )}
                        {po.status === 'draft' && (
                          <button className="text-xs text-red-500 hover:underline font-medium" onClick={() => cancelPO(po.id)}>Cancel</button>
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
  const searchParams = useSearchParams()
  const router = useRouter()

  const [transactions, setTransactions] = useState<StockTransaction[]>([])
  const [txTotal, setTxTotal] = useState(0)
  const [txPage, setTxPage] = useState(1)
  const [valuation, setValuation] = useState<{ products: any[]; totalValue: number } | null>(null)
  const [valPage, setValPage] = useState(1)
  const [valSearch, setValSearch] = useState(searchParams.get('val_search') || '')
  const [valCategory, setValCategory] = useState(searchParams.get('val_category') || '')
  const [valBrand, setValBrand] = useState(searchParams.get('val_brand') || '')
  const [valStockStatus, setValStockStatus] = useState(searchParams.get('val_stock') || '')
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState(searchParams.get('ledger_search') || '')
  const [from, setFrom] = useState(searchParams.get('ledger_from') || '')
  const [to, setTo] = useState(searchParams.get('ledger_to') || '')
  const [view, setView] = useState<'ledger' | 'valuation'>((searchParams.get('stock_view') as 'ledger' | 'valuation') || 'ledger')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editQty, setEditQty] = useState('')
  const [editNotes, setEditNotes] = useState('')
  const [editSaving, setEditSaving] = useState(false)
  const [ledgerSortCol, setLedgerSortCol] = useState<string | undefined>(undefined)

  function syncUrl(patch: Record<string, string>) {
    const p = new URLSearchParams(window.location.search)
    for (const [k, v] of Object.entries(patch)) {
      if (v) p.set(k, v); else p.delete(k)
    }
    router.replace(`/admin/inventory?${p.toString()}`, { scroll: false })
  }
  const [ledgerSortDir, setLedgerSortDir] = useState<SortDir | undefined>(undefined)
  const [valSortCol, setValSortCol] = useState<string | undefined>(undefined)
  const [valSortDir, setValSortDir] = useState<SortDir | undefined>(undefined)

  const LEDGER_SORT_KEYS: Record<string, keyof StockTransaction> = {
    date: 'created_at', product: 'product_name', type: 'transaction_type',
    change: 'quantity_change', balance: 'quantity_after', reference: 'reference_type',
  }

  const sortedTransactions = ledgerSortCol && LEDGER_SORT_KEYS[ledgerSortCol]
    ? [...transactions].sort((a, b) => {
        const k = LEDGER_SORT_KEYS[ledgerSortCol]
        const cmp = String(a[k] ?? '').localeCompare(String(b[k] ?? ''), 'en', { numeric: true })
        return ledgerSortDir === 'asc' ? cmp : -cmp
      })
    : transactions

  function handleLedgerSort(col: string, dir: SortDir) { setLedgerSortCol(col); setLedgerSortDir(dir) }
  function handleValSort(col: string, dir: SortDir) { setValSortCol(col); setValSortDir(dir) }

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

  const allValRows = valuation?.products || []
  const filteredValRows = allValRows.filter(p => {
    if (valSearch.trim()) {
      const q = valSearch.toLowerCase()
      if (!(p.name || '').toLowerCase().includes(q) && !(p.sku || '').toLowerCase().includes(q) && !(p.variant_name || '').toLowerCase().includes(q)) return false
    }
    if (valCategory && p.category_name !== valCategory) return false
    if (valBrand && p.brand_name !== valBrand) return false
    if (valStockStatus === 'in_stock' && parseFloat(p.inventory_quantity || '0') <= 0) return false
    if (valStockStatus === 'out_of_stock' && parseFloat(p.inventory_quantity || '0') > 0) return false
    if (valStockStatus === 'low_stock' && (parseFloat(p.inventory_quantity || '0') <= 0 || parseFloat(p.inventory_quantity || '0') > 5)) return false
    return true
  })

  const valCategories = [...new Set(allValRows.map(p => p.category_name).filter(Boolean))].sort() as string[]
  const valBrands = [...new Set(allValRows.map(p => p.brand_name).filter(Boolean))].sort() as string[]
  const valTotalPages = Math.ceil(filteredValRows.length / VALUATION_PAGE_SIZE)
  const VAL_SORT_KEYS: Record<string, string> = {
    product: 'name', variant: 'variant_name', sku: 'sku',
    stock: 'inventory_quantity', price: 'cost_price', value: 'stock_value',
  }
  const sortedValRows = valSortCol && VAL_SORT_KEYS[valSortCol]
    ? [...filteredValRows].sort((a, b) => {
        const k = VAL_SORT_KEYS[valSortCol]
        const cmp = String(a[k] ?? '').localeCompare(String(b[k] ?? ''), 'en', { numeric: true })
        return valSortDir === 'asc' ? cmp : -cmp
      })
    : filteredValRows
  const valSlice = sortedValRows.slice((valPage - 1) * VALUATION_PAGE_SIZE, valPage * VALUATION_PAGE_SIZE)

  function startEdit(p: any) {
    const rowId = p.variant_id || p.id
    setEditingId(rowId)
    setEditQty(String(parseFloat(p.inventory_quantity || '0')))
    setEditNotes('')
  }

  async function saveEdit(p: any) {
    setEditSaving(true)
    await fetch('/api/admin/inventory/stock', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        product_id: p.id,
        variant_id: p.variant_id || null,
        new_quantity: parseFloat(editQty),
        notes: editNotes || undefined,
      }),
    })
    setEditSaving(false)
    setEditingId(null)
    loadValuation()
  }

  function cancelEdit() {
    setEditingId(null)
    setEditQty('')
    setEditNotes('')
  }

  return (
    <div className="space-y-5">
      <div className="flex gap-1 border-b border-border-default">
        {(['ledger', 'valuation'] as const).map(v => (
          <button key={v} onClick={() => { setView(v); syncUrl({ stock_view: v }) }}
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
                onChange={v => { setSearch(v); setTxPage(1); syncUrl({ ledger_search: v }) }}
                placeholder="Name, SKU..."
                inputClassName="w-full px-3 py-2.5 pr-9 bg-surface border border-border-secondary rounded-lg text-sm text-foreground focus:ring-2 focus:ring-accent-500 focus:border-transparent transition-colors hover:border-border-default placeholder:text-foreground-muted" />
            </div>
            <div>
              <label className={labelCls}>From</label>
              <input type="date" className="px-3 py-2.5 rounded-lg border border-border-secondary bg-surface text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-transparent hover:border-border-default w-36" value={from} onChange={e => { setFrom(e.target.value); setTxPage(1); syncUrl({ ledger_from: e.target.value }) }} />
            </div>
            <div>
              <label className={labelCls}>To</label>
              <input type="date" className="px-3 py-2.5 rounded-lg border border-border-secondary bg-surface text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-transparent hover:border-border-default w-36" value={to} onChange={e => { setTo(e.target.value); setTxPage(1); syncUrl({ ledger_to: e.target.value }) }} />
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
                      <SortableHeader label="Date" column="date" options={sortOptions('date')} currentSort={ledgerSortCol} currentDir={ledgerSortDir} onSort={handleLedgerSort} />
                      <SortableHeader label="Product" column="product" options={sortOptions('text')} currentSort={ledgerSortCol} currentDir={ledgerSortDir} onSort={handleLedgerSort} />
                      <SortableHeader label="Type" column="type" options={sortOptions('text')} currentSort={ledgerSortCol} currentDir={ledgerSortDir} onSort={handleLedgerSort} />
                      <SortableHeader label="Change" column="change" options={sortOptions('number')} currentSort={ledgerSortCol} currentDir={ledgerSortDir} onSort={handleLedgerSort} align="right" />
                      <SortableHeader label="Balance" column="balance" options={sortOptions('number')} currentSort={ledgerSortCol} currentDir={ledgerSortDir} onSort={handleLedgerSort} align="right" />
                      <SortableHeader label="Reference" column="reference" options={sortOptions('text')} currentSort={ledgerSortCol} currentDir={ledgerSortDir} onSort={handleLedgerSort} className="hidden md:table-cell" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-default">
                    {transactions.length === 0 && (
                      <tr><td colSpan={6} className="py-12 text-center text-foreground-secondary text-sm">
                        {search || from || to ? 'No transactions match your filters' : 'No stock transactions yet'}
                      </td></tr>
                    )}
                    {sortedTransactions.map(tx => (
                      <tr key={tx.id} className="hover:bg-surface-secondary/50 transition-colors">
                        <td className="px-4 py-3 text-foreground-secondary whitespace-nowrap text-xs">
                          {new Date(tx.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                        </td>
                        <td className="px-4 py-3 text-foreground">
                          <HoverCard
                            trigger={
                              <Link href={`/admin/products/${tx.product_id}`} className="font-medium hover:text-accent-500 hover:underline underline-offset-2">
                                {tx.product_name}{tx.variant_name && <span className="text-foreground-secondary font-normal"> / {tx.variant_name}</span>}
                              </Link>
                            }
                            align="left"
                            side="bottom"
                            width="260px"
                          >
                            <div className="p-3 space-y-2">
                              <p className="text-sm font-semibold text-foreground leading-tight">{tx.product_name}</p>
                              {tx.variant_name && <p className="text-xs text-foreground-secondary">{tx.variant_name}</p>}
                              {tx.product_sku && <p className="text-xs font-mono text-foreground-muted">{tx.product_sku}</p>}
                              <div className="border-t border-border-default pt-2 space-y-1.5 text-xs">
                                <div className="flex justify-between">
                                  <span className="text-foreground-secondary">Type</span>
                                  <span className={`px-1.5 py-0.5 rounded-full font-medium ${TYPE_BADGE[tx.transaction_type] || ''}`}>{tx.transaction_type}</span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-foreground-secondary">Change</span>
                                  <span className={`font-mono font-semibold ${tx.quantity_change > 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                                    {tx.quantity_change > 0 ? '+' : ''}{tx.quantity_change}
                                  </span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-foreground-secondary">Balance after</span>
                                  <span className="font-mono font-medium text-foreground">{tx.quantity_after}</span>
                                </div>
                                {tx.notes && (
                                  <div className="pt-1 border-t border-border-default">
                                    <p className="text-foreground-secondary leading-snug">{tx.notes}</p>
                                  </div>
                                )}
                              </div>
                            </div>
                          </HoverCard>
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
          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex-1 min-w-[200px]">
              <label className={labelCls}>Search product</label>
              <AdminTypeahead
                type="products"
                value={valSearch}
                onChange={v => { setValSearch(v); setValPage(1); syncUrl({ val_search: v }) }}
                placeholder="Name, SKU, variant..."
                inputClassName="w-full px-3 py-2.5 pr-9 bg-surface border border-border-secondary rounded-lg text-sm text-foreground focus:ring-2 focus:ring-accent-500 focus:border-transparent transition-colors hover:border-border-default placeholder:text-foreground-muted"
              />
            </div>
            <div className="w-44">
              <label className={labelCls}>Category</label>
              <AdminSelect
                value={valCategory}
                onChange={v => { setValCategory(v); setValPage(1); syncUrl({ val_category: v }) }}
                placeholder="All categories"
                options={[
                  { value: '', label: 'All categories' },
                  ...valCategories.map(c => ({ value: c, label: c })),
                ]}
              />
            </div>
            <div className="w-40">
              <label className={labelCls}>Brand</label>
              <AdminSelect
                value={valBrand}
                onChange={v => { setValBrand(v); setValPage(1); syncUrl({ val_brand: v }) }}
                placeholder="All brands"
                options={[
                  { value: '', label: 'All brands' },
                  ...valBrands.map(b => ({ value: b, label: b })),
                ]}
              />
            </div>
            <div className="w-40">
              <label className={labelCls}>Stock status</label>
              <AdminSelect
                value={valStockStatus}
                onChange={v => { setValStockStatus(v); setValPage(1); syncUrl({ val_stock: v }) }}
                placeholder="All"
                options={[
                  { value: '', label: 'All' },
                  { value: 'in_stock', label: 'In Stock' },
                  { value: 'low_stock', label: 'Low Stock (≤5)' },
                  { value: 'out_of_stock', label: 'Out of Stock' },
                ]}
              />
            </div>
            {(valSearch || valCategory || valBrand || valStockStatus) && (
              <div className="flex flex-col">
                <span className={labelCls}>&nbsp;</span>
                <button
                  onClick={() => { setValSearch(''); setValCategory(''); setValBrand(''); setValStockStatus(''); setValPage(1); syncUrl({ val_search: '', val_category: '', val_brand: '', val_stock: '' }) }}
                  className="px-3 py-2.5 rounded-lg text-sm text-foreground-secondary hover:text-foreground border border-border-default hover:bg-surface-secondary transition-colors"
                >
                  Clear filters
                </button>
              </div>
            )}
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="w-6 h-6 border-2 border-secondary-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : valuation ? (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <SummaryCard label="Stock Value (ex-GST)" value={formatINR(filteredValRows.reduce((s, p) => s + parseFloat(p.stock_value || '0'), 0))} accent sub={filteredValRows.length !== allValRows.length ? `${filteredValRows.length} SKUs shown` : 'All products'} />
                <SummaryCard label="Stock Value (incl. GST)" value={formatINR(filteredValRows.reduce((s, p) => s + parseFloat(p.inventory_quantity || '0') * parseFloat(p.selling_price || '0'), 0))} accent sub={filteredValRows.length !== allValRows.length ? `${filteredValRows.length} SKUs shown` : 'All products'} />
                <SummaryCard label="Total SKUs" value={String(filteredValRows.length)} sub={filteredValRows.length !== allValRows.length ? `of ${allValRows.length} total` : 'across all products'} />
                <SummaryCard label="In Stock" value={String(filteredValRows.filter(p => parseFloat(p.inventory_quantity || '0') > 0).length)} sub="SKUs with stock > 0" />
              </div>
              {editingId && (
                <div className="bg-surface-elevated rounded-xl border border-secondary-200 dark:border-secondary-800/40 p-4 flex flex-wrap gap-4 items-end">
                  <div>
                    <p className="text-xs font-medium text-foreground-secondary mb-1">Adjust Stock Quantity</p>
                    <input
                      type="number"
                      min="0"
                      step="0.001"
                      autoFocus
                      value={editQty}
                      onChange={e => setEditQty(e.target.value)}
                      className="w-32 px-3 py-2 rounded-lg border border-secondary-500 bg-surface text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-secondary-500"
                    />
                  </div>
                  <div className="flex-1 min-w-[160px]">
                    <p className="text-xs font-medium text-foreground-secondary mb-1">Note (optional)</p>
                    <input
                      type="text"
                      placeholder="Reason for adjustment"
                      value={editNotes}
                      onChange={e => setEditNotes(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-border-default bg-surface text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-secondary-500"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => { const p = valSlice.find(r => (r.variant_id || r.id) === editingId); if (p) saveEdit(p) }}
                      disabled={editSaving || editQty === ''}
                      className="px-4 py-2 rounded-lg text-sm font-medium bg-secondary-500 hover:bg-secondary-600 text-white disabled:opacity-50 transition-colors"
                    >
                      {editSaving ? 'Saving…' : 'Save'}
                    </button>
                    <button onClick={cancelEdit} className="px-4 py-2 rounded-lg text-sm font-medium border border-border-default hover:bg-surface-secondary text-foreground transition-colors">
                      Cancel
                    </button>
                  </div>
                </div>
              )}
              <div className="bg-surface-elevated rounded-xl border border-border-default overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-surface-secondary border-b border-border-default">
                      <tr>
                        <SortableHeader label="Product" column="product" options={sortOptions('text')} currentSort={valSortCol} currentDir={valSortDir} onSort={handleValSort} />
                        <SortableHeader label="Variant" column="variant" options={sortOptions('text')} currentSort={valSortCol} currentDir={valSortDir} onSort={handleValSort} className="hidden sm:table-cell" />
                        <SortableHeader label="SKU" column="sku" options={sortOptions('text')} currentSort={valSortCol} currentDir={valSortDir} onSort={handleValSort} className="hidden md:table-cell" />
                        <SortableHeader label="Stock" column="stock" options={sortOptions('number')} currentSort={valSortCol} currentDir={valSortDir} onSort={handleValSort} align="right" />
                        <SortableHeader label="Price ex-GST" column="price" options={sortOptions('number')} currentSort={valSortCol} currentDir={valSortDir} onSort={handleValSort} align="right" />
                        <th className="px-4 py-3 text-right text-xs font-semibold text-foreground-secondary uppercase tracking-wide">GST %</th>
                        <SortableHeader label="Stock Value (ex-GST)" column="value" options={sortOptions('number')} currentSort={valSortCol} currentDir={valSortDir} onSort={handleValSort} align="right" />
                        <th className="px-4 py-3 text-right text-xs font-semibold text-foreground-secondary uppercase tracking-wide">Stock Value (incl. GST)</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-foreground-secondary uppercase tracking-wide">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border-default">
                      {valSlice.length === 0 && (
                        <tr><td colSpan={9} className="py-12 text-center text-foreground-secondary text-sm">
                          {valSearch ? `No products match "${valSearch}"` : 'No products in stock'}
                        </td></tr>
                      )}
                      {valSlice.map((p) => {
                        const rowId = p.variant_id || p.id
                        const isEditing = editingId === rowId
                        return (
                          <tr key={rowId} className={`hover:bg-surface-secondary/50 transition-colors ${isEditing ? 'bg-secondary-50/50 dark:bg-secondary-900/10' : ''}`}>
                            <td className="px-4 py-3 font-medium text-foreground">
                              <HoverCard
                                trigger={
                                  <Link href={`/admin/products/${p.id}`} className="hover:text-accent-500 hover:underline underline-offset-2">
                                    {p.name}
                                  </Link>
                                }
                                align="left"
                                side="bottom"
                                width="260px"
                              >
                                <div className="p-3 space-y-2">
                                  <p className="text-sm font-semibold text-foreground leading-tight">{p.name}</p>
                                  {p.variant_name && <p className="text-xs text-foreground-secondary">{p.variant_name}</p>}
                                  {p.sku && <p className="text-xs font-mono text-foreground-muted">{p.sku}</p>}
                                  <div className="border-t border-border-default pt-2 space-y-1.5 text-xs">
                                    <div className="flex justify-between">
                                      <span className="text-foreground-secondary">Stock</span>
                                      <span className="font-semibold text-foreground">{parseFloat(p.inventory_quantity || '0')}</span>
                                    </div>
                                    <div className="flex justify-between">
                                      <span className="text-foreground-secondary">Price ex-GST</span>
                                      <span className="font-medium text-foreground">{formatINR(parseFloat(p.cost_price || '0'))}</span>
                                    </div>
                                    <div className="flex justify-between">
                                      <span className="text-foreground-secondary">Stock Value</span>
                                      <span className="font-semibold text-foreground">{formatINR(parseFloat(p.stock_value || '0'))}</span>
                                    </div>
                                  </div>
                                </div>
                              </HoverCard>
                            </td>
                            <td className="px-4 py-3 text-foreground-secondary hidden sm:table-cell">{p.variant_name || '—'}</td>
                            <td className="px-4 py-3 font-mono text-xs text-foreground-secondary hidden md:table-cell">{p.sku || '—'}</td>
                            <td className="px-4 py-3 text-right">
                              <span className={`font-medium ${parseFloat(p.inventory_quantity || '0') === 0 ? 'text-red-600 dark:text-red-400' : parseFloat(p.inventory_quantity || '0') <= 5 ? 'text-orange-600 dark:text-orange-400' : 'text-foreground'}`}>
                                {parseFloat(p.inventory_quantity || '0')}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right text-foreground">{formatINR(parseFloat(p.cost_price || '0'))}</td>
                            <td className="px-4 py-3 text-right text-foreground-secondary text-sm">{parseFloat(p.gst_percentage || '0')}%</td>
                            <td className="px-4 py-3 text-right font-semibold text-foreground">{formatINR(parseFloat(p.stock_value || '0'))}</td>
                            <td className="px-4 py-3 text-right font-semibold text-foreground">{formatINR(parseFloat(p.inventory_quantity || '0') * parseFloat(p.selling_price || '0'))}</td>
                            <td className="px-4 py-3 text-right">
                              <div className="flex items-center justify-end gap-1">
                                <Link
                                  href={`/admin/products/${p.id}`}
                                  title="View Product"
                                  className="p-1.5 rounded hover:bg-surface-secondary text-accent-500 hover:text-accent-600 transition-colors"
                                >
                                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                  </svg>
                                </Link>
                                <button
                                  onClick={() => isEditing ? cancelEdit() : startEdit(p)}
                                  title={isEditing ? 'Cancel edit' : 'Adjust stock'}
                                  className={`p-1.5 rounded transition-colors ${isEditing ? 'hover:bg-surface-secondary text-secondary-500 hover:text-secondary-600' : 'hover:bg-surface-secondary text-foreground-muted hover:text-foreground'}`}
                                >
                                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                  </svg>
                                </button>
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="px-4 pb-4">
                  <ClientPagination page={valPage} total={filteredValRows.length} pageSize={VALUATION_PAGE_SIZE} onChange={p => { setValPage(p); cancelEdit() }} />
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
  const searchParams = useSearchParams()
  const router = useRouter()
  const tabParam = searchParams.get('tab') as Tab | null
  const poParam = searchParams.get('po') || undefined
  const [tab, setTab] = useState<Tab>(tabParam && ['suppliers', 'po', 'stock'].includes(tabParam) ? tabParam : poParam ? 'po' : 'suppliers')

  function handleTabChange(key: Tab) {
    setTab(key)
    const params = new URLSearchParams()
    params.set('tab', key)
    router.replace(`/admin/inventory?${params.toString()}`, { scroll: false })
  }

  return (
    <div className="space-y-5">
      <div className="flex border-b border-border-default gap-1">
        {TABS.map(t => (
          <button key={t.key} onClick={() => handleTabChange(t.key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${tab === t.key ? 'border-secondary-500 dark:border-secondary-400 text-secondary-500 dark:text-secondary-400' : 'border-transparent text-foreground-secondary hover:text-foreground'}`}>
            {t.label}
          </button>
        ))}
      </div>
      <div>
        {tab === 'suppliers' && <SuppliersTab />}
        {tab === 'po' && <POTab initialPO={poParam} />}
        {tab === 'stock' && <StockTab />}
      </div>
    </div>
  )
}
