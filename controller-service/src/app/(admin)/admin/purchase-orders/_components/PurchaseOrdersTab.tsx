'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { productLabel as grainLabel } from '@/lib/catalog/product-label'
import Link from 'next/link'
import AdminTypeahead from '@/components/admin/AdminTypeahead'
import AdminSelect from '@/components/admin/AdminSelect'
import SortableHeader, { sortOptions, type SortDir } from '@/components/admin/SortableHeader'
import { useToast } from '@/contexts/ToastContext'
import { useConfirm } from '@/contexts/ConfirmContext'
import DatePicker from '@/components/ui/DatePicker'
import { ap } from '@/lib/shared/admin-path'
import { formatDate } from '@/lib/shared/format'
import { generateSerialNumber, generateLotNumber, generateSerialRun } from '@/lib/catalog/selling-unit'
import CopySku from '@/components/ui/CopySku'
import { useBarcodeScanner } from '@/hooks/useBarcodeScanner'
import { RequireWrite } from '@/contexts/AdminScopesContext'
import { round3 } from '@/lib/shared/number-display'
import PurchaseOrdersMobileList from './PurchaseOrdersMobileList'
import { poDaysLate, poReceivedShare } from '@/lib/purchasing/po-status'
import { documentUrlForLocation } from '@/lib/tenancy/forms-host'
import { inputCls, labelCls, btnPrimary, btnSecondary, PAGE_SIZE, formatINR, SummaryCard, ClientPagination, STATUS_BADGE, type Supplier } from '@/components/admin/purchasing/shared'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type PO = {
  id: string
  po_number: string
  supplier_id: string
  supplier_name: string
  supplier_email: string | null
  status: string
  order_date: string
  expected_date: string | null
  item_count: number
  total_amount: string
}

type POItem = {
  id: string
  product_id: string
  variant_id: string | null
  sub_variant_id: string | null
  product_name: string
  variant_name: string | null
  sku: string | null
  product_sku?: string | null
  quantity: string
  unit_cost: string
  tax_rate: string
  total_cost: string
  quantity_received: string
  purchase_unit: string | null
  purchase_unit_factor: string | null
  sell_unit_label: string | null
  sell_unit_dimension: string | null
  sell_unit_qty_step: string | null
  perishable: boolean
  serialized: boolean
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
function serialsRequired(it: {
  receive_qty?: string
  purchase_unit_factor?: string | number
  sell_unit_qty_step?: string | null
}): number {
  const base = parseFloat(String(it.receive_qty || '0')) * parseFloat(String(it.purchase_unit_factor || '1'))
  const step = parseFloat(String(it.sell_unit_qty_step ?? '1')) || 1
  return Math.round(base / (step > 0 ? step : 1))
}

function POProgress({ items }: { items: POItem[] }) {
  if (!items.length) return null
  const share = poReceivedShare(items)
  const pct = Math.round(share * 100)
  const lines = items.filter(it => (Number(it.quantity_received) || 0) >= (Number(it.quantity) || 0)).length
  return (
    <div className="bg-surface-elevated rounded-xl border border-border-default px-4 py-3">
      <div className="flex items-center justify-between text-xs mb-1.5">
        <span className="font-medium text-foreground-secondary">Received</span>
        <span className="text-foreground-muted">
          {pct}% of quantity · {lines}/{items.length} lines complete
        </span>
      </div>
      <div className="h-2 rounded-full bg-surface-secondary overflow-hidden">
        <div
          className={`h-full rounded-full ${pct >= 100 ? 'bg-green-500' : pct > 0 ? 'bg-yellow-500' : 'bg-surface-secondary'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

function ExpectedDateEditor({
  poId,
  value,
  onSaved,
}: {
  poId: string
  value: string
  onSaved: (v: string) => void
}) {
  const { showToast } = useToast()
  const [date, setDate] = useState(value)
  const [saving, setSaving] = useState(false)
  useEffect(() => setDate(value), [value])
  async function save() {
    setSaving(true)
    try {
      const res = await fetch(`/api/admin/inventory/po/${poId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expected_date: date || null }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || 'Failed to update')
      showToast('Expected date updated', 'success')
      onSaved(date)
    } catch (e: any) {
      showToast(e.message, 'error')
    } finally {
      setSaving(false)
    }
  }
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div>
        <label className={labelCls}>Expected delivery</label>
        <DatePicker className="w-40" value={date} onChange={v => setDate(v || '')} />
      </div>
      <button className={btnSecondary} disabled={saving || date === value} onClick={save}>
        {saving ? 'Saving...' : 'Reschedule'}
      </button>
    </div>
  )
}

export default function PurchaseOrdersTab({ initialPO }: { initialPO?: string }) {
  const { showToast } = useToast()
  const confirm = useConfirm()
  const [pos, setPOs] = useState<PO[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [supplierFilter, setSupplierFilter] = useState('')
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [viewPO, setViewPO] = useState<{ po: any; items: POItem[]; grns: any[] } | null>(null)
  const [receiveMode, setReceiveMode] = useState<{ po: any } | null>(null)
  // Receive edit-session id — opened on modal open, closed on submit (save) or
  // cancel (rollback). Kept in a ref because closers run outside the setter.
  const receiveSessionIdRef = React.useRef<string | null>(null)
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
  const [poDrafts, setPoDrafts] = useState<
    { id: string; supplier_name: string | null; line_count: number; updated_at: string }[]
  >([])

  useEffect(() => {
    fetch('/api/admin/inventory/po/draft', { credentials: 'include' })
      .then(r => (r.ok ? r.json() : { drafts: [] }))
      .then(j => setPoDrafts(j.drafts || []))
      .catch(() => setPoDrafts([]))
  }, [])
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
      if (el && !el.value) {
        el.focus()
        return
      }
    }
  }, [])

  // Serials that were just received — enables the "Print labels" action post-receive.
  const [lastReceivedSerials, setLastReceivedSerials] = useState<string[]>([])

  // Fill the next empty serial slot (across serialized items, in order) from a scan.
  // Dedupe: ignore a serial already entered anywhere in this receive.
  const fillNextSerial = useCallback(
    (code: string) => {
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
    },
    [showToast]
  )

  useBarcodeScanner({ onScan: fillNextSerial, enabled: !!receiveMode && scanSerials, captureInInputs: true })

  // Autosave the in-progress receive form to localStorage (keyed by PO id) so a
  // long receive isn't lost on navigate-away/refresh. Restored in openReceive.
  // Also mirrors to po_receive_drafts on the server so Cancel rolls back cleanly.
  useEffect(() => {
    if (!receiveMode?.po?.id || receiveItems.length === 0) return
    const poId = receiveMode.po.id
    const key = `po_receive_draft:${poId}`
    const t = setTimeout(() => {
      // Only persist the fields the user edits (not the whole product record).
      const slim = receiveItems.map(it => ({
        id: it.id,
        receive_qty: it.receive_qty,
        receive_cost: it.receive_cost,
        lot_number: it.lot_number,
        expiry_date: it.expiry_date,
        manufacture_date: it.manufacture_date,
        location_id: it.location_id,
        serial_numbers: it.serial_numbers,
      }))
      try {
        localStorage.setItem(
          key,
          JSON.stringify({ items: slim, notes: receiveNotes, warehouse_id: receiveWarehouseId, savedAt: Date.now() })
        )
      } catch {}
      // Mirror to server draft (fire-and-forget — localStorage still works offline).
      void fetch(`/api/admin/inventory/po/${poId}/receive/draft`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          line_items: slim,
          serials: slim.flatMap(r => (Array.isArray(r.serial_numbers) ? r.serial_numbers : [])),
        }),
      }).catch(() => {})
    }, 600)
    return () => clearTimeout(t)
  }, [receiveMode, receiveItems, receiveNotes, receiveWarehouseId])

  async function printReceivedSerialLabels() {
    if (!lastReceivedSerials.length) return
    try {
      const res = await fetch('/api/admin/labels/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ serial_numbers: lastReceivedSerials, copies: 1, sheet: false }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || 'Failed')
      }
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
      const res = await fetch(`/api/admin/inventory/po/${po.id}/resend-email`, {
        method: 'POST',
        credentials: 'include',
      })
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
    po_number: 'po_number',
    supplier: 'supplier_name',
    date: 'order_date',
    expected: 'expected_date',
    items: 'item_count',
    total: 'total_amount',
    status: 'status',
  }

  const sortedPOs =
    poSortCol && PO_SORT_KEYS[poSortCol]
      ? [...pos].sort((a, b) => {
          const k = PO_SORT_KEYS[poSortCol]
          const cmp = String(a[k] ?? '').localeCompare(String(b[k] ?? ''), 'en', { numeric: true })
          return poSortDir === 'asc' ? cmp : -cmp
        })
      : pos

  function handlePoSort(col: string, dir: SortDir) {
    setPoSortCol(col)
    setPoSortDir(dir)
  }

  const load = useCallback(
    async (pg = page) => {
      setLoading(true)
      const params = new URLSearchParams({ page: String(pg), limit: String(PAGE_SIZE) })
      if (search) params.set('search', search)
      if (statusFilter) params.set('status', statusFilter)
      if (supplierFilter) params.set('supplier_id', supplierFilter)
      const res = await fetch(`/api/admin/inventory/po?${params}`)
      const json = await res.json()
      setPOs(json?.purchase_orders || [])
      setTotal(json?.total || 0)
      setLoading(false)
    },
    [search, statusFilter, supplierFilter, page]
  )

  useEffect(() => {
    load(page)
  }, [load, page])

  // ?po= takes a PO id or a PO number (number links predate the id ones).
  const deepLinked = React.useRef(false)
  useEffect(() => {
    if (!initialPO || deepLinked.current) return
    deepLinked.current = true
    if (UUID_RE.test(initialPO)) {
      openPO(initialPO)
      return
    }
    fetch(`/api/admin/inventory/po?${new URLSearchParams({ search: initialPO, limit: '5' })}`)
      .then(r => (r.ok ? r.json() : null))
      .then(j => {
        const match = (j?.purchase_orders || []).find((p: PO) => p.po_number === initialPO)
        if (match) openPO(match.id)
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPO])

  useEffect(() => {
    if (suppliers.length === 0) {
      fetch('/api/admin/inventory/suppliers?limit=1000')
        .then(r => r.json())
        .then(j => setSuppliers(j?.suppliers || []))
    }
    if (poCategories.length === 0) {
      fetch('/api/categories')
        .then(r => r.json())
        .then(d => setPoCategories((d.categories || d || []).map((c: any) => ({ id: c.id, name: c.name }))))
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
        receive_qty: String(round3(factor > 1 ? remaining / factor : remaining)),
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

    // Open an editor-session so Cancel can roll back the draft on the server.
    try {
      const sr = await fetch('/api/admin/editor-sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ resource_type: 'po_receive', resource_id: id }),
      })
      if (sr.ok) {
        const sj = await sr.json()
        receiveSessionIdRef.current = sj.session_id || null
      }
    } catch {}

    // Prefer the server-side receive draft (survives machine switches); fall back to localStorage.
    try {
      const dr = await fetch(`/api/admin/inventory/po/${id}/receive/draft`, { credentials: 'include' })
      if (dr.ok) {
        const dj = await dr.json()
        if (dj?.draft?.line_items && Array.isArray(dj.draft.line_items)) {
          const byId: Record<string, any> = {}
          for (const d of dj.draft.line_items as any[]) byId[d.id] = d
          const merged = items.map((it: any) => (byId[it.id] ? { ...it, ...byId[it.id] } : it))
          setReceiveItems(merged)
          setReceiveNotes('')
          setReceiveWarehouseId('')
          setDraftRestored(true)
          return
        }
      }
    } catch {}
    try {
      const raw = localStorage.getItem(`po_receive_draft:${id}`)
      if (raw) {
        const draft = JSON.parse(raw)
        if (draft && Array.isArray(draft.items)) {
          // Merge saved per-item values by po_item_id onto the fresh item list.
          const byId: Record<string, any> = {}
          for (const d of draft.items) byId[d.id] = d
          const merged = items.map((it: any) => (byId[it.id] ? { ...it, ...byId[it.id] } : it))
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

  // Cancel the receive: close the session (rolls back draft on the server) and
  // discard the client state. localStorage mirror is cleared too.
  async function cancelReceive() {
    const poId = receiveMode?.po?.id
    const sid = receiveSessionIdRef.current
    if (sid) {
      await fetch(`/api/admin/editor-sessions/${sid}/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action: 'cancel' }),
      }).catch(() => {})
      receiveSessionIdRef.current = null
    }
    if (poId) {
      try { localStorage.removeItem(`po_receive_draft:${poId}`) } catch {}
    }
    setReceiveMode(null)
  }

  // Explicitly save the in-progress receive as a draft and exit. The form already
  // autosaves as you type; this writes immediately (bypassing the debounce) so the
  // user can confidently leave and resume later from the PO list.
  function saveDraftAndExit() {
    if (!receiveMode?.po?.id) return
    try {
      const slim = receiveItems.map(it => ({
        id: it.id,
        receive_qty: it.receive_qty,
        receive_cost: it.receive_cost,
        lot_number: it.lot_number,
        expiry_date: it.expiry_date,
        manufacture_date: it.manufacture_date,
        location_id: it.location_id,
        serial_numbers: it.serial_numbers,
      }))
      localStorage.setItem(
        `po_receive_draft:${receiveMode.po.id}`,
        JSON.stringify({
          items: slim,
          notes: receiveNotes,
          warehouse_id: receiveWarehouseId,
          savedAt: Date.now(),
        })
      )
      showToast('Draft saved — resume this receipt anytime from the PO list.', 'success')
    } catch {
      showToast('Could not save draft', 'error')
    }
    // Close the session as 'save' — server does NOT roll back the draft on save.
    const sid = receiveSessionIdRef.current
    if (sid) {
      void fetch(`/api/admin/editor-sessions/${sid}/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action: 'save' }),
      }).catch(() => {})
      receiveSessionIdRef.current = null
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
      const serials = Array.isArray(it.serial_numbers) ? (it.serial_numbers as string[]) : []
      return serials.filter(Boolean).length !== serialsRequired(it)
    })
    if (missingSerials.length > 0) {
      showToast(
        `Serial numbers count must match received qty for: ${missingSerials.map((it: any) => grainLabel(it)).join(', ')}`,
        'error'
      )
      return
    }
    setReceiveSaving(true)
    const items = receiveItems
      .filter(it => parseFloat(it.receive_qty) > 0)
      .map(it => ({
        po_item_id: it.id,
        product_id: it.product_id,
        variant_id: it.variant_id || null,
        sub_variant_id: it.sub_variant_id || null,
        quantity_received: parseFloat(it.receive_qty),
        unit_cost: parseFloat(it.receive_cost),
        purchase_unit_factor: parseFloat(it.purchase_unit_factor || '1'),
        ...(it.perishable
          ? {
              lot_number: it.lot_number || null,
              expiry_date: it.expiry_date || null,
              manufacture_date: it.manufacture_date || null,
              location_id: it.location_id || null,
            }
          : {}),
        ...(it.serialized
          ? {
              serial_numbers: (Array.isArray(it.serial_numbers) ? (it.serial_numbers as string[]) : []).filter(Boolean),
            }
          : {}),
      }))
    const res = await fetch(`/api/admin/inventory/po/${receiveMode.po.id}/receive`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items,
        notes: receiveNotes,
        ...(receiveWarehouseId ? { warehouse_id: receiveWarehouseId } : {}),
      }),
    })
    const json = await res.json()
    setReceiveSaving(false)
    if (json.success) {
      // Clear the autosaved draft for this PO now that it's received.
      try {
        localStorage.removeItem(`po_receive_draft:${receiveMode.po.id}`)
      } catch {}
      // Delete the server-side draft + close the session as 'save' (no rollback).
      void fetch(`/api/admin/inventory/po/${receiveMode.po.id}/receive/draft`, {
        method: 'DELETE',
        credentials: 'include',
      }).catch(() => {})
      const sid = receiveSessionIdRef.current
      if (sid) {
        void fetch(`/api/admin/editor-sessions/${sid}/close`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ action: 'save' }),
        }).catch(() => {})
        receiveSessionIdRef.current = null
      }
      setDraftRestored(false)
      // Stash received serials so labels can be printed from the PO list, then close.
      const receivedSerials = items.flatMap((it: any) => (Array.isArray(it.serial_numbers) ? it.serial_numbers : []))
      setLastReceivedSerials(receivedSerials)
      setReceiveMode(null)
      load(page)
      if (Array.isArray(json.warnings) && json.warnings.length) {
        showToast(json.warnings[0], 'error')
      }
    } else showToast(json.error || 'Failed to receive goods', 'error')
  }

  async function sendPO(id: string) {
    await fetch(`/api/admin/inventory/po/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
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
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'cancelled' }),
    })
    load(page)
    if (viewPO?.po.id === id) setViewPO(null)
  }

  const openCount = pos.filter(p => ['draft', 'sent', 'partial'].includes(p.status)).length
  const pendingValue = pos
    .filter(p => ['draft', 'sent', 'partial'].includes(p.status))
    .reduce((s, p) => s + parseFloat(p.total_amount || '0'), 0)

  if (receiveMode) {
    return (
      <div className="space-y-5">
        <div className="flex items-center gap-3">
          <button
            className="inline-flex items-center gap-1.5 text-sm text-foreground-secondary hover:text-foreground transition-colors"
            onClick={cancelReceive}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Back
          </button>
          <div>
            <h3 className="font-semibold text-foreground">Receive Goods — {receiveMode.po.po_number}</h3>
            <p className="text-xs text-foreground-secondary mt-0.5">Supplier: {receiveMode.po.supplier_name}</p>
          </div>
          {/* Barcode scan toggle for serial capture */}
          <button
            type="button"
            onClick={() => setScanSerials(v => !v)}
            title={scanSerials ? 'Scanning on — scan each unit to fill the next serial slot' : 'Serial scanning off'}
            className={`ml-auto flex items-center gap-1.5 text-xs font-semibold px-2.5 h-control-sm rounded-lg border transition-colors ${scanSerials ? 'border-accent-500 bg-accent-50 dark:bg-accent-900/20 text-accent-700 dark:text-accent-400' : 'border-border-default text-foreground-muted hover:bg-surface-secondary'}`}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 6h1m3 0h1m3 0v12M4 18h1m11-12h1M8 18h1m7-12v12m3-12h1v12h-1"
              />
            </svg>
            {scanSerials ? 'Scan serials: on' : 'Scan serials: off'}
          </button>
        </div>
        {draftRestored && (
          <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20">
            <svg
              className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-sm text-foreground flex-1">
              Restored your unsaved progress for this PO. Your entries auto-save as you go.
            </p>
            <button
              type="button"
              onClick={() => {
                try {
                  localStorage.removeItem(`po_receive_draft:${receiveMode.po.id}`)
                } catch {}
                setDraftRestored(false)
                openReceive(receiveMode.po.id)
              }}
              className="text-xs font-semibold text-amber-700 dark:text-amber-400 hover:underline shrink-0"
            >
              Discard draft
            </button>
          </div>
        )}
        <div className="bg-surface-elevated rounded-xl border border-border-default overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-secondary border-b border-border-default">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-secondary uppercase tracking-wide">
                    Product
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-foreground-secondary uppercase tracking-wide">
                    Ordered
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-foreground-secondary uppercase tracking-wide">
                    Prev. Received
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-foreground-secondary uppercase tracking-wide">
                    Receive Now
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-foreground-secondary uppercase tracking-wide">
                    Unit Cost (₹)
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-foreground-secondary uppercase tracking-wide">
                    Tax %
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-foreground-secondary uppercase tracking-wide">
                    Line Total (₹)
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-default">
                {receiveItems.map((it, idx) => {
                  const factor = parseFloat(it.purchase_unit_factor || '1')
                  const baseLabel = poBaseUnitLabel(it)
                  const puLabel = it.purchase_unit || baseLabel
                  const orderedInPu =
                    factor > 1 ? Math.round((parseFloat(it.quantity) / factor) * 1000) / 1000 : parseFloat(it.quantity)
                  const prevInPu =
                    factor > 1
                      ? Math.round((parseFloat(it.quantity_received || '0') / factor) * 1000) / 1000
                      : parseFloat(it.quantity_received || '0')
                  return (
                    <React.Fragment key={it.id}>
                      <tr className="hover:bg-surface-secondary/50 transition-colors">
                        <td className="px-4 py-3 text-foreground">
                          <p className="font-medium">
                            {it.product_name}
                            {it.variant_name && (
                              <span className="text-foreground-secondary font-normal"> / {it.variant_name}</span>
                            )}
                          </p>
                          {it.sku && (
                            <p className="text-xs text-foreground-muted font-mono mt-0.5 inline-flex items-center gap-1">
                              {it.sku}
                              <CopySku sku={it.sku} />
                            </p>
                          )}
                          {it.purchase_unit && factor > 1 && (
                            <p className="text-xs text-foreground-muted mt-0.5">
                              1 {it.purchase_unit} = {factor} {baseLabel}
                            </p>
                          )}
                          {it.perishable && (
                            <span className="mt-1 inline-block text-[10px] font-medium px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">
                              Perishable
                            </span>
                          )}
                          {it.serialized && (
                            <span className="mt-1 inline-block text-[10px] font-medium px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                              Serialized
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right text-foreground-secondary">
                          {orderedInPu}
                          {puLabel && <span className="text-xs text-foreground-muted ml-1">{puLabel}</span>}
                        </td>
                        <td className="px-4 py-3 text-right text-foreground-secondary">
                          {prevInPu}
                          {puLabel && <span className="text-xs text-foreground-muted ml-1">{puLabel}</span>}
                        </td>
                        <td className="px-4 py-3 text-right align-middle">
                          <div className="flex items-center justify-end gap-1.5">
                            <input
                              type="number"
                              min="0"
                              step="0.001"
                              className="w-24 field-compact border border-border-default bg-surface text-foreground text-right focus:outline-none focus:ring-2 focus:ring-secondary-500 focus:border-transparent"
                              value={it.receive_qty}
                              onChange={e =>
                                setReceiveItems(items =>
                                  items.map((r, i) => (i === idx ? { ...r, receive_qty: e.target.value } : r))
                                )
                              }
                            />
                            {puLabel && <span className="text-xs text-foreground-muted">{puLabel}</span>}
                            {factor > 1 && parseFloat(it.receive_qty) > 0 && (
                              <span className="text-xs text-foreground-muted">
                                = {Math.round(parseFloat(it.receive_qty) * factor * 1000) / 1000} {baseLabel}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right align-middle">
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            className="w-28 field-compact border border-border-default bg-surface text-foreground text-right focus:outline-none focus:ring-2 focus:ring-secondary-500 focus:border-transparent"
                            value={it.receive_cost}
                            onChange={e =>
                              setReceiveItems(items =>
                                items.map((r, i) => (i === idx ? { ...r, receive_cost: e.target.value } : r))
                              )
                            }
                          />
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
                                <label className={labelCls}>
                                  Expiry Date <span className="text-red-500">*</span>
                                </label>
                                <DatePicker
                                  value={it.expiry_date}
                                  onChange={v =>
                                    setReceiveItems(items =>
                                      items.map((r, i) => (i === idx ? { ...r, expiry_date: v } : r))
                                    )
                                  }
                                />
                              </div>
                              <div>
                                <label className={labelCls}>Manufacture Date</label>
                                <DatePicker
                                  value={it.manufacture_date}
                                  onChange={v =>
                                    setReceiveItems(items =>
                                      items.map((r, i) => (i === idx ? { ...r, manufacture_date: v } : r))
                                    )
                                  }
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
                                    onChange={e =>
                                      setReceiveItems(items =>
                                        items.map((r, i) => (i === idx ? { ...r, lot_number: e.target.value } : r))
                                      )
                                    }
                                  />
                                  <button
                                    type="button"
                                    title="Regenerate lot number"
                                    onClick={() => {
                                      const autoLot = generateLotNumber(it.sku || it.product_sku)
                                      setReceiveItems(items =>
                                        items.map((r, i) => (i === idx ? { ...r, lot_number: autoLot } : r))
                                      )
                                    }}
                                    className="px-2 h-control-sm rounded border border-border-default bg-surface hover:bg-surface-elevated text-foreground-muted hover:text-foreground transition-colors text-xs"
                                  >
                                    ↺
                                  </button>
                                </div>
                              </div>
                              <div className="self-start">
                                <label className={labelCls}>Shelf Location</label>
                                <AdminSelect
                                  id={`location-${idx}`}
                                  value={it.location_id}
                                  onChange={v =>
                                    setReceiveItems(items =>
                                      items.map((r, i) => (i === idx ? { ...r, location_id: v } : r))
                                    )
                                  }
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
                      {it.serialized &&
                        parseFloat(it.receive_qty) > 0 &&
                        (() => {
                          const needed = serialsRequired(it)
                          const serials: string[] = Array.isArray(it.serial_numbers)
                            ? (it.serial_numbers as string[])
                            : []
                          const entered = serials.filter(Boolean).length
                          const serialSku = it.sku || it.product_sku
                          const autoSerial = () => generateSerialNumber(serialSku)
                          const updateSerial = (slotIdx: number, val: string) =>
                            setReceiveItems(items =>
                              items.map((r, i) => {
                                if (i !== idx) return r
                                const arr = [...(r.serial_numbers as string[])]
                                arr[slotIdx] = val
                                return { ...r, serial_numbers: arr }
                              })
                            )
                          return (
                            <tr className="bg-blue-50/60 dark:bg-blue-900/10 border-t border-blue-100 dark:border-blue-900/30">
                              <td colSpan={7} className="px-4 py-3">
                                <div>
                                  <div className="flex items-center justify-between mb-2">
                                    <label className={labelCls + ' mb-0'}>
                                      Serial Numbers
                                      <span className="ml-1 text-foreground-muted font-normal">
                                        ({needed} required)
                                      </span>
                                    </label>
                                    <div className="flex items-center gap-2">
                                      {entered === needed ? (
                                        <span className="text-xs text-green-600 dark:text-green-400">
                                          {entered}/{needed} entered ✓
                                        </span>
                                      ) : (
                                        <span className="text-xs text-amber-600 dark:text-amber-400">
                                          {entered}/{needed} entered
                                        </span>
                                      )}
                                      <button
                                        type="button"
                                        className="text-xs px-2 h-control-sm rounded border border-border-default bg-surface-elevated hover:bg-surface-hover text-foreground-secondary"
                                        onClick={() =>
                                          setReceiveItems(items =>
                                            items.map((r, i) => {
                                              if (i !== idx) return r
                                              return { ...r, serial_numbers: generateSerialRun(serialSku, needed) }
                                            })
                                          )
                                        }
                                      >
                                        Generate All
                                      </button>
                                    </div>
                                  </div>
                                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                                    {Array.from({ length: needed }, (_, n) => (
                                      <div key={n} className="flex gap-1">
                                        <input
                                          ref={el => {
                                            serialInputRefs.current[`${idx}:${n}`] = el
                                          }}
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
            <label className={labelCls}>
              Warehouse <span className="text-foreground-muted font-normal">(stock destination)</span>
            </label>
            <AdminSelect
              value={receiveWarehouseId}
              onChange={setReceiveWarehouseId}
              options={[{ value: '', label: '— none —' }, ...editWarehouses.map(w => ({ value: w.id, label: w.name }))]}
            />
            {receiveWarehouseId && (
              <p className="mt-1 text-xs text-foreground-muted">
                Stock with no specific bin will land on the open shelf. Override per-item below.
              </p>
            )}
          </div>
        )}
        <div>
          <label className={labelCls}>Notes</label>
          <textarea
            className={inputCls}
            rows={2}
            value={receiveNotes}
            onChange={e => setReceiveNotes(e.target.value)}
          />
        </div>
        <div className="flex gap-3">
          <button className={btnPrimary} onClick={submitReceive} disabled={receiveSaving}>
            {receiveSaving ? 'Saving...' : 'Confirm Receipt'}
          </button>
          <button
            className="control-sm border border-border-default text-foreground-secondary font-medium hover:bg-surface-secondary transition-colors"
            onClick={saveDraftAndExit}
            disabled={receiveSaving}
          >
            Save Draft
          </button>
          <button className={btnSecondary} onClick={cancelReceive}>
            Cancel
          </button>
        </div>
      </div>
    )
  }

  if (viewPO) {
    return (
      <div className="space-y-5">
        <div className="flex items-center gap-3">
          <button
            className="inline-flex items-center gap-1.5 text-sm text-foreground-secondary hover:text-foreground transition-colors"
            onClick={() => setViewPO(null)}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Back
          </button>
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-foreground">{viewPO.po.po_number}</h3>
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[viewPO.po.status] || ''}`}>
              {viewPO.po.status}
            </span>
            {poDaysLate(viewPO.po) > 0 && (
              <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
                {poDaysLate(viewPO.po)}d overdue
              </span>
            )}
          </div>
          <div className="ml-auto flex items-center gap-2">
            {viewPO.po.view_token && (
              <a
                href={documentUrlForLocation('purchaseorder', window.location, viewPO.po.view_token)}
                target="_blank"
                rel="noopener noreferrer"
                className={btnSecondary}
              >
                Open PO document
              </a>
            )}
            <RequireWrite scope="inventory">
              <Link href={ap(`/admin/purchase-orders/new?duplicate=${viewPO.po.id}`)} className={btnSecondary}>
                Duplicate
              </Link>
            </RequireWrite>
          </div>
        </div>
        <POProgress items={viewPO.items} />
        {['draft', 'sent', 'partial'].includes(viewPO.po.status) && (
          <RequireWrite scope="inventory">
            <ExpectedDateEditor
              poId={viewPO.po.id}
              value={viewPO.po.expected_date ? String(viewPO.po.expected_date).slice(0, 10) : ''}
              onSaved={v => {
                setViewPO(cur => (cur ? { ...cur, po: { ...cur.po, expected_date: v || null } } : cur))
                load(page)
              }}
            />
          </RequireWrite>
        )}
        {viewPO.po.notes && (
          <p className="text-sm text-foreground-secondary bg-surface-elevated border border-border-default rounded-xl px-4 py-3 whitespace-pre-wrap">
            {viewPO.po.notes}
          </p>
        )}
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
                  <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-secondary uppercase tracking-wide">
                    Product
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-secondary uppercase tracking-wide hidden sm:table-cell">
                    SKU
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-foreground-secondary uppercase tracking-wide">
                    Qty
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-foreground-secondary uppercase tracking-wide">
                    Unit Cost
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-foreground-secondary uppercase tracking-wide hidden sm:table-cell">
                    Tax %
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-foreground-secondary uppercase tracking-wide">
                    Total
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-foreground-secondary uppercase tracking-wide">
                    Received
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-default">
                {viewPO.items.map(it => {
                  const factor = parseFloat(it.purchase_unit_factor || '1')
                  const baseLabel = poBaseUnitLabel(it)
                  const puLabel = it.purchase_unit || baseLabel
                  const qtyInPu =
                    factor > 1 ? Math.round((parseFloat(it.quantity) / factor) * 1000) / 1000 : parseFloat(it.quantity)
                  const recvInPu =
                    factor > 1
                      ? Math.round((parseFloat(it.quantity_received || '0') / factor) * 1000) / 1000
                      : parseFloat(it.quantity_received || '0')
                  const recvFull = recvInPu >= qtyInPu
                  const recvPartial = recvInPu > 0 && !recvFull
                  return (
                    <tr key={it.id} className="hover:bg-surface-secondary/50 transition-colors">
                      <td className="px-4 py-3 text-foreground">
                        <p className="font-medium">
                          {it.product_name}
                          {it.variant_name && (
                            <span className="text-foreground-secondary font-normal"> / {it.variant_name}</span>
                          )}
                        </p>
                        {it.purchase_unit && (
                          <p className="text-xs text-foreground-muted mt-0.5">
                            {factor > 1 ? `1 ${it.purchase_unit} = ${factor} ${baseLabel}` : it.purchase_unit}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-foreground-secondary hidden sm:table-cell">
                        <span className="inline-flex items-center gap-1">
                          {it.sku || '—'}
                          {it.sku && <CopySku sku={it.sku} />}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-foreground-secondary">
                        {qtyInPu}
                        {puLabel && <span className="text-xs text-foreground-muted ml-1">{puLabel}</span>}
                      </td>
                      <td className="px-4 py-3 text-right text-foreground">{formatINR(parseFloat(it.unit_cost))}</td>
                      <td className="px-4 py-3 text-right text-foreground-secondary hidden sm:table-cell">
                        {it.tax_rate}%
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-foreground">
                        {formatINR(parseFloat(it.total_cost))}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span
                          className={`text-xs font-medium ${recvFull ? 'text-green-600 dark:text-green-400' : recvPartial ? 'text-yellow-600 dark:text-yellow-400' : 'text-foreground-secondary'}`}
                        >
                          {recvInPu} / {qtyInPu}
                          {puLabel && <span className="font-normal opacity-70 ml-1">{puLabel}</span>}
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
                  <div
                    key={grn.id}
                    className="bg-surface-elevated rounded-xl border border-border-default overflow-hidden"
                  >
                    <div className="flex items-center justify-between px-4 py-2.5 bg-surface-secondary border-b border-border-default">
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-xs font-semibold text-foreground">{grn.grn_number}</span>
                        <span className="text-xs text-foreground-secondary">{formatDate(grn.received_date)}</span>
                      </div>
                      {grn.notes && (
                        <span className="text-xs text-foreground-muted italic truncate max-w-xs">{grn.notes}</span>
                      )}
                    </div>
                    <div className="divide-y divide-border-default">
                      {grnItems.map((gi: any, idx: number) => {
                        const matchItem = viewPO.items.find((it: POItem) => it.id === gi.po_item_id)
                        const factor = parseFloat(gi.purchase_unit_factor || '1')
                        const recvBase = parseFloat(gi.quantity_received || '0')
                        const recvPu = factor > 1 ? Math.round((recvBase / factor) * 1000) / 1000 : recvBase
                        const puLabel =
                          matchItem?.purchase_unit ||
                          poBaseUnitLabel(matchItem || { sell_unit_label: '', sell_unit_dimension: '' })
                        const productLabel = matchItem ? grainLabel(matchItem) : `Item #${idx + 1}`
                        const taxRate = parseFloat(gi.tax_rate ?? matchItem?.tax_rate ?? '0')
                        const costPerPu = gi.unit_cost ? parseFloat(gi.unit_cost) * factor * (1 + taxRate / 100) : null
                        return (
                          <div key={idx} className="flex items-center justify-between px-4 py-2 text-sm">
                            <span className="text-foreground-secondary">{productLabel}</span>
                            <div className="flex items-center gap-4 text-right">
                              <span className="text-foreground font-medium">
                                {recvPu}
                                <span className="text-xs text-foreground-muted ml-1">{puLabel}</span>
                              </span>
                              {costPerPu != null && (
                                <span className="text-foreground-secondary text-xs">
                                  @ {formatINR(costPerPu)}/{puLabel}
                                </span>
                              )}
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
              <button className={btnPrimary} onClick={() => sendPO(viewPO.po.id)}>
                Mark as Sent
              </button>
              <button
                className="px-4 h-control rounded-lg text-sm font-medium bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-900/20 dark:text-red-400 dark:hover:bg-red-900/30 transition-colors"
                onClick={() => cancelPO(viewPO.po.id)}
              >
                Cancel PO
              </button>
            </div>
          </RequireWrite>
        )}
        {['sent', 'partial'].includes(viewPO.po.status) && (
          <RequireWrite scope="inventory">
            <div className="flex gap-3 pt-2">
              <button
                className={btnPrimary}
                onClick={() => {
                  setViewPO(null)
                  openReceive(viewPO.po.id)
                }}
              >
                Record Receipt
              </button>
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
          <svg
            className="w-4 h-4 text-accent-600 dark:text-accent-400 shrink-0"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-sm text-foreground flex-1">
            {lastReceivedSerials.length} serialized unit(s) received. Print labels to stick on each unit.
          </p>
          <button
            type="button"
            onClick={printReceivedSerialLabels}
            className="px-3 h-control-sm rounded-lg bg-accent-500 hover:bg-accent-600 text-white text-xs font-semibold transition-colors"
          >
            Print serial labels
          </button>
          <button
            type="button"
            onClick={() => setLastReceivedSerials([])}
            className="text-foreground-muted hover:text-foreground"
            title="Dismiss"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
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
            onChange={v => {
              setSearch(v)
              setPage(1)
            }}
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
            onChange={v => {
              setStatusFilter(v)
              setPage(1)
            }}
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
        <div className="w-52">
          <label className={labelCls}>Supplier</label>
          <AdminSelect
            sm
            className="[&_button]:h-9"
            value={supplierFilter}
            onChange={v => {
              setSupplierFilter(v)
              setPage(1)
            }}
            placeholder="All suppliers"
            options={[{ value: '', label: 'All suppliers' }, ...suppliers.map(s => ({ value: s.id, label: s.name }))]}
          />
        </div>
      </div>

      {poDrafts.length > 0 && (
        <div className="mb-3 rounded-lg border border-amber-200 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 px-3 py-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="text-xs font-medium text-amber-700 dark:text-amber-300">
              {poDrafts.length} draft{poDrafts.length === 1 ? '' : 's'} in progress — resume where you left off:
            </span>
            <div className="flex items-center gap-2 flex-wrap">
              {poDrafts.slice(0, 5).map(d => (
                <Link
                  key={d.id}
                  href={ap(`/admin/purchase-orders/new?draftId=${d.id}`)}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-amber-300 dark:border-amber-700 bg-surface text-xs text-foreground hover:bg-surface-secondary transition"
                >
                  <span className="font-medium">{d.supplier_name || 'No supplier'}</span>
                  <span className="text-foreground-muted">· {d.line_count} line{d.line_count === 1 ? '' : 's'}</span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="bg-surface-elevated rounded-xl border border-border-default p-4 space-y-3">
          <div className="h-5 w-32 bg-surface-secondary rounded animate-pulse" />
          <div className="h-12 w-full bg-surface-secondary rounded animate-pulse" />
          <div className="h-12 w-full bg-surface-secondary rounded animate-pulse" />
          <div className="h-12 w-full bg-surface-secondary rounded animate-pulse" />
        </div>
      ) : (
        <div className="bg-surface-elevated rounded-xl border border-border-default overflow-hidden">
          <div className="md:hidden p-4 space-y-3">
            {pos.length === 0 ? (
              <p className="py-8 text-center text-foreground-secondary text-sm">
                {search || statusFilter || supplierFilter ? 'No purchase orders match your filters' : 'No purchase orders yet'}
              </p>
            ) : (
              <PurchaseOrdersMobileList
                pos={sortedPOs}
                statusBadge={STATUS_BADGE}
                sendingEmailId={sendingEmailId}
                onView={openPO}
                onSend={sendPO}
                onReceive={openReceive}
                onSendEmail={sendPOEmail}
                onCancel={cancelPO}
              />
            )}
          </div>
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-secondary border-b border-border-default">
                <tr>
                  <SortableHeader
                    label="PO #"
                    column="po_number"
                    options={sortOptions('text')}
                    currentSort={poSortCol}
                    currentDir={poSortDir}
                    onSort={handlePoSort}
                  />
                  <SortableHeader
                    label="Supplier"
                    column="supplier"
                    options={sortOptions('text')}
                    currentSort={poSortCol}
                    currentDir={poSortDir}
                    onSort={handlePoSort}
                  />
                  <SortableHeader
                    label="Date"
                    column="date"
                    options={sortOptions('date')}
                    currentSort={poSortCol}
                    currentDir={poSortDir}
                    onSort={handlePoSort}
                    className="hidden sm:table-cell"
                  />
                  <SortableHeader
                    label="Expected"
                    column="expected"
                    options={sortOptions('date')}
                    currentSort={poSortCol}
                    currentDir={poSortDir}
                    onSort={handlePoSort}
                    className="hidden md:table-cell"
                  />
                  <SortableHeader
                    label="Items"
                    column="items"
                    options={sortOptions('number')}
                    currentSort={poSortCol}
                    currentDir={poSortDir}
                    onSort={handlePoSort}
                    className="hidden lg:table-cell"
                    align="right"
                  />
                  <SortableHeader
                    label="Total"
                    column="total"
                    options={sortOptions('number')}
                    currentSort={poSortCol}
                    currentDir={poSortDir}
                    onSort={handlePoSort}
                    align="right"
                  />
                  <SortableHeader
                    label="Status"
                    column="status"
                    options={sortOptions('text')}
                    currentSort={poSortCol}
                    currentDir={poSortDir}
                    onSort={handlePoSort}
                  />
                  <th className="px-4 py-3 text-right text-xs font-semibold text-foreground-secondary uppercase tracking-wide">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-default">
                {pos.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-foreground-secondary text-sm">
                      {search || statusFilter || supplierFilter ? 'No purchase orders match your filters' : 'No purchase orders yet'}
                    </td>
                  </tr>
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
                      <Link
                        href={ap(`/admin/suppliers/${po.supplier_id}/view`)}
                        className="hover:text-accent-500 hover:underline"
                      >
                        {po.supplier_name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-foreground-secondary whitespace-nowrap hidden sm:table-cell">
                      {formatDate(po.order_date)}
                    </td>
                    <td className="px-4 py-3 text-foreground-secondary whitespace-nowrap hidden md:table-cell">
                      {po.expected_date ? formatDate(po.expected_date) : '—'}
                      {poDaysLate(po) > 0 && (
                        <span className="ml-1.5 inline-flex px-1.5 py-0.5 rounded text-[10px] font-semibold bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
                          {poDaysLate(po)}d late
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-foreground-secondary hidden lg:table-cell">
                      {po.item_count}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-foreground">
                      {formatINR(parseFloat(po.total_amount))}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium capitalize ${STATUS_BADGE[po.status] || ''}`}
                      >
                        {po.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-3">
                        <button
                          className="text-xs text-secondary-500 dark:text-secondary-400 hover:underline font-medium"
                          onClick={() => openPO(po.id)}
                        >
                          View
                        </button>
                        <RequireWrite scope="inventory">
                          {po.status === 'draft' && (
                            <button
                              className="text-xs text-accent-500 hover:underline font-medium"
                              onClick={() => sendPO(po.id)}
                            >
                              Send
                            </button>
                          )}
                          {['sent', 'partial'].includes(po.status) && (
                            <button
                              className="text-xs text-green-600 dark:text-green-400 hover:underline font-medium"
                              onClick={() => openReceive(po.id)}
                            >
                              Receive
                            </button>
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
                                  <circle
                                    className="opacity-25"
                                    cx="12"
                                    cy="12"
                                    r="10"
                                    stroke="currentColor"
                                    strokeWidth={4}
                                  />
                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                                </svg>
                              ) : (
                                <svg
                                  className="w-3.5 h-3.5"
                                  fill="none"
                                  viewBox="0 0 24 24"
                                  stroke="currentColor"
                                  strokeWidth={2}
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                                  />
                                </svg>
                              )}
                            </button>
                          )}
                          {po.status === 'draft' && (
                            <button
                              className="text-xs text-red-500 hover:underline font-medium"
                              onClick={() => cancelPO(po.id)}
                            >
                              Cancel
                            </button>
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
            <ClientPagination
              page={page}
              total={total}
              pageSize={PAGE_SIZE}
              onChange={p => {
                setPage(p)
                setLoading(true)
              }}
            />
          </div>
        </div>
      )}
    </div>
  )
}
