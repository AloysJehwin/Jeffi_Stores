'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { productLabel as grainLabel } from '@/lib/product-label'
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
import { generateSerialNumber, generateLotNumber, generateSerialRun } from '@/lib/selling-unit'
import CopySku from '@/components/ui/CopySku'
import { useBarcodeScanner } from '@/components/admin/useBarcodeScanner'
import { RequireWrite, useCanWrite, useHasScope } from '@/contexts/AdminScopesContext'

type Tab = 'suppliers' | 'po' | 'stock'

const TABS: { key: Tab; label: string }[] = [
  { key: 'suppliers', label: 'Suppliers' },
  { key: 'po', label: 'Purchase Orders' },
  { key: 'stock', label: 'Stock Ledger' },
]

const inputCls = 'w-full field-sm border border-border-default bg-surface text-foreground focus:outline-none focus:ring-2 focus:ring-secondary-500 focus:border-transparent transition-colors placeholder:text-foreground-muted'
const labelCls = 'block text-xs font-medium text-foreground-secondary mb-1'
const btnPrimary = 'control-sm border border-transparent bg-secondary-500 hover:bg-secondary-600 dark:bg-secondary-400 dark:hover:bg-secondary-300 text-white dark:text-secondary-900 font-medium transition-colors disabled:opacity-50'
const btnSecondary = 'control-sm border border-border-default bg-surface hover:bg-surface-secondary text-foreground font-medium transition-colors'

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
  const btnCls = 'control-xs font-medium border border-border-default text-foreground-secondary hover:bg-surface-secondary disabled:opacity-40 disabled:pointer-events-none transition-colors'

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
            inputClassName="w-full field-sm pr-9 bg-surface border border-border-secondary text-foreground focus:ring-2 focus:ring-accent-500 focus:border-transparent transition-colors hover:border-border-default placeholder:text-foreground-muted"
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
          <div className="hidden md:block">
            <RequireWrite scope="inventory">
              <Link href={ap('/admin/suppliers/new')} className={btnPrimary}>
                + Add Supplier
              </Link>
            </RequireWrite>
          </div>
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
                      <div className="hidden md:flex items-center justify-end gap-3">
                        <RequireWrite scope="inventory">
                          <Link href={ap(`/admin/suppliers/${s.id}/edit`)} className="text-xs text-secondary-500 dark:text-secondary-400 hover:underline font-medium">Edit</Link>
                          <button className="text-xs text-foreground-secondary hover:text-foreground hover:underline" onClick={() => toggleActive(s)}>
                            {s.is_active ? 'Deactivate' : 'Activate'}
                          </button>
                        </RequireWrite>
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
  id: string; product_id: string; variant_id: string | null; sub_variant_id: string | null
  product_name: string; variant_name: string | null; sku: string | null; product_sku?: string | null
  quantity: string; unit_cost: string; tax_rate: string; total_cost: string; quantity_received: string
  purchase_unit: string | null; purchase_unit_factor: string | null
  sell_unit_label: string | null; sell_unit_dimension: string | null; sell_unit_qty_step: string | null
  perishable: boolean; serialized: boolean
}

/** For count-dimension products stock is always in pc; for others use sell_unit_label */
function poBaseUnitLabel(it: Pick<POItem, 'sell_unit_label' | 'sell_unit_dimension'>): string {
  if (!it.sell_unit_dimension || it.sell_unit_dimension === 'count') return 'pc'
  return it.sell_unit_label || 'units'
}

/**
 * Serial numbers required for a serialized receive: one serial per qty_step of
 * BASE quantity. base = receive_qty × purchase_unit_factor; expected = base / qty_step.
 * Matches the sale side (serialCountForQuantity) and the receive route's guard.
 */
function serialsRequired(it: { receive_qty?: string; purchase_unit_factor?: string | number; sell_unit_qty_step?: string | null }): number {
  const base = parseFloat(String(it.receive_qty || '0')) * parseFloat(String(it.purchase_unit_factor || '1'))
  const step = parseFloat(String(it.sell_unit_qty_step ?? '1')) || 1
  return Math.round(base / (step > 0 ? step : 1))
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
  const [receiveWarehouseId, setReceiveWarehouseId] = useState('')
  const [editWarehouses, setEditWarehouses] = useState<{ id: string; name: string; code: string }[]>([])
  const [shelfLocations, setShelfLocations] = useState<{ id: string; display_code: string }[]>([])
  const [poSortCol, setPoSortCol] = useState<string | undefined>(undefined)
  const [poSortDir, setPoSortDir] = useState<SortDir | undefined>(undefined)
  const [sendingEmailId, setSendingEmailId] = useState<string | null>(null)
  const [scanSerials, setScanSerials] = useState(true)
  const [draftRestored, setDraftRestored] = useState(false)
  // Refs to every serial input, keyed "itemIdx:slotIdx", so Enter/scan can advance focus.
  const serialInputRefs = React.useRef<Record<string, HTMLInputElement | null>>({})

  // Move focus to the next empty serial input after the given one (wraps across items).
  const focusNextSerial = useCallback((afterKey: string) => {
    const keys = Object.keys(serialInputRefs.current)
      .filter(k => serialInputRefs.current[k])
      .sort((a, b) => {
        const [ai, as] = a.split(':').map(Number)
        const [bi, bs] = b.split(':').map(Number)
        return ai - bi || as - bs
      })
    const start = keys.indexOf(afterKey)
    for (let step = 1; step <= keys.length; step++) {
      const el = serialInputRefs.current[keys[(start + step) % keys.length]]
      if (el && !el.value) { el.focus(); return }
    }
  }, [])

  // Serials that were just received — enables the "Print labels" action post-receive.
  const [lastReceivedSerials, setLastReceivedSerials] = useState<string[]>([])

  // Fill the next empty serial slot (across serialized items, in order) from a scan.
  // Dedupe: ignore a serial already entered anywhere in this receive.
  const fillNextSerial = useCallback((code: string) => {
    const sn = code.trim()
    if (!sn) return
    setReceiveItems(items => {
      // already present?
      for (const r of items) {
        if (Array.isArray(r.serial_numbers) && (r.serial_numbers as string[]).includes(sn)) {
          showToast(`Serial ${sn} already scanned`, 'error')
          return items
        }
      }
      const next = items.map(r => ({ ...r }))
      for (let ri = 0; ri < next.length; ri++) {
        const r = next[ri]
        if (!r.serialized || parseFloat(r.receive_qty || '0') <= 0) continue
        const needed = serialsRequired(r)
        const arr = Array.isArray(r.serial_numbers) ? [...(r.serial_numbers as string[])] : []
        while (arr.length < needed) arr.push('')
        const empty = arr.findIndex(s => !s)
        if (empty !== -1) {
          arr[empty] = sn
          r.serial_numbers = arr
          showToast(`Serial ${sn} → ${r.product_name}`, 'success')
          // Keep the cursor on the next empty slot for continuous scanning.
          setTimeout(() => focusNextSerial(`${ri}:${empty}`), 0)
          return next
        }
      }
      showToast('All serial slots are full', 'info')
      return items
    })
  }, [showToast])

  useBarcodeScanner({ onScan: fillNextSerial, enabled: !!receiveMode && scanSerials, captureInInputs: true })

  // Autosave the in-progress receive form to localStorage (keyed by PO id) so a
  // long receive isn't lost on navigate-away/refresh. Restored in openReceive.
  useEffect(() => {
    if (!receiveMode?.po?.id || receiveItems.length === 0) return
    const key = `po_receive_draft:${receiveMode.po.id}`
    const t = setTimeout(() => {
      try {
        // Only persist the fields the user edits (not the whole product record).
        const slim = receiveItems.map(it => ({
          id: it.id, receive_qty: it.receive_qty, receive_cost: it.receive_cost,
          lot_number: it.lot_number, expiry_date: it.expiry_date, manufacture_date: it.manufacture_date,
          location_id: it.location_id, serial_numbers: it.serial_numbers,
        }))
        localStorage.setItem(key, JSON.stringify({ items: slim, notes: receiveNotes, warehouse_id: receiveWarehouseId, savedAt: Date.now() }))
      } catch {}
    }, 600)
    return () => clearTimeout(t)
  }, [receiveMode, receiveItems, receiveNotes, receiveWarehouseId])

  async function printReceivedSerialLabels() {
    if (!lastReceivedSerials.length) return
    try {
      const res = await fetch('/api/admin/labels/batch', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ serial_numbers: lastReceivedSerials, copies: 1, sheet: false }),
      })
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Failed') }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `serial-labels-${new Date().toISOString().slice(0, 10)}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e: any) {
      showToast(e.message || 'Label print failed', 'error')
    }
  }

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
    setDraftRestored(false)
    const res = await fetch(`/api/admin/inventory/po/${id}`)
    const json = await res.json()
    const items = (json.items || []).map((it: POItem) => {
      const factor = parseFloat(it.purchase_unit_factor || '1')
      const remaining = Math.max(0, parseFloat(it.quantity) - parseFloat(it.quantity_received || '0'))
      const autoLot = generateLotNumber(it.sku || it.product_sku)
      return {
        ...it,
        receive_qty: String(factor > 1 ? Math.round((remaining / factor) * 1000) / 1000 : remaining),
        receive_cost: it.unit_cost,
        purchase_unit_factor: factor,
        lot_number: autoLot,
        expiry_date: '',
        manufacture_date: '',
        location_id: '',
        serial_numbers: [] as string[],
      }
    })
    setReceiveMode({ po: json.purchase_order })
    // Restore an autosaved draft for this PO (survives navigate-away / refresh).
    try {
      const raw = localStorage.getItem(`po_receive_draft:${id}`)
      if (raw) {
        const draft = JSON.parse(raw)
        if (draft && Array.isArray(draft.items)) {
          // Merge saved per-item values by po_item_id onto the fresh item list.
          const byId: Record<string, any> = {}
          for (const d of draft.items) byId[d.id] = d
          const merged = items.map((it: any) => byId[it.id] ? { ...it, ...byId[it.id] } : it)
          setReceiveItems(merged)
          setReceiveNotes(draft.notes || '')
          if (draft.warehouse_id) setReceiveWarehouseId(draft.warehouse_id)
          setDraftRestored(true)
          return
        }
      }
    } catch {}
    setReceiveItems(items)
    setReceiveNotes('')
    setReceiveWarehouseId('')
    // Fetch shelf locations and warehouses for pickers
    const [slRes, whRes] = await Promise.all([
      fetch('/api/admin/shelving/locations', { credentials: 'include' }).catch(() => null),
      fetch('/api/admin/shelving/warehouses', { credentials: 'include' }).catch(() => null),
    ])
    if (slRes?.ok) {
      const slJson = await slRes.json()
      setShelfLocations(slJson?.locations || [])
    }
    if (whRes?.ok) {
      const whJson = await whRes.json()
      const whs: { id: string; name: string; code: string }[] = whJson?.warehouses || []
      // Auto-select if only one warehouse
      if (whs.length === 1) setReceiveWarehouseId(whs[0].id)
      setEditWarehouses(whs)
    }
  }

  // Explicitly save the in-progress receive as a draft and exit. The form already
  // autosaves as you type; this writes immediately (bypassing the debounce) so the
  // user can confidently leave and resume later from the PO list.
  function saveDraftAndExit() {
    if (!receiveMode?.po?.id) return
    try {
      const slim = receiveItems.map(it => ({
        id: it.id, receive_qty: it.receive_qty, receive_cost: it.receive_cost,
        lot_number: it.lot_number, expiry_date: it.expiry_date, manufacture_date: it.manufacture_date,
        location_id: it.location_id, serial_numbers: it.serial_numbers,
      }))
      localStorage.setItem(`po_receive_draft:${receiveMode.po.id}`, JSON.stringify({
        items: slim, notes: receiveNotes, warehouse_id: receiveWarehouseId, savedAt: Date.now(),
      }))
      showToast('Draft saved — resume this receipt anytime from the PO list.', 'success')
    } catch {
      showToast('Could not save draft', 'error')
    }
    setReceiveMode(null)
  }

  async function submitReceive() {
    if (!receiveMode) return
    // Validate perishable items have expiry_date
    const missing = receiveItems.filter(it => parseFloat(it.receive_qty) > 0 && it.perishable && !it.expiry_date)
    if (missing.length > 0) {
      showToast(`Expiry date required for: ${missing.map((it: any) => grainLabel(it)).join(', ')}`, 'error')
      return
    }
    // Validate serialized items have the right number of serial numbers
    const missingSerials = receiveItems.filter(it => {
      if (!it.serialized || parseFloat(it.receive_qty) <= 0) return false
      const serials = Array.isArray(it.serial_numbers) ? it.serial_numbers as string[] : []
      return serials.filter(Boolean).length !== serialsRequired(it)
    })
    if (missingSerials.length > 0) {
      showToast(`Serial numbers count must match received qty for: ${missingSerials.map((it: any) => grainLabel(it)).join(', ')}`, 'error')
      return
    }
    setReceiveSaving(true)
    const items = receiveItems.filter(it => parseFloat(it.receive_qty) > 0).map(it => ({
      po_item_id: it.id, product_id: it.product_id, variant_id: it.variant_id || null,
      sub_variant_id: it.sub_variant_id || null,
      quantity_received: parseFloat(it.receive_qty), unit_cost: parseFloat(it.receive_cost),
      purchase_unit_factor: parseFloat(it.purchase_unit_factor || '1'),
      ...(it.perishable ? {
        lot_number: it.lot_number || null,
        expiry_date: it.expiry_date || null,
        manufacture_date: it.manufacture_date || null,
        location_id: it.location_id || null,
      } : {}),
      ...(it.serialized ? {
        serial_numbers: (Array.isArray(it.serial_numbers) ? it.serial_numbers as string[] : []).filter(Boolean),
      } : {}),
    }))
    const res = await fetch(`/api/admin/inventory/po/${receiveMode.po.id}/receive`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items, notes: receiveNotes, ...(receiveWarehouseId ? { warehouse_id: receiveWarehouseId } : {}) }),
    })
    const json = await res.json()
    setReceiveSaving(false)
    if (json.success) {
      // Clear the autosaved draft for this PO now that it's received.
      try { localStorage.removeItem(`po_receive_draft:${receiveMode.po.id}`) } catch {}
      setDraftRestored(false)
      // Stash received serials so labels can be printed from the PO list, then close.
      const receivedSerials = items.flatMap((it: any) => Array.isArray(it.serial_numbers) ? it.serial_numbers : [])
      setLastReceivedSerials(receivedSerials)
      setReceiveMode(null)
      load(page)
      if (Array.isArray(json.warnings) && json.warnings.length) {
        showToast(json.warnings[0], 'error')
      }
    }
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
          {/* Barcode scan toggle for serial capture */}
          <button type="button" onClick={() => setScanSerials(v => !v)}
            title={scanSerials ? 'Scanning on — scan each unit to fill the next serial slot' : 'Serial scanning off'}
            className={`ml-auto flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg border transition-colors ${scanSerials ? 'border-accent-500 bg-accent-50 dark:bg-accent-900/20 text-accent-700 dark:text-accent-400' : 'border-border-default text-foreground-muted hover:bg-surface-secondary'}`}>
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h1m3 0h1m3 0v12M4 18h1m11-12h1M8 18h1m7-12v12m3-12h1v12h-1" />
            </svg>
            {scanSerials ? 'Scan serials: on' : 'Scan serials: off'}
          </button>
        </div>
        {draftRestored && (
          <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20">
            <svg className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-sm text-foreground flex-1">Restored your unsaved progress for this PO. Your entries auto-save as you go.</p>
            <button type="button" onClick={() => {
              try { localStorage.removeItem(`po_receive_draft:${receiveMode.po.id}`) } catch {}
              setDraftRestored(false)
              openReceive(receiveMode.po.id)
            }} className="text-xs font-semibold text-amber-700 dark:text-amber-400 hover:underline shrink-0">
              Discard draft
            </button>
          </div>
        )}
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
                      {it.sku && <p className="text-xs text-foreground-muted font-mono mt-0.5 inline-flex items-center gap-1">{it.sku}<CopySku sku={it.sku} /></p>}
                      {it.purchase_unit && factor > 1 && (
                        <p className="text-xs text-foreground-muted mt-0.5">1 {it.purchase_unit} = {factor} {baseLabel}</p>
                      )}
                      {it.perishable && (
                        <span className="mt-1 inline-block text-[10px] font-medium px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">Perishable</span>
                      )}
                      {it.serialized && (
                        <span className="mt-1 inline-block text-[10px] font-medium px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">Serialized</span>
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
                            <div className="flex gap-1">
                              <input
                                type="text"
                                placeholder="optional"
                                className={inputCls + ' flex-1'}
                                value={it.lot_number}
                                onChange={e => setReceiveItems(items => items.map((r, i) => i === idx ? { ...r, lot_number: e.target.value } : r))}
                              />
                              <button
                                type="button"
                                title="Regenerate lot number"
                                onClick={() => {
                                  const autoLot = generateLotNumber(it.sku || it.product_sku)
                                  setReceiveItems(items => items.map((r, i) => i === idx ? { ...r, lot_number: autoLot } : r))
                                }}
                                className="px-2 py-1 rounded border border-border-default bg-surface hover:bg-surface-elevated text-foreground-muted hover:text-foreground transition-colors text-xs"
                              >↺</button>
                            </div>
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
                  {it.serialized && parseFloat(it.receive_qty) > 0 && (() => {
                    const needed = serialsRequired(it)
                    const serials: string[] = Array.isArray(it.serial_numbers) ? it.serial_numbers as string[] : []
                    const entered = serials.filter(Boolean).length
                    const serialSku = it.sku || it.product_sku
                    const autoSerial = () => generateSerialNumber(serialSku)
                    const updateSerial = (slotIdx: number, val: string) =>
                      setReceiveItems(items => items.map((r, i) => {
                        if (i !== idx) return r
                        const arr = [...(r.serial_numbers as string[])]
                        arr[slotIdx] = val
                        return { ...r, serial_numbers: arr }
                      }))
                    return (
                      <tr className="bg-blue-50/60 dark:bg-blue-900/10 border-t border-blue-100 dark:border-blue-900/30">
                        <td colSpan={7} className="px-4 py-3">
                          <div>
                            <div className="flex items-center justify-between mb-2">
                              <label className={labelCls + ' mb-0'}>
                                Serial Numbers
                                <span className="ml-1 text-foreground-muted font-normal">({needed} required)</span>
                              </label>
                              <div className="flex items-center gap-2">
                                {entered === needed
                                  ? <span className="text-xs text-green-600 dark:text-green-400">{entered}/{needed} entered ✓</span>
                                  : <span className="text-xs text-amber-600 dark:text-amber-400">{entered}/{needed} entered</span>
                                }
                                <button
                                  type="button"
                                  className="text-xs px-2 py-1 rounded border border-border-default bg-surface-elevated hover:bg-surface-hover text-foreground-secondary"
                                  onClick={() => setReceiveItems(items => items.map((r, i) => {
                                    if (i !== idx) return r
                                    return { ...r, serial_numbers: generateSerialRun(serialSku, needed) }
                                  }))}
                                >
                                  Generate All
                                </button>
                              </div>
                            </div>
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                              {Array.from({ length: needed }, (_, n) => (
                                <div key={n} className="flex gap-1">
                                  <input
                                    ref={el => { serialInputRefs.current[`${idx}:${n}`] = el }}
                                    type="text"
                                    placeholder={autoSerial()}
                                    className={inputCls + ' font-mono text-xs flex-1 min-w-0'}
                                    value={serials[n] ?? ''}
                                    onChange={e => updateSerial(n, e.target.value)}
                                    onKeyDown={e => {
                                      if (e.key === 'Enter') {
                                        e.preventDefault()
                                        focusNextSerial(`${idx}:${n}`)
                                      }
                                    }}
                                  />
                                  <button
                                    type="button"
                                    title="Auto-generate"
                                    className="shrink-0 text-xs px-1.5 rounded border border-border-default bg-surface-elevated hover:bg-surface-hover text-foreground-secondary"
                                    onClick={() => updateSerial(n, autoSerial())}
                                  >
                                    Auto
                                  </button>
                                </div>
                              ))}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )
                  })()}
                  </React.Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
        {editWarehouses.length > 0 && (
          <div>
            <label className={labelCls}>Warehouse <span className="text-foreground-muted font-normal">(stock destination)</span></label>
            <AdminSelect
              value={receiveWarehouseId}
              onChange={setReceiveWarehouseId}
              options={[
                { value: '', label: '— none —' },
                ...editWarehouses.map(w => ({ value: w.id, label: w.name })),
              ]}
            />
            {receiveWarehouseId && <p className="mt-1 text-xs text-foreground-muted">Stock with no specific bin will land on the open shelf. Override per-item below.</p>}
          </div>
        )}
        <div>
          <label className={labelCls}>Notes</label>
          <textarea className={inputCls} rows={2} value={receiveNotes} onChange={e => setReceiveNotes(e.target.value)} />
        </div>
        <div className="flex gap-3">
          <button className={btnPrimary} onClick={submitReceive} disabled={receiveSaving}>{receiveSaving ? 'Saving...' : 'Confirm Receipt'}</button>
          <button
            className="control-sm border border-border-default text-foreground-secondary font-medium hover:bg-surface-secondary transition-colors"
            onClick={saveDraftAndExit}
            disabled={receiveSaving}
          >
            Save Draft
          </button>
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
                    <td className="px-4 py-3 font-mono text-xs text-foreground-secondary hidden sm:table-cell"><span className="inline-flex items-center gap-1">{it.sku || '—'}{it.sku && <CopySku sku={it.sku} />}</span></td>
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
                          ? grainLabel(matchItem)
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
          <RequireWrite scope="inventory">
            <div className="flex gap-3 pt-2">
              <button className={btnPrimary} onClick={() => sendPO(viewPO.po.id)}>Mark as Sent</button>
              <button className="px-4 py-2 rounded-lg text-sm font-medium bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-900/20 dark:text-red-400 dark:hover:bg-red-900/30 transition-colors" onClick={() => cancelPO(viewPO.po.id)}>Cancel PO</button>
            </div>
          </RequireWrite>
        )}
        {['sent', 'partial'].includes(viewPO.po.status) && (
          <RequireWrite scope="inventory">
            <div className="flex gap-3 pt-2">
              <button className={btnPrimary} onClick={() => { setViewPO(null); openReceive(viewPO.po.id) }}>Record Receipt</button>
            </div>
          </RequireWrite>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {lastReceivedSerials.length > 0 && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-accent-300 dark:border-accent-800 bg-accent-50 dark:bg-accent-900/20">
          <svg className="w-4 h-4 text-accent-600 dark:text-accent-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-sm text-foreground flex-1">
            {lastReceivedSerials.length} serialized unit(s) received. Print labels to stick on each unit.
          </p>
          <button type="button" onClick={printReceivedSerialLabels}
            className="px-3 py-1.5 rounded-lg bg-accent-500 hover:bg-accent-600 text-white text-xs font-semibold transition-colors">
            Print serial labels
          </button>
          <button type="button" onClick={() => setLastReceivedSerials([])}
            className="text-foreground-muted hover:text-foreground" title="Dismiss">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
      )}
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
            inputClassName="w-full h-9 px-3 pr-9 bg-surface border border-border-secondary rounded-lg text-sm text-foreground focus:ring-2 focus:ring-accent-500 focus:border-transparent transition-colors hover:border-border-default placeholder:text-foreground-muted"
          />
        </div>
        <div className="w-44">
          <label className={labelCls}>Status</label>
          <AdminSelect
            sm
            className="[&_button]:h-9"
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
        <div className="hidden md:flex flex-col">
          <span className={labelCls}>&nbsp;</span>
          <RequireWrite scope="inventory">
            <Link href={ap('/admin/inventory/po/new')} className={`${btnPrimary} h-9 inline-flex items-center whitespace-nowrap`}>
              + Create PO
            </Link>
          </RequireWrite>
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
                        <RequireWrite scope="inventory">
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
                        </RequireWrite>
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
  batch_id: string | null; lot_number: string | null; expiry_date: string | null; serial_number: string | null
}

function StockTab() {
  const canFinancial = useHasScope('financial:read')
  const searchParams = useSearchParams()
  const router = useRouter()
  const { showToast } = useToast()
  const confirm = useConfirm()
  const canWrite = useCanWrite('inventory')
  const [transactions, setTransactions] = useState<StockTransaction[]>([])
  const [txTotal, setTxTotal] = useState(0)
  const [txPage, setTxPage] = useState(1)
  const [valuation, setValuation] = useState<{ products: any[]; total: number; totalValue: number; totalValueInclGst?: number; inStockCount?: number; allCategories?: string[]; allBrands?: string[] } | null>(null)
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
  const [editWarehouses, setEditWarehouses] = useState<{ id: string; name: string; code: string }[]>([])
  const [editWarehouseId, setEditWarehouseId] = useState('')
  const [editLocationId, setEditLocationId] = useState('')
  const [editLocations, setEditLocations] = useState<{ id: string; display_code: string; is_open_shelf: boolean }[]>([])
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [expandedSerialProducts, setExpandedSerialProducts] = useState<Set<string>>(new Set())
  const [expandedValProducts, setExpandedValProducts] = useState<Set<string>>(new Set())
  const [expandedValVariants, setExpandedValVariants] = useState<Set<string>>(new Set())

  function toggleValProduct(id: string) {
    setExpandedValProducts(prev => {
      const n = new Set(prev)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  }

  function toggleValVariant(id: string) {
    setExpandedValVariants(prev => {
      const n = new Set(prev)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  }

  function toggleSerialProduct(key: string) {
    setExpandedSerialProducts(prev => {
      const n = new Set(prev)
      n.has(key) ? n.delete(key) : n.add(key)
      return n
    })
  }

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
  // refId is a COMPOSITE grouping key (reference_id + type [+ timestamp]); it is
  // not addressable. linkId is the bare reference_id for building URLs.
  const ledgerGroups: { refId: string; linkId: string | null; refType: string; refLabel: string | null; date: string; txs: StockTransaction[] }[] = []
  for (const tx of sortedTransactions) {
    // Group by reference_id + transaction_type so sale and return events for the
    // same order appear as separate groups instead of netting to 0.
    // Manual adjustments carry the PRODUCT id as reference_id, so every adjustment
    // ever made to a product would otherwise collapse into one group across dates —
    // key those by timestamp instead, which is what one save actually shares.
    // Fall back to tx.id for rows with no reference_id (legacy rows).
    const groupKey = tx.reference_type === 'manual'
      ? `${tx.reference_id || tx.id}::${tx.transaction_type}::${tx.created_at}`
      : tx.reference_id ? `${tx.reference_id}::${tx.transaction_type}` : tx.id
    const existing = ledgerGroups.find(g => g.refId === groupKey)
    if (existing) {
      existing.txs.push(tx)
      if (tx.created_at > existing.date) existing.date = tx.created_at
    } else {
      ledgerGroups.push({ refId: groupKey, linkId: tx.reference_id || null, refType: tx.reference_type, refLabel: tx.reference_label, date: tx.created_at, txs: [tx] })
    }
  }

  // The server orders rows by ITS group key, which lumps every manual adjustment for
  // a product into one block. Splitting those by timestamp above creates groups the
  // server never ordered, so re-sort by each group's own newest event.
  if (!ledgerSortCol) ledgerGroups.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))

  function handleLedgerSort(col: string, dir: SortDir) { setLedgerSortCol(col); setLedgerSortDir(dir) }
  function handleValSort(col: string, dir: SortDir) { setValSortCol(col || undefined); setValSortDir(col ? dir : undefined); setValPage(1) }

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
    if (valSortCol) { params.set('sort', valSortCol); params.set('dir', valSortDir || 'desc') }
    const res = await fetch(`/api/admin/inventory/stock?${params}`)
    const json = await res.json()
    setValuation(json)
    setLoading(false)
  }, [valSearch, valCategory, valBrand, valStockStatus, valPage, valSortCol, valSortDir])

  useEffect(() => {
    if (view === 'ledger') loadLedger(txPage)
    else loadValuation(valPage)
  }, [view, loadLedger, loadValuation, txPage, valPage])

  const allValRows = valuation?.products || []
  const valTotal = valuation?.total || 0

  const valCategories = (valuation?.allCategories || [...new Set(allValRows.map((p: any) => p.category_name).filter(Boolean))]).sort() as string[]
  const valBrands = (valuation?.allBrands || [...new Set(allValRows.map((p: any) => p.brand_name).filter(Boolean))]).sort() as string[]

  // Rows are sorted server-side (across all SKUs) via the sort/dir params, so render as-is.
  const sortedValRows = allValRows

  const valTree = useMemo(() => {
    const num = (v: any) => parseFloat(v || '0') || 0
    const leafValueEx = (r: any) => num(r.inventory_quantity) * num(r.cost_price)
    const leafValueIncl = (r: any) => num(r.inventory_quantity) * num(r.selling_price)

    type ValLeaf = any
    type ValVariant = {
      variantId: string
      leaf: ValLeaf | null
      subVariants: ValLeaf[]
      stock: number
      valueEx: number
      valueIncl: number
    }
    type ValProduct = {
      productId: string
      head: ValLeaf
      simpleLeaf: ValLeaf | null
      variants: ValVariant[]
      stock: number
      valueEx: number
      valueIncl: number
    }

    const products: ValProduct[] = []
    const byProduct = new Map<string, ValProduct>()

    for (const r of sortedValRows) {
      const pid = String(r.id)
      let prod = byProduct.get(pid)
      if (!prod) {
        prod = { productId: pid, head: r, simpleLeaf: null, variants: [], stock: 0, valueEx: 0, valueIncl: 0 }
        byProduct.set(pid, prod)
        products.push(prod)
      }
      prod.stock += num(r.inventory_quantity)
      prod.valueEx += leafValueEx(r)
      prod.valueIncl += leafValueIncl(r)

      if (!r.variant_id) {
        prod.simpleLeaf = r
        continue
      }

      const vid = String(r.variant_id)
      let variant = prod.variants.find(v => v.variantId === vid)
      if (!variant) {
        variant = { variantId: vid, leaf: null, subVariants: [], stock: 0, valueEx: 0, valueIncl: 0 }
        prod.variants.push(variant)
      }
      variant.stock += num(r.inventory_quantity)
      variant.valueEx += leafValueEx(r)
      variant.valueIncl += leafValueIncl(r)

      if (r.sub_variant_id) {
        variant.subVariants.push(r)
      } else {
        variant.leaf = r
      }
    }

    return products
  }, [sortedValRows])

  function startEdit(p: any) {
    const rowId = p.sub_variant_id || p.variant_id || p.id
    setEditingId(rowId)
    setEditNotes('')
    setEditWarehouseId('')
    setEditLocationId('')
    setEditLocations([])

    // Fetch warehouses for shelf assignment, then pre-select existing shelf
    const variantParam = p.sub_variant_id ? `&sub_variant_id=${p.sub_variant_id}` : p.variant_id ? `&variant_id=${p.variant_id}` : ''
    Promise.all([
      fetch('/api/admin/shelving/warehouses', { credentials: 'include' }).then(r => r.json()),
      fetch(`/api/admin/shelving/stock?product_id=${p.id}${variantParam}`, { credentials: 'include' }).then(r => r.json()),
    ]).then(([wj, sj]) => {
      const warehouses = wj.warehouses || []
      setEditWarehouses(warehouses)
      const existing = (sj.locations || [])[0]
      if (existing?.warehouse_id) {
        setEditWarehouseId(existing.warehouse_id)
        // editLocations will be populated by the useEffect on editWarehouseId;
        // store the location_id so it can be selected after locations load
        setEditLocationId(existing.location_id)
      }
    }).catch(() => {})

    // Build unit options from the valuation row data
    const sellFactor = parseFloat(p.sell_unit_factor || '1') || 1
    const units: { id: string; unit: string; display_label: string | null; factor: number; dimension: string }[] = []

    // We don't have unit IDs in the valuation row — fetch them from the units API
    const apiPath = p.sub_variant_id && p.variant_id
      ? `/api/admin/products/${p.id}/variants/${p.variant_id}/sub-variants/${p.sub_variant_id}/units`
      : p.variant_id
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
      ...(editWarehouseId ? { warehouse_id: editWarehouseId } : {}),
      ...(editWarehouseId && editLocationId ? { location_id: editLocationId } : {}),
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
    setEditWarehouseId('')
    setEditLocationId('')
    setEditLocations([])
  }

  useEffect(() => {
    if (!editWarehouseId) { setEditLocations([]); setEditLocationId(''); return }
    fetch(`/api/admin/shelving/locations?warehouse_id=${editWarehouseId}`, { credentials: 'include' })
      .then(r => r.json())
      .then(j => {
        setEditLocations(j.locations || [])
        // Only reset location if not already pre-seeded by startEdit
        setEditLocationId(prev => {
          const locs: { id: string }[] = j.locations || []
          return locs.some(l => l.id === prev) ? prev : ''
        })
      })
      .catch(() => {})
  }, [editWarehouseId])

  function renderValLeaf(p: any, firstCell: React.ReactNode, variantCell: React.ReactNode) {
    const rowId = p.sub_variant_id || p.variant_id || p.id
    const isEditing = editingId === rowId
    return (
      <React.Fragment key={rowId}>
        <tr className={`hover:bg-surface-secondary/50 transition-colors ${isEditing ? 'bg-secondary-50/50 dark:bg-secondary-900/10' : ''}`}>
          <td className="px-4 py-3 font-medium text-foreground">{firstCell}</td>
          <td className="px-4 py-3 text-foreground-secondary hidden sm:table-cell">{variantCell}</td>
          <td className="px-4 py-3 font-mono text-xs text-foreground-secondary hidden md:table-cell"><span className="inline-flex items-center gap-1">{p.row_sku || p.sku || '—'}{(p.row_sku || p.sku) && <CopySku sku={p.row_sku || p.sku} />}</span></td>
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
                const displayQty = parseFloat(p.inventory_quantity || '0')
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
          <td className="px-4 py-3 text-right font-semibold text-foreground">{formatINR(parseFloat(p.inventory_quantity || '0') * parseFloat(p.cost_price || '0'))}</td>
          <td className="px-4 py-3 text-right font-semibold text-foreground">{formatINR(parseFloat(p.inventory_quantity || '0') * parseFloat(p.selling_price || '0'))}</td>
          <td className="px-4 py-3 text-right align-middle">
            <div className="flex items-center justify-end gap-1 flex-nowrap">
              {isEditing ? (
                <>
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
                    onClick={() => !(p.perishable || p.serialized) && startEdit(p)}
                    title={(p.perishable || p.serialized) ? 'Stock managed via batches or serials — use GRN to receive or Remove to deduct' : 'Adjust stock'}
                    disabled={!!(p.perishable || p.serialized)}
                    className={`p-1.5 rounded-lg transition-colors ${(p.perishable || p.serialized) ? 'opacity-30 cursor-not-allowed text-foreground-muted' : 'hover:bg-surface-secondary text-foreground-secondary hover:text-accent-500'}`}
                    hidden={!canWrite}
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
        {isEditing && (
          <tr className="bg-secondary-50/50 dark:bg-secondary-900/10">
            <td colSpan={10} className="px-4 pb-3 pt-0">
              <div className="flex items-center justify-end gap-2 flex-wrap">
                <input
                  type="text"
                  placeholder="Note (optional)"
                  value={editNotes}
                  onChange={e => setEditNotes(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') saveEdit(p); if (e.key === 'Escape') cancelEdit() }}
                  className="field-xs w-48 border border-border-default bg-surface text-foreground focus:outline-none focus:ring-2 focus:ring-secondary-500"
                />
                {editWarehouses.length > 0 && (
                  <AdminSelect
                    value={editWarehouseId}
                    onChange={setEditWarehouseId}
                    xs
                    className="w-40"
                    options={[
                      { value: '', label: '— warehouse —' },
                      ...editWarehouses.map(w => ({ value: w.id, label: w.name })),
                    ]}
                  />
                )}
                {editWarehouseId && (
                  <AdminSelect
                    value={editLocationId}
                    onChange={setEditLocationId}
                    xs
                    className="w-44"
                    options={[
                      { value: '', label: '— open shelf —' },
                      ...editLocations.filter(l => !l.is_open_shelf).map(l => ({ value: l.id, label: l.display_code })),
                    ]}
                  />
                )}
              </div>
            </td>
          </tr>
        )}
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
                      <th className="pb-1.5 text-right font-medium pr-4">Batch Value</th>
                      <th className="pb-1.5 w-8"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-default/50">
                    {expandedValRows[rowId]!.map((b: any) => {
                      const d = b.expiry_date ? new Date(b.expiry_date) : null
                      const diffDays = d ? Math.floor((d.getTime() - Date.now()) / 86400000) : null
                      const expiryCls = diffDays === null ? 'text-foreground-muted' : diffDays < 0 ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' : diffDays <= 30 ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                      const qty = parseFloat(b.quantity_remaining || '0')
                      const batchValue = qty * parseFloat(b.unit_cost || '0')
                      const serials: string[] = Array.isArray(b.serials) ? b.serials : []
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
                          <td className="py-1.5 pr-4 text-right font-semibold text-foreground">{formatINR(batchValue)}</td>
                          <td className="py-1.5 text-right">
                            {canWrite && (
                            <button
                              onClick={async () => {
                                const ok = await confirm({
                                  title: 'Remove Batch',
                                  message: qty > 0
                                    ? `This batch still has ${qty} units remaining. Are you sure you want to remove it?`
                                    : 'Remove this batch?',
                                  confirmLabel: 'Remove',
                                  variant: 'danger',
                                })
                                if (!ok) return
                                const res = await fetch(`/api/admin/inventory/batches/${b.batch_id}`, { method: 'DELETE' })
                                const json = await res.json()
                                if (!res.ok) { showToast(json.error || 'Failed to remove batch', 'error'); return }
                                showToast('Batch removed', 'success')
                                toggleValBatch(rowId, p.id, p.variant_id || null, p.sub_variant_id || null)
                                setTimeout(() => toggleValBatch(rowId, p.id, p.variant_id || null, p.sub_variant_id || null), 100)
                              }}
                              className="text-red-500 hover:text-red-700 text-xs px-1.5 py-0.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                              title="Remove batch"
                            >Remove</button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                    {!p.perishable && parseFloat(p.inventory_quantity || '0') > 0 && (
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
                inputClassName="w-full field-sm pr-9 bg-surface border border-border-secondary text-foreground focus:ring-2 focus:ring-accent-500 focus:border-transparent transition-colors hover:border-border-default placeholder:text-foreground-muted" />
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

                      // Build per-product sub-groups within this reference group
                      type ProductSubGroup = { key: string; productId: string; variantId: string | null; subVariantId: string | null; txs: StockTransaction[] }
                      const productSubGroups: ProductSubGroup[] = []
                      for (const tx of group.txs) {
                        const pKey = `${tx.product_id}::${tx.variant_id || ''}::${tx.sub_variant_id || ''}`
                        const existing = productSubGroups.find(g => g.key === pKey)
                        if (existing) existing.txs.push(tx)
                        else productSubGroups.push({ key: pKey, productId: tx.product_id, variantId: tx.variant_id, subVariantId: tx.sub_variant_id ?? null, txs: [tx] })
                      }
                      const productCount = productSubGroups.length

                      const refLink = group.refType === 'order' && group.linkId ? (
                        <Link href={ap(`/admin/invoices/${group.linkId}`)} className="font-mono text-accent-500 hover:underline underline-offset-2">
                          {group.refLabel || (group.linkId || group.refId).slice(0, 8) + '…'}
                        </Link>
                      ) : group.refType === 'cash_sale' && group.linkId ? (
                        <Link href={ap(`/admin/cash-sale/${group.linkId}`)} className="font-mono text-accent-500 hover:underline underline-offset-2">
                          {group.refLabel || (group.linkId || group.refId).slice(0, 8) + '…'}
                        </Link>
                      ) : group.refType === 'grn' && canFinancial ? (
                        <Link href={ap(`/admin/financial?tab=grn`)} className="font-mono text-accent-500 hover:underline underline-offset-2">
                          {group.refLabel || (group.linkId || group.refId).slice(0, 8) + '…'}
                        </Link>
                      ) : (
                        <span className="font-mono text-foreground-secondary">{group.refType} / {(group.linkId || group.refId).slice(0, 8)}…</span>
                      )

                      function fmtChange(n: number) {
                        const sign = n > 0 ? '+' : n < 0 ? '−' : ''
                        return `${sign}${Math.abs(n)}`
                      }

                      function BatchCell({ tx }: { tx: StockTransaction }) {
                        if (tx.serial_number) return (
                          <div className="space-y-0.5">
                            <span className="font-mono text-foreground-secondary">{tx.serial_number}</span>
                            {tx.lot_number && <span className="block font-mono text-xs text-foreground-muted">{tx.lot_number}</span>}
                            {tx.expiry_date && (() => {
                              const d = new Date(tx.expiry_date); const now = new Date()
                              const diffDays = Math.floor((d.getTime() - now.getTime()) / 86400000)
                              const cls = diffDays < 0 ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' : diffDays <= 30 ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                              return <span className={`inline-flex px-1.5 py-0.5 rounded text-xs font-medium ${cls}`}>{formatDate(tx.expiry_date)}</span>
                            })()}
                          </div>
                        )
                        if (tx.lot_number) return (
                          <div className="space-y-0.5">
                            <span className="font-mono text-foreground-secondary">{tx.lot_number}</span>
                            {tx.expiry_date && (() => {
                              const d = new Date(tx.expiry_date); const now = new Date()
                              const diffDays = Math.floor((d.getTime() - now.getTime()) / 86400000)
                              const cls = diffDays < 0 ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' : diffDays <= 30 ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                              return <span className={`inline-flex px-1.5 py-0.5 rounded text-xs font-medium ${cls}`}>{formatDate(tx.expiry_date)}</span>
                            })()}
                          </div>
                        )
                        return <span className="text-foreground-muted">—</span>
                      }

                      // Single-product, single-tx: flat row (no grouping chrome)
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
                                  {tx.product_sku && <p className="text-xs font-mono text-foreground-muted inline-flex items-center gap-1">{tx.product_sku}<CopySku sku={tx.product_sku} /></p>}
                                  <div className="border-t border-border-default pt-2 space-y-1.5 text-xs">
                                    <div className="flex justify-between"><span className="text-foreground-secondary">Type</span><span className={`px-1.5 py-0.5 rounded-full font-medium ${TYPE_BADGE[tx.transaction_type] || ''}`}>{tx.transaction_type}</span></div>
                                    <div className="flex justify-between"><span className="text-foreground-secondary">Change</span><span className={`font-mono font-semibold ${chg > 0 ? 'text-green-600 dark:text-green-400' : chg < 0 ? 'text-red-600 dark:text-red-400' : 'text-foreground-secondary'}`}>{fmtChange(chg)}</span></div>
                                    <div className="flex justify-between"><span className="text-foreground-secondary">Balance after</span><span className="font-mono font-medium text-foreground">{Number(tx.quantity_after)}</span></div>
                                    {tx.notes && <div className="pt-1 border-t border-border-default"><p className="text-foreground-secondary leading-snug">{tx.notes}</p></div>}
                                  </div>
                                </div>
                              </HoverCard>
                              {tx.product_sku && <p className="text-xs text-foreground-muted font-mono mt-0.5 inline-flex items-center gap-1">{tx.product_sku}<CopySku sku={tx.product_sku} /></p>}
                            </td>
                            <td className="px-4 py-3"><span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium capitalize ${TYPE_BADGE[tx.transaction_type] || ''}`}>{tx.transaction_type}</span></td>
                            <td className={`px-4 py-3 text-right font-mono font-semibold ${chg > 0 ? 'text-green-600 dark:text-green-400' : chg < 0 ? 'text-red-600 dark:text-red-400' : 'text-foreground-secondary'}`}>
                              {fmtChange(chg)}
                              {tx.quantity_in_unit != null && tx.unit_label && <span className="block text-xs font-normal text-foreground-muted">({Number(tx.quantity_in_unit) > 0 ? '+' : ''}{Number(tx.quantity_in_unit)} {tx.unit_label})</span>}
                            </td>
                            <td className="px-4 py-3 text-right font-mono text-foreground font-medium">{Number(tx.quantity_after)}</td>
                            <td className="px-4 py-3 text-xs hidden md:table-cell">{refLink}</td>
                            <td className="px-4 py-3 text-xs hidden md:table-cell"><BatchCell tx={tx} /></td>
                          </tr>
                        )
                      }

                      return (
                        <React.Fragment key={`group-${group.refId}`}>
                          {/* Level-1: GRN / order header — collapses all products */}
                          <tr
                            className="bg-surface-secondary/60 hover:bg-surface-secondary cursor-pointer transition-colors select-none"
                            onClick={() => toggleGroup(group.refId)}
                          >
                            <td className="px-4 py-2.5 text-foreground-secondary whitespace-nowrap text-xs">
                              {new Date(group.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                            </td>
                            <td className="px-4 py-2.5">
                              <div className="flex items-center gap-2">
                                <svg className={`w-3.5 h-3.5 text-foreground-secondary shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                </svg>
                                <span className="text-sm font-medium text-foreground">
                                  {productCount === 1
                                    ? <>{group.txs[0].product_name}{group.txs[0].variant_name && <span className="text-foreground-secondary font-normal"> / {group.txs[0].variant_name}</span>}</>
                                    : `${productCount} products`
                                  }
                                  <span className="ml-2 text-xs text-foreground-muted font-normal">{group.txs.length} entries</span>
                                </span>
                              </div>
                            </td>
                            <td className="px-4 py-2.5"><span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium capitalize ${TYPE_BADGE[txType] || ''}`}>{txType}</span></td>
                            <td className={`px-4 py-2.5 text-right font-mono font-semibold ${totalChange > 0 ? 'text-green-600 dark:text-green-400' : totalChange < 0 ? 'text-red-600 dark:text-red-400' : 'text-foreground-secondary'}`}>
                              {fmtChange(totalChange)}
                              <span className="block text-xs font-normal text-foreground-muted">net total</span>
                            </td>
                            <td className="px-4 py-2.5 text-right text-foreground-muted text-xs font-mono">—</td>
                            <td className="px-4 py-2.5 text-xs hidden md:table-cell">{refLink}</td>
                            <td className="px-4 py-2.5 hidden md:table-cell" />
                          </tr>

                          {/* Level-2: per-product rows (shown when level-1 expanded) */}
                          {expanded && productSubGroups.map(pg => {
                            const pgTotalChange = Math.round(pg.txs.reduce((s, t) => s + Number(t.quantity_change), 0) * 1000) / 1000
                            const isSerialPg = pg.txs.length > 1 && pg.txs.every(t => t.serial_number)
                            const isBatchPg = !isSerialPg && pg.txs.length > 1 && pg.txs.some(t => t.lot_number || t.batch_id)
                            const isExpandable = isSerialPg || isBatchPg
                            const serialKey = `${group.refId}::${pg.key}`
                            const serialExpanded = expandedSerialProducts.has(serialKey)
                            const repTx = pg.txs[pg.txs.length - 1] // last tx has final balance

                            return (
                              <React.Fragment key={`pg-${pg.key}`}>
                                {/* Product row — clickable if it has serial or batch sub-rows */}
                                <tr
                                  className={`bg-surface/40 transition-colors border-l-2 border-accent-500/30 ${isExpandable ? 'cursor-pointer hover:bg-surface-secondary/30 select-none' : 'hover:bg-surface-secondary/20'}`}
                                  onClick={isExpandable ? () => toggleSerialProduct(serialKey) : undefined}
                                >
                                  <td className="px-4 py-2.5 text-foreground-secondary whitespace-nowrap text-xs pl-8" />
                                  <td className="px-4 py-2.5 pl-8 text-foreground">
                                    <div className="flex items-center gap-2">
                                      {isExpandable && (
                                        <svg className={`w-3 h-3 text-foreground-secondary shrink-0 transition-transform ${serialExpanded ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                        </svg>
                                      )}
                                      <div>
                                        <Link href={ap(`/admin/products/${repTx.product_id}`)} className="text-sm font-medium hover:text-accent-500 hover:underline underline-offset-2" onClick={e => e.stopPropagation()}>
                                          {repTx.product_name}{repTx.variant_name && <span className="text-foreground-secondary font-normal"> / {repTx.variant_name}{repTx.sub_variant_name ? ` / ${repTx.sub_variant_name}` : ''}</span>}
                                        </Link>
                                        {repTx.product_sku && <p className="text-xs text-foreground-muted font-mono mt-0.5 inline-flex items-center gap-1">{repTx.product_sku}<CopySku sku={repTx.product_sku} /></p>}
                                        {isSerialPg && <p className="text-xs text-foreground-muted mt-0.5">{pg.txs.length} serials · {serialExpanded ? 'collapse' : 'expand'}</p>}
                                        {isBatchPg && <p className="text-xs text-foreground-muted mt-0.5">{pg.txs.length} batches · {serialExpanded ? 'collapse' : 'expand'}</p>}
                                      </div>
                                    </div>
                                  </td>
                                  <td className="px-4 py-2.5" />
                                  <td className={`px-4 py-2.5 text-right font-mono font-semibold text-sm ${pgTotalChange > 0 ? 'text-green-600 dark:text-green-400' : pgTotalChange < 0 ? 'text-red-600 dark:text-red-400' : 'text-foreground-secondary'}`}>
                                    {fmtChange(pgTotalChange)}
                                    {isExpandable && <span className="block text-xs font-normal text-foreground-muted">net total</span>}
                                  </td>
                                  <td className="px-4 py-2.5 text-right font-mono text-foreground font-medium text-sm">
                                    {isExpandable ? '—' : Number(repTx.quantity_after)}
                                  </td>
                                  <td className="px-4 py-2.5 text-xs hidden md:table-cell" />
                                  <td className="px-4 py-2.5 text-xs hidden md:table-cell">
                                    {isSerialPg
                                      ? <span className="font-mono text-xs text-foreground-secondary">{pg.txs.slice(0, 2).map(t => t.serial_number).join(', ')}{pg.txs.length > 2 ? ` (+${pg.txs.length - 2} more)` : ''}</span>
                                      : isBatchPg
                                        ? <span className="font-mono text-xs text-foreground-secondary">{pg.txs.slice(0, 2).map(t => t.lot_number).filter(Boolean).join(', ')}{pg.txs.length > 2 ? ` (+${pg.txs.length - 2} more)` : ''}</span>
                                        : <BatchCell tx={repTx} />
                                    }
                                  </td>
                                </tr>

                                {/* Level-3: individual serial rows */}
                                {isSerialPg && serialExpanded && pg.txs.map(tx => {
                                  const chg = Number(tx.quantity_change)
                                  return (
                                    <tr key={tx.id} className="bg-surface/20 hover:bg-surface-secondary/20 transition-colors border-l-4 border-accent-500/20">
                                      <td className="px-4 py-2 text-foreground-secondary whitespace-nowrap text-xs pl-14" />
                                      <td className="px-4 py-2 pl-14 text-foreground">
                                        <span className="font-mono text-xs text-foreground-secondary">{tx.serial_number}</span>
                                        {tx.lot_number && <span className="block font-mono text-xs text-foreground-muted">{tx.lot_number}</span>}
                                      </td>
                                      <td className="px-4 py-2" />
                                      <td className={`px-4 py-2 text-right font-mono text-sm ${chg > 0 ? 'text-green-600 dark:text-green-400' : chg < 0 ? 'text-red-600 dark:text-red-400' : 'text-foreground-secondary'}`}>{fmtChange(chg)}</td>
                                      <td className="px-4 py-2 text-right font-mono text-foreground text-sm">{Number(tx.quantity_after)}</td>
                                      <td className="px-4 py-2 hidden md:table-cell" />
                                      <td className="px-4 py-2 text-xs hidden md:table-cell">
                                        {tx.expiry_date && (() => {
                                          const d = new Date(tx.expiry_date); const now = new Date()
                                          const diffDays = Math.floor((d.getTime() - now.getTime()) / 86400000)
                                          const cls = diffDays < 0 ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' : diffDays <= 30 ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                                          return <span className={`inline-flex px-1.5 py-0.5 rounded text-xs font-medium ${cls}`}>{formatDate(tx.expiry_date)}</span>
                                        })()}
                                      </td>
                                    </tr>
                                  )
                                })}

                                {/* Level-3: individual batch/lot rows */}
                                {isBatchPg && serialExpanded && pg.txs.map(tx => {
                                  const chg = Number(tx.quantity_change)
                                  return (
                                    <tr key={tx.id} className="bg-surface/20 hover:bg-surface-secondary/20 transition-colors border-l-4 border-accent-500/20">
                                      <td className="px-4 py-2 text-foreground-secondary whitespace-nowrap text-xs pl-14" />
                                      <td className="px-4 py-2 pl-14 text-foreground">
                                        <span className="font-mono text-xs text-foreground-secondary">{tx.lot_number || '—'}</span>
                                      </td>
                                      <td className="px-4 py-2" />
                                      <td className={`px-4 py-2 text-right font-mono text-sm ${chg > 0 ? 'text-green-600 dark:text-green-400' : chg < 0 ? 'text-red-600 dark:text-red-400' : 'text-foreground-secondary'}`}>{fmtChange(chg)}</td>
                                      <td className="px-4 py-2 text-right font-mono text-foreground text-sm">{Number(tx.quantity_after)}</td>
                                      <td className="px-4 py-2 hidden md:table-cell" />
                                      <td className="px-4 py-2 text-xs hidden md:table-cell">
                                        {tx.expiry_date && (() => {
                                          const d = new Date(tx.expiry_date); const now = new Date()
                                          const diffDays = Math.floor((d.getTime() - now.getTime()) / 86400000)
                                          const cls = diffDays < 0 ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' : diffDays <= 30 ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                                          return <span className={`inline-flex px-1.5 py-0.5 rounded text-xs font-medium ${cls}`}>{formatDate(tx.expiry_date)}</span>
                                        })()}
                                      </td>
                                    </tr>
                                  )
                                })}
                              </React.Fragment>
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
                onSelect={item => { setValSearch(item.label); setValPage(1); syncUrl({ val_search: item.label }) }}
                placeholder="Name, SKU, variant..."
                inputClassName="w-full field-sm pr-9 bg-surface border border-border-secondary text-foreground focus:ring-2 focus:ring-accent-500 focus:border-transparent transition-colors hover:border-border-default placeholder:text-foreground-muted"
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
                <SummaryCard label="Stock Value (ex-GST)" value={formatINR(valuation.totalValue || 0)} accent sub={`${valTotal} SKUs`} />
                <SummaryCard label="Stock Value (incl. GST)" value={formatINR(valuation.totalValueInclGst || 0)} accent sub="all products" />
                <SummaryCard label="Total SKUs" value={String(valTotal)} sub="across all products" />
                <SummaryCard label="In Stock" value={String(valuation.inStockCount ?? allValRows.filter(p => parseFloat(p.inventory_quantity || '0') > 0).length)} sub="across all products" />
              </div>
              <div className="bg-surface-elevated rounded-xl border border-border-default overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-surface-secondary border-b border-border-default">
                      <tr>
                        <SortableHeader label="Product" column="product" options={sortOptions('text')} currentSort={valSortCol} currentDir={valSortDir} onSort={handleValSort} />
                        <SortableHeader label="Variant" column="variant" options={sortOptions('text')} currentSort={valSortCol} currentDir={valSortDir} onSort={handleValSort} className="hidden sm:table-cell" />
                        <SortableHeader label="SKU" column="sku" options={sortOptions('text')} currentSort={valSortCol} currentDir={valSortDir} onSort={handleValSort} className="hidden md:table-cell" />
                        <SortableHeader label="Stock" column="stock" options={sortOptions('number')} currentSort={valSortCol} currentDir={valSortDir} onSort={handleValSort} align="right" className="w-[110px]" />
                        <th className="px-4 py-3 text-center text-xs font-semibold text-foreground-secondary uppercase tracking-wide hidden sm:table-cell">Sell Unit</th>
                        <SortableHeader label="Price ex-GST" column="price" options={sortOptions('number')} currentSort={valSortCol} currentDir={valSortDir} onSort={handleValSort} align="right" />
                        <th className="px-4 py-3 text-right text-xs font-semibold text-foreground-secondary uppercase tracking-wide">GST %</th>
                        <SortableHeader label="Stock Value (ex-GST)" column="value" options={sortOptions('number')} currentSort={valSortCol} currentDir={valSortDir} onSort={handleValSort} align="right" />
                        <th className="px-4 py-3 text-right text-xs font-semibold text-foreground-secondary uppercase tracking-wide">Stock Value (incl. GST)</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-foreground-secondary uppercase tracking-wide w-[130px]">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border-default">
                      {valTree.length === 0 && (
                        <tr><td colSpan={10} className="py-12 text-center text-foreground-secondary text-sm">
                          {valSearch ? `No products match "${valSearch}"` : 'No products in stock'}
                        </td></tr>
                      )}
                      {valTree.map((prod) => {
                        const productExpanded = expandedValProducts.has(prod.productId)
                        const chevron = (expanded: boolean) => (
                          <svg className={`w-4 h-4 shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                        )

                        if (prod.simpleLeaf && prod.variants.length === 0) {
                          const p = prod.simpleLeaf
                          const firstCell = (
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
                                {(p.row_sku || p.sku) && <p className="text-xs font-mono text-foreground-muted">{p.row_sku || p.sku}</p>}
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
                                    <span className="font-semibold text-foreground">{formatINR(parseFloat(p.inventory_quantity || '0') * parseFloat(p.cost_price || '0'))}</span>
                                  </div>
                                </div>
                              </div>
                            </HoverCard>
                          )
                          return renderValLeaf(p, firstCell, '—')
                        }

                        return (
                          <React.Fragment key={prod.productId}>
                            <tr className="hover:bg-surface-secondary/50 transition-colors">
                              <td className="px-4 py-3 font-medium text-foreground">
                                <button
                                  onClick={() => toggleValProduct(prod.productId)}
                                  className="flex items-center gap-1.5 text-left hover:text-secondary-500 transition-colors"
                                >
                                  {chevron(productExpanded)}
                                  <HoverCard
                                    trigger={
                                      <Link href={ap(`/admin/products/${prod.head.id}`)} onClick={e => e.stopPropagation()} className="hover:text-accent-500 hover:underline underline-offset-2">
                                        {prod.head.name}
                                      </Link>
                                    }
                                    align="left"
                                    side="bottom"
                                    width="260px"
                                  >
                                    <div className="p-3 space-y-2">
                                      <p className="text-sm font-semibold text-foreground leading-tight">{prod.head.name}</p>
                                      {(prod.head.row_sku || prod.head.sku) && <p className="text-xs font-mono text-foreground-muted">{prod.head.row_sku || prod.head.sku}</p>}
                                      <div className="border-t border-border-default pt-2 space-y-1.5 text-xs">
                                        <div className="flex justify-between">
                                          <span className="text-foreground-secondary">Stock</span>
                                          <span className="font-semibold text-foreground">{prod.stock}</span>
                                        </div>
                                        <div className="flex justify-between">
                                          <span className="text-foreground-secondary">Stock Value</span>
                                          <span className="font-semibold text-foreground">{formatINR(prod.valueEx)}</span>
                                        </div>
                                      </div>
                                    </div>
                                  </HoverCard>
                                </button>
                              </td>
                              <td className="px-4 py-3 text-foreground-secondary hidden sm:table-cell">—</td>
                              <td className="px-4 py-3 font-mono text-xs text-foreground-secondary hidden md:table-cell"><span className="inline-flex items-center gap-1">{prod.head.row_sku || prod.head.sku || '—'}{(prod.head.row_sku || prod.head.sku) && <CopySku sku={prod.head.row_sku || prod.head.sku} />}</span></td>
                              <td className="px-4 py-3 text-right font-medium text-foreground">{prod.stock}</td>
                              <td className="px-4 py-3 text-center text-foreground-muted text-xs hidden sm:table-cell">—</td>
                              <td className="px-4 py-3 text-right text-foreground-muted">—</td>
                              <td className="px-4 py-3 text-right text-foreground-muted text-sm">—</td>
                              <td className="px-4 py-3 text-right font-semibold text-foreground">{formatINR(prod.valueEx)}</td>
                              <td className="px-4 py-3 text-right font-semibold text-foreground">{formatINR(prod.valueIncl)}</td>
                              <td className="px-4 py-3 text-right text-foreground-muted">—</td>
                            </tr>
                            {productExpanded && prod.variants.map((variant) => {
                              const variantExpanded = expandedValVariants.has(variant.variantId)
                              const hasSubs = variant.subVariants.length > 0

                              if (!hasSubs && variant.leaf) {
                                const p = variant.leaf
                                const firstCell = (
                                  <span className="pl-8 flex items-center gap-1.5">
                                    <span className="text-foreground-secondary">{p.variant_name || '—'}</span>
                                  </span>
                                )
                                return renderValLeaf(p, firstCell, p.variant_name || '—')
                              }

                              const vHead = variant.leaf || variant.subVariants[0]
                              return (
                                <React.Fragment key={variant.variantId}>
                                  <tr className="hover:bg-surface-secondary/50 transition-colors">
                                    <td className="px-4 py-3 font-medium text-foreground">
                                      <button
                                        onClick={() => toggleValVariant(variant.variantId)}
                                        className="pl-8 flex items-center gap-1.5 text-left hover:text-secondary-500 transition-colors"
                                      >
                                        {chevron(variantExpanded)}
                                        <span className="text-foreground-secondary">{vHead.variant_name || '—'}</span>
                                      </button>
                                    </td>
                                    <td className="px-4 py-3 text-foreground-secondary hidden sm:table-cell">{vHead.variant_name || '—'}</td>
                                    <td className="px-4 py-3 font-mono text-xs text-foreground-secondary hidden md:table-cell"><span className="inline-flex items-center gap-1">{vHead.row_sku || vHead.sku || '—'}{(vHead.row_sku || vHead.sku) && <CopySku sku={vHead.row_sku || vHead.sku} />}</span></td>
                                    <td className="px-4 py-3 text-right font-medium text-foreground">{variant.stock}</td>
                                    <td className="px-4 py-3 text-center text-foreground-muted text-xs hidden sm:table-cell">—</td>
                                    <td className="px-4 py-3 text-right text-foreground-muted">—</td>
                                    <td className="px-4 py-3 text-right text-foreground-muted text-sm">—</td>
                                    <td className="px-4 py-3 text-right font-semibold text-foreground">{formatINR(variant.valueEx)}</td>
                                    <td className="px-4 py-3 text-right font-semibold text-foreground">{formatINR(variant.valueIncl)}</td>
                                    <td className="px-4 py-3 text-right text-foreground-muted">—</td>
                                  </tr>
                                  {variantExpanded && variant.subVariants.map((sv) => {
                                    const firstCell = (
                                      <span className="pl-12 flex items-center gap-1.5">
                                        <span className="text-foreground-secondary">{sv.sub_variant_name || '—'}</span>
                                      </span>
                                    )
                                    const variantCell = sv.variant_name
                                      ? (sv.sub_variant_name ? `${sv.variant_name} / ${sv.sub_variant_name}` : sv.variant_name)
                                      : (sv.sub_variant_name || '—')
                                    return renderValLeaf(sv, firstCell, variantCell)
                                  })}
                                </React.Fragment>
                              )
                            })}
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
