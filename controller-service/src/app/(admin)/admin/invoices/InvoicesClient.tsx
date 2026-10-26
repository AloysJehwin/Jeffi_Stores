'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { AlertTriangle, ArrowDown, ArrowUp, Check, Download, Plus, X } from 'lucide-react'
import { INVOICE_ALIASES, INVOICE_FIELDS, INVOICE_SEARCH } from '@jeffi/list-filters/fields'
import { TabAction, TabActionsPortal, PageHeader, PAYMENT_STATUS, StatusBadge, badgeCls, Dialog, EmptyState, Field, Fields, TableSkeleton, FormFooter, FormButton, fieldInputCls, InfiniteFooter, ListFilters, fetchJson, useFilterQuery, useInfiniteList, type StatusMap } from '@/components/admin/kit'
import { ap } from '@/lib/shared/admin-path'
import { useToast } from '@/contexts/ToastContext'
import RowActions from '@/components/admin/RowActions'
import HoverCard from '@/components/ui/HoverCard'
import LineItemsSection, {
  newLineItem,
  fetchSeedLineItem,
  type LineItem as LILineItem,
  isBlankLine,
  validateLineItems,
  lineItemPayload,
  apiErrorMessage,
  insufficientMessage,
} from '@/components/admin/LineItemsSection'
import BatchPickerModal, { type BatchPickerItem } from '@/components/admin/BatchPickerModal'
import SerialEntryModal, {
  type SerialItem,
  type SerialAssignment,
  SerialPicker,
} from '@/components/admin/SerialEntryModal'
import { type SortDir } from '@/components/admin/sortOptions'
import DatePicker from '@/components/ui/DatePicker'
import Toggle from '@/components/ui/Toggle'
import InvoicesMobileList from './_components/InvoicesMobileList'

export interface Invoice {
  id: string
  order_number: string
  invoice_number: string
  invoice_date: string
  customer_name: string
  customer_phone: string
  customer_email: string
  total_amount: string
  taxable_amount: string
  cgst_amount: string
  sgst_amount: string
  igst_amount: string
  payment_status: string
  status: string
  source: string
  buyer_gstin: string | null
  irn: string | null
  irn_status: string | null
  eway_bill_no: string | null
  pdf_url: string | null
}

type LineItem = LILineItem

type View = 'list' | 'create' | 'edit'

const PAYMENT_MODES = [
  { value: 'cash', label: 'Cash', paid: true },
  { value: 'upi', label: 'UPI', paid: true },
  { value: 'upi_qr', label: 'UPI (QR Scan)', paid: true },
  { value: 'credit', label: 'Credit', paid: false },
]

function fmt(n: number) {
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDate(s: string) {
  if (!s) return ''
  const d = new Date(s)
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

const inputCls = fieldInputCls
const labelCls = 'block text-xs font-medium text-foreground-secondary mb-1.5'

export const SOURCE_STATUS: StatusMap = {
  online: { label: 'Online', tone: 'blue' },
  offline: { label: 'Offline', tone: 'muted' },
  cash_sale: { label: 'Offline', tone: 'muted' },
  business: { label: 'Business', tone: 'green' },
}

// Badge class strings; other lists still key on these.
export const PAYMENT_COLORS: Record<string, string> = Object.fromEntries(Object.entries(PAYMENT_STATUS).map(([k, v]) => [k, badgeCls(v.tone)]))
export const SOURCE_COLORS: Record<string, string> = Object.fromEntries(Object.entries(SOURCE_STATUS).map(([k, v]) => [k, badgeCls(v.tone)]))

export default function InvoicesClient({ canWrite = false }: { canWrite?: boolean }) {
  const { showToast } = useToast()
  const searchParams = useSearchParams()
  const router = useRouter()
  const [view, setViewState] = useState<View>(() => {
    const v = searchParams.get('view')
    return v === 'create' || v === 'edit' ? v : 'list'
  })
  const [editId, setEditId] = useState<string | null>(null)

  // sync view state when URL changes (browser back/forward)
  useEffect(() => {
    const v = searchParams.get('view')
    const next: View = v === 'create' || v === 'edit' ? v : 'list'
    setViewState(next)
    if (next === 'list') {
      resetForm()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  // open editor directly when ?edit=<id>&view=edit is in the URL (reload or direct link)
  const editIdRef = useRef<string | null>(null)
  useEffect(() => {
    const editParam = searchParams.get('edit')
    if (editParam && searchParams.get('view') === 'edit' && editIdRef.current !== editParam) {
      editIdRef.current = editParam
      openEdit({ id: editParam, source: 'offline', invoice_number: '', status: 'draft' } as Invoice)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams.toString()])

  // Deep-link preseed (scan → New Invoice): ?product=<id> with no ?edit seeds the
  // first line item of a fresh editor. Best-effort; skips if editing an existing invoice.
  const seededProductRef = useRef(false)
  useEffect(() => {
    if (seededProductRef.current) return
    const pid = searchParams.get('product')
    if (!pid || searchParams.get('edit')) return
    seededProductRef.current = true
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

  function navigateView(next: View, id?: string) {
    setViewState(next)
    if (next === 'list') {
      editIdRef.current = null
      router.back()
    } else {
      const params = new URLSearchParams(window.location.search)
      params.set('view', next)
      if (id) params.set('edit', id)
      else params.delete('edit')
      router.push(ap(`/admin/invoices?${params.toString()}`), { scroll: false })
    }
  }

  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null)
  const [cancellingId, setCancellingId] = useState<string | null>(null)
  const [sendingEmailId, setSendingEmailId] = useState<string | null>(null)
  // Filters live in the URL (from / to is the invoice date, shared with the Overview period).
  const filters = useFilterQuery(INVOICE_FIELDS, { aliases: INVOICE_ALIASES })
  const [sortCol, setSortCol] = useState<string | undefined>(undefined)
  const [sortDir, setSortDir] = useState<SortDir | undefined>(undefined)

  function handleSort(col: string, dir: SortDir) {
    setSortCol(col || undefined)
    setSortDir(col ? dir : undefined)
    // Refetch from the server so sort applies across ALL rows, not just the current page.
    // (a useEffect keyed on sortCol/sortDir triggers the page-1 refetch.)
  }

  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [customerEmail, setCustomerEmail] = useState('')
  const [addressLine1, setAddressLine1] = useState('')
  const [addressLine2, setAddressLine2] = useState('')
  const [city, setCity] = useState('')
  const [state, setState] = useState('')
  const [postalCode, setPostalCode] = useState('')
  const [buyerGstin, setBuyerGstin] = useState('')
  const [paymentMode, setPaymentMode] = useState('cash')

  // Buyer (Bill to) — separate from consignee
  const [buyerSame, setBuyerSame] = useState(true)
  const [buyerSearch, setBuyerSearch] = useState('')
  const [buyerResults, setBuyerResults] = useState<any[]>([])
  const [showBuyerDrop, setShowBuyerDrop] = useState(false)
  const buyerTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [buyerName, setBuyerName] = useState('')
  const [buyerPhone, setBuyerPhone] = useState('')
  const [buyerEmail, setBuyerEmail] = useState('')
  const [buyerAddr1, setBuyerAddr1] = useState('')
  const [buyerAddr2, setBuyerAddr2] = useState('')
  const [buyerCity, setBuyerCity] = useState('')
  const [buyerStateVal, setBuyerStateVal] = useState('')
  const [buyerPostalCode, setBuyerPostalCode] = useState('')
  const [buyerGstinBill, setBuyerGstinBill] = useState('')

  const [custSearch, setCustSearch] = useState('')
  const [custResults, setCustResults] = useState<any[]>([])
  const [showCustDrop, setShowCustDrop] = useState(false)
  const custTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [invoiceDate, setInvoiceDate] = useState('')
  const [notes, setNotes] = useState('')
  const [creditWarning, setCreditWarning] = useState<{ outstanding: number; creditLimit: number } | null>(null)
  const [items, setItems] = useState<LineItem[]>([newLineItem()])
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState('')
  const [autoSaveStatus, setAutoSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const autoSaveInFlight = useRef(false)
  const [editLoading, setEditLoading] = useState(false)
  const [drafts, setDrafts] = useState<any[]>([])
  const [draftsLoading, setDraftsLoading] = useState(false)
  const [finalizingId, setFinalizingId] = useState<string | null>(null)
  const [publishingId, setPublishingId] = useState<string | null>(null)
  const [editIsDraft, setEditIsDraft] = useState(false)

  // Batch picker for perishable line items
  const [batchPickerItem, setBatchPickerItem] = useState<BatchPickerItem | null>(null)
  const [batchAssignments, setBatchAssignments] = useState<Record<string, { batch_id: string; qty: number }[]>>({}) // lineItemId → [{batch_id, qty}]
  const [assignedBatchLabels, setAssignedBatchLabels] = useState<Record<string, string>>({}) // lineItemId → lot label(s)
  const [serialAssignments, setSerialAssignments] = useState<SerialAssignment[]>([])
  const [serialPickerItems, setSerialPickerItems] = useState<SerialItem[] | null>(null)
  // Inline (in-line-item) serial assignment: one SerialItem per serialized line,
  // fetched on demand. The modal path above still serves every other flow.
  const [inlineSerialItems, setInlineSerialItems] = useState<Record<string, SerialItem>>({})

  // Prune serial assignments whose line was removed or product cleared, so scanned
  // serials stay in lockstep with the current serialized lines (no orphans).
  useEffect(() => {
    const validIds = new Set(items.filter(it => it.product_id && it.serialized).map(it => it.id))
    setSerialAssignments(prev => {
      const next = prev.filter(sa => validIds.has(sa.order_item_id))
      return next.length === prev.length ? prev : next
    })
  }, [items])

  // Draft-list finalize batch/serial picker
  const [draftFinalizeId, setDraftFinalizeId] = useState<string | null>(null)
  const [draftBatchItems, setDraftBatchItems] = useState<BatchPickerItem[]>([])
  const [draftSerialItems, setDraftSerialItems] = useState<SerialItem[]>([])

  const INVOICE_SORT_KEYS: Record<string, keyof Invoice> = {
    invoice_number: 'invoice_number',
    date: 'invoice_date',
    customer: 'customer_name',
    amount: 'total_amount',
    payment: 'payment_status',
    source: 'source',
  }


  // Rows are ordered server-side (across all invoices) via sort/dir params; 25 per page.
  const list = useInfiniteList<Invoice>({
    key: `${filters}|${sortCol}|${sortDir}`,
    pageSize: 25,
    getKey: i => i.id,
    fetchPage: async (p, signal) => {
      const params = new URLSearchParams(filters)
      if (sortCol && INVOICE_SORT_KEYS[sortCol]) {
        params.set('sort', INVOICE_SORT_KEYS[sortCol])
        params.set('dir', sortDir || 'desc')
      }
      params.set('page', String(p))
      const data = await fetchJson(`/api/admin/invoices?${params}`, signal)
      return { rows: data.invoices || [], total: data.total || 0 }
    },
  })
  const invoices = list.rows
  const sortedInvoices = invoices
  const loading = list.loading
  const fetchInvoices = list.reload

  const fetchDrafts = useCallback(async () => {
    setDraftsLoading(true)
    try {
      const res = await fetch('/api/admin/invoices/drafts', { credentials: 'include' })
      if (res.ok) setDrafts((await res.json()).drafts || [])
    } finally {
      setDraftsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchDrafts()
  }, [fetchDrafts])

  // Autosave draft every 30s when editing an existing draft
  useEffect(() => {
    if (!editId || !editIsDraft) return
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)
    autoSaveTimer.current = setTimeout(() => {
      void autoSaveDraft()
    }, 30000)
    return () => {
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)
    }
  }, [
    editId,
    editIsDraft,
    customerName,
    customerPhone,
    customerEmail,
    addressLine1,
    addressLine2,
    city,
    state,
    postalCode,
    buyerGstin,
    paymentMode,
    notes,
    items,
  ])

  async function finalizeDraft(id: string) {
    setFinalizingId(id)
    try {
      // Check if any items are perishable/serialized and need assignment
      const batchRes = await fetch(`/api/admin/inventory/batches/available?order_id=${id}`, { credentials: 'include' })
      const batchData = await batchRes.json()
      const hasBatch = batchData.items?.length > 0
      const hasSerial = batchData.serialized_items?.length > 0
      if (hasBatch || hasSerial) {
        setDraftFinalizeId(id)
        if (hasBatch) setDraftBatchItems(batchData.items)
        if (hasSerial) setDraftSerialItems(batchData.serialized_items)
        setFinalizingId(null)
        return
      }
      await doFinalizeDraft(id, [], [])
    } catch {
      showToast('Failed to finalize draft', 'error')
      setFinalizingId(null)
    }
  }

  async function publishAmendmentDraft(id: string) {
    setPublishingId(id)
    try {
      const res = await fetch(`/api/admin/invoices/drafts/${id}/publish`, {
        method: 'POST',
        credentials: 'include',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        showToast(apiErrorMessage(res, data, 'Failed to publish amendment'), 'error')
        return
      }
      showToast(`Amendment published as ${data.invoiceNumber || ''}`, 'success')
      fetchDrafts()
      fetchInvoices()
    } catch {
      showToast('Failed to publish amendment', 'error')
    } finally {
      setPublishingId(null)
    }
  }

  async function doFinalizeDraft(
    id: string,
    batchAssignments: { order_item_id: string; batch_id: string; qty: number }[],
    serialAssignmentsArg: { order_item_id: string; serial_number: string }[]
  ) {
    setFinalizingId(id)
    try {
      const res = await fetch(`/api/admin/invoices/drafts/${id}/finalize`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batch_assignments: batchAssignments, serial_assignments: serialAssignmentsArg }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        showToast(apiErrorMessage(res, data, 'Failed to finalize'), 'error')
        return
      }
      showToast(`Invoice ${data.invoiceNumber || ''} finalized`, 'success')
      fetchDrafts()
      fetchInvoices()
      if (data.invoiceUrl) window.open(data.invoiceUrl, '_blank')
    } catch {
      showToast('Failed to finalize draft', 'error')
    } finally {
      setFinalizingId(null)
    }
  }

  function searchCustomers(q: string) {
    setCustSearch(q)
    if (custTimer.current) clearTimeout(custTimer.current)
    if (q.length < 2) {
      setCustResults([])
      setShowCustDrop(false)
      return
    }
    custTimer.current = setTimeout(async () => {
      const res = await fetch(`/api/admin/customers/search?q=${encodeURIComponent(q)}`)
      const data = await res.json()
      setCustResults(data.results || [])
      setShowCustDrop(true)
    }, 300)
  }

  function selectCustomer(c: any) {
    setCustomerName(c.addr_name || c.full_name || '')
    setCustomerPhone(
      (c.phone || '')
        .replace(/^\+?91/, '')
        .replace(/\D/g, '')
        .slice(-10)
    )
    setCustomerEmail(c.email || '')
    setAddressLine1(c.address_line1 || '')
    setAddressLine2(c.address_line2 || '')
    setCity(c.city || '')
    setState(c.state || '')
    setPostalCode(c.postal_code || '')
    setBuyerGstin(c.gst_number || '')
    setCustSearch('')
    setCustResults([])
    setShowCustDrop(false)
  }

  function searchBuyers(q: string) {
    setBuyerSearch(q)
    if (buyerTimer.current) clearTimeout(buyerTimer.current)
    if (q.length < 2) {
      setBuyerResults([])
      setShowBuyerDrop(false)
      return
    }
    buyerTimer.current = setTimeout(async () => {
      const res = await fetch(`/api/admin/customers/search?q=${encodeURIComponent(q)}`)
      const data = await res.json()
      setBuyerResults(data.results || [])
      setShowBuyerDrop(true)
    }, 300)
  }

  function selectBuyer(c: any) {
    setBuyerName(c.addr_name || c.full_name || '')
    setBuyerPhone(
      (c.phone || '')
        .replace(/^\+?91/, '')
        .replace(/\D/g, '')
        .slice(-10)
    )
    setBuyerEmail(c.email || '')
    setBuyerAddr1(c.address_line1 || '')
    setBuyerAddr2(c.address_line2 || '')
    setBuyerCity(c.city || '')
    setBuyerStateVal(c.state || '')
    setBuyerPostalCode(c.postal_code || '')
    setBuyerGstinBill(c.gst_number || '')
    setBuyerSearch('')
    setBuyerResults([])
    setShowBuyerDrop(false)
  }

  function resetForm() {
    setCustomerName('')
    setCustomerPhone('')
    setCustomerEmail('')
    setAddressLine1('')
    setAddressLine2('')
    setCity('')
    setState('')
    setPostalCode('')
    setBuyerGstin('')
    setPaymentMode('cash')
    setInvoiceDate('')
    setNotes('')
    setItems([newLineItem()])
    setFormError('')
    setEditId(null)
    setEditIsDraft(false)
    setCustSearch('')
    setCustResults([])
    setShowCustDrop(false)
    setBuyerSame(true)
    setBuyerSearch('')
    setBuyerResults([])
    setShowBuyerDrop(false)
    setBuyerName('')
    setBuyerPhone('')
    setBuyerEmail('')
    setBuyerAddr1('')
    setBuyerAddr2('')
    setBuyerCity('')
    setBuyerStateVal('')
    setBuyerPostalCode('')
    setBuyerGstinBill('')
    setBatchAssignments({})
    setSerialAssignments([])
    setSerialPickerItems(null)
  }

  async function openEdit(inv: Invoice) {
    editIdRef.current = inv.id
    setEditLoading(true)
    try {
      const res = await fetch(`/api/admin/orders/${inv.id}`, { credentials: 'include' })
      const data = await res.json()
      const order = data.order || data
      const orderItems: any[] = data.items || []

      setEditId(inv.id)
      setCustomerName(order.customer_name || '')
      setCustomerPhone(
        (order.customer_phone || '')
          .replace(/^\+?91/, '')
          .replace(/\D/g, '')
          .slice(-10)
      )
      setCustomerEmail(order.customer_email || '')
      setBuyerGstin(order.buyer_gstin || '')
      setPaymentMode(order.payment_status === 'paid' ? 'cash' : 'credit')
      setInvoiceDate(order.invoice_date ? order.invoice_date.slice(0, 10) : '')
      setNotes(order.notes || '')

      const addr = order.shipping_address || {}
      setAddressLine1(addr.address_line1 || '')
      setAddressLine2(addr.address_line2 || '')
      setCity(addr.city || '')
      setState(addr.state || '')
      setPostalCode(addr.postal_code || '')

      const billAddr = order.billing_address || {}
      const hasSeparateBilling = !!(
        billAddr.address_line1 &&
        (billAddr.address_line1 !== addr.address_line1 || billAddr.city !== addr.city)
      )
      setBuyerSame(!hasSeparateBilling)
      if (hasSeparateBilling) {
        setBuyerName(billAddr.full_name || order.customer_name || '')
        setBuyerPhone('')
        setBuyerEmail('')
        setBuyerAddr1(billAddr.address_line1 || '')
        setBuyerAddr2(billAddr.address_line2 || '')
        setBuyerCity(billAddr.city || '')
        setBuyerStateVal(billAddr.state || '')
        setBuyerPostalCode(billAddr.postal_code || '')
        setBuyerGstinBill(order.buyer_gstin || '')
      }

      setItems(
        orderItems.length > 0
          ? orderItems.map((it: any) => ({
              id: it.id || Math.random().toString(36).slice(2),
              product_id: it.product_id || null,
              is_custom: !it.product_id,
              product_name: it.product_name || '',
              product_sku: it.product_sku || '',
              variant_id: it.variant_id || null,
              sub_variant_id: it.sub_variant_id || null,
              variant_name: it.variant_name || '',
              hsn_code: it.hsn_code || '',
              gst_rate: String(Math.round(parseFloat(it.gst_rate ?? '18')) || 0),
              quantity: String(it.quantity ?? '1'),
              unit: !it.product_id ? it.buy_unit || 'PCS' : it.unit || 'pcs',
              buy_unit: it.product_id ? it.buy_unit || null : null,
              buy_mode: null,
              sell_unit_factor: it.sold_unit_factor && it.sold_unit_factor > 1 ? it.sold_unit_factor : 1,
              sell_unit_dimension: null,
              available_units: [],
              selected_unit_key: '',
              unit_price: String(it.mrp && it.mrp > 0 ? it.mrp : (it.unit_price ?? '')),
              discount_pct: it.discount_pct ?? 0,
              mrp: it.mrp ?? it.unit_price ?? 0,
              inventory_quantity:
                it.sub_variant?.inventory_quantity ?? it.variant?.inventory_quantity ?? it.inventory_quantity ?? null,
            }))
          : [newLineItem()]
      )

      setFormError('')
      setEditIsDraft(inv.status === 'draft')
      navigateView('edit', inv.id)
    } catch {
      showToast('Failed to load invoice for editing', 'error')
    } finally {
      setEditLoading(false)
    }
  }

  async function cancelInvoice(inv: Invoice) {
    setCancellingId(inv.id)
    try {
      const res = await fetch(`/api/admin/orders/${inv.id}/cancel`, { method: 'POST', credentials: 'include' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to cancel')
      showToast(`Invoice ${inv.invoice_number} cancelled`, 'success')
      fetchInvoices()
    } catch (err: any) {
      showToast(err.message, 'error')
    } finally {
      setCancellingId(null)
    }
  }

  async function sendInvoiceEmail(inv: Invoice) {
    setSendingEmailId(inv.id)
    try {
      const res = await fetch(`/api/admin/invoices/${inv.id}/resend-email`, { method: 'POST', credentials: 'include' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to send email')
      showToast('Email sent successfully', 'success')
    } catch (err: any) {
      showToast(err.message, 'error')
    } finally {
      setSendingEmailId(null)
    }
  }

  // Save new invoice as draft without finalizing
  async function handleSaveDraft() {
    if (!customerName.trim()) {
      setFormError('Customer name is required')
      return
    }
    const draftLineError = items.some(it => !isBlankLine(it)) ? validateLineItems(items) : null
    if (draftLineError) {
      setFormError(draftLineError)
      showToast(draftLineError, 'error')
      return
    }
    setFormError('')
    setSubmitting(true)
    try {
      const res = await fetch('/api/admin/invoices/drafts', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName,
          customerPhone,
          customerEmail,
          addressLine1,
          addressLine2,
          city,
          state,
          postalCode,
          buyerGstin,
          paymentMode,
          notes,
          saveAsDraft: true,
          items: items.filter(it => !isBlankLine(it)).map(lineItemPayload),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        const msg = apiErrorMessage(res, data, 'Failed to save draft')
        setFormError(msg)
        showToast(msg, 'error')
        return
      }
      showToast('Invoice saved as draft', 'success')
      resetForm()
      navigateView('list')
      fetchDrafts()
    } catch (err: any) {
      setFormError(err.message || 'Failed')
    } finally {
      setSubmitting(false)
    }
  }

  // Autosave existing draft — debounced
  async function autoSaveDraft() {
    if (!editId || !editIsDraft || autoSaveInFlight.current) return
    // Wait for complete lines; the explicit Save/Finalize buttons report problems.
    if (validateLineItems(items)) return
    autoSaveInFlight.current = true
    setAutoSaveStatus('saving')
    try {
      const res = await fetch(`/api/admin/invoices/drafts/${editId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName,
          customerPhone,
          customerEmail,
          addressLine1,
          addressLine2,
          city,
          state,
          postalCode,
          buyerGstin,
          paymentMode,
          invoiceDate,
          notes,
          items: items.filter(it => !isBlankLine(it)).map(lineItemPayload),
        }),
      })
      setAutoSaveStatus(res.ok ? 'saved' : 'error')
      if (!res.ok) setFormError(apiErrorMessage(res, await res.json().catch(() => ({})), 'Draft autosave failed'))
      setTimeout(() => setAutoSaveStatus('idle'), 2000)
    } catch {
      setAutoSaveStatus('error')
      setTimeout(() => setAutoSaveStatus('idle'), 2000)
    } finally {
      autoSaveInFlight.current = false
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!customerName.trim()) {
      setFormError('Customer name is required')
      return
    }
    if (!addressLine1.trim()) {
      setFormError('Address line 1 is required')
      return
    }
    if (!city.trim()) {
      setFormError('City is required')
      return
    }
    if (!customerPhone.trim()) {
      setFormError('Phone number is required')
      return
    }
    const lineError = validateLineItems(items)
    if (lineError) {
      setFormError(lineError)
      showToast(lineError, 'error')
      return
    }
    setFormError('')
    setSubmitting(true)
    try {
      const res = await fetch('/api/admin/orders/create', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName,
          customerPhone,
          customerEmail,
          addressLine1,
          addressLine2,
          city,
          state,
          postalCode,
          buyerGstin,
          paymentMode,
          notes,
          items: items.filter(it => !isBlankLine(it)).map(lineItemPayload),
          batch_assignments: Object.entries(batchAssignments).flatMap(([order_item_id, batches]) =>
            batches.map(b => ({ order_item_id, batch_id: b.batch_id, qty: b.qty }))
          ),
          serial_assignments: serialAssignments,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        const msg = apiErrorMessage(res, data, 'Failed to save invoice')
        setFormError(msg)
        showToast(msg, 'error')
        return
      }
      if (data.savedAsDraft) {
        showToast(insufficientMessage('Saved as draft — not enough stock', data.insufficientItems), 'error')
      } else {
        showToast(`Invoice ${data.invoiceNumber || ''} created`, 'success')
        if (data.invoiceUrl) window.open(data.invoiceUrl, '_blank')
      }
      resetForm()
      navigateView('list')
      fetchInvoices()
      fetchDrafts()
    } catch (err: any) {
      setFormError(err.message || 'Failed')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!editId) return
    if (!customerName.trim()) {
      setFormError('Customer name is required')
      return
    }
    if (!addressLine1.trim()) {
      setFormError('Address line 1 is required')
      return
    }
    if (!city.trim()) {
      setFormError('City is required')
      return
    }
    if (!customerPhone.trim()) {
      setFormError('Phone number is required')
      return
    }
    const lineError = validateLineItems(items)
    if (lineError) {
      setFormError(lineError)
      showToast(lineError, 'error')
      return
    }
    setFormError('')
    setSubmitting(true)
    try {
      const res = await fetch(`/api/admin/invoices/${editId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName,
          customerPhone,
          customerEmail,
          addressLine1,
          addressLine2,
          city,
          state,
          postalCode,
          buyerGstin,
          paymentMode,
          invoiceDate,
          notes,
          items: items.filter(it => !isBlankLine(it)).map(lineItemPayload),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        const msg = apiErrorMessage(res, data, 'Failed to save invoice')
        setFormError(msg)
        showToast(msg, 'error')
        return
      }
      if (data.movedToDraft) {
        showToast(insufficientMessage('Invoice moved to draft — not enough stock', data.insufficientItems), 'error')
      } else {
        showToast('Invoice updated', 'success')
      }
      resetForm()
      navigateView('list')
      fetchInvoices()
      fetchDrafts()
    } catch (err: any) {
      setFormError(err.message || 'Failed')
    } finally {
      setSubmitting(false)
    }
  }

  // Keep one SerialItem per serialized line so the inline panel knows how many
  // serials that line needs. Re-runs when a line's product or quantity changes.
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

  async function handleStockBadgeClick(item: LILineItem) {
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
      const pre = serialAssignments.filter(sa => sa.order_item_id === item.id).map(sa => sa.serial_number)
      setSerialPickerItems(
        data.serialized_items.map((si: SerialItem) => (si.order_item_id === item.id ? { ...si, preassigned: pre } : si))
      )
    } else if (data.items?.length > 0) {
      setBatchPickerItem(data.items[0])
    }
  }

  // A serialized unit added via a serial scan → auto-record it as this line's
  // assignment (deduped GLOBALLY by serial_number — a unit can't be on two lines).
  function handleSerialScanned(lineId: string, serial: { serial_number: string }) {
    setSerialAssignments(prev =>
      prev.some(sa => sa.serial_number === serial.serial_number)
        ? prev
        : [...prev, { order_item_id: lineId, serial_number: serial.serial_number }]
    )
  }

  // Quantity dropped below the assigned-serial count → trim the tail assignments.
  function handleQuantityReduced(lineId: string, keep: number) {
    setSerialAssignments(prev => {
      const forLine = prev.filter(sa => sa.order_item_id === lineId)
      if (forLine.length <= keep) return prev
      const trimmed = new Set(forLine.slice(keep).map(sa => sa.serial_number))
      return prev.filter(sa => !(sa.order_item_id === lineId && trimmed.has(sa.serial_number)))
    })
  }

  async function handleFinalizeEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!editId) return
    if (!customerName.trim()) {
      setFormError('Customer name is required')
      return
    }
    if (!addressLine1.trim()) {
      setFormError('Address line 1 is required')
      return
    }
    if (!city.trim()) {
      setFormError('City is required')
      return
    }
    if (!customerPhone.trim()) {
      setFormError('Phone number is required')
      return
    }
    const lineError = validateLineItems(items)
    if (lineError) {
      setFormError(lineError)
      showToast(lineError, 'error')
      return
    }
    setFormError('')
    setSubmitting(true)
    try {
      const saveRes = await fetch(`/api/admin/invoices/${editId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName,
          customerPhone,
          customerEmail,
          addressLine1,
          addressLine2,
          city,
          state,
          postalCode,
          buyerGstin,
          paymentMode,
          invoiceDate,
          notes,
          items: items.filter(it => !isBlankLine(it)).map(lineItemPayload),
        }),
      })
      const saveData = await saveRes.json().catch(() => ({}))
      if (!saveRes.ok) {
        const msg = apiErrorMessage(saveRes, saveData, 'Failed to save')
        setFormError(msg)
        showToast(msg, 'error')
        return
      }
      if (saveData.movedToDraft) {
        const msg = insufficientMessage('Cannot finalize — not enough stock', saveData.insufficientItems)
        setFormError(msg)
        showToast(msg, 'error')
        fetchDrafts()
        return
      }

      const finalRes = await fetch(`/api/admin/invoices/drafts/${editId}/finalize`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          batch_assignments:
            Object.keys(batchAssignments).length > 0
              ? items
                  .filter(li => batchAssignments[li.id]?.length > 0)
                  .flatMap(li => {
                    const saved = (saveData.savedItemIds || []).find(
                      (s: any) => s.product_id === li.product_id && (s.variant_id || null) === (li.variant_id || null)
                    )
                    if (!saved) return []
                    return (batchAssignments[li.id] || []).map(b => ({
                      order_item_id: saved.order_item_id,
                      batch_id: b.batch_id,
                      qty: b.qty,
                    }))
                  })
              : [],
          serial_assignments:
            serialAssignments.length > 0
              ? serialAssignments.map(sa => {
                  const li = items.find(it => it.id === sa.order_item_id)
                  if (!li) return sa
                  const saved = (saveData.savedItemIds || []).find(
                    (s: any) => s.product_id === li.product_id && (s.variant_id || null) === (li.variant_id || null)
                  )
                  return saved ? { ...sa, order_item_id: saved.order_item_id } : sa
                })
              : [],
        }),
      })
      const finalData = await finalRes.json().catch(() => ({}))
      if (!finalRes.ok) {
        const msg = apiErrorMessage(finalRes, finalData, 'Failed to finalize')
        setFormError(msg)
        showToast(msg, 'error')
        return
      }
      showToast(`Invoice ${finalData.invoiceNumber || ''} finalized`, 'success')
      resetForm()
      navigateView('list')
      fetchInvoices()
      fetchDrafts()
      if (finalData.invoiceUrl) window.open(finalData.invoiceUrl, '_blank')
    } catch (err: any) {
      setFormError(err.message || 'Failed')
    } finally {
      setSubmitting(false)
    }
  }

  const selectedPayment = PAYMENT_MODES.find(m => m.value === paymentMode)

  function renderForm(isEdit: boolean) {
    return (
      <>
        {batchPickerItem && (
          <BatchPickerModal
            items={[batchPickerItem]}
            onConfirm={async assignments => {
              const map: Record<string, { batch_id: string; qty: number }[]> = { ...batchAssignments }
              const labelMap: Record<string, string> = { ...assignedBatchLabels }
              // Group assignments by order_item_id
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

              // Check if this item is serialized — if so, prompt for serial numbers
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
                // Drop confirmed serials from OTHER lines too — one unit, one line.
                const confirmedSerials = new Set(assignments.map(a => a.serial_number))
                const kept = prev.filter(a => !itemIds.has(a.order_item_id) && !confirmedSerials.has(a.serial_number))
                return [...kept, ...assignments]
              })
              setSerialPickerItems(null)
            }}
            onCancel={() => setSerialPickerItems(null)}
          />
        )}
        <div className="space-y-5">
          <PageHeader
            back={{ href: ap('/admin/invoices'), label: 'Invoices' }}
            title={isEdit ? 'Edit Offline Invoice' : 'New Offline Invoice'}
            description={isEdit ? 'Update customer details, items and payment mode' : 'Walk-in, credit sale, B2B or bulk order'}
          />

          {formError && (
            <div className="rounded-xl border border-red-500/40 bg-red-500/5 px-4 py-3 text-sm text-red-600 dark:text-red-400">
              {formError}
            </div>
          )}

          <form onSubmit={isEdit ? handleEdit : handleCreate} className="space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* Col 1 — Invoice Details */}
              <div className="bg-surface-elevated border border-border-default rounded-xl p-5 flex flex-col gap-3">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground">Invoice Details</h2>
                <div>
                  <label className={labelCls}>Invoice Date</label>
                  <DatePicker value={invoiceDate} onChange={setInvoiceDate} />
                </div>
                <div>
                  <label className={labelCls}>Payment Mode</label>
                  <div className="grid grid-cols-2 gap-2 mt-1">
                    {PAYMENT_MODES.map(m => (
                      <label
                        key={m.value}
                        className={`flex h-control items-center gap-2 px-3 rounded-lg border cursor-pointer transition-colors ${paymentMode === m.value ? 'border-accent-500 bg-accent-500/10 text-foreground' : 'border-border-default bg-surface text-foreground-secondary hover:border-border-secondary'}`}
                      >
                        <input
                          type="radio"
                          name="paymentMode"
                          value={m.value}
                          checked={paymentMode === m.value}
                          onChange={() => setPaymentMode(m.value)}
                          className="accent-accent-500 shrink-0"
                        />
                        <span className="text-sm font-medium">{m.label}</span>
                      </label>
                    ))}
                  </div>
                  {!selectedPayment?.paid && (
                    <p className="text-xs text-amber-700 dark:text-amber-400 mt-2">
                      Payment status will be <strong>Unpaid</strong> — credit sale
                    </p>
                  )}
                  {paymentMode === 'credit' && creditWarning && (
                    <div className="mt-2 px-3 py-2 rounded-lg bg-amber-500/5 border border-amber-500/40 text-xs text-amber-700 dark:text-amber-400 flex items-start gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      <span>
                        {creditWarning.creditLimit > 0
                          ? `Credit limit warning: ₹${creditWarning.outstanding.toLocaleString('en-IN', { maximumFractionDigits: 2 })} outstanding of ₹${creditWarning.creditLimit.toLocaleString('en-IN', { maximumFractionDigits: 2 })} limit`
                          : `₹${creditWarning.outstanding.toLocaleString('en-IN', { maximumFractionDigits: 2 })} already outstanding for this customer`}
                      </span>
                    </div>
                  )}
                </div>
                <div>
                  <label className={labelCls}>Notes</label>
                  <textarea
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    rows={3}
                    className={inputCls + ' resize-none'}
                    placeholder="Any additional notes..."
                  />
                </div>
              </div>

              {/* Col 2 — Consignee (Ship to) */}
              <div className="bg-surface-elevated border border-border-default rounded-xl p-5 flex flex-col gap-3">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground">
                  Consignee <span className="text-foreground-muted font-normal">(Ship to)</span>
                </h2>
                <div className="relative">
                  <input
                    type="text"
                    value={custSearch}
                    onChange={e => searchCustomers(e.target.value)}
                    placeholder="Search existing customer…"
                    className={inputCls}
                  />
                  {showCustDrop && custResults.length > 0 && (
                    <div className="absolute z-20 left-0 right-0 top-full mt-1 bg-surface-elevated border border-border-default rounded-lg shadow-lg max-h-48 overflow-y-auto">
                      {custResults.map(c => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => selectCustomer(c)}
                          className="w-full text-left px-3 py-2 hover:bg-surface-secondary transition-colors"
                        >
                          <p className="text-sm font-medium text-foreground">{c.company_name || c.full_name}</p>
                          <p className="text-xs text-foreground-secondary">
                            {c.city}, {c.state}
                          </p>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <label className={labelCls}>
                    Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={customerName}
                    onChange={e => setCustomerName(e.target.value)}
                    required
                    className={inputCls}
                    placeholder="Full name or company"
                  />
                </div>
                <div>
                  <label className={labelCls}>Phone &amp; Email</label>
                  <div className="flex gap-2">
                    <div className="flex flex-1 min-w-0">
                      <span className="inline-flex h-control items-center px-3 rounded-l-lg border border-r-0 border-border-secondary bg-surface-secondary text-foreground-secondary text-sm select-none shrink-0">
                        +91
                      </span>
                      <input
                        type="tel"
                        inputMode="numeric"
                        maxLength={10}
                        value={customerPhone}
                        onChange={e => setCustomerPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                        onBlur={async () => {
                          if (paymentMode !== 'credit' || !customerPhone.trim()) {
                            setCreditWarning(null)
                            return
                          }
                          const res = await fetch(
                            `/api/admin/financial/receivables?customerPhone=${encodeURIComponent(customerPhone.trim())}`
                          )
                          const json = await res.json()
                          if (json.summary?.total > 0 || json.rows?.[0]?.credit_limit > 0) {
                            setCreditWarning({
                              outstanding: json.summary.total,
                              creditLimit: json.rows?.[0]?.credit_limit || 0,
                            })
                          } else {
                            setCreditWarning(null)
                          }
                        }}
                        className={inputCls + ' rounded-l-none min-w-0'}
                        placeholder="XXXXXXXXXX"
                      />
                    </div>
                    <input
                      type="email"
                      value={customerEmail}
                      onChange={e => setCustomerEmail(e.target.value)}
                      className={inputCls + ' flex-1 min-w-0'}
                      placeholder="email"
                    />
                  </div>
                </div>
                <div>
                  <label className={labelCls}>Address Line 1</label>
                  <input
                    type="text"
                    value={addressLine1}
                    onChange={e => setAddressLine1(e.target.value)}
                    className={inputCls}
                    placeholder="Street address"
                  />
                </div>
                <div>
                  <label className={labelCls}>Address Line 2</label>
                  <input
                    type="text"
                    value={addressLine2}
                    onChange={e => setAddressLine2(e.target.value)}
                    className={inputCls}
                    placeholder="Apt, area, landmark"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className={labelCls}>
                      City <span className="text-red-500">*</span>
                    </label>
                    <input type="text" value={city} onChange={e => setCity(e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>State</label>
                    <input
                      type="text"
                      value={state}
                      onChange={e => setState(e.target.value)}
                      className={inputCls}
                      placeholder="Tamil Nadu"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className={labelCls}>Postal Code</label>
                    <input
                      type="text"
                      value={postalCode}
                      onChange={e => setPostalCode(e.target.value)}
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>GSTIN</label>
                    <input
                      type="text"
                      value={buyerGstin}
                      onChange={e => setBuyerGstin(e.target.value.toUpperCase())}
                      maxLength={15}
                      className={inputCls + ' font-mono'}
                      placeholder="29XXXXX..."
                    />
                  </div>
                </div>
              </div>

              {/* Col 3 — Buyer (Bill to) */}
              <div className="bg-surface-elevated border border-border-default rounded-xl p-5 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground">
                    Buyer <span className="text-foreground-muted font-normal">(Bill to)</span>
                  </h2>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-foreground-secondary">Same as consignee</span>
                    <Toggle checked={buyerSame} onChange={setBuyerSame} />
                  </div>
                </div>
                {!buyerSame && (
                  <>
                    <div className="relative">
                      <input
                        type="text"
                        value={buyerSearch}
                        onChange={e => searchBuyers(e.target.value)}
                        placeholder="Search buyer…"
                        className={inputCls}
                      />
                      {showBuyerDrop && buyerResults.length > 0 && (
                        <div className="absolute z-20 left-0 right-0 top-full mt-1 bg-surface-elevated border border-border-default rounded-lg shadow-lg max-h-48 overflow-y-auto">
                          {buyerResults.map(c => (
                            <button
                              key={c.id}
                              type="button"
                              onClick={() => selectBuyer(c)}
                              className="w-full text-left px-3 py-2 hover:bg-surface-secondary transition-colors"
                            >
                              <p className="text-sm font-medium text-foreground">{c.company_name || c.full_name}</p>
                              <p className="text-xs text-foreground-secondary">
                                {c.city}, {c.state}
                              </p>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <div>
                      <label className={labelCls}>Name</label>
                      <input
                        type="text"
                        value={buyerName}
                        onChange={e => setBuyerName(e.target.value)}
                        className={inputCls}
                        placeholder="Buyer name or company"
                      />
                    </div>
                    <div>
                      <label className={labelCls}>Phone &amp; Email</label>
                      <div className="flex gap-2">
                        <div className="flex flex-1 min-w-0">
                          <span className="inline-flex h-control items-center px-3 rounded-l-lg border border-r-0 border-border-secondary bg-surface-secondary text-foreground-secondary text-sm select-none shrink-0">
                            +91
                          </span>
                          <input
                            type="tel"
                            inputMode="numeric"
                            maxLength={10}
                            value={buyerPhone}
                            onChange={e => setBuyerPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                            className={inputCls + ' rounded-l-none min-w-0'}
                            placeholder="XXXXXXXXXX"
                          />
                        </div>
                        <input
                          type="email"
                          value={buyerEmail}
                          onChange={e => setBuyerEmail(e.target.value)}
                          className={inputCls + ' flex-1 min-w-0'}
                          placeholder="email"
                        />
                      </div>
                    </div>
                    <div>
                      <label className={labelCls}>Address Line 1</label>
                      <input
                        type="text"
                        value={buyerAddr1}
                        onChange={e => setBuyerAddr1(e.target.value)}
                        className={inputCls}
                        placeholder="Street address"
                      />
                    </div>
                    <div>
                      <label className={labelCls}>Address Line 2</label>
                      <input
                        type="text"
                        value={buyerAddr2}
                        onChange={e => setBuyerAddr2(e.target.value)}
                        className={inputCls}
                        placeholder="Apt, area, landmark"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className={labelCls}>City</label>
                        <input
                          type="text"
                          value={buyerCity}
                          onChange={e => setBuyerCity(e.target.value)}
                          className={inputCls}
                        />
                      </div>
                      <div>
                        <label className={labelCls}>State</label>
                        <input
                          type="text"
                          value={buyerStateVal}
                          onChange={e => setBuyerStateVal(e.target.value)}
                          className={inputCls}
                          placeholder="Tamil Nadu"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className={labelCls}>Postal Code</label>
                        <input
                          type="text"
                          value={buyerPostalCode}
                          onChange={e => setBuyerPostalCode(e.target.value)}
                          className={inputCls}
                        />
                      </div>
                      <div>
                        <label className={labelCls}>GSTIN</label>
                        <input
                          type="text"
                          value={buyerGstinBill}
                          onChange={e => setBuyerGstinBill(e.target.value.toUpperCase())}
                          maxLength={15}
                          className={inputCls + ' font-mono'}
                          placeholder="29XXXXX..."
                        />
                      </div>
                    </div>
                  </>
                )}
                {buyerSame && (
                  <p className="text-xs text-foreground-muted">Billing address same as shipping address.</p>
                )}
              </div>
            </div>

            <div className="bg-surface-elevated border border-border-default rounded-xl p-5">
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
                  const mine = serialAssignments.filter(sa => sa.order_item_id === item.id).map(sa => sa.serial_number)
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

            <FormFooter
              onCancel={() => {
                resetForm()
                navigateView('list')
              }}
              secondary={
                isEdit && editIsDraft && autoSaveStatus !== 'idle' ? (
                  <span className={`w-full order-first md:order-none md:w-auto ${autoSaveStatus === 'saving' ? 'text-foreground-muted' : autoSaveStatus === 'saved' ? 'text-green-700 dark:text-green-400' : 'text-red-500'}`}>
                    {autoSaveStatus === 'saving' ? 'Auto-saving…' : autoSaveStatus === 'saved' ? 'Auto-saved' : 'Auto-save failed'}
                  </span>
                ) : undefined
              }
            >
              <div className="grid w-full grid-cols-2 gap-2 md:flex md:w-auto md:items-center md:gap-2">
                {!isEdit && canWrite && (
                  <FormButton type="button" variant="secondary" disabled={submitting} onClick={handleSaveDraft} className="w-full md:w-auto">
                    {submitting ? 'Saving…' : 'Save as Draft'}
                  </FormButton>
                )}
                {isEdit && editIsDraft && canWrite && (
                  <FormButton type="button" disabled={submitting} onClick={handleFinalizeEdit} className="w-full bg-amber-500 hover:bg-amber-600 md:w-auto">
                    {submitting ? 'Finalizing…' : 'Save & Finalize'}
                  </FormButton>
                )}
                {canWrite && (
                  <FormButton disabled={submitting} className="col-span-2 w-full md:col-span-1 md:w-auto">
                    {submitting ? (isEdit ? 'Saving…' : 'Creating…') : isEdit ? 'Save Changes' : 'Create Invoice'}
                  </FormButton>
                )}
              </div>
            </FormFooter>
          </form>
        </div>
      </>
    )
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectedInvoice(null)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  if (view === 'create') return renderForm(false)
  if (view === 'edit')
    return editLoading ? (
      <div className="p-12 text-center text-foreground-muted text-sm">Loading invoice…</div>
    ) : (
      renderForm(true)
    )

  return (
    <>
      {draftFinalizeId && draftBatchItems.length > 0 && (
        <BatchPickerModal
          items={draftBatchItems}
          onConfirm={assignments => {
            const id = draftFinalizeId
            setDraftFinalizeId(null)
            setDraftBatchItems([])
            doFinalizeDraft(id, assignments, [])
          }}
          onCancel={() => {
            setDraftFinalizeId(null)
            setDraftBatchItems([])
          }}
        />
      )}
      {draftFinalizeId && draftSerialItems.length > 0 && draftBatchItems.length === 0 && (
        <SerialEntryModal
          items={draftSerialItems}
          onConfirm={assignments => {
            const id = draftFinalizeId
            setDraftFinalizeId(null)
            setDraftSerialItems([])
            doFinalizeDraft(id, [], assignments)
          }}
          onCancel={() => {
            setDraftFinalizeId(null)
            setDraftSerialItems([])
          }}
        />
      )}
      <div className="space-y-5">
        <PageHeader title="Invoices" description="All online and offline invoices" />
        {canWrite && (
          <TabActionsPortal>
            <TabAction onClick={() => navigateView('create')} icon={<Plus className="w-4 h-4" />} label="New Offline Invoice" />
          </TabActionsPortal>
        )}

        <ListFilters
          entity="invoices"
          fields={INVOICE_FIELDS}
          aliases={INVOICE_ALIASES}
          search={INVOICE_SEARCH}
          noun="Invoices"
          tab="list"
          exportable
        />

        {(draftsLoading || drafts.length > 0) && (
          <section className="overflow-hidden rounded-xl border border-amber-500/40 bg-amber-500/5">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-500/30 px-4 py-3">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <span className="text-sm font-semibold text-foreground">Draft Invoices</span>
                {drafts.length > 0 && <span className={badgeCls('amber')}>{drafts.length}</span>}
              </div>
              <p className="text-xs text-foreground-muted">Draft invoices pending finalization or amendment publishing</p>
            </div>

            {draftsLoading ? (
              <div className="p-6 text-center text-sm text-foreground-muted">Loading drafts…</div>
            ) : (
              <>
                <div className="hidden overflow-x-auto md:block">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-amber-500/30 text-xs text-foreground-muted">
                        {['Order No', 'Customer', 'Phone', 'Amount', 'Stock', 'Created', 'Actions'].map(h => (
                          <th key={h} className={`px-4 py-2.5 font-medium ${h === 'Amount' ? 'text-right' : 'text-left'}`}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {drafts.map(draft => (
                        <tr key={draft.id} className="border-b border-amber-500/20 last:border-0 hover:bg-amber-500/5">
                          <td className="px-4 py-3 font-mono text-xs font-medium">
                            <a href={ap(`/admin/orders/${draft.id}/view`)} className="text-foreground hover:text-accent-500 hover:underline">
                              {draft.order_number}
                            </a>
                            <span className={`ml-2 ${badgeCls(draft.order_number?.startsWith('AMD-') ? 'blue' : 'amber')}`}>{draft.order_number?.startsWith('AMD-') ? 'Amendment Draft' : 'Draft'}</span>
                          </td>
                          <td className="px-4 py-3 text-foreground">{draft.customer_name}</td>
                          <td className="px-4 py-3 text-xs text-foreground-secondary">{draft.customer_phone ? `+91 ${draft.customer_phone}` : '—'}</td>
                          <td className="px-4 py-3 text-right font-semibold tabular-nums text-foreground">₹{fmt(parseFloat(draft.total_amount))}</td>
                          <td className="whitespace-nowrap px-4 py-3">
                            <DraftStockPill draft={draft} />
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-xs text-foreground-secondary">{fmtDate(draft.created_at)}</td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-3">
                              {draft.source === 'offline' && !draft.order_number?.startsWith('AMD-') && canWrite && (
                                <button
                                  onClick={() => openEdit({ id: draft.id, source: 'offline', invoice_number: '', status: 'draft' } as Invoice)}
                                  className="text-xs font-medium text-foreground-secondary hover:text-foreground"
                                >
                                  Edit
                                </button>
                              )}
                              {draft.source !== 'offline' && (
                                <a href={ap(`/admin/invoices/${draft.id}/view`)} className="text-xs font-medium text-foreground-secondary hover:text-foreground">
                                  View
                                </a>
                              )}
                              {draft.order_number?.startsWith('AMD-') ? (
                                <>
                                  <a href={ap(`/admin/invoices/${draft.id}/view`)} className="text-xs font-medium text-foreground-secondary hover:text-foreground">
                                    View
                                  </a>
                                  {canWrite && (
                                    <button onClick={() => publishAmendmentDraft(draft.id)} disabled={publishingId === draft.id} className="text-xs font-semibold text-accent-500 hover:underline disabled:opacity-50">
                                      {publishingId === draft.id ? 'Publishing…' : 'Publish Amendment'}
                                    </button>
                                  )}
                                </>
                              ) : canWrite ? (
                                <button onClick={() => finalizeDraft(draft.id)} disabled={finalizingId === draft.id} className="text-xs font-semibold text-amber-700 hover:underline disabled:opacity-50 dark:text-amber-400">
                                  {finalizingId === draft.id ? 'Finalizing…' : 'Finalize'}
                                </button>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="divide-y divide-amber-500/20 md:hidden">
                  {drafts.map(draft => (
                    <div key={draft.id} className="space-y-2 p-4">
                      <div className="flex flex-col items-start gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-2">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <a href={ap(`/admin/orders/${draft.id}/view`)} className="font-mono text-xs font-medium text-foreground hover:text-accent-500 hover:underline">
                            {draft.order_number}
                          </a>
                          <span className={badgeCls(draft.order_number?.startsWith('AMD-') ? 'blue' : 'amber')}>{draft.order_number?.startsWith('AMD-') ? 'Amendment Draft' : 'Draft'}</span>
                        </div>
                        <span className="shrink-0 whitespace-nowrap text-sm font-semibold tabular-nums text-foreground">₹{fmt(parseFloat(draft.total_amount))}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-foreground">{draft.customer_name}</span>
                        <span className="text-xs text-foreground-secondary">{fmtDate(draft.created_at)}</span>
                      </div>
                      {draft.customer_phone && <p className="text-xs text-foreground-secondary">+91 {draft.customer_phone}</p>}
                      <div className="pt-1">
                        <DraftStockPill draft={draft} />
                      </div>
                      <div className="flex gap-4 pt-1">
                        {draft.source === 'offline' && !draft.order_number?.startsWith('AMD-') && canWrite && (
                          <button
                            onClick={() => openEdit({ id: draft.id, source: 'offline', invoice_number: '', status: 'draft' } as Invoice)}
                            className="text-xs font-medium text-foreground-secondary hover:text-foreground"
                          >
                            Edit
                          </button>
                        )}
                        {(draft.source !== 'offline' || draft.order_number?.startsWith('AMD-')) && (
                          <a href={ap(`/admin/invoices/${draft.id}/view`)} className="text-xs font-medium text-foreground-secondary hover:text-foreground">
                            View
                          </a>
                        )}
                        {draft.order_number?.startsWith('AMD-') ? (
                          canWrite && (
                            <button onClick={() => publishAmendmentDraft(draft.id)} disabled={publishingId === draft.id} className="text-xs font-semibold text-accent-500 disabled:opacity-50">
                              {publishingId === draft.id ? 'Publishing…' : 'Publish Amendment'}
                            </button>
                          )
                        ) : canWrite ? (
                          <button onClick={() => finalizeDraft(draft.id)} disabled={finalizingId === draft.id} className="text-xs font-semibold text-amber-700 disabled:opacity-50 dark:text-amber-400">
                            {finalizingId === draft.id ? 'Finalizing…' : 'Finalize'}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>
        )}

        {loading ? (
          <TableSkeleton rows={8} cols={8} />
        ) : invoices.length === 0 ? (
          <EmptyState title="No invoices found." body="Try a different search or clear the filters." />
        ) : (
          <>
            <div className="hidden overflow-hidden rounded-xl border border-border-default bg-surface-elevated md:block">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border-default bg-surface-secondary/50 text-xs text-foreground-muted">
                      <SortTh label="Invoice No" col="invoice_number" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                      <SortTh label="Customer" col="customer" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                      <SortTh label="Date" col="date" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                      <SortTh label="Amount" col="amount" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} num />
                      <SortTh label="Payment" col="payment" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                      <SortTh label="Source" col="source" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                      <th className="px-3 py-2.5 text-left font-medium">IRN</th>
                      <th className="px-3 py-2.5 text-right font-medium">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedInvoices.map(inv => (
                      <tr key={inv.id} className="cursor-pointer border-b border-border-default/60 last:border-0 hover:bg-surface-secondary/60" onClick={() => setSelectedInvoice(inv)}>
                        <td className="px-3 py-2.5" onClick={e => e.stopPropagation()}>
                          <HoverCard
                            trigger={
                              <a
                                href={ap(inv.source === 'cash_sale' ? `/admin/cash-sale/${inv.id}/view` : `/admin/invoices/${inv.id}/view`)}
                                className="font-mono text-sm font-semibold text-accent-500 hover:text-accent-600 hover:underline"
                              >
                                {inv.invoice_number}
                              </a>
                            }
                            align="left"
                            side="bottom"
                            width="260px"
                          >
                            <div className="space-y-2 p-3">
                              <p className="font-mono text-sm font-semibold text-foreground">{inv.invoice_number}</p>
                              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                                <span className="text-foreground-muted">Customer</span>
                                <span className="truncate font-medium text-foreground">{inv.customer_name || '—'}</span>
                                {inv.customer_phone && (
                                  <>
                                    <span className="text-foreground-muted">Phone</span>
                                    <span className="text-foreground">+91 {inv.customer_phone}</span>
                                  </>
                                )}
                                <span className="text-foreground-muted">Date</span>
                                <span className="text-foreground">{fmtDate(inv.invoice_date)}</span>
                                <span className="text-foreground-muted">Total</span>
                                <span className="font-semibold text-foreground">₹{fmt(parseFloat(inv.total_amount))}</span>
                                <span className="text-foreground-muted">Payment</span>
                                <span>
                                  <StatusBadge status={inv.payment_status} map={PAYMENT_STATUS} />
                                </span>
                                <span className="text-foreground-muted">Source</span>
                                <span className="text-foreground">{SOURCE_STATUS[inv.source]?.label ?? 'Offline'}</span>
                              </div>
                            </div>
                          </HoverCard>
                          {inv.order_number && <div className="mt-0.5 font-mono text-xs text-foreground-muted">{inv.order_number}</div>}
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="font-medium text-foreground">{inv.customer_name}</div>
                          {inv.customer_phone && <div className="mt-0.5 text-xs text-foreground-muted">+91 {inv.customer_phone}</div>}
                          {inv.buyer_gstin && <div className="mt-0.5 font-mono text-xs text-foreground-muted">{inv.buyer_gstin}</div>}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-foreground-secondary">{fmtDate(inv.invoice_date)}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">
                          <div className="font-semibold text-foreground">₹{fmt(parseFloat(inv.total_amount))}</div>
                          {parseFloat(inv.taxable_amount) > 0 && <div className="mt-0.5 text-xs text-foreground-muted">Taxable ₹{fmt(parseFloat(inv.taxable_amount))}</div>}
                        </td>
                        <td className="px-3 py-2.5">
                          <StatusBadge status={inv.payment_status} map={PAYMENT_STATUS} />
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex flex-wrap items-center gap-1">
                            <StatusBadge status={inv.source} map={SOURCE_STATUS} label={SOURCE_STATUS[inv.source]?.label ?? 'Offline'} />
                            {inv.status === 'cancelled' && <span className={badgeCls('red')}>Cancelled</span>}
                          </div>
                        </td>
                        <td className="px-3 py-2.5">
                          {inv.irn ? (
                            <span className={`${badgeCls(inv.irn_status === 'generated' ? 'green' : 'amber')} inline-flex items-center gap-1`}>
                              {inv.irn_status === 'generated' ? (
                                <>
                                  <Check className="h-3 w-3" /> IRN
                                </>
                              ) : (
                                'Stub'
                              )}
                            </span>
                          ) : (
                            <span className="text-xs text-foreground-muted">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right" onClick={e => e.stopPropagation()}>
                          <RowActions
                            size="sm"
                            actions={
                              inv.source === 'cash_sale'
                                ? [
                                    { key: 'download-receipt', kind: 'download', label: 'Download Receipt PDF', href: `/api/admin/cash-sale/${inv.id}/receipt`, target: '_blank' },
                                    { key: 'view-sale', kind: 'open', label: 'View Sale', href: ap(`/admin/cash-sale/${inv.id}/view`) },
                                  ]
                                : [
                                    { key: 'download-invoice', kind: 'download', label: 'Download Invoice PDF', href: `/api/orders/${inv.id}/invoice`, target: '_blank' },
                                    { key: 'view-invoice', kind: 'open', label: 'View Invoice', href: ap(`/admin/invoices/${inv.id}/view`) },
                                    {
                                      key: 'send-email',
                                      kind: 'email',
                                      label: `Send email to ${inv.customer_email}`,
                                      hidden: !inv.customer_email,
                                      busy: sendingEmailId === inv.id,
                                      onSelect: () => sendInvoiceEmail(inv),
                                    },
                                    {
                                      key: 'edit',
                                      kind: 'edit',
                                      label: 'Edit Invoice',
                                      scope: 'invoices:write',
                                      hidden: inv.source !== 'offline' || inv.status === 'cancelled',
                                      onSelect: () => openEdit(inv),
                                    },
                                    {
                                      key: 'cancel',
                                      label: 'Cancel Invoice',
                                      icon: X,
                                      variant: 'danger',
                                      scope: 'invoices:write',
                                      hidden: inv.source !== 'offline' || inv.status === 'cancelled',
                                      busy: cancellingId === inv.id,
                                      onSelect: () => cancelInvoice(inv),
                                      confirm: {
                                        title: 'Cancel Invoice',
                                        message: `Cancel invoice ${inv.invoice_number}? This action cannot be undone.`,
                                        confirmLabel: 'Cancel Invoice',
                                        cancelLabel: 'Keep',
                                        variant: 'danger',
                                      },
                                    },
                                  ]
                            }
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <InvoicesMobileList invoices={invoices} canWrite={canWrite} sendingEmailId={sendingEmailId} cancellingId={cancellingId} onSendEmail={sendInvoiceEmail} onCancel={cancelInvoice} />
          </>
        )}
        <InfiniteFooter shown={invoices.length} control={list} noun="invoices" />
        <InvoiceDetailModal inv={selectedInvoice} onClose={() => setSelectedInvoice(null)} />
      </div>
    </>
  )
}

/** Header cell that toggles the server sort for one column (desc first, then asc). */
function SortTh({ label, col, sortCol, sortDir, onSort, num }: { label: string; col: string; sortCol?: string; sortDir?: SortDir; onSort: (c: string, d: SortDir) => void; num?: boolean }) {
  const on = sortCol === col
  return (
    <th
      aria-sort={on ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}
      onClick={() => onSort(col, on && sortDir !== 'asc' ? 'asc' : 'desc')}
      className={`cursor-pointer select-none whitespace-nowrap px-3 py-2.5 font-medium hover:text-foreground ${num ? 'text-right' : 'text-left'}`}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {on && (sortDir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
      </span>
    </th>
  )
}

function InvoiceDetailModal({ inv, onClose }: { inv: Invoice | null; onClose: () => void }) {
  const money = (v: string) => `₹${fmt(parseFloat(v))}`
  const isCash = inv?.source === 'cash_sale'
  return (
    <Dialog
      open={!!inv}
      onClose={onClose}
      size="lg"
      zIndex="z-[300]"
      title={<span className="font-mono">{inv?.invoice_number}</span>}
      description={inv && new Date(inv.invoice_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
      footer={
        inv && (
          <a href={isCash ? `/api/admin/cash-sale/${inv.id}/receipt` : `/api/orders/${inv.id}/invoice`} target="_blank" rel="noopener noreferrer" className="control-md bg-accent-500 font-medium text-white hover:bg-accent-600">
            <Download className="h-4 w-4" />
            {isCash ? 'Receipt PDF' : 'Invoice PDF'}
          </a>
        )
      }
    >
      {inv && (
        <div className="space-y-5">
          <div className="flex flex-wrap gap-2">
            <StatusBadge status={inv.payment_status} map={PAYMENT_STATUS} />
            <StatusBadge status={inv.source} map={SOURCE_STATUS} label={SOURCE_STATUS[inv.source]?.label ?? 'Offline'} />
            {inv.irn && (
              <span className={`${badgeCls(inv.irn_status === 'generated' ? 'green' : 'amber')} inline-flex items-center gap-1`}>
                {inv.irn_status === 'generated' ? (
                  <>
                    <Check className="h-3 w-3" /> IRN
                  </>
                ) : (
                  'IRN Stub'
                )}
              </span>
            )}
          </div>
          <Fields>
            <Field
              label="Customer"
              value={
                <span className="block">
                  <span className="font-semibold">{inv.customer_name}</span>
                  {inv.customer_phone && <span className="block text-xs text-foreground-secondary">+91 {inv.customer_phone}</span>}
                  {inv.customer_email && <span className="block text-xs text-foreground-secondary">{inv.customer_email}</span>}
                  {inv.buyer_gstin && <span className="block font-mono text-xs text-foreground-secondary">{inv.buyer_gstin}</span>}
                </span>
              }
            />
            <Field label="Order" value={inv.order_number} mono />
          </Fields>
          <div className="grid grid-cols-2 gap-3 rounded-lg bg-surface-secondary p-3 sm:grid-cols-4 [&>*:last-child:nth-child(odd)]:col-span-2 sm:[&>*:last-child:nth-child(odd)]:col-span-1">
            <Field label="Taxable" value={<span className="font-semibold tabular-nums">{money(inv.taxable_amount)}</span>} />
            {parseFloat(inv.cgst_amount) > 0 && (
              <Field
                label="CGST + SGST"
                value={
                  <span className="font-semibold tabular-nums">
                    {money(inv.cgst_amount)} + {money(inv.sgst_amount)}
                  </span>
                }
              />
            )}
            {parseFloat(inv.igst_amount) > 0 && <Field label="IGST" value={<span className="font-semibold tabular-nums">{money(inv.igst_amount)}</span>} />}
            <Field label="Total" value={<span className="font-bold tabular-nums">{money(inv.total_amount)}</span>} />
          </div>
        </div>
      )}
    </Dialog>
  )
}

// Inline stock-availability pill for the Draft Invoices table.
// Backend returns total_items / short_items / out_of_stock_items / stock_lines per draft.
// Hovering shows a per-item breakdown popup.
function DraftStockPill({ draft }: { draft: any }) {
  const total = Number(draft?.total_items ?? 0)
  const short = Number(draft?.short_items ?? 0)
  const oos = Number(draft?.out_of_stock_items ?? 0)
  const lines: Array<{
    product_name: string
    variant_name?: string
    buy_unit?: string
    raw_qty: number
    req_qty: number
    avail_qty: number
    ok: boolean
  }> = Array.isArray(draft?.stock_lines) ? draft.stock_lines : []

  const pill = (() => {
    if (total === 0) return <span className="text-xs text-foreground-muted">—</span>
    if (short === 0)
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-green-500/10 text-green-700 dark:text-green-400">
          <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
          All {total} in stock
        </span>
      )
    if (oos > 0)
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-red-500/10 text-red-600 dark:text-red-400">
          <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
          {oos} of {total} out of stock
        </span>
      )
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-amber-500/10 text-amber-700 dark:text-amber-400">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
        {short} of {total} short
      </span>
    )
  })()

  if (total === 0 || lines.length === 0) return pill

  return (
    <span className="relative group inline-flex">
      {pill}
      {/* Hover popup — hidden (removed from layout) until hover, so it never reserves vertical
          space inside the table's scroll container. Shown below the pill to avoid top clipping. */}
      <span
        className="pointer-events-none hidden group-hover:block absolute top-full left-0 md:left-1/2 md:-translate-x-1/2 mt-2 z-50
        w-72 rounded-lg border border-border-default bg-surface shadow-lg p-2"
      >
        <span className="block text-xs font-semibold text-foreground mb-1.5">Stock breakdown</span>
        {lines.map((l, i) => {
          const name = l.variant_name ? `${l.product_name} — ${l.variant_name}` : l.product_name
          const avail = Number(l.avail_qty)
          const req = Number(l.req_qty)
          const raw = Number(l.raw_qty)
          const isBulkUnit = l.buy_unit && l.buy_unit !== 'pc' && l.buy_unit !== 'pcs' && req !== raw
          const statusColor =
            avail <= 0
              ? 'text-red-600 dark:text-red-400'
              : avail < req
                ? 'text-amber-600 dark:text-amber-400'
                : 'text-green-600 dark:text-green-400'
          return (
            <span
              key={i}
              className="flex items-start justify-between gap-2 py-1 border-t border-border-default first:border-0"
            >
              <span className="text-xs text-foreground leading-snug truncate max-w-[150px]" title={name}>
                {name}
              </span>
              <span className={`text-xs font-medium whitespace-nowrap shrink-0 ${statusColor}`}>
                {isBulkUnit ? `${raw} ${l.buy_unit} = ${req} pcs` : `${req} pcs`}
                {' · '}stock: {avail}
              </span>
            </span>
          )
        })}
      </span>
    </span>
  )
}
