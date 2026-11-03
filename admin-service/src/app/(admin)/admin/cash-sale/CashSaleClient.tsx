'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { productLabel, variantLabel } from '@/lib/catalog/product-label'
import { round2 } from '@/lib/catalog/gst'
import { useRouter, useSearchParams } from 'next/navigation'
import { useToast } from '@/contexts/ToastContext'
import { useConfirm } from '@/contexts/ConfirmContext'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import { FileText, ExternalLink, Plus, X } from 'lucide-react'
import { Badge, Dialog, EmptyState, Field, Fields, InfiniteFooter, ListFilters, SortTh, TableSkeleton, badgeCls, fetchJson, useActionToast, useFilterQuery, useInfiniteList, useListSort, type SortCol, type StatusMap } from '@/components/admin/kit'
import { TabAction, TabActionsPortal } from '@/components/admin/channels/ui'
import LineItemsSection, { newLineItem, fetchSeedLineItem, isBlankLine, validateDraftLines, type LineItem } from '@/components/admin/LineItemsSection'
import { useDraftLock } from '@/hooks/useDraftLock'
import { useAutosaveDraft } from '@/hooks/useAutosaveDraft'
import { DraftLockBanner, LockedFieldset } from '@/components/admin/kit/draft-lock'
import { assertDraftResponse, lockHeaders } from '@/lib/client/draft-lock-client'
import AutosaveStatusPill from '@/components/admin/AutosaveStatusPill'
import HoverCard from '@/components/ui/HoverCard'
import RowActions from '@/components/admin/RowActions'
import { ap } from '@/lib/shared/admin-path'
import BatchPickerModal, { type BatchPickerItem } from '@/components/admin/BatchPickerModal'
import SerialEntryModal, {
  type SerialItem,
  type SerialAssignment,
  SerialPicker,
} from '@/components/admin/SerialEntryModal'
import CashSaleMobileList from './_components/CashSaleMobileList'
import { CASH_SALE_ALIASES, CASH_SALE_FIELDS, CASH_SALE_SEARCH } from '@/lib/filters/fields/cash-sale'

const SORT_COLS: SortCol[] = [
  { key: 'invoice_number', label: 'Receipt No' },
  { key: 'invoice_date', label: 'Date', type: 'date' },
  { key: 'customer_name', label: 'Customer' },
  { key: 'total_amount', label: 'Amount', type: 'number' },
  { key: 'payment_status', label: 'Payment' },
]

interface CashSale {
  id: string
  order_number: string
  invoice_number: string | null
  invoice_date: string
  customer_name: string
  total_amount: string
  taxable_amount: string
  cgst_amount: string
  sgst_amount: string
  igst_amount: string
  payment_status: string
  status: string
  notes: string | null
  pdf_url: string | null
}

interface Receipt {
  invoiceNumber: string | null
  saleId: string
  invoiceUrl: string | null
  items: LineItem[]
  paymentMode: string
  notes: string
  subtotal: number
  tax: number
  total: number
}

export type View = 'list' | 'new' | 'receipt'

const PAYMENT_MODES = [
  { value: 'cash', label: 'Cash' },
  { value: 'upi', label: 'UPI' },
  { value: 'upi_qr', label: 'UPI (QR Scan)' },
]

// Cash-sale payment_status values; full kit badge classes so callers add nothing.
const CASH_PAYMENT_STATUS: StatusMap = {
  paid: { label: 'Paid', tone: 'green' },
  unpaid: { label: 'Unpaid', tone: 'amber' },
  refunded: { label: 'Refunded', tone: 'muted' },
  cancelled: { label: 'Cancelled', tone: 'red' },
}
const PAYMENT_COLORS: Record<string, string> = Object.fromEntries(Object.entries(CASH_PAYMENT_STATUS).map(([k, v]) => [k, badgeCls(v.tone)]))
const payCls = (s: string) => PAYMENT_COLORS[s] || badgeCls('muted')

const inputCls =
  'field-md w-full border border-border-secondary bg-surface text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-transparent'
const labelCls = 'block text-xs font-medium text-foreground-secondary mb-1'

function fmt(n: number) {
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDate(s: string) {
  if (!s) return ''
  return new Date(s).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

function calcTotals(items: LineItem[]) {
  let subtotal = 0
  let totalTax = 0
  items.forEach(it => {
    const unitPrice = parseFloat(String(it.unit_price || 0))
    const rawQty = parseFloat(String(it.quantity || 0))
    const gstRate = parseFloat(String(it.gst_rate || 18))
    const discPct = parseFloat(String(it.discount_pct || 0))
    const factor = it.sell_unit_dimension === 'count' && it.sell_unit_factor > 1 ? it.sell_unit_factor : 1
    const effectiveQty = rawQty * factor
    const mrpEx = unitPrice / (1 + gstRate / 100)
    const lineEx = effectiveQty * mrpEx * (1 - discPct / 100)
    const lineTax = (lineEx * gstRate) / 100
    subtotal += lineEx + lineTax
    totalTax += lineTax
  })
  return { subtotal: round2(subtotal), tax: round2(totalTax) }
}

// onViewChange lets the tabs wrapper drop the page title and tabs while a sale / receipt is open.
export default function CashSaleClient({ onViewChange }: { onViewChange?: (v: View) => void } = {}) {
  const { showToast } = useToast()
  const confirm = useConfirm()
  const canWrite = useCanWrite('invoices')
  const searchParams = useSearchParams()
  const router = useRouter()
  const [view, setView] = useState<View>('list')
  useEffect(() => {
    onViewChange?.(view)
  }, [view, onViewChange])

  const [selectedSale, setSelectedSale] = useState<CashSale | null>(null)
  const [cancellingId, setCancellingId] = useState<string | null>(null)
  // The list filters and sort live in the URL (from / to are the bill date).
  const filters = useFilterQuery(CASH_SALE_FIELDS, { aliases: CASH_SALE_ALIASES })
  const { sort, dir } = useListSort()

  const [paymentMode, setPaymentMode] = useState('cash')
  const [notes, setNotes] = useState('')
  const [items, setItems] = useState<LineItem[]>([newLineItem()])

  useEffect(() => {
    const pid = searchParams.get('product')
    if (!pid) return
    const vid = searchParams.get('variant')
    let cancelled = false
    fetchSeedLineItem(pid, vid).then(seed => {
      if (cancelled || !seed) return
      setItems(prev => (prev.length === 1 && !prev[0].product_id ? [seed] : [seed, ...prev]))
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [submitting, setSubmitting] = useState(false)
  const actionToast = useActionToast()
  // Validation and submit failures are toasts; '' clears nothing.
  const setFormError = (m: string) => m && actionToast.error(m)
  const [receipt, setReceipt] = useState<Receipt | null>(null)

  // Batch/serial assignment for perishable and serialized products
  const [batchPickerItem, setBatchPickerItem] = useState<BatchPickerItem | null>(null)
  const [batchAssignments, setBatchAssignments] = useState<Record<string, { batch_id: string; qty: number }[]>>({})
  const [assignedBatchLabels, setAssignedBatchLabels] = useState<Record<string, string>>({})
  const [serialAssignments, setSerialAssignments] = useState<SerialAssignment[]>([])
  const [serialPickerItems, setSerialPickerItems] = useState<SerialItem[] | null>(null)
  const [inlineSerialItems, setInlineSerialItems] = useState<Record<string, SerialItem>>({})

  // Prune serial assignments whose line was removed or whose product was cleared
  // (LineItemsSection doesn't notify on remove/clear). Keeps assignments in lockstep
  // with the current serialized lines so no orphan serial is submitted.
  useEffect(() => {
    const validIds = new Set(items.filter(it => it.product_id && it.serialized).map(it => it.id))
    setSerialAssignments(prev => {
      const next = prev.filter(sa => validIds.has(sa.order_item_id))
      return next.length === prev.length ? prev : next
    })
  }, [items])

  // A held bill: parked (no invoice number, no stock change) until Complete Sale.
  const [heldId, setHeldId] = useState<string | null>(null)
  const heldIdRef = useRef<string | null>(null)
  heldIdRef.current = heldId
  const [billLabel, setBillLabel] = useState('')
  const [holding, setHolding] = useState(false)
  // Hydrating writes nothing; completing stops autosave so it can't touch the removed bill.
  const skipSaveRef = useRef(false)
  const completingRef = useRef(false)

  function billBody() {
    return {
      label: billLabel.trim() || null,
      payment_mode: paymentMode as 'cash' | 'upi' | 'upi_qr',
      notes: notes || null,
      items: items.filter(it => !isBlankLine(it)),
      assignments: { batches: batchAssignments, batch_labels: assignedBatchLabels, serials: serialAssignments },
      total_estimate: calcTotals(items).subtotal,
    }
  }

  const lock = useDraftLock({ resourceType: 'cash_sale', resourceId: heldId })
  const autosave = useAutosaveDraft<ReturnType<typeof billBody>>({
    save: async (body, signal) => {
      const id = heldIdRef.current
      if (!id) return
      const res = await fetch(`/api/admin/invoices/cash-sale/drafts/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...lockHeaders('cash_sale', id) },
        credentials: 'include',
        signal,
        body: JSON.stringify(body),
      })
      await assertDraftResponse(res, 'Could not save the held bill')
    },
    enabled: () => !!heldIdRef.current && !completingRef.current && !lock.readOnly,
    onLocked: (_err, unsaved) => lock.markLocked(unsaved),
  })
  const triggerRef = useRef(autosave.trigger)
  triggerRef.current = autosave.trigger
  useEffect(() => {
    if (!heldId || view !== 'new') return
    if (skipSaveRef.current) {
      skipSaveRef.current = false
      return
    }
    triggerRef.current(billBody())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, paymentMode, notes, billLabel, batchAssignments, assignedBatchLabels, serialAssignments])

  // Resuming claims the bill so other cashiers see it being rung up.
  useEffect(() => {
    if (heldId && lock.loaded && lock.claimable && !lock.isMine) void lock.claim()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heldId, lock.loaded, lock.claimable])

  // ?draft=<id> resumes a held bill with today's stock levels.
  useEffect(() => {
    const id = searchParams.get('draft')
    if (!id || id === heldIdRef.current) return
    let cancelled = false
    ;(async () => {
      const res = await fetch(`/api/admin/invoices/cash-sale/drafts/${id}`, { credentials: 'include' })
      const j = await res.json().catch(() => ({}))
      if (cancelled) return
      if (!res.ok || !j.draft) {
        showToast(j.error || 'Could not open the held bill', 'error')
        router.replace(ap('/admin/cash-sale?tab=drafts'))
        return
      }
      const d = j.draft
      const lines: LineItem[] = Array.isArray(d.items) && d.items.length ? d.items : [newLineItem()]
      skipSaveRef.current = true
      completingRef.current = false
      setItems(lines)
      setPaymentMode(d.payment_mode || 'cash')
      setNotes(d.notes || '')
      setBillLabel(d.label || '')
      setBatchAssignments(d.assignments?.batches || {})
      setAssignedBatchLabels(d.assignments?.batch_labels || {})
      setSerialAssignments(d.assignments?.serials || [])
      setHeldId(id)
      setView('new')
      const fresh = await Promise.all(
        lines.map(it =>
          it.product_id && !it.sub_variant_id ? fetchSeedLineItem(it.product_id, it.variant_id).then(seed => [it.id, seed] as const) : null
        )
      )
      if (cancelled) return
      const stock = new Map(fresh.filter(f => f?.[1]).map(f => [f![0], f![1]!.inventory_quantity]))
      if (stock.size) {
        skipSaveRef.current = true
        setItems(prev => prev.map(it => (stock.has(it.id) ? { ...it, inventory_quantity: stock.get(it.id) ?? it.inventory_quantity } : it)))
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  // Back to the parked pile: unlocked, so any cashier can pick it up.
  async function parkBill(id: string) {
    await fetch(`/api/admin/draft-locks/cash_sale/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ action: 'release' }),
    }).catch(() => {})
  }

  function leaveEditor(tab?: 'drafts') {
    resetForm()
    setHeldId(null)
    setBillLabel('')
    setView('list')
    router.replace(ap(`/admin/cash-sale${tab ? `?tab=${tab}` : ''}`), { scroll: false })
  }

  async function holdBill() {
    const body = billBody()
    if (!body.items.length) return setFormError('Add an item before holding the bill')
    const issue = validateDraftLines(items)
    if (issue) return setFormError(issue)
    setHolding(true)
    try {
      const id = heldIdRef.current
      const park = !!id && lock.isMine
      if (id) await autosave.flush(body)
      else {
        const res = await fetch('/api/admin/invoices/cash-sale/drafts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(body),
        })
        const j = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(j.error || 'Could not hold the bill')
      }
      showToast('Bill held — resume it from Held bills', 'success')
      leaveEditor('drafts')
      if (park) await parkBill(id!)
    } catch (err: any) {
      setFormError(err.message || 'Could not hold the bill')
    } finally {
      setHolding(false)
    }
  }

  async function discardBill() {
    const id = heldIdRef.current
    if (!id) return
    const ok = await confirm({
      title: 'Discard held bill',
      message: 'Discard this held bill? Its items are not sold and nothing changes in stock.',
      confirmLabel: 'Discard',
      cancelLabel: 'Keep',
      variant: 'danger',
    })
    if (!ok) return
    completingRef.current = true
    const res = await fetch(`/api/admin/invoices/cash-sale/drafts/${id}`, { method: 'DELETE', credentials: 'include' })
    const j = await res.json().catch(() => ({}))
    if (!res.ok) {
      completingRef.current = false
      return setFormError(j.error || 'Could not discard the bill')
    }
    showToast('Held bill discarded', 'success')
    leaveEditor('drafts')
  }

  async function backFromEditor() {
    const id = heldIdRef.current
    if (!id) {
      resetForm()
      setView('list')
      return
    }
    const park = !lock.readOnly && lock.isMine
    if (!lock.readOnly) {
      try {
        await autosave.flush(billBody())
      } catch {
        /* the held copy keeps its last save */
      }
    }
    leaveEditor('drafts')
    if (park) await parkBill(id)
  }

  // Ordered server-side across all sales via ?sort&dir; 25 per page.
  const list = useInfiniteList<CashSale>({
    key: `${filters}|${sort}|${dir}`,
    pageSize: 25,
    getKey: s => s.id,
    fetchPage: async (p, signal) => {
      const params = new URLSearchParams(filters)
      if (sort) {
        params.set('sort', sort)
        params.set('dir', dir)
      }
      params.set('page', String(p))
      const data = await fetchJson(`/api/admin/cash-sale?${params}`, signal)
      return { rows: data.sales || [], total: data.total || 0 }
    },
  })
  const sales = list.rows
  const sortedSales = sales
  const loading = list.loading
  const fetchSales = list.reload

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectedSale(null)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  function resetForm() {
    setPaymentMode('cash')
    setNotes('')
    setItems([newLineItem()])
    setFormError('')
    setBatchAssignments({})
    setAssignedBatchLabels({})
    setSerialAssignments([])
    setSerialPickerItems(null)
    setBatchPickerItem(null)
  }

  async function cancelSale(id: string) {
    const ok = await confirm({
      title: 'Cancel Sale',
      message: 'Cancel this cash sale? Stock will be restocked. This action cannot be undone.',
      confirmLabel: 'Cancel Sale',
      cancelLabel: 'Keep',
      variant: 'danger',
    })
    if (!ok) return
    setCancellingId(id)
    try {
      const res = await fetch(`/api/admin/cash-sale/${id}/detail`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel' }),
      })
      const data = await res.json()
      if (!res.ok) {
        showToast(data.error || 'Failed to cancel', 'error')
        return
      }
      showToast('Cash sale cancelled and stock restored', 'success')
      fetchSales()
    } catch {
      showToast('Failed to cancel sale', 'error')
    } finally {
      setCancellingId(null)
    }
  }

  // Signature of what actually determines each line's serial requirement.
  const serialLineKey = items
    .filter(it => it.product_id && it.serialized)
    .map(
      it =>
        `${it.id}:${it.product_id}:${it.variant_id ?? ''}:${it.sub_variant_id ?? ''}:${it.quantity}:${it.sell_unit_factor ?? 1}`
    )
    .join('|')

  useEffect(() => {
    const serialLines = items.filter(it => it.product_id && it.serialized)
    if (serialLines.length === 0) {
      setInlineSerialItems({})
      return
    }
    let cancelled = false
    ;(async () => {
      const next: Record<string, SerialItem> = {}
      for (const item of serialLines) {
        const params = new URLSearchParams({
          product_id: item.product_id!,
          line_item_id: item.id,
          qty: String(
            (Number(item.quantity) || 1) *
              (item.sell_unit_factor && item.sell_unit_factor > 1 ? item.sell_unit_factor : 1)
          ),
        })
        if (item.variant_id) params.set('variant_id', item.variant_id)
        if (item.sub_variant_id) params.set('sub_variant_id', item.sub_variant_id)
        try {
          const res = await fetch(`/api/admin/inventory/batches/available?${params}`, { credentials: 'include' })
          const data = await res.json()
          const si = data.serialized_items?.[0]
          if (si) next[item.id] = si
        } catch {
          /* leave the line without an inline panel */
        }
      }
      if (!cancelled) setInlineSerialItems(next)
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serialLineKey])

  async function handleStockBadgeClick(item: LineItem) {
    if (!item.product_id) return
    const params = new URLSearchParams({
      product_id: item.product_id,
      line_item_id: item.id,
      qty: String(
        (Number(item.quantity) || 1) * (item.sell_unit_factor && item.sell_unit_factor > 1 ? item.sell_unit_factor : 1)
      ),
    })
    if (item.variant_id) params.set('variant_id', item.variant_id)
    if (item.sub_variant_id) params.set('sub_variant_id', item.sub_variant_id)
    const res = await fetch(`/api/admin/inventory/batches/available?${params}`, { credentials: 'include' })
    const data = await res.json()
    if (data.serialized_items?.length > 0) {
      // Pre-fill any serials already assigned to this line (e.g. auto-recorded from
      // a scan) so the modal only asks for the delta.
      const pre = serialAssignments.filter(sa => sa.order_item_id === item.id).map(sa => sa.serial_number)
      setSerialPickerItems(
        data.serialized_items.map((si: SerialItem) => (si.order_item_id === item.id ? { ...si, preassigned: pre } : si))
      )
    } else if (data.items?.length > 0) {
      setBatchPickerItem(data.items[0])
    }
  }

  // A serialized unit was added via a serial scan → auto-record it as this line's
  // assignment (so it doesn't re-prompt). Dedupe GLOBALLY by serial_number — a
  // physical unit can't belong to two lines.
  function handleSerialScanned(lineId: string, serial: { serial_number: string }) {
    setSerialAssignments(prev =>
      prev.some(sa => sa.serial_number === serial.serial_number)
        ? prev
        : [...prev, { order_item_id: lineId, serial_number: serial.serial_number }]
    )
  }

  // Quantity dropped below the assigned-serial count → trim the extra (tail)
  // assignments for that line so it doesn't over-assign.
  function handleQuantityReduced(lineId: string, keep: number) {
    setSerialAssignments(prev => {
      const forLine = prev.filter(sa => sa.order_item_id === lineId)
      if (forLine.length <= keep) return prev
      const trimmed = new Set(forLine.slice(keep).map(sa => sa.serial_number))
      return prev.filter(sa => !(sa.order_item_id === lineId && trimmed.has(sa.serial_number)))
    })
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (items.some(it => !it.product_name.trim() || !it.unit_price)) {
      setFormError('All items need a name and price')
      return
    }
    // Serialized lines need assignments. The exact count is base/qty_step, which
    // this form does not carry — the picker sets it and the server enforces it.
    const missingSerial = items.find(
      it => it.product_id && it.serialized && serialAssignments.filter(sa => sa.order_item_id === it.id).length === 0
    )
    if (missingSerial) {
      setFormError(`Serial numbers required for "${productLabel(missingSerial)}" — click the stock badge to assign`)
      return
    }
    // Validate perishable items have batch assignments
    const missingBatch = items.find(
      it => it.product_id && it.perishable && !it.serialized && !batchAssignments[it.id]?.length
    )
    if (missingBatch) {
      setFormError(`Batch assignment required for "${productLabel(missingBatch)}" — click the stock badge to assign`)
      return
    }
    const overstock = items.find(
      it => it.inventory_quantity !== null && Number(it.quantity) * (it.sell_unit_factor || 1) > it.inventory_quantity
    )
    if (overstock) {
      setFormError(
        `Insufficient stock for "${overstock.product_name}" — available: ${overstock.inventory_quantity}, required: ${overstock.quantity}`
      )
      return
    }
    setFormError('')
    setSubmitting(true)
    const draftId = heldIdRef.current
    completingRef.current = true
    try {
      const res = await fetch('/api/admin/invoices/cash-sale', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paymentMode,
          notes,
          items: items.map(it => ({
            product_id: it.product_id,
            product_name: it.product_name,
            product_sku: it.product_sku,
            variant_id: it.variant_id,
            sub_variant_id: it.sub_variant_id,
            variant_name: it.variant_name,
            hsn_code: it.hsn_code,
            gst_rate: it.gst_rate,
            quantity: it.quantity,
            buy_unit: it.buy_unit || null,
            unit: it.unit,
            unit_price: Number(it.mrp) > 0 ? Number(it.mrp) : Number(it.unit_price),
            discount_pct: Number(it.discount_pct) || 0,
            temp_id: it.id,
          })),
          batch_assignments: Object.entries(batchAssignments).flatMap(([order_item_id, batches]) =>
            batches.map(b => ({ order_item_id, batch_id: b.batch_id, qty: b.qty }))
          ),
          serial_assignments: serialAssignments,
          ...(draftId ? { draft_id: draftId } : {}),
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        completingRef.current = false
        if (res.status === 423) lock.markLocked()
        setFormError(data.error || 'Failed to create cash sale')
        return
      }
      const { subtotal, tax } = calcTotals(items)
      setReceipt({
        invoiceNumber: data.invoiceNumber,
        saleId: data.saleId,
        invoiceUrl: data.invoiceUrl,
        items: [...items],
        paymentMode,
        notes,
        subtotal,
        tax,
        total: subtotal,
      })
      showToast(data.invoiceNumber ? `Receipt ${data.invoiceNumber} created` : 'Cash sale recorded', 'success')
      resetForm()
      if (draftId) {
        setHeldId(null)
        setBillLabel('')
        router.replace(ap('/admin/cash-sale'), { scroll: false })
      }
      setView('receipt')
      fetchSales()
    } catch (err: any) {
      completingRef.current = false
      setFormError(err.message || 'Failed')
    } finally {
      setSubmitting(false)
    }
  }

  if (view === 'receipt' && receipt) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              setReceipt(null)
              setView('list')
            }}
            aria-label="Back to sales list"
            title="Back to sales list"
            className="p-2 text-foreground-secondary hover:text-foreground transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
          </button>
          <div>
            <h1 className="text-xl font-bold text-foreground">Receipt</h1>
            <p className="text-xs text-foreground-secondary mt-0.5">Cash sale completed</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-surface-elevated border border-border-default rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-border-default flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs text-foreground-muted uppercase tracking-wide">Receipt No</p>
                <p className="text-xl font-bold text-foreground font-mono mt-0.5 [overflow-wrap:anywhere]">
                  {receipt.invoiceNumber || 'Pending'}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs text-foreground-muted uppercase tracking-wide">Customer</p>
                <p className="text-sm font-semibold text-foreground mt-0.5">Walk-in Customer</p>
                <div className="flex gap-1.5 justify-end mt-1.5">
                  <Badge tone="green">Paid</Badge>
                  <span className={`${badgeCls('muted')} capitalize`}>
                    {receipt.paymentMode.replace(/_/g, ' ')}
                  </span>
                </div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border-default bg-surface-secondary/50 text-xs text-foreground-muted">
                    <th className="px-5 py-2.5 text-left font-medium">Item</th>
                    <th className="px-4 py-2.5 text-right font-medium">Qty</th>
                    <th className="px-4 py-2.5 text-right font-medium">Rate</th>
                    <th className="px-5 py-2.5 text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {receipt.items.map((item, i) => {
                    const qty = parseFloat(String(item.quantity || 0))
                    const price = parseFloat(String(item.unit_price || 0))
                    return (
                      <tr key={i} className="border-b border-border-default last:border-0">
                        <td className="px-5 py-3">
                          <p className="font-medium text-foreground">{item.product_name}</p>
                          {item.variant_name && (
                            <p className="text-xs text-foreground-muted mt-0.5">{variantLabel(item)}</p>
                          )}
                          {item.hsn_code && <p className="text-xs text-foreground-muted">HSN: {item.hsn_code}</p>}
                        </td>
                        <td className="px-4 py-3 text-right text-foreground-secondary">{qty}</td>
                        <td className="px-4 py-3 text-right text-foreground-secondary">₹{fmt(price)}</td>
                        <td className="px-5 py-3 text-right font-semibold text-foreground">₹{fmt(qty * price)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {receipt.notes && (
              <div className="px-5 py-3 border-t border-border-default">
                <p className="text-xs text-foreground-muted break-words">Notes: {receipt.notes}</p>
              </div>
            )}
          </div>

          <div className="space-y-4">
            <div className="bg-surface-elevated border border-border-default rounded-xl p-5 space-y-3">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-foreground">Summary</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between text-foreground-secondary">
                  <span>Subtotal (incl. tax)</span>
                  <span>₹{fmt(receipt.subtotal)}</span>
                </div>
                <div className="flex justify-between text-foreground-secondary">
                  <span>GST (18%)</span>
                  <span>₹{fmt(receipt.tax)}</span>
                </div>
                <div className="flex justify-between font-bold text-foreground text-base border-t border-border-default pt-2 mt-2">
                  <span>Total</span>
                  <span>₹{fmt(receipt.total)}</span>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              {receipt.invoiceUrl && (
                <a
                  href={receipt.invoiceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex min-h-10 items-center justify-center gap-2 rounded-lg bg-accent-500 px-4 text-sm font-semibold text-white transition-colors hover:bg-accent-600"
                >
                  <FileText className="h-4 w-4" />
                  Print / Download Receipt
                </a>
              )}
              <button
                onClick={() => {
                  setReceipt(null)
                  setView('new')
                }}
                className="hidden min-h-10 items-center justify-center rounded-lg bg-accent-500 px-4 text-sm font-semibold text-white transition-colors hover:bg-accent-600 md:inline-flex"
              >
                New Sale
              </button>
              <button
                onClick={() => {
                  setReceipt(null)
                  setView('list')
                }}
                className="min-h-10 rounded-lg border border-border-default px-4 text-sm font-medium text-foreground transition-colors hover:bg-surface-secondary"
              >
                View All Sales
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (view === 'new') {
    const { subtotal: liveSubtotal, tax: liveTax } = calcTotals(items)
    return (
      <div className="space-y-4">
        {batchPickerItem && (
          <BatchPickerModal
            items={[batchPickerItem]}
            onConfirm={assignments => {
              const map: Record<string, { batch_id: string; qty: number }[]> = { ...batchAssignments }
              const labelMap: Record<string, string> = { ...assignedBatchLabels }
              const byItem: Record<string, typeof assignments> = {}
              for (const a of assignments) {
                if (!byItem[a.order_item_id]) byItem[a.order_item_id] = []
                byItem[a.order_item_id].push(a)
              }
              for (const [order_item_id, itemAssignments] of Object.entries(byItem)) {
                map[order_item_id] = itemAssignments.map(a => ({ batch_id: a.batch_id, qty: a.qty }))
                const lots = itemAssignments.map(a => {
                  const batch = batchPickerItem?.batches.find(b => b.id === a.batch_id)
                  return batch?.lot_number || a.batch_id.slice(0, 8)
                })
                labelMap[order_item_id] = lots.join(', ')
              }
              setBatchAssignments(map)
              setAssignedBatchLabels(labelMap)
              setBatchPickerItem(null)
              // If serialized, prompt for serial numbers next
              const lineItem = items.find(it => it.id === Object.keys(byItem)[0])
              if (lineItem?.serialized) {
                const totalQty = assignments.reduce((s, a) => s + a.qty, 0)
                const step = batchPickerItem?.qty_step && batchPickerItem.qty_step > 0 ? batchPickerItem.qty_step : 1
                setSerialPickerItems([
                  {
                    order_item_id: lineItem.id,
                    product_name: lineItem.product_name,
                    variant_name: lineItem.variant_name || null,
                    required_qty: totalQty,
                    required_serials: Math.round(totalQty / step),
                    qty_step: step,
                    already_assigned: false,
                    preassigned: serialAssignments
                      .filter(sa => sa.order_item_id === lineItem.id)
                      .map(sa => sa.serial_number),
                    product_id: lineItem.product_id || undefined,
                    variant_id: lineItem.variant_id || null,
                    sub_variant_id: lineItem.sub_variant_id || null,
                  },
                ])
              }
            }}
            onCancel={() => setBatchPickerItem(null)}
          />
        )}
        {serialPickerItems && (
          <SerialEntryModal
            items={serialPickerItems}
            onConfirm={assignments => {
              setSerialAssignments(prev => {
                const itemIds = new Set(assignments.map(a => a.order_item_id))
                // Serials confirmed in this modal, so we can drop them from OTHER
                // lines too — a physical unit belongs to exactly one line.
                const confirmedSerials = new Set(assignments.map(a => a.serial_number))
                const kept = prev.filter(a => !itemIds.has(a.order_item_id) && !confirmedSerials.has(a.serial_number))
                return [...kept, ...assignments]
              })
              setSerialPickerItems(null)
            }}
            onCancel={() => setSerialPickerItems(null)}
          />
        )}
        <div className="flex items-center gap-3">
          <button
            onClick={backFromEditor}
            aria-label={heldId ? 'Back to held bills' : 'Back to sales list'}
            title={heldId ? 'Back to held bills' : 'Back to sales list'}
            className="p-2 text-foreground-secondary hover:text-foreground transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-bold text-foreground">{heldId ? `Held bill${billLabel.trim() ? ` · ${billLabel.trim()}` : ''}` : 'New Cash Sale'}</h1>
            <p className="text-foreground-secondary text-xs mt-0.5">Walk-in sale — no customer details required</p>
          </div>
          {heldId && <AutosaveStatusPill status={autosave.status} />}
        </div>
        {heldId && <DraftLockBanner lock={lock} scope="invoices:write" />}


        <form onSubmit={handleSubmit}>
          <LockedFieldset readOnly={lock.readOnly}>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2 space-y-4">
              <div className="bg-surface-elevated border border-border-default rounded-xl p-4">
                <LineItemsSection
                  items={items}
                  onChange={setItems}
                  onStockBadgeClick={handleStockBadgeClick}
                  assignedBatchLabels={assignedBatchLabels}
                  onSerialScanned={handleSerialScanned}
                  onQuantityReduced={handleQuantityReduced}
                  lineAssignmentSummary={item => {
                    const si = inlineSerialItems[item.id]
                    if (!si) return null
                    const needed = si.required_serials ?? si.required_qty
                    const have = serialAssignments.filter(sa => sa.order_item_id === item.id).length
                    return { label: `Serials — ${have} of ${needed} selected`, complete: have === needed }
                  }}
                  renderLineAssignment={item => {
                    const si = inlineSerialItems[item.id]
                    if (!si) return null
                    const mine = serialAssignments
                      .filter(sa => sa.order_item_id === item.id)
                      .map(sa => sa.serial_number)
                    const selected = new Set(mine)
                    return (
                      <SerialPicker
                        // Scanned serials reach the picker as `preassigned`: they may be
                        // reserved and so absent from the in-stock list, and scan mode
                        // seeds its fields from this.
                        item={{ ...si, preassigned: mine }}
                        selected={selected}
                        autoFill={false}
                        onChange={next =>
                          setSerialAssignments(prev => [
                            ...prev.filter(sa => sa.order_item_id !== item.id),
                            ...Array.from(next).map(sn => ({ order_item_id: item.id, serial_number: sn })),
                          ])
                        }
                      />
                    )
                  }}
                />
              </div>

              <div className="bg-surface-elevated border border-border-default rounded-xl p-4">
                <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-foreground">Payment Mode</h2>
                <div className="flex flex-wrap gap-2">
                  {PAYMENT_MODES.map(m => (
                    <label
                      key={m.value}
                      className={`flex min-h-10 flex-1 min-w-[7rem] cursor-pointer items-center gap-2 rounded-lg border px-4 transition-colors ${
                        paymentMode === m.value ? 'border-accent-500 bg-accent-500/10 text-foreground' : 'border-border-default bg-surface-secondary text-foreground-secondary hover:border-accent-500/50'
                      }`}
                    >
                      <input
                        type="radio"
                        name="paymentMode"
                        value={m.value}
                        checked={paymentMode === m.value}
                        onChange={() => setPaymentMode(m.value)}
                        className="shrink-0 accent-accent-500"
                      />
                      <span className="text-sm font-medium">{m.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="bg-surface-elevated border border-border-default rounded-xl p-4">
                <label className={labelCls}>Notes (optional)</label>
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  rows={3}
                  className={inputCls + ' resize-none'}
                  placeholder="Any remarks for this sale..."
                />
              </div>
            </div>

            <div className="space-y-4">
              <div className="bg-surface-elevated border border-border-default rounded-xl p-5 sticky top-4">
                <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-foreground">Order Summary</h3>
                <div className="space-y-2 text-sm mb-4">
                  <div className="flex justify-between text-foreground-secondary">
                    <span>Items ({items.filter(it => it.product_name).length})</span>
                    <span>₹{fmt(liveSubtotal)}</span>
                  </div>
                  <div className="flex justify-between text-foreground-secondary">
                    <span>GST (est.)</span>
                    <span>₹{fmt(liveTax)}</span>
                  </div>
                  <div className="flex justify-between font-bold text-foreground text-lg border-t border-border-default pt-3 mt-2">
                    <span>Total</span>
                    <span>₹{fmt(liveSubtotal)}</span>
                  </div>
                </div>
                <div className="pt-2 border-t border-border-default">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-2 h-2 rounded-full bg-green-500" />
                    <span className="text-xs text-foreground-muted">Walk-in Customer</span>
                  </div>
                  {canWrite && (
                    <>
                      <input
                        value={billLabel}
                        onChange={e => setBillLabel(e.target.value)}
                        maxLength={80}
                        aria-label="Bill name"
                        placeholder="Name this bill (optional)"
                        className={inputCls + ' mb-3'}
                      />
                      <button
                        type="submit"
                        disabled={submitting || holding}
                        className="w-full rounded-xl bg-accent-500 py-3 text-sm font-bold text-white transition-colors hover:bg-accent-600 disabled:opacity-50"
                      >
                        {submitting ? 'Processing…' : 'Complete Sale'}
                      </button>
                      <button
                        type="button"
                        onClick={holdBill}
                        disabled={submitting || holding}
                        title="Park this bill without an invoice number or a stock change"
                        className="mt-2 w-full rounded-xl border border-border-default py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-surface-secondary disabled:opacity-50"
                      >
                        {holding ? 'Holding…' : 'Hold Bill'}
                      </button>
                      {heldId && (
                        <button
                          type="button"
                          onClick={discardBill}
                          disabled={submitting || holding}
                          className="mt-2 w-full py-1.5 text-xs font-medium text-red-600 hover:underline disabled:opacity-50 dark:text-red-400"
                        >
                          Discard bill
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
          </LockedFieldset>
        </form>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {canWrite && (
        <TabActionsPortal>
          <TabAction
            onClick={() => {
              resetForm()
              setView('new')
            }}
            icon={<Plus className="w-4 h-4" />}
            label="New Cash Sale"
          />
        </TabActionsPortal>
      )}

      <ListFilters
        entity="cash_sale"
        fields={CASH_SALE_FIELDS}
        aliases={CASH_SALE_ALIASES}
        search={CASH_SALE_SEARCH}
        noun="Cash sales"
        tab="list"
        exportable
      />

      <div className="bg-surface-elevated border border-border-default rounded-xl overflow-hidden">
        {loading ? (
          <TableSkeleton rows={8} cols={6} />
        ) : sales.length === 0 ? (
          <EmptyState bare title={filters ? 'No cash sales match these filters.' : 'No cash sales found.'} />
        ) : (
          <>
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border-default bg-surface-secondary/50">
                    {SORT_COLS.map(c => (
                      <SortTh key={c.key} col={c} className="px-4 py-3 text-xs font-semibold text-foreground-secondary" />
                    ))}
                    <th className="px-4 py-3 text-right text-xs font-semibold text-foreground-secondary">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedSales.map(sale => (
                    <tr
                      key={sale.id}
                      className="cursor-pointer border-b border-border-default/60 transition-colors last:border-0 hover:bg-surface-secondary/60"
                      onClick={() => setSelectedSale(sale)}
                    >
                      <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                        <HoverCard
                          trigger={
                            sale.invoice_number ? (
                              <a
                                href={ap(`/admin/cash-sale/${sale.id}/view`)}
                                className="font-mono font-semibold text-sm text-accent-500 hover:text-accent-600 underline decoration-dotted underline-offset-2"
                              >
                                {sale.invoice_number}
                              </a>
                            ) : (
                              <span className="font-mono text-xs text-foreground-muted underline decoration-dotted underline-offset-2 cursor-default">
                                —
                              </span>
                            )
                          }
                          align="left"
                          side="bottom"
                          width="260px"
                        >
                          <div className="p-3 space-y-2">
                            <p className="font-mono font-semibold text-foreground text-sm">
                              {sale.invoice_number || sale.order_number}
                            </p>
                            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                              <span className="text-foreground-muted">Customer</span>
                              <span className="text-foreground font-medium">Walk-in Customer</span>
                              <span className="text-foreground-muted">Date</span>
                              <span className="text-foreground">{fmtDate(sale.invoice_date)}</span>
                              <span className="text-foreground-muted">Total</span>
                              <span className="text-foreground font-semibold">
                                ₹{fmt(parseFloat(sale.total_amount))}
                              </span>
                              <span className="text-foreground-muted">Payment</span>
                              <span
                                className={`font-medium ${sale.payment_status === 'paid' ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400'}`}
                              >
                                {sale.payment_status}
                              </span>
                            </div>
                          </div>
                        </HoverCard>
                        <div className="text-xs text-foreground-muted mt-0.5 font-mono">{sale.order_number}</div>
                      </td>
                      <td className="px-4 py-3 text-foreground-secondary whitespace-nowrap text-sm">
                        {fmtDate(sale.invoice_date)}
                      </td>
                      <td className="px-4 py-3 text-sm text-foreground">Walk-in Customer</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="font-semibold text-foreground text-sm">
                          ₹
                          {parseFloat(sale.total_amount).toLocaleString('en-IN', {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </div>
                        {parseFloat(sale.taxable_amount) > 0 && (
                          <div className="text-xs text-foreground-muted mt-0.5">
                            Taxable ₹
                            {parseFloat(sale.taxable_amount).toLocaleString('en-IN', {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={payCls(sale.payment_status)}>{sale.payment_status}</span>
                        {sale.status === 'cancelled' && <span className={`ml-1 ${badgeCls('red')}`}>Cancelled</span>}
                      </td>
                      <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                        <RowActions
                          size="sm"
                          actions={[
                            {
                              key: 'receipt',
                              kind: 'download',
                              label: 'Download Receipt PDF',
                              href: `/api/admin/cash-sale/${sale.id}/receipt`,
                              target: '_blank',
                            },
                            {
                              key: 'view',
                              kind: 'view',
                              label: 'View Detail',
                              href: ap(`/admin/cash-sale/${sale.id}/view`),
                            },
                            {
                              key: 'cancel',
                              kind: 'revoke',
                              label: 'Cancel Sale',
                              variant: 'danger',
                              danger: false,
                              hidden: sale.status === 'cancelled' || !canWrite,
                              busy: cancellingId === sale.id,
                              disabled: cancellingId === sale.id,
                              onSelect: () => cancelSale(sale.id),
                            },
                          ]}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="md:hidden p-4 pt-0 space-y-3">
              <CashSaleMobileList
                sales={sortedSales}
                canWrite={canWrite}
                cancellingId={cancellingId}
                paymentColors={PAYMENT_COLORS}
                onCancel={cancelSale}
              />
            </div>
          </>
        )}
      </div>

      <InfiniteFooter shown={sales.length} control={list} noun="sales" />

      {selectedSale && (
        <SaleDetailModal
          sale={selectedSale}
          onClose={() => setSelectedSale(null)}
          onCancelled={() => {
            setSelectedSale(null)
            fetchSales()
          }}
        />
      )}
    </div>
  )
}

function SaleDetailModal({
  sale,
  onClose,
  onCancelled,
}: {
  sale: CashSale
  onClose: () => void
  onCancelled: () => void
}) {
  const { showToast } = useToast()
  const confirm = useConfirm()
  const canWrite = useCanWrite('invoices')
  const [cancelling, setCancelling] = useState(false)

  async function handleCancel() {
    const ok = await confirm({
      title: 'Cancel Sale',
      message: 'Cancel this cash sale? Stock will be restocked. This action cannot be undone.',
      confirmLabel: 'Cancel Sale',
      cancelLabel: 'Keep',
      variant: 'danger',
    })
    if (!ok) return
    setCancelling(true)
    try {
      const res = await fetch(`/api/admin/cash-sale/${sale.id}/detail`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel' }),
      })
      const data = await res.json()
      if (!res.ok) {
        showToast(data.error || 'Failed to cancel', 'error')
        return
      }
      showToast('Cash sale cancelled and stock restored', 'success')
      onCancelled()
    } catch {
      showToast('Failed to cancel sale', 'error')
    } finally {
      setCancelling(false)
    }
  }

  const isCancelled = sale.status === 'cancelled'
  const inr2 = (v: string) => parseFloat(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const linkCls = 'control-md border border-border-default text-foreground hover:bg-surface-secondary'
  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      zIndex="z-[300]"
      title={<span className="font-mono">{sale.invoice_number || sale.order_number}</span>}
      description={new Date(sale.invoice_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
      footer={
        <>
          <a href={`/api/admin/cash-sale/${sale.id}/receipt`} target="_blank" rel="noopener noreferrer" className={linkCls}>
            <FileText className="h-4 w-4" />
            Receipt PDF
          </a>
          <a href={ap(`/admin/orders/${sale.id}/view`)} className={linkCls}>
            <ExternalLink className="h-4 w-4" />
            View Order
          </a>
          {!isCancelled && canWrite && (
            <button
              type="button"
              onClick={handleCancel}
              disabled={cancelling}
              className="control-md mr-auto border border-red-500/40 text-red-600 hover:bg-red-500/10 disabled:opacity-50 dark:text-red-400 sm:order-first"
            >
              <X className="h-4 w-4" />
              {cancelling ? 'Cancelling…' : 'Cancel Sale'}
            </button>
          )}
        </>
      }
    >
      <div className="space-y-5">
        <div className="flex flex-wrap gap-2">
          <span className={payCls(sale.payment_status)}>{sale.payment_status}</span>
          <Badge>Cash Sale</Badge>
          {sale.status === 'cancelled' && <Badge tone="red">Cancelled</Badge>}
        </div>
        <Fields>
          <Field label="Customer" value="Walk-in Customer" />
          <Field label="Order" value={sale.order_number} mono />
        </Fields>
        <div className="grid grid-cols-2 gap-3 rounded-lg bg-surface-secondary p-3 sm:grid-cols-4 [&>*:last-child:nth-child(odd)]:col-span-2 sm:[&>*:last-child:nth-child(odd)]:col-span-1">
          <Field label="Taxable" value={`₹${inr2(sale.taxable_amount)}`} />
          {parseFloat(sale.cgst_amount) > 0 && <Field label="CGST + SGST" value={`₹${inr2(sale.cgst_amount)} + ₹${inr2(sale.sgst_amount)}`} />}
          <Field label="Total" value={<span className="font-bold">₹{inr2(sale.total_amount)}</span>} />
        </div>
        {sale.notes && (
          <Fields cols={1}>
            <Field label="Notes" value={sale.notes} />
          </Fields>
        )}
      </div>
    </Dialog>
  )
}
