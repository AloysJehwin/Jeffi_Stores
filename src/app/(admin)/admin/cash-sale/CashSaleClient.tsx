'use client'

import { useState, useEffect, useCallback } from 'react'
import { productLabel, variantLabel } from '@/lib/catalog/product-label'
import { round2 } from '@/lib/catalog/gst'
import { useSearchParams, useRouter } from 'next/navigation'
import { createPortal } from 'react-dom'
import { useToast } from '@/contexts/ToastContext'
import { useConfirm } from '@/contexts/ConfirmContext'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import AdminSelect from '@/components/admin/AdminSelect'
import AdminTypeahead from '@/components/admin/AdminTypeahead'
import DatePicker from '@/components/ui/DatePicker'
import SortableHeader, { sortOptions, type SortDir } from '@/components/admin/SortableHeader'
import LineItemsSection, { newLineItem, fetchSeedLineItem, type LineItem } from '@/components/admin/LineItemsSection'
import HoverCard from '@/components/ui/HoverCard'
import { ap } from '@/lib/shared/admin-path'
import BatchPickerModal, { type BatchPickerItem } from '@/components/admin/BatchPickerModal'
import SerialEntryModal, {
  type SerialItem,
  type SerialAssignment,
  SerialPicker,
} from '@/components/admin/SerialEntryModal'
import CashSaleMobileList from './_components/CashSaleMobileList'

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

type View = 'list' | 'new' | 'receipt'

const PAYMENT_MODES = [
  { value: 'cash', label: 'Cash' },
  { value: 'upi', label: 'UPI' },
  { value: 'upi_qr', label: 'UPI (QR Scan)' },
]

const PAYMENT_COLORS: Record<string, string> = {
  paid: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  unpaid: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  refunded: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
  cancelled: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
}

const inputCls =
  'field-sm w-full border border-border-default bg-surface-secondary text-foreground focus:outline-none focus:ring-1 focus:ring-secondary-500 dark:focus:ring-secondary-400'
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

export default function CashSaleClient() {
  const { showToast } = useToast()
  const confirm = useConfirm()
  const canWrite = useCanWrite('invoices')
  const searchParams = useSearchParams()
  const router = useRouter()
  const [view, setView] = useState<View>('list')

  const [sales, setSales] = useState<CashSale[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [selectedSale, setSelectedSale] = useState<CashSale | null>(null)
  const [cancellingId, setCancellingId] = useState<string | null>(null)
  const [paymentFilter, setPaymentFilter] = useState(searchParams.get('payment') || '')
  const [fromDate, setFromDate] = useState(searchParams.get('from') || '')
  const [toDate, setToDate] = useState(searchParams.get('to') || '')
  const [searchQ, setSearchQ] = useState(searchParams.get('search') || '')
  const [searchInput, setSearchInput] = useState(searchParams.get('search') || '')
  const [sortCol, setSortCol] = useState<string | undefined>(undefined)
  const [sortDir, setSortDir] = useState<SortDir | undefined>(undefined)

  function syncUrl(patch: Record<string, string>) {
    const p = new URLSearchParams(window.location.search)
    for (const [k, v] of Object.entries(patch)) {
      if (v) p.set(k, v)
      else p.delete(k)
    }
    router.replace(ap(`/admin/cash-sale?${p.toString()}`), { scroll: false })
  }

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
  const [formError, setFormError] = useState('')
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

  const totalPages = Math.ceil(total / 25)

  const SORT_KEYS: Record<string, keyof CashSale> = {
    invoice_number: 'invoice_number',
    date: 'invoice_date',
    amount: 'total_amount',
    payment: 'payment_status',
  }

  // Ordered server-side across all sales via sort/dir params.
  const sortedSales = sales

  const fetchSales = useCallback(
    async (p = 1) => {
      setLoading(true)
      try {
        const params = new URLSearchParams()
        if (paymentFilter) params.set('payment', paymentFilter)
        if (fromDate) params.set('from', fromDate)
        if (toDate) params.set('to', toDate)
        if (searchQ) params.set('search', searchQ)
        if (sortCol && SORT_KEYS[sortCol]) {
          params.set('sort', SORT_KEYS[sortCol])
          params.set('dir', sortDir || 'desc')
        }
        params.set('page', String(p))
        const res = await fetch(`/api/admin/cash-sale?${params}`, { credentials: 'include' })
        if (!res.ok) throw new Error('Failed')
        const data = await res.json()
        setSales(data.sales || [])
        setTotal(data.total || 0)
        setPage(p)
      } catch {
        showToast('Failed to load cash sales', 'error')
      } finally {
        setLoading(false)
      }
    },
    [paymentFilter, fromDate, toDate, searchQ, sortCol, sortDir, showToast]
  )

  useEffect(() => {
    fetchSales(1)
  }, [paymentFilter, fromDate, toDate, searchQ, sortCol, sortDir])

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
      fetchSales(page)
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
    if (items.some(it => !it.product_id)) {
      setFormError('All items must be selected from inventory — free-typed names are not allowed')
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
            unit_price: Number(it.mrp) > 0 ? Number(it.mrp) : Number(it.unit_price),
            discount_pct: Number(it.discount_pct) || 0,
            temp_id: it.id,
          })),
          batch_assignments: Object.entries(batchAssignments).flatMap(([order_item_id, batches]) =>
            batches.map(b => ({ order_item_id, batch_id: b.batch_id, qty: b.qty }))
          ),
          serial_assignments: serialAssignments,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
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
      setView('receipt')
      fetchSales(1)
    } catch (err: any) {
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
            <div className="px-5 py-4 border-b border-border-default flex items-start justify-between">
              <div>
                <p className="text-xs text-foreground-muted uppercase tracking-wide">Receipt No</p>
                <p className="text-xl font-bold text-foreground font-mono mt-0.5">
                  {receipt.invoiceNumber || 'Pending'}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs text-foreground-muted uppercase tracking-wide">Customer</p>
                <p className="text-sm font-semibold text-foreground mt-0.5">Walk-in Customer</p>
                <div className="flex gap-1.5 justify-end mt-1.5">
                  <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">
                    Paid
                  </span>
                  <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-surface border border-border-default text-foreground-secondary capitalize">
                    {receipt.paymentMode.replace(/_/g, ' ')}
                  </span>
                </div>
              </div>
            </div>

            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-default bg-surface-secondary">
                  <th className="px-5 py-2.5 text-left text-xs font-semibold text-foreground-secondary">Item</th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold text-foreground-secondary">Qty</th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold text-foreground-secondary">Rate</th>
                  <th className="px-5 py-2.5 text-right text-xs font-semibold text-foreground-secondary">Amount</th>
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

            {receipt.notes && (
              <div className="px-5 py-3 border-t border-border-default">
                <p className="text-xs text-foreground-muted">Notes: {receipt.notes}</p>
              </div>
            )}
          </div>

          <div className="space-y-4">
            <div className="bg-surface-elevated border border-border-default rounded-xl p-5 space-y-3">
              <h3 className="text-sm font-semibold text-foreground">Summary</h3>
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
                  className="flex items-center justify-center gap-2 px-4 py-2.5 bg-secondary-500 hover:bg-secondary-600 text-white rounded-lg text-sm font-semibold transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                    />
                  </svg>
                  Print / Download Receipt
                </a>
              )}
              <button
                onClick={() => {
                  setReceipt(null)
                  setView('new')
                }}
                className="px-4 py-2.5 bg-secondary-500 hover:bg-secondary-600 dark:bg-secondary-400 dark:hover:bg-secondary-300 dark:text-secondary-900 text-white rounded-lg text-sm font-semibold transition-colors"
              >
                New Sale
              </button>
              <button
                onClick={() => {
                  setReceipt(null)
                  setView('list')
                }}
                className="px-4 py-2.5 border border-border-default rounded-lg text-sm font-medium text-foreground hover:bg-surface-secondary transition-colors"
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
            onClick={() => {
              resetForm()
              setView('list')
            }}
            className="p-2 text-foreground-secondary hover:text-foreground transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
          </button>
          <div>
            <h1 className="text-xl font-bold text-foreground">New Cash Sale</h1>
            <p className="text-foreground-secondary text-xs mt-0.5">Walk-in sale — no customer details required</p>
          </div>
        </div>

        {formError && (
          <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-300 text-sm">
            {formError}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 space-y-4">
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
                <h2 className="text-sm font-semibold text-foreground mb-3">Payment Mode</h2>
                <div className="flex flex-wrap gap-2">
                  {PAYMENT_MODES.map(m => (
                    <label
                      key={m.value}
                      className={`flex items-center gap-2 px-4 py-2 rounded-lg border cursor-pointer transition-colors ${
                        paymentMode === m.value
                          ? 'border-secondary-500 dark:border-secondary-400 bg-secondary-50 dark:bg-secondary-700/30 text-secondary-700 dark:text-secondary-200'
                          : 'border-border-default bg-surface-secondary text-foreground-secondary hover:border-secondary-400 dark:hover:border-secondary-500'
                      }`}
                    >
                      <input
                        type="radio"
                        name="paymentMode"
                        value={m.value}
                        checked={paymentMode === m.value}
                        onChange={() => setPaymentMode(m.value)}
                        className="accent-secondary-500 shrink-0"
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
                <h3 className="text-sm font-semibold text-foreground mb-4">Order Summary</h3>
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
                    <button
                      type="submit"
                      disabled={submitting}
                      className="w-full py-3 bg-secondary-500 hover:bg-secondary-600 dark:bg-secondary-400 dark:hover:bg-secondary-300 dark:text-secondary-900 text-white rounded-xl text-sm font-bold disabled:opacity-50 transition-colors"
                    >
                      {submitting ? 'Processing…' : 'Complete Sale'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </form>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-2">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-secondary-500 dark:text-foreground">Cash Sales</h1>
          <p className="text-foreground-secondary mt-1 text-sm">Walk-in sales — no customer details</p>
        </div>
        {canWrite && (
          <button
            onClick={() => {
              resetForm()
              setView('new')
            }}
            className="flex items-center gap-2 px-4 py-2 bg-secondary-500 hover:bg-secondary-600 dark:bg-secondary-400 dark:hover:bg-secondary-300 dark:text-secondary-900 text-white rounded-lg text-sm font-semibold transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            New Cash Sale
          </button>
        )}
      </div>

      <div className="bg-surface-elevated border border-border-default rounded-xl p-4 space-y-3">
        <div className="flex flex-wrap gap-2 items-center">
          <div className="flex-1 min-w-[200px]">
            <AdminTypeahead
              type="invoices"
              value={searchInput}
              onChange={setSearchInput}
              onSelect={item => {
                setSearchInput(item.label)
                setSearchQ(item.label)
                syncUrl({ search: item.label })
              }}
              onEnter={val => {
                setSearchQ(val)
                syncUrl({ search: val })
              }}
              placeholder="Search receipt no, order no…"
              inputClassName={inputCls + ' pr-9'}
            />
          </div>
          <button
            onClick={() => {
              setSearchQ(searchInput)
              syncUrl({ search: searchInput })
            }}
            className="control-sm border border-transparent bg-secondary-500 hover:bg-secondary-600 dark:bg-secondary-400 dark:hover:bg-secondary-300 dark:text-secondary-900 text-white font-medium transition-colors"
          >
            Search
          </button>
          {(searchQ || paymentFilter || fromDate || toDate) && (
            <button
              onClick={() => {
                setSearchQ('')
                setSearchInput('')
                setPaymentFilter('')
                setFromDate('')
                setToDate('')
                syncUrl({ search: '', payment: '', from: '', to: '' })
              }}
              className="control-sm border border-border-default text-foreground-secondary hover:bg-surface-secondary transition-colors"
            >
              Clear
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <AdminSelect
            sm
            value={paymentFilter}
            onChange={v => {
              setPaymentFilter(v)
              syncUrl({ payment: v })
            }}
            placeholder="All Payments"
            options={[
              { value: 'paid', label: 'Paid' },
              { value: 'refunded', label: 'Refunded' },
              { value: 'cancelled', label: 'Cancelled' },
            ]}
          />
          <div className="flex items-center gap-2">
            <DatePicker
              className="w-36"
              value={fromDate}
              onChange={v => {
                setFromDate(v)
                syncUrl({ from: v })
              }}
            />
            <span className="text-foreground-secondary text-xs">to</span>
            <DatePicker
              className="w-36"
              value={toDate}
              onChange={v => {
                setToDate(v)
                syncUrl({ to: v })
              }}
            />
          </div>
        </div>
      </div>

      <div className="bg-surface-elevated border border-border-default rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-4 space-y-2">
            {[...Array(8)].map((_, i) => (
              <div
                key={i}
                className="flex items-center gap-3 px-2 py-1 animate-pulse"
                style={{ animationDelay: `${i * 50}ms` }}
              >
                <div className="h-4 w-24 bg-surface-secondary rounded" />
                <div className="h-4 w-20 bg-surface-secondary rounded" />
                <div className="h-4 flex-1 bg-surface-secondary rounded" />
                <div className="h-4 w-20 bg-surface-secondary rounded" />
                <div className="h-4 w-16 bg-surface-secondary rounded" />
                <div className="h-4 w-16 bg-surface-secondary rounded" />
              </div>
            ))}
          </div>
        ) : sales.length === 0 ? (
          <div className="p-12 text-center text-foreground-muted text-sm">No cash sales found.</div>
        ) : (
          <>
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border-default bg-surface-secondary">
                    <SortableHeader
                      label="Receipt No"
                      column="invoice_number"
                      options={sortOptions('text')}
                      onSort={(c, d) => {
                        setSortCol(c)
                        setSortDir(d)
                      }}
                      currentSort={sortCol}
                      currentDir={sortDir}
                    />
                    <SortableHeader
                      label="Date"
                      column="date"
                      options={sortOptions('date')}
                      onSort={(c, d) => {
                        setSortCol(c)
                        setSortDir(d)
                      }}
                      currentSort={sortCol}
                      currentDir={sortDir}
                    />
                    <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-secondary">Customer</th>
                    <SortableHeader
                      label="Amount"
                      column="amount"
                      options={sortOptions('number')}
                      onSort={(c, d) => {
                        setSortCol(c)
                        setSortDir(d)
                      }}
                      currentSort={sortCol}
                      currentDir={sortDir}
                    />
                    <SortableHeader
                      label="Payment"
                      column="payment"
                      options={sortOptions('text')}
                      onSort={(c, d) => {
                        setSortCol(c)
                        setSortDir(d)
                      }}
                      currentSort={sortCol}
                      currentDir={sortDir}
                    />
                    <th className="px-4 py-3 text-right text-xs font-semibold text-foreground-secondary">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedSales.map(sale => (
                    <tr
                      key={sale.id}
                      className="border-b border-border-default hover:bg-surface-secondary transition-colors cursor-pointer"
                      onClick={() => setSelectedSale(sale)}
                    >
                      <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                        <HoverCard
                          trigger={
                            sale.invoice_number ? (
                              <a
                                href={ap(`/admin/cash-sale/${sale.id}`)}
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
                                className={`font-medium ${sale.payment_status === 'paid' ? 'text-green-600 dark:text-green-400' : 'text-yellow-600 dark:text-yellow-400'}`}
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
                          ₹{parseFloat(sale.total_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </div>
                        {parseFloat(sale.taxable_amount) > 0 && (
                          <div className="text-xs text-foreground-muted mt-0.5">
                            Taxable ₹
                            {parseFloat(sale.taxable_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`px-2 py-0.5 rounded-full text-xs font-medium ${PAYMENT_COLORS[sale.payment_status] || ''}`}
                        >
                          {sale.payment_status}
                        </span>
                        {sale.status === 'cancelled' && (
                          <span className="ml-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300">
                            Cancelled
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1">
                          <a
                            href={`/api/admin/cash-sale/${sale.id}/receipt`}
                            target="_blank"
                            rel="noreferrer"
                            title="Download Receipt PDF"
                            className="p-1.5 rounded-lg hover:bg-surface-secondary text-foreground-secondary hover:text-foreground transition-colors"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                              />
                            </svg>
                          </a>
                          <a
                            href={ap(`/admin/cash-sale/${sale.id}`)}
                            title="View Detail"
                            className="p-1.5 rounded-lg hover:bg-surface-secondary text-foreground-secondary hover:text-accent-500 transition-colors"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                              />
                            </svg>
                          </a>
                          {sale.status !== 'cancelled' && canWrite && (
                            <button
                              onClick={() => cancelSale(sale.id)}
                              disabled={cancellingId === sale.id}
                              title="Cancel Sale"
                              className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-foreground-secondary hover:text-red-600 dark:hover:text-red-400 transition-colors disabled:opacity-50"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M6 18L18 6M6 6l12 12"
                                />
                              </svg>
                            </button>
                          )}
                        </div>
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

      {totalPages > 1 && (
        <div className="px-4 py-3 border border-border-default border-t-0 rounded-b-xl bg-surface-elevated flex items-center justify-between gap-2">
          <p className="text-xs text-foreground-muted whitespace-nowrap">
            <span className="font-medium text-foreground">
              {(page - 1) * 25 + 1}–{Math.min(page * 25, total)}
            </span>{' '}
            of <span className="font-medium text-foreground">{total}</span> sales
          </p>
          <div className="flex items-center gap-1.5">
            <button
              disabled={page <= 1}
              onClick={() => fetchSales(page - 1)}
              className="px-3 py-1.5 text-xs font-medium border border-border-default rounded-lg text-foreground-secondary hover:bg-surface-secondary disabled:opacity-40 disabled:pointer-events-none transition-colors"
            >
              Prev
            </button>
            <span className="text-xs text-foreground-muted whitespace-nowrap">
              {page}/{totalPages}
            </span>
            <button
              disabled={page >= totalPages}
              onClick={() => fetchSales(page + 1)}
              className="px-3 py-1.5 text-xs font-medium border border-border-default rounded-lg text-foreground-secondary hover:bg-surface-secondary disabled:opacity-40 disabled:pointer-events-none transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {selectedSale && (
        <SaleDetailModal
          sale={selectedSale}
          onClose={() => setSelectedSale(null)}
          onCancelled={() => {
            setSelectedSale(null)
            fetchSales(page)
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
  if (typeof document === 'undefined') return null
  return createPortal(
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div
        className="relative bg-surface-elevated rounded-xl shadow-2xl border border-border-default w-full max-w-2xl max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between p-5 border-b border-border-default">
          <div className="min-w-0 pr-4">
            <h2 className="text-lg font-bold text-foreground leading-tight font-mono">
              {sale.invoice_number || sale.order_number}
            </h2>
            <p className="text-xs text-foreground-muted mt-0.5">
              {new Date(sale.invoice_date).toLocaleDateString('en-IN', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              })}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-surface-secondary text-foreground-muted hover:text-foreground transition-colors flex-shrink-0"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-5 space-y-5">
          <div className="flex flex-wrap gap-2">
            <span
              className={`px-2.5 py-0.5 text-xs font-semibold rounded-full ${PAYMENT_COLORS[sale.payment_status] || ''}`}
            >
              {sale.payment_status}
            </span>
            <span className="px-2.5 py-0.5 text-xs font-semibold rounded-full bg-surface border border-border-default text-foreground-secondary">
              Cash Sale
            </span>
            {sale.status === 'cancelled' && (
              <span className="px-2.5 py-0.5 text-xs font-semibold rounded-full bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300">
                Cancelled
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-foreground-muted uppercase tracking-wide mb-1.5">Customer</p>
              <p className="text-sm font-semibold text-foreground">Walk-in Customer</p>
            </div>
            <div>
              <p className="text-xs text-foreground-muted uppercase tracking-wide mb-1.5">Order</p>
              <p className="text-sm text-foreground font-mono">{sale.order_number}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3 rounded-lg bg-surface-secondary">
            <div>
              <p className="text-xs text-foreground-muted">Taxable</p>
              <p className="text-sm font-semibold text-foreground">
                ₹{parseFloat(sale.taxable_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </p>
            </div>
            {parseFloat(sale.cgst_amount) > 0 && (
              <div>
                <p className="text-xs text-foreground-muted">CGST + SGST</p>
                <p className="text-sm font-semibold text-foreground">
                  ₹{parseFloat(sale.cgst_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })} + ₹
                  {parseFloat(sale.sgst_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </p>
              </div>
            )}
            <div>
              <p className="text-xs text-foreground-muted">Total</p>
              <p className="text-sm font-bold text-foreground">
                ₹{parseFloat(sale.total_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </p>
            </div>
          </div>

          {sale.notes && (
            <div>
              <p className="text-xs text-foreground-muted uppercase tracking-wide mb-1">Notes</p>
              <p className="text-sm text-foreground">{sale.notes}</p>
            </div>
          )}

          <div className="flex flex-wrap gap-3 pt-1 border-t border-border-default">
            <a
              href={`/api/admin/cash-sale/${sale.id}/receipt`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold bg-surface-secondary hover:bg-surface-secondary/70 text-foreground transition-colors border border-border-default"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
              Receipt PDF
            </a>
            <a
              href={ap(`/admin/orders/${sale.id}`)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold bg-surface-secondary hover:bg-surface-secondary/70 text-foreground transition-colors border border-border-default"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                />
              </svg>
              View Order
            </a>
            {!isCancelled && canWrite && (
              <div className="ml-auto">
                <button
                  onClick={handleCancel}
                  disabled={cancelling}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 border border-red-200 dark:border-red-800 transition-colors disabled:opacity-50"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  {cancelling ? 'Cancelling…' : 'Cancel Sale'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
