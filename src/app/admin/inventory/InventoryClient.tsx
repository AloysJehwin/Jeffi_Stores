'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import AdminTypeahead from '@/components/admin/AdminTypeahead'
import AdminSelect from '@/components/admin/AdminSelect'
import HoverCard from '@/components/ui/HoverCard'
import SortableHeader, { sortOptions, type SortDir } from '@/components/admin/SortableHeader'
import { useToast } from '@/contexts/ToastContext'
import { useConfirm } from '@/contexts/ConfirmContext'
import DatePicker from '@/components/ui/DatePicker'
import { ap } from '@/lib/admin-path'

type Tab = 'suppliers' | 'po' | 'stock'

const TABS: { key: Tab; label: string }[] = [
  { key: 'suppliers', label: 'Suppliers' },
  { key: 'po', label: 'Purchase Orders' },
  { key: 'stock', label: 'Stock Ledger' },
]

const inputCls = 'w-full px-3 py-1.5 rounded-lg border border-border-default bg-surface text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-secondary-500 focus:border-transparent transition-colors placeholder:text-foreground-muted'
const labelCls = 'block text-xs font-medium text-foreground-secondary mb-1'
const btnPrimary = 'px-4 py-1.5 rounded-lg text-sm font-medium bg-secondary-500 hover:bg-secondary-600 dark:bg-secondary-400 dark:hover:bg-secondary-300 text-white dark:text-secondary-900 transition-colors disabled:opacity-50'
const btnSecondary = 'px-4 py-1.5 rounded-lg text-sm font-medium border border-border-default bg-surface hover:bg-surface-secondary text-foreground transition-colors'

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
  const btnCls = 'px-3 py-1.5 text-xs font-medium border border-border-default rounded-lg text-foreground-secondary hover:bg-surface-secondary disabled:opacity-40 disabled:pointer-events-none transition-colors'

  return (
    <div className="flex items-center justify-between gap-2 px-1 pt-4 border-t border-border-default mt-2">
      <p className="text-xs text-foreground-muted whitespace-nowrap">
        <span className="font-medium text-foreground">{start}–{end}</span> of <span className="font-medium text-foreground">{total}</span>
      </p>
      <div className="flex items-center gap-1.5">
        <button onClick={() => onChange(page - 1)} disabled={page <= 1} className={btnCls}>Prev</button>
        <span className="text-xs text-foreground-muted whitespace-nowrap">{page}/{totalPages}</span>
        <button onClick={() => onChange(page + 1)} disabled={page >= totalPages} className={btnCls}>Next</button>
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
            inputClassName="w-full px-3 py-1.5 pr-9 bg-surface border border-border-secondary rounded-lg text-sm text-foreground focus:ring-2 focus:ring-accent-500 focus:border-transparent transition-colors hover:border-border-default placeholder:text-foreground-muted"
          />
        </div>
        <div className="flex flex-col">
          <AdminSelect
            label="Status"
            value={showAll ? 'all' : 'active'}
            onChange={v => { setShowAll(v === 'all'); setPage(1) }}
            options={[
              { value: 'active', label: 'Active only' },
              { value: 'all', label: 'Show inactive' },
            ]}
            sm
          />
        </div>
        <div className="flex flex-col">
          <span className={labelCls}>&nbsp;</span>
          <Link href={ap('/admin/suppliers/new')} className={btnPrimary}>
            + Add Supplier
          </Link>
        </div>
      </div>

      {loading ? (
        <div className="bg-surface-elevated rounded-xl border border-border-default p-4 space-y-3">
          <div className="h-5 w-32 bg-surface-secondary rounded animate-pulse" />
          <div className="h-12 w-full bg-surface-secondary rounded animate-pulse" />
          <div className="h-12 w-full bg-surface-secondary rounded animate-pulse" />
          <div className="h-12 w-full bg-surface-secondary rounded animate-pulse" />
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
                      <Link href={ap(`/admin/suppliers/${s.id}`)} className="hover:text-accent-500 hover:underline">{s.name}</Link>
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
                        <Link href={ap(`/admin/suppliers/${s.id}/edit`)} className="text-xs text-secondary-500 dark:text-secondary-400 hover:underline font-medium">Edit</Link>
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
  supplier_email: string | null
  status: string; order_date: string; expected_date: string | null
  item_count: number; total_amount: string
}

type POItem = {
  id: string; product_id: string; variant_id: string | null
  product_name: string; variant_name: string | null; sku: string | null
  quantity: string; unit_cost: string; tax_rate: string; total_cost: string; quantity_received: string
  purchase_unit: string | null; purchase_unit_factor: string | null
  sell_unit_label: string | null; sell_unit_dimension: string | null
  perishable: boolean
}

/** For count-dimension products stock is always in pc; for others use sell_unit_label */
function poBaseUnitLabel(it: Pick<POItem, 'sell_unit_label' | 'sell_unit_dimension'>): string {
  if (!it.sell_unit_dimension || it.sell_unit_dimension === 'count') return 'pc'
  return it.sell_unit_label || 'units'
}

function POTab({ initialPO }: { initialPO?: string }) {
  const { showToast } = useToast()
  const confirm = useConfirm()
  const [pos, setPOs] = useState<PO[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [viewPO, setViewPO] = useState<{ po: any; items: POItem[]; grns: any[] } | null>(null)
  const [receiveMode, setReceiveMode] = useState<{ po: any } | null>(null)
  const [poCategories, setPoCategories] = useState<{ id: string; name: string }[]>([])
  const [saving, setSaving] = useState(false)
  const [receiveItems, setReceiveItems] = useState<any[]>([])
  const [receiveNotes, setReceiveNotes] = useState('')
  const [receiveSaving, setReceiveSaving] = useState(false)
  const [shelfLocations, setShelfLocations] = useState<{ id: string; display_code: string }[]>([])
  const [poSortCol, setPoSortCol] = useState<string | undefined>(undefined)
  const [poSortDir, setPoSortDir] = useState<SortDir | undefined>(undefined)
  const [sendingEmailId, setSendingEmailId] = useState<string | null>(null)

  async function sendPOEmail(po: PO) {
    setSendingEmailId(po.id)
    try {
      const res = await fetch(`/api/admin/inventory/po/${po.id}/resend-email`, { method: 'POST', credentials: 'include' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to send email')
      showToast('Purchase order email sent', 'success')
    } catch (err: any) {
      showToast(err.message, 'error')
    } finally {
      setSendingEmailId(null)
    }
  }

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
    setViewPO({ po: json.purchase_order, items: json.items || [], grns: json.grns || [] })
  }

  async function openReceive(id: string) {
    const res = await fetch(`/api/admin/inventory/po/${id}`)
    const json = await res.json()
    const items = (json.items || []).map((it: POItem) => {
      const factor = parseFloat(it.purchase_unit_factor || '1')
      const remaining = Math.max(0, parseFloat(it.quantity) - parseFloat(it.quantity_received || '0'))
      return {
        ...it,
        receive_qty: String(factor > 1 ? Math.round((remaining / factor) * 1000) / 1000 : remaining),
        receive_cost: it.unit_cost,
        purchase_unit_factor: factor,
        lot_number: '',
        expiry_date: '',
        manufacture_date: '',
        location_id: '',
      }
    })
    setReceiveMode({ po: json.purchase_order })
    setReceiveItems(items)
    setReceiveNotes('')
    // Fetch shelf locations for the location picker
    const slRes = await fetch('/api/admin/shelving/locations').catch(() => null)
    if (slRes?.ok) {
      const slJson = await slRes.json()
      setShelfLocations(slJson?.locations || [])
    }
  }

  async function submitReceive() {
    if (!receiveMode) return
    // Validate perishable items have expiry_date
    const missing = receiveItems.filter(it => parseFloat(it.receive_qty) > 0 && it.perishable && !it.expiry_date)
    if (missing.length > 0) {
      showToast(`Expiry date required for: ${missing.map((it: any) => it.product_name + (it.variant_name ? ' / ' + it.variant_name : '')).join(', ')}`, 'error')
      return
    }
    setReceiveSaving(true)
    const items = receiveItems.filter(it => parseFloat(it.receive_qty) > 0).map(it => ({
      po_item_id: it.id, product_id: it.product_id, variant_id: it.variant_id || null,
      quantity_received: parseFloat(it.receive_qty), unit_cost: parseFloat(it.receive_cost),
      purchase_unit_factor: parseFloat(it.purchase_unit_factor || '1'),
      ...(it.perishable ? {
        lot_number: it.lot_number || null,
        expiry_date: it.expiry_date || null,
        manufacture_date: it.manufacture_date || null,
        location_id: it.location_id || null,
      } : {}),
    }))
    const res = await fetch(`/api/admin/inventory/po/${receiveMode.po.id}/receive`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items, notes: receiveNotes }),
    })
    const json = await res.json()
    setReceiveSaving(false)
    if (json.success) { setReceiveMode(null); load(page) }
    else showToast(json.error || 'Failed to receive goods', 'error')
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
      setViewPO({ po: json.purchase_order, items: json.items || [], grns: json.grns || [] })
    }
  }

  async function cancelPO(id: string) {
    const ok = await confirm({
      title: 'Cancel purchase order?',
      message: 'This cannot be undone.',
      variant: 'danger',
      confirmLabel: 'Cancel PO',
      cancelLabel: 'Keep',
    })
    if (!ok) return
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
          <button className="inline-flex items-center gap-1.5 text-sm text-foreground-secondary hover:text-foreground transition-colors" onClick={() => setReceiveMode(null)}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
            Back
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
                  <th className="px-4 py-3 text-right text-xs font-semibold text-foreground-secondary uppercase tracking-wide">Tax %</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-foreground-secondary uppercase tracking-wide">Line Total (₹)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-default">
                {receiveItems.map((it, idx) => {
                  const factor = parseFloat(it.purchase_unit_factor || '1')
                  const baseLabel = poBaseUnitLabel(it)
                  const puLabel = it.purchase_unit || baseLabel
                  const orderedInPu = factor > 1 ? Math.round((parseFloat(it.quantity) / factor) * 1000) / 1000 : parseFloat(it.quantity)
                  const prevInPu = factor > 1 ? Math.round((parseFloat(it.quantity_received || '0') / factor) * 1000) / 1000 : parseFloat(it.quantity_received || '0')
                  return (
                  <React.Fragment key={it.id}>
                  <tr className="hover:bg-surface-secondary/50 transition-colors">
                    <td className="px-4 py-3 text-foreground">
                      <p className="font-medium">{it.product_name}{it.variant_name && <span className="text-foreground-secondary font-normal"> / {it.variant_name}</span>}</p>
                      {it.sku && <p className="text-xs text-foreground-muted font-mono mt-0.5">{it.sku}</p>}
                      {it.purchase_unit && factor > 1 && (
                        <p className="text-xs text-foreground-muted mt-0.5">1 {it.purchase_unit} = {factor} {baseLabel}</p>
                      )}
                      {it.perishable && (
                        <span className="mt-1 inline-block text-[10px] font-medium px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">Perishable</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-foreground-secondary">
                      {orderedInPu}{puLabel && <span className="text-xs text-foreground-muted ml-1">{puLabel}</span>}
                    </td>
                    <td className="px-4 py-3 text-right text-foreground-secondary">
                      {prevInPu}{puLabel && <span className="text-xs text-foreground-muted ml-1">{puLabel}</span>}
                    </td>
                    <td className="px-4 py-3 text-right align-middle">
                      <div className="flex items-center justify-end gap-1.5">
                        <input type="number" min="0" step="0.001" className="w-24 field-compact border border-border-default bg-surface text-foreground text-right focus:outline-none focus:ring-2 focus:ring-secondary-500 focus:border-transparent" value={it.receive_qty}
                          onChange={e => setReceiveItems(items => items.map((r, i) => i === idx ? { ...r, receive_qty: e.target.value } : r))} />
                        {puLabel && <span className="text-xs text-foreground-muted">{puLabel}</span>}
                        {factor > 1 && parseFloat(it.receive_qty) > 0 && (
                          <span className="text-xs text-foreground-muted">= {Math.round(parseFloat(it.receive_qty) * factor * 1000) / 1000} {baseLabel}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right align-middle">
                      <input type="number" min="0" step="0.01" className="w-28 field-compact border border-border-default bg-surface text-foreground text-right focus:outline-none focus:ring-2 focus:ring-secondary-500 focus:border-transparent" value={it.receive_cost}
                        onChange={e => setReceiveItems(items => items.map((r, i) => i === idx ? { ...r, receive_cost: e.target.value } : r))} />
                    </td>
                    <td className="px-4 py-3 text-right text-foreground-secondary align-middle">
                      {parseFloat(it.tax_rate || '0') > 0 ? `${it.tax_rate}%` : '—'}
                    </td>
                    <td className="px-4 py-3 text-right text-foreground align-middle">
                      {(() => {
                        const qty = parseFloat(it.receive_qty) || 0
                        const cost = parseFloat(it.receive_cost) || 0
                        const tax = parseFloat(it.tax_rate || '0')
                        if (!qty || !cost) return '—'
                        const baseQty = qty * factor
                        const lineTotal = baseQty * cost * (1 + tax / 100)
                        return formatINR(lineTotal)
                      })()}
                    </td>
                  </tr>
                  {it.perishable && (
                    <tr className="bg-orange-50/60 dark:bg-orange-900/10 border-t border-orange-100 dark:border-orange-900/30">
                      <td colSpan={7} className="px-4 py-3">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 items-start">
                          <div>
                            <label className={labelCls}>Expiry Date <span className="text-red-500">*</span></label>
                            <DatePicker
                              value={it.expiry_date}
                              onChange={v => setReceiveItems(items => items.map((r, i) => i === idx ? { ...r, expiry_date: v } : r))}
                            />
                          </div>
                          <div>
                            <label className={labelCls}>Manufacture Date</label>
                            <DatePicker
                              value={it.manufacture_date}
                              onChange={v => setReceiveItems(items => items.map((r, i) => i === idx ? { ...r, manufacture_date: v } : r))}
                            />
                          </div>
                          <div>
                            <label className={labelCls}>Lot Number</label>
                            <input
                              type="text"
                              placeholder="optional"
                              className={inputCls}
                              value={it.lot_number}
                              onChange={e => setReceiveItems(items => items.map((r, i) => i === idx ? { ...r, lot_number: e.target.value } : r))}
                            />
                          </div>
                          <div className="self-start">
                            <label className={labelCls}>Shelf Location</label>
                            <AdminSelect
                              id={`location-${idx}`}
                              value={it.location_id}
                              onChange={v => setReceiveItems(items => items.map((r, i) => i === idx ? { ...r, location_id: v } : r))}
                              sm
                              options={[
                                { value: '', label: '— none —' },
                                ...shelfLocations.map(sl => ({ value: sl.id, label: sl.display_code })),
                              ]}
                            />
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                  </React.Fragment>
                  )
                })}
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
          <button className="inline-flex items-center gap-1.5 text-sm text-foreground-secondary hover:text-foreground transition-colors" onClick={() => setViewPO(null)}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
            Back
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
                {viewPO.items.map(it => {
                  const factor = parseFloat(it.purchase_unit_factor || '1')
                  const baseLabel = poBaseUnitLabel(it)
                  const puLabel = it.purchase_unit || baseLabel
                  const qtyInPu = factor > 1 ? Math.round((parseFloat(it.quantity) / factor) * 1000) / 1000 : parseFloat(it.quantity)
                  const recvInPu = factor > 1 ? Math.round((parseFloat(it.quantity_received || '0') / factor) * 1000) / 1000 : parseFloat(it.quantity_received || '0')
                  const recvFull = recvInPu >= qtyInPu
                  const recvPartial = recvInPu > 0 && !recvFull
                  return (
                  <tr key={it.id} className="hover:bg-surface-secondary/50 transition-colors">
                    <td className="px-4 py-3 text-foreground">
                      <p className="font-medium">{it.product_name}{it.variant_name && <span className="text-foreground-secondary font-normal"> / {it.variant_name}</span>}</p>
                      {it.purchase_unit && (
                        <p className="text-xs text-foreground-muted mt-0.5">
                          {factor > 1 ? `1 ${it.purchase_unit} = ${factor} ${baseLabel}` : it.purchase_unit}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-foreground-secondary hidden sm:table-cell">{it.sku || '—'}</td>
                    <td className="px-4 py-3 text-right text-foreground-secondary">
                      {qtyInPu}{puLabel && <span className="text-xs text-foreground-muted ml-1">{puLabel}</span>}
                    </td>
                    <td className="px-4 py-3 text-right text-foreground">{formatINR(parseFloat(it.unit_cost))}</td>
                    <td className="px-4 py-3 text-right text-foreground-secondary hidden sm:table-cell">{it.tax_rate}%</td>
                    <td className="px-4 py-3 text-right font-semibold text-foreground">{formatINR(parseFloat(it.total_cost))}</td>
                    <td className="px-4 py-3 text-right">
                      <span className={`text-xs font-medium ${recvFull ? 'text-green-600 dark:text-green-400' : recvPartial ? 'text-yellow-600 dark:text-yellow-400' : 'text-foreground-secondary'}`}>
                        {recvInPu} / {qtyInPu}{puLabel && <span className="font-normal opacity-70 ml-1">{puLabel}</span>}
                      </span>
                    </td>
                  </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Receipt history */}
        {viewPO.grns.length > 0 && (
          <div>
            <h4 className="text-sm font-semibold text-foreground mb-2">Receipt History</h4>
            <div className="space-y-3">
              {viewPO.grns.map((grn: any) => {
                const grnItems: any[] = grn.grn_items || []
                return (
                  <div key={grn.id} className="bg-surface-elevated rounded-xl border border-border-default overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-2.5 bg-surface-secondary border-b border-border-default">
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-xs font-semibold text-foreground">{grn.grn_number}</span>
                        <span className="text-xs text-foreground-secondary">{formatDate(grn.received_date)}</span>
                      </div>
                      {grn.notes && <span className="text-xs text-foreground-muted italic truncate max-w-xs">{grn.notes}</span>}
                    </div>
                    <div className="divide-y divide-border-default">
                      {grnItems.map((gi: any, idx: number) => {
                        const matchItem = viewPO.items.find((it: POItem) => it.id === gi.po_item_id)
                        const factor = parseFloat(gi.purchase_unit_factor || '1')
                        const recvBase = parseFloat(gi.quantity_received || '0')
                        const recvPu = factor > 1 ? Math.round((recvBase / factor) * 1000) / 1000 : recvBase
                        const puLabel = matchItem?.purchase_unit || poBaseUnitLabel(matchItem || { sell_unit_label: '', sell_unit_dimension: '' })
                        const productLabel = matchItem
                          ? `${matchItem.product_name}${matchItem.variant_name ? ' / ' + matchItem.variant_name : ''}`
                          : `Item #${idx + 1}`
                        const taxRate = parseFloat(gi.tax_rate ?? matchItem?.tax_rate ?? '0')
                        const costPerPu = gi.unit_cost
                          ? parseFloat(gi.unit_cost) * factor * (1 + taxRate / 100)
                          : null
                        return (
                          <div key={idx} className="flex items-center justify-between px-4 py-2 text-sm">
                            <span className="text-foreground-secondary">{productLabel}</span>
                            <div className="flex items-center gap-4 text-right">
                              <span className="text-foreground font-medium">
                                {recvPu}<span className="text-xs text-foreground-muted ml-1">{puLabel}</span>
                              </span>
                              {costPerPu != null && <span className="text-foreground-secondary text-xs">@ {formatINR(costPerPu)}/{puLabel}</span>}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

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
            inputClassName="w-full px-3 py-1.5 pr-9 bg-surface border border-border-secondary rounded-lg text-sm text-foreground focus:ring-2 focus:ring-accent-500 focus:border-transparent transition-colors hover:border-border-default placeholder:text-foreground-muted"
          />
        </div>
        <div className="w-44">
          <label className={labelCls}>Status</label>
          <AdminSelect
            sm
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
          <Link href={ap('/admin/inventory/po/new')} className={btnPrimary}>
            + Create PO
          </Link>
        </div>
      </div>

      {loading ? (
        <div className="bg-surface-elevated rounded-xl border border-border-default p-4 space-y-3">
          <div className="h-5 w-32 bg-surface-secondary rounded animate-pulse" />
          <div className="h-12 w-full bg-surface-secondary rounded animate-pulse" />
          <div className="h-12 w-full bg-surface-secondary rounded animate-pulse" />
          <div className="h-12 w-full bg-surface-secondary rounded animate-pulse" />
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
                    <td className="px-4 py-3 font-mono text-xs font-medium">
                      <button
                        type="button"
                        onClick={() => openPO(po.id)}
                        className="text-accent-500 hover:underline cursor-pointer font-mono"
                      >
                        {po.po_number}
                      </button>
                    </td>
                    <td className="px-4 py-3 font-medium text-foreground">
                      <Link href={ap(`/admin/suppliers/${po.supplier_id}`)} className="hover:text-accent-500 hover:underline">{po.supplier_name}</Link>
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
                        {po.supplier_email && (
                          <button
                            onClick={() => sendPOEmail(po)}
                            disabled={sendingEmailId === po.id}
                            title={`Send email to ${po.supplier_email}`}
                            className="p-1 text-foreground-secondary hover:text-secondary-500 transition-colors disabled:opacity-50"
                          >
                            {sendingEmailId === po.id ? (
                              <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth={4} />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                              </svg>
                            ) : (
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                              </svg>
                            )}
                          </button>
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
  unit_id: string | null; unit_label: string | null
  unit_factor: number | null; quantity_in_unit: number | null
  product_id: string; product_name: string; product_sku: string | null
  variant_id: string | null; variant_name: string | null
  sub_variant_id: string | null; sub_variant_name: string | null
  reference_label: string | null
  batch_id: string | null; lot_number: string | null; expiry_date: string | null
}

function StockTab() {
  const searchParams = useSearchParams()
  const router = useRouter()

  const [transactions, setTransactions] = useState<StockTransaction[]>([])
  const [txTotal, setTxTotal] = useState(0)
  const [txPage, setTxPage] = useState(1)
  const [valuation, setValuation] = useState<{ products: any[]; total: number; totalValue: number; allCategories?: string[]; allBrands?: string[] } | null>(null)
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
  const [expandedValRows, setExpandedValRows] = useState<Record<string, any[] | null>>({})
  const [loadingBatchRow, setLoadingBatchRow] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editQty, setEditQty] = useState('')
  const [editNotes, setEditNotes] = useState('')
  const [editSaving, setEditSaving] = useState(false)
  const [editUnits, setEditUnits] = useState<{ id: string; unit: string; display_label: string | null; factor: number; dimension: string }[]>([])
  const [editUnitId, setEditUnitId] = useState<string>('')
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())

  function toggleGroup(refId: string) {
    setExpandedGroups(prev => {
      const next = new Set(prev)
      if (next.has(refId)) next.delete(refId); else next.add(refId)
      return next
    })
  }

  async function toggleValBatch(rowId: string, productId: string, variantId: string | null, subVariantId: string | null) {
    if (expandedValRows[rowId] !== undefined) {
      setExpandedValRows(prev => { const n = { ...prev }; delete n[rowId]; return n })
      return
    }
    setLoadingBatchRow(rowId)
    const params = new URLSearchParams({ view: 'batch_valuation', product_id: productId })
    if (variantId) params.set('variant_id', variantId)
    if (subVariantId) params.set('sub_variant_id', subVariantId)
    const res = await fetch(`/api/admin/inventory/stock?${params}`)
    const json = await res.json()
    setExpandedValRows(prev => ({ ...prev, [rowId]: json?.batches || [] }))
    setLoadingBatchRow(null)
  }

  function syncUrl(patch: Record<string, string>) {
    const p = new URLSearchParams(window.location.search)
    for (const [k, v] of Object.entries(patch)) {
      if (v) p.set(k, v); else p.delete(k)
    }
    router.replace(`${ap('/admin/inventory')}?${p.toString()}`, { scroll: false })
  }
  const [ledgerSortCol, setLedgerSortCol] = useState<string | undefined>(undefined)
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

  // Group by reference_id, preserving order of first appearance
  const ledgerGroups: { refId: string; refType: string; refLabel: string | null; date: string; txs: StockTransaction[] }[] = []
  for (const tx of sortedTransactions) {
    const existing = ledgerGroups.find(g => g.refId === tx.reference_id)
    if (existing) { existing.txs.push(tx) }
    else { ledgerGroups.push({ refId: tx.reference_id, refType: tx.reference_type, refLabel: tx.reference_label, date: tx.created_at, txs: [tx] }) }
  }

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

  const loadValuation = useCallback(async (pg = valPage) => {
    setLoading(true)
    const params = new URLSearchParams({
      view: 'valuation',
      page: String(pg),
      limit: String(VALUATION_PAGE_SIZE),
    })
    if (valSearch) params.set('search', valSearch)
    if (valCategory) params.set('category', valCategory)
    if (valBrand) params.set('brand', valBrand)
    if (valStockStatus) params.set('stock_status', valStockStatus)
    const res = await fetch(`/api/admin/inventory/stock?${params}`)
    const json = await res.json()
    setValuation(json)
    setLoading(false)
  }, [valSearch, valCategory, valBrand, valStockStatus, valPage])

  useEffect(() => {
    if (view === 'ledger') loadLedger(txPage)
    else loadValuation(valPage)
  }, [view, loadLedger, loadValuation, txPage, valPage])

  const allValRows = valuation?.products || []
  const valTotal = valuation?.total || 0

  const valCategories = (valuation?.allCategories || [...new Set(allValRows.map((p: any) => p.category_name).filter(Boolean))]).sort() as string[]
  const valBrands = (valuation?.allBrands || [...new Set(allValRows.map((p: any) => p.brand_name).filter(Boolean))]).sort() as string[]

  const VAL_SORT_KEYS: Record<string, string> = {
    product: 'name', variant: 'variant_name', sku: 'sku',
    stock: 'inventory_quantity', price: 'cost_price', value: 'stock_value',
  }
  const sortedValRows = valSortCol && VAL_SORT_KEYS[valSortCol]
    ? [...allValRows].sort((a, b) => {
        const k = VAL_SORT_KEYS[valSortCol]
        const cmp = String(a[k] ?? '').localeCompare(String(b[k] ?? ''), 'en', { numeric: true })
        return valSortDir === 'asc' ? cmp : -cmp
      })
    : allValRows

  function startEdit(p: any) {
    const rowId = p.sub_variant_id || p.variant_id || p.id
    setEditingId(rowId)
    setEditNotes('')

    // Build unit options from the valuation row data
    const sellFactor = parseFloat(p.sell_unit_factor || '1') || 1
    const units: { id: string; unit: string; display_label: string | null; factor: number; dimension: string }[] = []

    // We don't have unit IDs in the valuation row — fetch them from the units API
    const apiPath = p.variant_id
      ? `/api/admin/products/${p.id}/variants/${p.variant_id}/units`
      : `/api/admin/products/${p.id}/units`

    // Default: show base-unit qty while units load
    const currentBase = parseFloat(p.inventory_quantity || '0')
    setEditQty(String(currentBase))
    setEditUnits([])
    setEditUnitId('')

    fetch(apiPath)
      .then(r => r.json())
      .then(json => {
        const fetched = (json?.units || []).map((u: any) => ({
          id: u.id,
          unit: u.unit,
          display_label: u.display_label,
          factor: parseFloat(u.factor) || 1,
          dimension: u.dimension,
        }))
        // For sub-variants, also try sub-variant-specific units if present; fall back to variant/product
        setEditUnits(fetched)
        // For count-dimension, always pre-select the base (pc, factor=1) unit so
        // the operator enters raw piece count — no unwanted multiplication.
        // For other dimensions, match by factor to the valuation row's sell unit.
        const isCount = p.sell_unit_dimension === 'count'
        const match = isCount
          ? (fetched.find((u: any) => u.factor === 1 && u.dimension === 'count') || fetched.find((u: any) => u.dimension === 'count') || fetched[0])
          : (fetched.find((u: any) => Math.abs(u.factor - sellFactor) < 0.0001) || fetched[0])
        if (match) {
          setEditUnitId(match.id)
          // Pre-fill qty as sell-unit qty only for non-count units with factor > 1
          if (!isCount && match.factor > 1) {
            setEditQty(String(Math.round(currentBase / match.factor * 1000) / 1000))
          }
        }
      })
      .catch(() => {})
  }

  async function saveEdit(p: any) {
    setEditSaving(true)
    const selectedUnit = editUnits.find(u => u.id === editUnitId)
    const body: Record<string, any> = {
      product_id: p.id,
      variant_id: p.variant_id || null,
      sub_variant_id: p.sub_variant_id || null,
      notes: editNotes || undefined,
    }
    // Count-dimension units are always stored as raw pcs — never multiply via unit_id path
    const isCountUnit = !selectedUnit || selectedUnit.dimension === 'count' || selectedUnit.factor === 1
    if (!isCountUnit) {
      body.unit_id = selectedUnit!.id
      body.quantity_in_unit = parseFloat(editQty)
    } else {
      body.new_quantity = parseFloat(editQty)
    }
    await fetch('/api/admin/inventory/stock', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    setEditSaving(false)
    setEditingId(null)
    loadValuation(valPage)
  }

  function cancelEdit() {
    setEditingId(null)
    setEditQty('')
    setEditNotes('')
    setEditUnits([])
    setEditUnitId('')
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
                inputClassName="w-full px-3 py-1.5 pr-9 bg-surface border border-border-secondary rounded-lg text-sm text-foreground focus:ring-2 focus:ring-accent-500 focus:border-transparent transition-colors hover:border-border-default placeholder:text-foreground-muted" />
            </div>
            <div>
              <label className={labelCls}>From</label>
              <DatePicker className="w-36" value={from} onChange={v => { setFrom(v); setTxPage(1); syncUrl({ ledger_from: v }) }} />
            </div>
            <div>
              <label className={labelCls}>To</label>
              <DatePicker className="w-36" value={to} onChange={v => { setTo(v); setTxPage(1); syncUrl({ ledger_to: v }) }} />
            </div>
          </div>

          {loading ? (
            <div className="bg-surface-elevated rounded-xl border border-border-default p-4 space-y-3">
              <div className="h-5 w-32 bg-surface-secondary rounded animate-pulse" />
              <div className="h-12 w-full bg-surface-secondary rounded animate-pulse" />
              <div className="h-12 w-full bg-surface-secondary rounded animate-pulse" />
              <div className="h-12 w-full bg-surface-secondary rounded animate-pulse" />
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
                      <th className="px-4 py-3 text-xs font-semibold text-foreground-secondary uppercase tracking-wide hidden md:table-cell">Batch</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-default">
                    {transactions.length === 0 && (
                      <tr><td colSpan={7} className="py-12 text-center text-foreground-secondary text-sm">
                        {search || from || to ? 'No transactions match your filters' : 'No stock transactions yet'}
                      </td></tr>
                    )}
                    {ledgerGroups.map(group => {
                      const multi = group.txs.length > 1
                      const expanded = expandedGroups.has(group.refId)
                      const totalChange = Math.round(group.txs.reduce((s, t) => s + Number(t.quantity_change), 0) * 1000) / 1000
                      const txType = group.txs[0].transaction_type

                      const refLink = group.refType === 'order' ? (
                        <Link href={ap(`/admin/invoices/${group.refId}`)} className="font-mono text-accent-500 hover:underline underline-offset-2">
                          {group.refLabel || group.refId.slice(0, 8) + '…'}
                        </Link>
                      ) : group.refType === 'cash_sale' ? (
                        <Link href={ap(`/admin/cash-sale/${group.refId}`)} className="font-mono text-accent-500 hover:underline underline-offset-2">
                          {group.refLabel || group.refId.slice(0, 8) + '…'}
                        </Link>
                      ) : group.refType === 'grn' ? (
                        <Link href={ap(`/admin/financial?tab=grn`)} className="font-mono text-accent-500 hover:underline underline-offset-2">
                          {group.refLabel || group.refId.slice(0, 8) + '…'}
                        </Link>
                      ) : (
                        <span className="font-mono text-foreground-secondary">{group.refType} / {group.refId.slice(0, 8)}…</span>
                      )

                      function fmtChange(n: number) {
                        const sign = n > 0 ? '+' : n < 0 ? '−' : ''
                        return `${sign}${Math.abs(n)}`
                      }

                      if (!multi) {
                        const tx = group.txs[0]
                        const chg = Number(tx.quantity_change)
                        return (
                          <tr key={tx.id} className="hover:bg-surface-secondary/50 transition-colors">
                            <td className="px-4 py-3 text-foreground-secondary whitespace-nowrap text-xs">
                              {new Date(tx.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                            </td>
                            <td className="px-4 py-3 text-foreground">
                              <HoverCard
                                trigger={
                                  <Link href={ap(`/admin/products/${tx.product_id}`)} className="font-medium hover:text-accent-500 hover:underline underline-offset-2">
                                    {tx.product_name}{tx.variant_name && <span className="text-foreground-secondary font-normal"> / {tx.variant_name}{tx.sub_variant_name ? ` / ${tx.sub_variant_name}` : ''}</span>}
                                  </Link>
                                }
                                align="left" side="bottom" width="260px"
                              >
                                <div className="p-3 space-y-2">
                                  <p className="text-sm font-semibold text-foreground leading-tight">{tx.product_name}</p>
                                  {tx.variant_name && <p className="text-xs text-foreground-secondary">{tx.variant_name}{tx.sub_variant_name ? ` / ${tx.sub_variant_name}` : ''}</p>}
                                  {tx.product_sku && <p className="text-xs font-mono text-foreground-muted">{tx.product_sku}</p>}
                                  <div className="border-t border-border-default pt-2 space-y-1.5 text-xs">
                                    <div className="flex justify-between">
                                      <span className="text-foreground-secondary">Type</span>
                                      <span className={`px-1.5 py-0.5 rounded-full font-medium ${TYPE_BADGE[tx.transaction_type] || ''}`}>{tx.transaction_type}</span>
                                    </div>
                                    <div className="flex justify-between">
                                      <span className="text-foreground-secondary">Change</span>
                                      <span className={`font-mono font-semibold ${chg > 0 ? 'text-green-600 dark:text-green-400' : chg < 0 ? 'text-red-600 dark:text-red-400' : 'text-foreground-secondary'}`}>
                                        {fmtChange(chg)}
                                      </span>
                                    </div>
                                    <div className="flex justify-between">
                                      <span className="text-foreground-secondary">Balance after</span>
                                      <span className="font-mono font-medium text-foreground">{Number(tx.quantity_after)}</span>
                                    </div>
                                    {tx.notes && <div className="pt-1 border-t border-border-default"><p className="text-foreground-secondary leading-snug">{tx.notes}</p></div>}
                                  </div>
                                </div>
                              </HoverCard>
                              {tx.product_sku && <p className="text-xs text-foreground-muted font-mono mt-0.5">{tx.product_sku}</p>}
                            </td>
                            <td className="px-4 py-3">
                              <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium capitalize ${TYPE_BADGE[tx.transaction_type] || ''}`}>{tx.transaction_type}</span>
                            </td>
                            <td className={`px-4 py-3 text-right font-mono font-semibold ${chg > 0 ? 'text-green-600 dark:text-green-400' : chg < 0 ? 'text-red-600 dark:text-red-400' : 'text-foreground-secondary'}`}>
                              {fmtChange(chg)}
                              {tx.quantity_in_unit != null && tx.unit_label && (
                                <span className="block text-xs font-normal text-foreground-muted">
                                  ({Number(tx.quantity_in_unit) > 0 ? '+' : ''}{Number(tx.quantity_in_unit)} {tx.unit_label})
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-right font-mono text-foreground font-medium">{Number(tx.quantity_after)}</td>
                            <td className="px-4 py-3 text-xs hidden md:table-cell">{refLink}</td>
                            <td className="px-4 py-3 text-xs hidden md:table-cell">
                              {tx.lot_number ? (
                                <div className="space-y-0.5">
                                  <span className="font-mono text-foreground-secondary">{tx.lot_number}</span>
                                  {tx.expiry_date && (() => {
                                    const d = new Date(tx.expiry_date)
                                    const now = new Date()
                                    const diffDays = Math.floor((d.getTime() - now.getTime()) / 86400000)
                                    const cls = diffDays < 0 ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' : diffDays <= 30 ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                                    return <span className={`inline-flex px-1.5 py-0.5 rounded text-xs font-medium ${cls}`}>{formatDate(tx.expiry_date)}</span>
                                  })()}
                                </div>
                              ) : '—'}
                            </td>
                          </tr>
                        )
                      }

                      return (
                        <React.Fragment key={`group-${group.refId}`}>
                          {/* Group header row */}
                          <tr
                            className="bg-surface-secondary/60 hover:bg-surface-secondary cursor-pointer transition-colors select-none"
                            onClick={() => toggleGroup(group.refId)}
                          >
                            <td className="px-4 py-2.5 text-foreground-secondary whitespace-nowrap text-xs">
                              {new Date(group.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                            </td>
                            <td className="px-4 py-2.5">
                              <div className="flex items-center gap-2">
                                <svg
                                  className={`w-3.5 h-3.5 text-foreground-secondary shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`}
                                  fill="none" stroke="currentColor" viewBox="0 0 24 24"
                                >
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                </svg>
                                <span className="text-sm font-medium text-foreground">
                                  {group.txs.length} items
                                </span>
                                <span className="text-xs text-foreground-muted">
                                  {expanded ? '(collapse)' : '(expand)'}
                                </span>
                              </div>
                            </td>
                            <td className="px-4 py-2.5">
                              <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium capitalize ${TYPE_BADGE[txType] || ''}`}>{txType}</span>
                            </td>
                            <td className={`px-4 py-2.5 text-right font-mono font-semibold ${totalChange > 0 ? 'text-green-600 dark:text-green-400' : totalChange < 0 ? 'text-red-600 dark:text-red-400' : 'text-foreground-secondary'}`}>
                              {fmtChange(totalChange)}
                              <span className="block text-xs font-normal text-foreground-muted">net total</span>
                            </td>
                            <td className="px-4 py-2.5 text-right text-foreground-muted text-xs font-mono">—</td>
                            <td className="px-4 py-2.5 text-xs hidden md:table-cell">{refLink}</td>
                            <td className="px-4 py-2.5 hidden md:table-cell" />
                          </tr>

                          {/* Expanded product rows */}
                          {expanded && group.txs.map(tx => {
                            const chg = Number(tx.quantity_change)
                            return (
                              <tr key={tx.id} className="bg-surface/40 hover:bg-surface-secondary/30 transition-colors border-l-2 border-accent-500/30">
                                <td className="px-4 py-2.5 text-foreground-secondary whitespace-nowrap text-xs pl-8" />
                                <td className="px-4 py-2.5 pl-8 text-foreground">
                                  <Link href={ap(`/admin/products/${tx.product_id}`)} className="text-sm font-medium hover:text-accent-500 hover:underline underline-offset-2">
                                    {tx.product_name}{tx.variant_name && <span className="text-foreground-secondary font-normal"> / {tx.variant_name}{tx.sub_variant_name ? ` / ${tx.sub_variant_name}` : ''}</span>}
                                  </Link>
                                  {tx.product_sku && <p className="text-xs text-foreground-muted font-mono mt-0.5">{tx.product_sku}</p>}
                                </td>
                                <td className="px-4 py-2.5" />
                                <td className={`px-4 py-2.5 text-right font-mono font-semibold text-sm ${chg > 0 ? 'text-green-600 dark:text-green-400' : chg < 0 ? 'text-red-600 dark:text-red-400' : 'text-foreground-secondary'}`}>
                                  {fmtChange(chg)}
                                  {tx.quantity_in_unit != null && tx.unit_label && (
                                    <span className="block text-xs font-normal text-foreground-muted">
                                      ({Number(tx.quantity_in_unit) > 0 ? '+' : ''}{Number(tx.quantity_in_unit)} {tx.unit_label})
                                    </span>
                                  )}
                                </td>
                                <td className="px-4 py-2.5 text-right font-mono text-foreground font-medium text-sm">{Number(tx.quantity_after)}</td>
                                <td className="px-4 py-2.5 text-xs hidden md:table-cell" />
                                <td className="px-4 py-2.5 text-xs hidden md:table-cell">
                                  {tx.lot_number ? (
                                    <div className="space-y-0.5">
                                      <span className="font-mono text-foreground-secondary">{tx.lot_number}</span>
                                      {tx.expiry_date && (() => {
                                        const d = new Date(tx.expiry_date)
                                        const now = new Date()
                                        const diffDays = Math.floor((d.getTime() - now.getTime()) / 86400000)
                                        const cls = diffDays < 0 ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' : diffDays <= 30 ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                                        return <span className={`inline-flex px-1.5 py-0.5 rounded text-xs font-medium ${cls}`}>{formatDate(tx.expiry_date)}</span>
                                      })()}
                                    </div>
                                  ) : '—'}
                                </td>
                              </tr>
                            )
                          })}
                        </React.Fragment>
                      )
                    })}
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
                inputClassName="w-full px-3 py-1.5 pr-9 bg-surface border border-border-secondary rounded-lg text-sm text-foreground focus:ring-2 focus:ring-accent-500 focus:border-transparent transition-colors hover:border-border-default placeholder:text-foreground-muted"
              />
            </div>
            <div className="w-44">
              <label className={labelCls}>Category</label>
              <AdminSelect
                sm
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
                sm
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
                sm
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
                  className="px-3 py-1.5 rounded-lg text-sm text-foreground-secondary hover:text-foreground border border-border-default hover:bg-surface-secondary transition-colors"
                >
                  Clear filters
                </button>
              </div>
            )}
          </div>

          {loading ? (
            <div className="bg-surface-elevated rounded-xl border border-border-default p-4 space-y-3">
              <div className="h-5 w-32 bg-surface-secondary rounded animate-pulse" />
              <div className="h-12 w-full bg-surface-secondary rounded animate-pulse" />
              <div className="h-12 w-full bg-surface-secondary rounded animate-pulse" />
              <div className="h-12 w-full bg-surface-secondary rounded animate-pulse" />
            </div>
          ) : valuation ? (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <SummaryCard label="Stock Value (ex-GST)" value={formatINR(allValRows.reduce((s, p) => { const qty = p.perishable ? parseFloat(p.batch_qty_total || '0') + parseFloat(p.inventory_quantity || '0') : parseFloat(p.inventory_quantity || '0'); return s + qty * parseFloat(p.cost_price || '0') }, 0))} accent sub={`${valTotal} SKUs`} />
                <SummaryCard label="Stock Value (incl. GST)" value={formatINR(allValRows.reduce((s, p) => { const qty = p.perishable ? parseFloat(p.batch_qty_total || '0') + parseFloat(p.inventory_quantity || '0') : parseFloat(p.inventory_quantity || '0'); return s + qty * parseFloat(p.selling_price || '0') }, 0))} accent sub="this page" />
                <SummaryCard label="Total SKUs" value={String(valTotal)} sub="across all products" />
                <SummaryCard label="In Stock" value={String(allValRows.filter(p => parseFloat(p.inventory_quantity || '0') > 0).length)} sub="on this page" />
              </div>
              <div className="bg-surface-elevated rounded-xl border border-border-default overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-surface-secondary border-b border-border-default">
                      <tr>
                        <SortableHeader label="Product" column="product" options={sortOptions('text')} currentSort={valSortCol} currentDir={valSortDir} onSort={handleValSort} />
                        <SortableHeader label="Variant" column="variant" options={sortOptions('text')} currentSort={valSortCol} currentDir={valSortDir} onSort={handleValSort} className="hidden sm:table-cell" />
                        <SortableHeader label="SKU" column="sku" options={sortOptions('text')} currentSort={valSortCol} currentDir={valSortDir} onSort={handleValSort} className="hidden md:table-cell" />
                        <SortableHeader label="Stock" column="stock" options={sortOptions('number')} currentSort={valSortCol} currentDir={valSortDir} onSort={handleValSort} align="right" />
                        <th className="px-4 py-3 text-center text-xs font-semibold text-foreground-secondary uppercase tracking-wide hidden sm:table-cell">Sell Unit</th>
                        <SortableHeader label="Price ex-GST" column="price" options={sortOptions('number')} currentSort={valSortCol} currentDir={valSortDir} onSort={handleValSort} align="right" />
                        <th className="px-4 py-3 text-right text-xs font-semibold text-foreground-secondary uppercase tracking-wide">GST %</th>
                        <SortableHeader label="Stock Value (ex-GST)" column="value" options={sortOptions('number')} currentSort={valSortCol} currentDir={valSortDir} onSort={handleValSort} align="right" />
                        <th className="px-4 py-3 text-right text-xs font-semibold text-foreground-secondary uppercase tracking-wide">Stock Value (incl. GST)</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-foreground-secondary uppercase tracking-wide">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border-default">
                      {sortedValRows.length === 0 && (
                        <tr><td colSpan={10} className="py-12 text-center text-foreground-secondary text-sm">
                          {valSearch ? `No products match "${valSearch}"` : 'No products in stock'}
                        </td></tr>
                      )}
                      {sortedValRows.map((p) => {
                        const rowId = p.sub_variant_id || p.variant_id || p.id
                        const isEditing = editingId === rowId
                        return (
                          <React.Fragment key={rowId}>
                          <tr className={`hover:bg-surface-secondary/50 transition-colors ${isEditing ? 'bg-secondary-50/50 dark:bg-secondary-900/10' : ''}`}>
                            <td className="px-4 py-3 font-medium text-foreground">
                              <HoverCard
                                trigger={
                                  <Link href={ap(`/admin/products/${p.id}`)} className="hover:text-accent-500 hover:underline underline-offset-2">
                                    {p.name}
                                  </Link>
                                }
                                align="left"
                                side="bottom"
                                width="260px"
                              >
                                <div className="p-3 space-y-2">
                                  <p className="text-sm font-semibold text-foreground leading-tight">{p.name}</p>
                                  {p.variant_name && <p className="text-xs text-foreground-secondary">{p.variant_name}{p.sub_variant_name ? ` / ${p.sub_variant_name}` : ''}</p>}
                                  {(p.row_sku || p.sku) && <p className="text-xs font-mono text-foreground-muted">{p.row_sku || p.sku}</p>}
                                  <div className="border-t border-border-default pt-2 space-y-1.5 text-xs">
                                    <div className="flex justify-between">
                                      <span className="text-foreground-secondary">Stock</span>
                                      <span className="font-semibold text-foreground">{p.perishable ? parseFloat(p.batch_qty_total || '0') + parseFloat(p.inventory_quantity || '0') : parseFloat(p.inventory_quantity || '0')}</span>
                                    </div>
                                    <div className="flex justify-between">
                                      <span className="text-foreground-secondary">Price ex-GST</span>
                                      <span className="font-medium text-foreground">{formatINR(parseFloat(p.cost_price || '0'))}</span>
                                    </div>
                                    <div className="flex justify-between">
                                      <span className="text-foreground-secondary">Stock Value</span>
                                      <span className="font-semibold text-foreground">{formatINR((() => { const qty = p.perishable ? parseFloat(p.batch_qty_total || '0') + parseFloat(p.inventory_quantity || '0') : parseFloat(p.inventory_quantity || '0'); return qty * parseFloat(p.cost_price || '0') })())}</span>
                                    </div>
                                  </div>
                                </div>
                              </HoverCard>
                            </td>
                            <td className="px-4 py-3 text-foreground-secondary hidden sm:table-cell">
                              {p.variant_name
                                ? (p.sub_variant_name ? `${p.variant_name} / ${p.sub_variant_name}` : p.variant_name)
                                : '—'}
                            </td>
                            <td className="px-4 py-3 font-mono text-xs text-foreground-secondary hidden md:table-cell">{p.row_sku || p.sku || '—'}</td>
                            <td className="px-4 py-3 text-right">
                              {isEditing ? (
                                <div className="flex flex-col items-end gap-1">
                                  {editUnits.length > 1 && (
                                    <AdminSelect
                                      value={editUnitId}
                                      onChange={v => setEditUnitId(v)}
                                      compact
                                      className="w-28"
                                      options={editUnits.map(u => ({
                                        value: u.id,
                                        label: `${u.display_label || u.unit}${u.factor !== 1 ? ` (×${u.factor})` : ''}`,
                                      }))}
                                    />
                                  )}
                                  <input
                                    type="number"
                                    min="0"
                                    step="0.001"
                                    autoFocus
                                    value={editQty}
                                    onChange={e => setEditQty(e.target.value)}
                                    onKeyDown={e => { if (e.key === 'Enter') saveEdit(p); if (e.key === 'Escape') cancelEdit() }}
                                    className="field-xs w-20 border border-secondary-500 bg-surface text-foreground focus:outline-none focus:ring-2 focus:ring-secondary-500 text-right"
                                  />
                                  {(() => {
                                    const u = editUnits.find(u => u.id === editUnitId)
                                    if (!u || u.factor === 1 || u.dimension === 'count') return null
                                    const base = Math.round(parseFloat(editQty || '0') * u.factor * 1000) / 1000
                                    return <span className="text-xs text-foreground-muted">= {base} {u.dimension === 'count' ? 'pcs' : 'base units'}</span>
                                  })()}
                                </div>
                              ) : (
                                (() => {
                                  const displayQty = p.perishable
                                    ? parseFloat(p.batch_qty_total || '0') + parseFloat(p.inventory_quantity || '0')
                                    : parseFloat(p.inventory_quantity || '0')
                                  return (
                                    <span className={`font-medium ${displayQty === 0 ? 'text-red-600 dark:text-red-400' : displayQty <= 5 ? 'text-orange-600 dark:text-orange-400' : 'text-foreground'}`}>
                                      {displayQty}
                                    </span>
                                  )
                                })()
                              )}
                            </td>
                            <td className="px-4 py-3 text-center text-foreground-secondary text-xs hidden sm:table-cell">
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-surface-secondary text-foreground-secondary font-medium whitespace-nowrap">
                                {p.sell_unit_dimension === 'count'
                                  ? <>Pc{(p.sell_unit_label || p.sell_unit) && (p.sell_unit_label || p.sell_unit) !== 'pc' ? <span className="text-foreground-muted font-normal">/ {p.sell_unit_label || p.sell_unit}</span> : null}</>
                                  : (p.sell_unit_label || p.sell_unit || 'Pc')}
                                {parseFloat(p.sell_unit_factor || '1') > 1 && p.base_unit_label && (
                                  <span className="text-foreground-muted font-normal">({parseFloat(p.sell_unit_factor)} {p.base_unit_label})</span>
                                )}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right text-foreground">{formatINR(parseFloat(p.cost_price || '0'))}</td>
                            <td className="px-4 py-3 text-right text-foreground-secondary text-sm">{parseFloat(p.gst_percentage || '0')}%</td>
                            <td className="px-4 py-3 text-right font-semibold text-foreground">{formatINR((() => { const qty = p.perishable ? parseFloat(p.batch_qty_total || '0') + parseFloat(p.inventory_quantity || '0') : parseFloat(p.inventory_quantity || '0'); return qty * parseFloat(p.cost_price || '0') })())}</td>
                            <td className="px-4 py-3 text-right font-semibold text-foreground">{formatINR((() => { const qty = p.perishable ? parseFloat(p.batch_qty_total || '0') + parseFloat(p.inventory_quantity || '0') : parseFloat(p.inventory_quantity || '0'); return qty * parseFloat(p.selling_price || '0') })())}</td>
                            <td className="px-4 py-3 text-right">
                              <div className="flex items-center justify-end gap-1">
                                {isEditing ? (
                                  <>
                                    <input
                                      type="text"
                                      placeholder="Note (optional)"
                                      value={editNotes}
                                      onChange={e => setEditNotes(e.target.value)}
                                      onKeyDown={e => { if (e.key === 'Enter') saveEdit(p); if (e.key === 'Escape') cancelEdit() }}
                                      className="hidden lg:block field-xs w-32 border border-border-default bg-surface text-foreground focus:outline-none focus:ring-2 focus:ring-secondary-500"
                                    />
                                    <button
                                      onClick={() => saveEdit(p)}
                                      disabled={editSaving || editQty === ''}
                                      title="Save"
                                      className="field-xs font-medium bg-secondary-500 hover:bg-secondary-600 text-white disabled:opacity-50 transition-colors"
                                    >
                                      {editSaving ? '…' : 'Save'}
                                    </button>
                                    <button onClick={cancelEdit} title="Cancel" className="p-1.5 rounded-lg hover:bg-surface-secondary text-foreground-secondary transition-colors">
                                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                      </svg>
                                    </button>
                                  </>
                                ) : (
                                  <>
                                    <Link
                                      href={ap(`/admin/products/${p.id}`)}
                                      title="View Product"
                                      className="p-1.5 rounded-lg hover:bg-surface-secondary text-accent-500 hover:text-accent-600 transition-colors"
                                    >
                                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                      </svg>
                                    </Link>
                                    <button
                                      onClick={() => startEdit(p)}
                                      title="Adjust stock"
                                      className="p-1.5 rounded-lg hover:bg-surface-secondary text-foreground-secondary hover:text-accent-500 transition-colors"
                                    >
                                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                      </svg>
                                    </button>
                                    <button
                                      onClick={() => toggleValBatch(rowId, p.id, p.variant_id || null, p.sub_variant_id || null)}
                                      title="Batch details"
                                      className={`p-1.5 rounded-lg hover:bg-surface-secondary transition-colors ${expandedValRows[rowId] !== undefined ? 'text-secondary-500' : 'text-foreground-secondary hover:text-secondary-500'}`}
                                    >
                                      {loadingBatchRow === rowId
                                        ? <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>
                                        : <svg className={`w-4 h-4 transition-transform ${expandedValRows[rowId] !== undefined ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
                                      }
                                    </button>
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>
                          {expandedValRows[rowId] !== undefined && (
                            <tr className="bg-surface-secondary/30">
                              <td colSpan={10} className="px-4 py-3">
                                {expandedValRows[rowId]!.length === 0 ? (
                                  <p className="text-xs text-foreground-muted italic">No batches with remaining stock for this product.</p>
                                ) : (
                                  <table className="w-full text-xs">
                                    <thead>
                                      <tr className="text-foreground-secondary">
                                        <th className="pb-1.5 text-left font-medium pr-4">Lot / Batch</th>
                                        <th className="pb-1.5 text-left font-medium pr-4">Expiry</th>
                                        <th className="pb-1.5 text-left font-medium pr-4 hidden sm:table-cell">Mfg Date</th>
                                        <th className="pb-1.5 text-left font-medium pr-4 hidden md:table-cell">Location</th>
                                        <th className="pb-1.5 text-right font-medium pr-4">Qty Remaining</th>
                                        <th className="pb-1.5 text-right font-medium">Batch Value</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border-default/50">
                                      {expandedValRows[rowId]!.map((b: any) => {
                                        const d = b.expiry_date ? new Date(b.expiry_date) : null
                                        const diffDays = d ? Math.floor((d.getTime() - Date.now()) / 86400000) : null
                                        const expiryCls = diffDays === null ? 'text-foreground-muted' : diffDays < 0 ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' : diffDays <= 30 ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                                        const qty = parseFloat(b.quantity_remaining || '0')
                                        const batchValue = qty * parseFloat(b.unit_cost || '0')
                                        return (
                                          <tr key={b.batch_id}>
                                            <td className="py-1.5 pr-4 font-mono text-foreground-secondary">{b.lot_number || '—'}</td>
                                            <td className="py-1.5 pr-4">
                                              {b.expiry_date
                                                ? <span className={`inline-flex px-1.5 py-0.5 rounded font-medium ${expiryCls}`}>{formatDate(b.expiry_date)}</span>
                                                : <span className="text-foreground-muted">—</span>}
                                            </td>
                                            <td className="py-1.5 pr-4 text-foreground-secondary hidden sm:table-cell">{b.manufacture_date ? formatDate(b.manufacture_date) : '—'}</td>
                                            <td className="py-1.5 pr-4 text-foreground-secondary hidden md:table-cell">{b.location || '—'}</td>
                                            <td className="py-1.5 pr-4 text-right font-medium text-foreground">{qty}</td>
                                            <td className="py-1.5 text-right font-semibold text-foreground">{formatINR(batchValue)}</td>
                                          </tr>
                                        )
                                      })}
                                      {parseFloat(p.inventory_quantity || '0') > 0 && (
                                        <tr key="default-stock" className="border-t border-border-default/50">
                                          <td className="py-1.5 pr-4 text-foreground-muted italic">Default stock</td>
                                          <td className="py-1.5 pr-4 text-foreground-muted">—</td>
                                          <td className="py-1.5 pr-4 text-foreground-muted hidden sm:table-cell">—</td>
                                          <td className="py-1.5 pr-4 text-foreground-muted hidden md:table-cell">—</td>
                                          <td className="py-1.5 pr-4 text-right font-medium text-foreground">{parseFloat(p.inventory_quantity || '0')}</td>
                                          <td className="py-1.5 text-right font-semibold text-foreground">{formatINR(parseFloat(p.inventory_quantity || '0') * parseFloat(p.cost_price || '0'))}</td>
                                        </tr>
                                      )}
                                    </tbody>
                                  </table>
                                )}
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      )
                    })}
                    </tbody>
                  </table>
                </div>
                <div className="px-4 pb-4">
                  <ClientPagination page={valPage} total={valTotal} pageSize={VALUATION_PAGE_SIZE} onChange={p => { setValPage(p); cancelEdit() }} />
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
    router.push(`${ap('/admin/inventory')}?${params.toString()}`, { scroll: false })
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
