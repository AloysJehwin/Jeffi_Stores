'use client'

import { useState, useEffect, useRef } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { ArrowDown, ArrowUp, Check, Plus, X } from 'lucide-react'
import { TabAction, TabActionsPortal, PageHeader, QUOTATION_STATUS, StatusBadge, badgeCls, Dialog, EmptyState, TableSkeleton, FormFooter, FormButton, fieldInputCls, useActionToast, InfiniteFooter, fetchJson, useInfiniteList } from '@/components/admin/kit'
import { useToast } from '@/contexts/ToastContext'
import RowActions from '@/components/admin/RowActions'
import AdminSelect from '@/components/admin/AdminSelect'
import { ap } from '@/lib/shared/admin-path'
import AdminTypeahead from '@/components/admin/AdminTypeahead'
import LineItemsSection, {
  LineItem,
  newLineItem,
  fetchSeedLineItem,
  isBlankLine,
  isCustomLine,
  validateLineItems,
  apiErrorMessage,
} from '@/components/admin/LineItemsSection'
import BatchPickerModal, {
  type BatchPickerItem,
  type BatchAssignment,
  type BatchOption,
  initSelections,
  expiryColor,
} from '@/components/admin/BatchPickerModal'
import SerialEntryModal, {
  type SerialItem,
  type SerialAssignment,
  SerialPicker,
} from '@/components/admin/SerialEntryModal'
import { type SortDir } from '@/components/admin/sortOptions'
import DatePicker from '@/components/ui/DatePicker'
import HoverCard from '@/components/ui/HoverCard'
import Toggle from '@/components/ui/Toggle'
import { lineItemExGst } from '@/lib/catalog/pricing'
import QuotationsMobileList from './_components/QuotationsMobileList'
import { round2 } from '@/lib/catalog/gst'

export interface Quotation {
  id: string
  quote_number: string
  quote_date: string
  status: string
  consignee_name: string
  consignee_addr1: string
  consignee_addr2: string | null
  consignee_city: string
  consignee_state: string
  consignee_gstin: string | null
  consignee_phone: string | null
  consignee_pincode: string | null
  consignee_email: string | null
  buyer_same: boolean
  buyer_name: string | null
  buyer_addr1: string | null
  buyer_addr2: string | null
  buyer_city: string | null
  buyer_state: string | null
  buyer_gstin: string | null
  buyer_phone: string | null
  buyer_pincode: string | null
  buyer_email: string | null
  notes: string | null
  subtotal: number
  cgst_amount: number
  sgst_amount: number
  total_amount: number
  converted_order_id: string | null
  view_token: string | null
  from_rfq: boolean | null
  created_at: string
}

type View = 'list' | 'editor'

// Badge class strings keyed by status; the mobile list reads these.
export const STATUS_COLORS: Record<string, string> = Object.fromEntries(Object.entries(QUOTATION_STATUS).map(([k, v]) => [k, badgeCls(v.tone)]))

function fmt2(n: number | string) {
  return Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDate(d: string) {
  if (!d) return ''
  const dt = new Date(d)
  return `${String(dt.getDate()).padStart(2, '0')}-${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][dt.getMonth()]}-${dt.getFullYear()}`
}

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

export default function QuotationsClient({ canWrite = false }: { canWrite?: boolean }) {
  const { showToast } = useToast()
  const searchParams = useSearchParams()
  const router = useRouter()
  const [view, setViewState] = useState<View>(() => {
    return searchParams.get('view') === 'editor' ? 'editor' : 'list'
  })

  // sync view state when URL changes (browser back/forward)
  useEffect(() => {
    const next: View = searchParams.get('view') === 'editor' ? 'editor' : 'list'
    setViewState(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  // open editor directly when ?edit=<id> is in the URL (e.g. from detail page Edit button)
  useEffect(() => {
    const editParam = searchParams.get('edit')
    if (editParam && searchParams.get('view') === 'editor') {
      openEdit(editParam)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function navigateView(next: View) {
    setViewState(next)
    if (next === 'list') {
      router.back()
    } else {
      const params = new URLSearchParams(window.location.search)
      params.set('view', next)
      router.push(ap(`/admin/quotations?${params.toString()}`), { scroll: false })
    }
  }
  const [selectedQuote, setSelectedQuote] = useState<Quotation | null>(null)
  const toast = useActionToast()
  // Load/delete failures are action responses: toast, not a banner.
  const setError = (m: string) => {
    if (m) toast.error(m)
  }
  const [statusFilter, setStatusFilter] = useState(searchParams.get('status') || 'all')
  const [searchQ, setSearchQ] = useState(searchParams.get('q') || '')
  const [fromDate, setFromDate] = useState(searchParams.get('from') || '')
  const [toDate, setToDate] = useState(searchParams.get('to') || '')
  const [sortCol, setSortCol] = useState<string | undefined>(undefined)
  const [sortDir, setSortDir] = useState<SortDir | undefined>(undefined)

  const PAGE_SIZE = 25

  function syncUrl(patch: Record<string, string>) {
    const p = new URLSearchParams(window.location.search)
    for (const [k, v] of Object.entries(patch)) {
      if (v && v !== 'all') p.set(k, v)
      else p.delete(k)
    }
    router.replace(ap(`/admin/quotations?${p.toString()}`), { scroll: false })
  }

  function handleSort(col: string, dir: SortDir) {
    setSortCol(col || undefined)
    setSortDir(col ? dir : undefined)
    // Server-side sort — a useEffect keyed on sortCol/sortDir refetches page 1.
  }

  const [editId, setEditId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [autoSaveStatus, setAutoSaveStatus] = useState<'idle' | 'pending' | 'saving' | 'saved'>('idle')
  const [isFinal, setIsFinal] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [convertingInvoice, setConvertingInvoice] = useState(false)
  const [convertedOrderId, setConvertedOrderId] = useState<string | null>(null)
  const [showConvertModal, setShowConvertModal] = useState(false)
  const [convertPendingQuoteId, setConvertPendingQuoteId] = useState<string | null>(null)
  const [convertPaymentMode, setConvertPaymentMode] = useState('cash')
  const [convertEnableDelivery, setConvertEnableDelivery] = useState(false)
  const [convertQrImageUrl, setConvertQrImageUrl] = useState<string | null>(null)
  const [convertQrTotal, setConvertQrTotal] = useState(0)
  const [convertResultOrderId, setConvertResultOrderId] = useState<string | null>(null)
  const [convertSavedAsDraft, setConvertSavedAsDraft] = useState(false)
  const [convertInsufficientItems, setConvertInsufficientItems] = useState<string[]>([])
  const [convertHasStockIssue, setConvertHasStockIssue] = useState(false)
  const [convertBatchPickerItems, setConvertBatchPickerItems] = useState<BatchPickerItem[] | null>(null)
  const [convertSerialPickerItems, setConvertSerialPickerItems] = useState<SerialItem[] | null>(null)
  const [pendingConvertArgs, setPendingConvertArgs] = useState<{
    quoteId: string
    paymentMode: string
    enableDelivery: boolean
  } | null>(null)
  const [convertStep, setConvertStep] = useState<'payment' | 'assign'>('payment')
  const [convertBatchSelections, setConvertBatchSelections] = useState<Record<string, Record<string, number>>>({})
  const [convertSerialSelections, setConvertSerialSelections] = useState<Record<string, Set<string>>>(() => ({}))
  // Scanner mode for the Assign Stock serial pickers (default on — scan fields).
  const [convertScanEnabled, setConvertScanEnabled] = useState(true)
  const [sendingEmailId, setSendingEmailId] = useState<string | null>(null)
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [quoteNumber, setQuoteNumber] = useState('')
  const [quoteDate, setQuoteDate] = useState(todayISO())
  const [notes, setNotes] = useState('')

  const [cName, setCName] = useState('')
  const [cAddr1, setCAddr1] = useState('')
  const [cAddr2, setCAddr2] = useState('')
  const [cCity, setCCity] = useState('')
  const [cState, setCState] = useState('Chhattisgarh')
  const [cGstin, setCGstin] = useState('')
  const [cPhone, setCPhone] = useState('')
  const [cPincode, setCPincode] = useState('')
  const [cEmail, setCEmail] = useState('')

  const [buyerSame, setBuyerSame] = useState(true)
  const [bName, setBName] = useState('')
  const [bAddr1, setBAddr1] = useState('')
  const [bAddr2, setBAddr2] = useState('')
  const [bCity, setBCity] = useState('')
  const [bState, setBState] = useState('Chhattisgarh')
  const [bGstin, setBGstin] = useState('')
  const [bPhone, setBPhone] = useState('')
  const [bPincode, setBPincode] = useState('')
  const [bEmail, setBEmail] = useState('')

  const [items, setItems] = useState<LineItem[]>([newLineItem()])

  // Deep-link preseed (scan → New Quotation): ?product=<id> with no ?edit seeds the
  // first line of a fresh editor. Best-effort; skips when editing an existing quotation.
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

  const [custSearch, setCustSearch] = useState('')
  const [custResults, setCustResults] = useState<any[]>([])
  const [showCustDrop, setShowCustDrop] = useState(false)
  const custTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [buyerSearch, setBuyerSearch] = useState('')
  const [buyerResults, setBuyerResults] = useState<any[]>([])
  const [showBuyerDrop, setShowBuyerDrop] = useState(false)
  const buyerTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const isEditorMounted = useRef(false)

  const QUOTE_SORT_KEYS: Record<string, keyof Quotation> = {
    quote_number: 'quote_number',
    date: 'quote_date',
    consignee: 'consignee_name',
    total: 'total_amount',
    status: 'status',
  }


  // Ordered server-side across all quotations via sort/dir params.
  const list = useInfiniteList<Quotation>({
    key: view === 'list' ? `${statusFilter}|${searchQ}|${fromDate}|${toDate}|${sortCol}|${sortDir}` : null,
    pageSize: PAGE_SIZE,
    getKey: q => q.id,
    fetchPage: async (p, signal) => {
      const params = new URLSearchParams()
      if (statusFilter !== 'all') params.set('status', statusFilter)
      if (searchQ) params.set('q', searchQ)
      if (fromDate) params.set('from', fromDate)
      if (toDate) params.set('to', toDate)
      if (sortCol && QUOTE_SORT_KEYS[sortCol]) {
        params.set('sort', QUOTE_SORT_KEYS[sortCol])
        params.set('dir', sortDir || 'desc')
      }
      params.set('page', String(p))
      params.set('pageSize', String(PAGE_SIZE))
      const data = await fetchJson(`/api/admin/quotations?${params}`, signal)
      return { rows: data.quotations || [], total: data.total || 0 }
    },
  })
  const quotations = list.rows
  const sortedQuotations = quotations
  const loading = list.loading
  const loadList = list.reload

  function newQuotation() {
    setEditId(null)
    setQuoteNumber('')
    setQuoteDate(todayISO())
    setNotes('')
    setCName('')
    setCAddr1('')
    setCAddr2('')
    setCCity('')
    setCState('Chhattisgarh')
    setCGstin('')
    setCPhone('')
    setCPincode('')
    setCEmail('')
    setBuyerSame(true)
    setBName('')
    setBAddr1('')
    setBAddr2('')
    setBCity('')
    setBState('Chhattisgarh')
    setBGstin('')
    setBPhone('')
    setBPincode('')
    setBEmail('')
    setItems([newLineItem()])
    setSaveError('')
    setIsFinal(false)
    setAutoSaveStatus('idle')
    isEditorMounted.current = false
    navigateView('editor')
  }

  async function openEdit(id: string) {
    setSaveError('')
    try {
      const res = await fetch(`/api/admin/quotations/${id}`)
      const data = await res.json()
      if (!res.ok) throw new Error(apiErrorMessage(res, data, 'Failed to load quotation'))
      const q: Quotation = data.quotation
      setEditId(id)
      setQuoteNumber(q.quote_number)
      setQuoteDate(q.quote_date?.slice(0, 10) || todayISO())
      setNotes(q.notes || '')
      setCName(q.consignee_name || '')
      setCAddr1(q.consignee_addr1 || '')
      setCAddr2(q.consignee_addr2 || '')
      setCCity(q.consignee_city || '')
      setCState(q.consignee_state || 'Chhattisgarh')
      setCGstin(q.consignee_gstin || '')
      setCPhone(
        (q.consignee_phone || '')
          .replace(/^\+?91/, '')
          .replace(/\D/g, '')
          .slice(-10)
      )
      setCPincode(q.consignee_pincode || '')
      setCEmail(q.consignee_email || '')
      setBuyerSame(q.buyer_same)
      setBName(q.buyer_name || '')
      setBAddr1(q.buyer_addr1 || '')
      setBAddr2(q.buyer_addr2 || '')
      setBCity(q.buyer_city || '')
      setBState(q.buyer_state || 'Chhattisgarh')
      setBGstin(q.buyer_gstin || '')
      setBPhone(
        (q.buyer_phone || '')
          .replace(/^\+?91/, '')
          .replace(/\D/g, '')
          .slice(-10)
      )
      setBPincode(q.buyer_pincode || '')
      setBEmail(q.buyer_email || '')
      const loadedItems: LineItem[] = (data.items || []).map((i: any) => {
        const gstRate = Number(i.gst_rate) || 0
        const rateExGst = Number(i.rate) || 0
        // rate is pre-discount ex-GST; show unit_price as pre-discount incl. GST so the discount field is meaningful
        const unitPrice = round2(rateExGst * (1 + gstRate / 100))
        const discPct = Number(i.discount_pct) || 0
        const mrp = Number(i.mrp) || 0
        return {
          id: i.id || Math.random().toString(36).slice(2),
          product_id: i.product_id || null,
          is_custom: !i.product_id,
          product_name: i.description || '',
          product_sku: i.sku || '',
          variant_id: i.variant_id || null,
          sub_variant_id: i.sub_variant_id || null,
          variant_name: '',
          hsn_code: i.hsn_code || '',
          gst_rate: String(gstRate),
          quantity: Number(i.quantity) || 1,
          unit: i.unit || 'PCS',
          unit_price: unitPrice,
          discount_pct: discPct,
          mrp,
          inventory_quantity: i.inventory_quantity ?? null,
          buy_unit: i.buy_unit || null,
          buy_mode: i.buy_mode || null,
          sell_unit_factor: Number(i.sell_unit_factor) || 1,
          sell_unit_dimension: i.sell_unit_dimension || null,
          available_units: [],
        }
      })
      setItems(loadedItems.length ? loadedItems : [newLineItem()])
      setIsFinal(q.status === 'final')
      setConvertedOrderId(q.converted_order_id || null)
      setAutoSaveStatus('idle')
      isEditorMounted.current = false
      navigateView('editor')
    } catch (e: any) {
      setError(e?.message || 'Failed to load quotation')
      showToast(e?.message || 'Failed to load quotation', 'error')
    }
  }

  async function convertToInvoice(
    quoteId: string,
    paymentMode: string,
    enableDelivery: boolean,
    batchAssignments?: BatchAssignment[],
    serialAssignments?: SerialAssignment[]
  ) {
    // Before converting, check if any items need batch/serial selection
    if (!batchAssignments && !serialAssignments) {
      try {
        const res = await fetch(`/api/admin/inventory/batches/available?quotation_id=${quoteId}`, {
          credentials: 'include',
        })
        if (res.ok) {
          const data = await res.json()
          const hasBatch = data.items && data.items.length > 0
          const hasSerial = data.serialized_items && data.serialized_items.length > 0
          if (hasBatch || hasSerial) {
            // Skip assign step if any item has insufficient stock — server will save as draft
            const anyShortBatch =
              hasBatch &&
              data.items.some(
                (i: BatchPickerItem) =>
                  !i.already_assigned &&
                  i.batches.reduce((s: number, b: BatchOption) => s + b.quantity_remaining, 0) < i.required_qty
              )
            if (!anyShortBatch && !convertHasStockIssue) {
              setPendingConvertArgs({ quoteId, paymentMode, enableDelivery })
              if (hasBatch) {
                setConvertBatchPickerItems(data.items)
                const init: Record<string, Record<string, number>> = {}
                for (const item of data.items) {
                  if (!item.already_assigned) init[item.order_item_id] = initSelections(item)
                }
                setConvertBatchSelections(init)
              }
              if (hasSerial) {
                setConvertSerialPickerItems(data.serialized_items)
                setConvertSerialSelections(
                  Object.fromEntries(
                    data.serialized_items
                      .filter((i: SerialItem) => !i.already_assigned)
                      .map((i: SerialItem) => [i.order_item_id, new Set<string>()])
                  )
                )
              }
              setConvertStep('assign')
              return
            }
          }
        }
      } catch (_) {}
    }

    setConvertingInvoice(true)
    try {
      const res = await fetch(`/api/admin/quotations/${quoteId}/convert-to-invoice`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paymentMode,
          enableDelivery,
          ...(batchAssignments && batchAssignments.length > 0 ? { batch_assignments: batchAssignments } : {}),
          ...(serialAssignments && serialAssignments.length > 0 ? { serial_assignments: serialAssignments } : {}),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        showToast(apiErrorMessage(res, data, 'Conversion failed'), 'error')
        return
      }
      setConvertedOrderId(data.orderId)
      setConvertResultOrderId(data.orderId)
      loadList()
      if (data.savedAsDraft) {
        setConvertSavedAsDraft(true)
        setConvertInsufficientItems(data.insufficientItems || [])
        showToast(
          `Saved as draft invoice — not enough stock for ${(data.insufficientItems || []).length} item(s)`,
          'error'
        )
      } else if (data.qrImageUrl) {
        setConvertQrImageUrl(data.qrImageUrl)
      } else {
        setShowConvertModal(false)
        showToast(`Invoice ${data.invoiceNumber} created`, 'success')
        if (data.orderId) window.location.href = ap(`/admin/invoices/${data.orderId}/view`)
      }
    } catch {
      showToast('Failed to convert quotation', 'error')
    } finally {
      setConvertingInvoice(false)
    }
  }

  async function save(newStatus?: string) {
    if (newStatus === 'final') {
      if (!cName.trim()) {
        setSaveError('Consignee name is required')
        return
      }
      if (!cAddr1.trim()) {
        setSaveError('Consignee address line 1 is required')
        return
      }
      if (!cCity.trim()) {
        setSaveError('Consignee city is required')
        return
      }
      if (!cPhone.trim()) {
        setSaveError('Consignee phone number is required')
        return
      }
      if (!buyerSame) {
        if (!bName.trim()) {
          setSaveError('Buyer name is required')
          return
        }
        if (!bAddr1.trim()) {
          setSaveError('Buyer address line 1 is required')
          return
        }
        if (!bCity.trim()) {
          setSaveError('Buyer city is required')
          return
        }
      }
    }
    // Explicit save (final) surfaces line problems; autosave just waits for valid lines.
    const lineError = validateLineItems(items)
    if (lineError) {
      if (newStatus === 'final') {
        setSaveError(lineError)
        showToast(lineError, 'error')
      } else if (items.some(i => !isBlankLine(i))) {
        setSaveError(`Not saved yet — ${lineError}`)
      }
      setAutoSaveStatus('idle')
      return
    }
    setSaving(true)
    setSaveError('')
    setAutoSaveStatus('saving')
    try {
      const body = {
        quote_date: quoteDate,
        notes,
        consignee_name: cName,
        consignee_addr1: cAddr1,
        consignee_addr2: cAddr2 || null,
        consignee_city: cCity,
        consignee_state: cState,
        consignee_gstin: cGstin || null,
        consignee_phone: cPhone || null,
        consignee_pincode: cPincode || null,
        consignee_email: cEmail || null,
        buyer_same: buyerSame,
        buyer_name: buyerSame ? null : bName,
        buyer_addr1: buyerSame ? null : bAddr1,
        buyer_addr2: buyerSame ? null : bAddr2 || null,
        buyer_city: buyerSame ? null : bCity,
        buyer_state: buyerSame ? null : bState,
        buyer_gstin: buyerSame ? null : bGstin || null,
        buyer_phone: buyerSame ? null : bPhone || null,
        buyer_pincode: buyerSame ? null : bPincode || null,
        buyer_email: buyerSame ? null : bEmail || null,
        items: items
          .filter(i => !isBlankLine(i))
          .map(i => {
            const custom = isCustomLine(i)
            const gstRate = Number(i.gst_rate) || 0
            const unitPrice = Number(i.unit_price) || 0
            // rate = per-piece ex-GST; product lines anchor on MRP, custom lines on the entered rate
            const inclGst = custom ? unitPrice : Number(i.mrp) || unitPrice
            return {
              description: i.product_name.trim(),
              hsn_code: i.hsn_code || null,
              gst_rate: gstRate,
              quantity: i.quantity,
              unit: custom ? (i.unit || 'PCS').trim().toUpperCase() : i.unit,
              buy_unit: custom ? null : i.buy_unit || null,
              rate: inclGst / (1 + gstRate / 100),
              discount_pct: Number(i.discount_pct) || 0,
              product_id: custom ? null : i.product_id,
              variant_id: custom ? null : i.variant_id || null,
              sub_variant_id: custom ? null : i.sub_variant_id || null,
              sell_unit_factor: custom ? 1 : i.sell_unit_factor || 1,
              sell_unit_dimension: custom ? null : i.sell_unit_dimension,
              is_custom: custom,
            }
          }),
        ...(newStatus ? { status: newStatus } : {}),
      }

      let res: Response
      if (editId) {
        res = await fetch(`/api/admin/quotations/${editId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
      } else {
        res = await fetch('/api/admin/quotations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
      }
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(apiErrorMessage(res, data, 'Save failed'))
      if (!editId) setEditId(data.quotation.id)
      setQuoteNumber(data.quotation.quote_number)
      setAutoSaveStatus('saved')
      setTimeout(() => setAutoSaveStatus('idle'), 2000)
      if (newStatus === 'final') {
        setIsFinal(true)
        navigateView('list')
      }
    } catch (e: any) {
      setSaveError(e.message || 'Save failed')
      if (newStatus) showToast(e.message || 'Save failed', 'error')
      setAutoSaveStatus('idle')
    } finally {
      setSaving(false)
    }
  }

  function scheduleAutoSave() {
    if (isFinal) return
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)
    setAutoSaveStatus('pending')
    autoSaveTimer.current = setTimeout(() => {
      save()
    }, 1500)
  }

  useEffect(() => {
    if (view !== 'editor') return
    if (!isEditorMounted.current) {
      isEditorMounted.current = true
      return
    }
    scheduleAutoSave()
  }, [
    quoteDate,
    notes,
    cName,
    cAddr1,
    cAddr2,
    cCity,
    cState,
    cGstin,
    cPhone,
    cPincode,
    cEmail,
    buyerSame,
    bName,
    bAddr1,
    bAddr2,
    bCity,
    bState,
    bGstin,
    bPhone,
    bPincode,
    bEmail,
    items,
  ])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectedQuote(null)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  async function downloadPDF() {
    if (!editId) {
      await save()
    }
    if (!editId) return
    setDownloading(true)
    try {
      const res = await fetch(`/api/admin/quotations/${editId}/pdf`)
      if (!res.ok) throw new Error('PDF generation failed')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `quotation-${quoteNumber.replace(/\//g, '-')}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e: any) {
      setSaveError(e.message || 'Download failed')
    } finally {
      setDownloading(false)
    }
  }

  async function startConvert(q: Quotation) {
    setConvertPendingQuoteId(q.id)
    setConvertPaymentMode('cash')
    setConvertEnableDelivery(false)
    setConvertQrImageUrl(null)
    setConvertQrTotal(q.total_amount || 0)
    setConvertSavedAsDraft(false)
    setConvertInsufficientItems([])
    setConvertHasStockIssue(false)
    setConvertStep('payment')
    setConvertBatchPickerItems(null)
    setConvertSerialPickerItems(null)
    setShowConvertModal(true)
    try {
      const res = await fetch(`/api/admin/quotations/${q.id}`)
      const data = await res.json()
      const qItems: any[] = data.items || []
      const stockIssue = qItems.some(item => {
        if (!item.product_id || item.inventory_quantity === null || item.inventory_quantity === undefined) return false
        const rawQty = parseFloat(item.quantity)
        const factor = parseFloat(item.sell_unit_factor)
        const baseQty = item.sell_unit_dimension === 'count' && factor > 1 ? rawQty * factor : rawQty
        return parseFloat(item.inventory_quantity) < baseQty
      })
      setConvertHasStockIssue(stockIssue)
      if (stockIssue) setConvertPaymentMode('credit')
    } catch (_) {
      // stock check is best-effort
    }
  }

  async function deleteQuote(id: string) {
    try {
      const res = await fetch(`/api/admin/quotations/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error)
      }
      list.setRows(prev => prev.filter(q => q.id !== id))
    } catch (e: any) {
      setError(e.message || 'Delete failed')
    }
  }

  async function sendQuoteEmail(id: string) {
    setSendingEmailId(id)
    try {
      const res = await fetch(`/api/admin/quotations/${id}/resend-email`, { method: 'POST', credentials: 'include' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to send email')
      showToast('Quotation email sent', 'success')
    } catch (err: any) {
      showToast(err.message, 'error')
    } finally {
      setSendingEmailId(null)
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
    setCName(c.addr_name || c.full_name || '')
    setCAddr1(c.address_line1 || '')
    setCAddr2(c.address_line2 || '')
    setCCity(c.city || '')
    setCState(c.state || 'Chhattisgarh')
    setCGstin(c.gst_number || '')
    setCPhone(
      (c.phone || '')
        .replace(/^\+?91/, '')
        .replace(/\D/g, '')
        .slice(-10)
    )
    setCPincode(c.postal_code || '')
    setCEmail(c.email || '')
    setCustSearch('')
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
    setBName(c.addr_name || c.full_name || '')
    setBAddr1(c.address_line1 || '')
    setBAddr2(c.address_line2 || '')
    setBCity(c.city || '')
    setBState(c.state || 'Chhattisgarh')
    setBGstin(c.gst_number || '')
    setBPhone(
      (c.phone || '')
        .replace(/^\+?91/, '')
        .replace(/\D/g, '')
        .slice(-10)
    )
    setBPincode(c.postal_code || '')
    setBEmail(c.email || '')
    setBuyerSearch('')
    setShowBuyerDrop(false)
  }

  const inputCls = fieldInputCls
  const labelCls = 'block text-xs font-medium text-foreground-secondary mb-1.5'

  if (view === 'list') {
    return (
      <div className="space-y-5">
        <PageHeader title="Quotations" description="Create and manage B2B quotations" />
        {canWrite && (
          <TabActionsPortal>
            <TabAction onClick={newQuotation} icon={<Plus className="w-4 h-4" />} label="New Quotation" />
          </TabActionsPortal>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-[200px] flex-1">
            <AdminTypeahead
              type="quotations"
              value={searchQ}
              onChange={v => {
                setSearchQ(v)
                syncUrl({ q: v })
              }}
              onEnter={() => loadList()}
              placeholder="Search quote # or consignee..."
              inputClassName={inputCls + ' pr-9'}
            />
          </div>
          <button type="button" onClick={() => loadList()} className="control-md bg-accent-500 font-medium text-white hover:bg-accent-600">
            Search
          </button>
          <div className="inline-flex h-control items-center rounded-lg border border-border-default bg-surface-elevated p-0.5">
            {['all', 'draft', 'final'].map(s => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  setStatusFilter(s)
                  syncUrl({ status: s })
                }}
                className={`h-full rounded-md px-3 text-xs font-medium capitalize transition-colors ${statusFilter === s ? 'bg-accent-500 text-white' : 'text-foreground-secondary hover:bg-surface-secondary'}`}
              >
                {s}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <DatePicker
              className="w-36"
              value={fromDate}
              onChange={v => {
                setFromDate(v)
                syncUrl({ from: v })
              }}
            />
            <span className="text-xs text-foreground-muted">to</span>
            <DatePicker
              className="w-36"
              value={toDate}
              onChange={v => {
                setToDate(v)
                syncUrl({ to: v })
              }}
            />
          </div>
          {(searchQ || statusFilter !== 'all' || fromDate || toDate) && (
            <button
              type="button"
              onClick={() => {
                setSearchQ('')
                setStatusFilter('all')
                setFromDate('')
                setToDate('')
                syncUrl({ q: '', status: '', from: '', to: '' })
              }}
              className="control-md border border-border-default text-foreground-secondary hover:bg-surface-secondary"
            >
              <X className="h-4 w-4" />
              Clear
            </button>
          )}
        </div>

        {loading ? (
          <TableSkeleton rows={8} cols={6} />
        ) : quotations.length === 0 ? (
          <EmptyState title="No quotations found." body="Create your first one." />
        ) : (
          <>
            <div className="hidden overflow-hidden rounded-xl border border-border-default bg-surface-elevated md:block">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border-default bg-surface-secondary/50 text-xs text-foreground-muted">
                      <SortTh label="Quote #" col="quote_number" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                      <SortTh label="Date" col="date" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                      <SortTh label="Consignee" col="consignee" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                      <SortTh label="Total" col="total" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} num />
                      <SortTh label="Status" col="status" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                      <th className="px-3 py-2.5 text-right font-medium">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedQuotations.map(q => (
                      <tr key={q.id} className="cursor-pointer border-b border-border-default/60 last:border-0 hover:bg-surface-secondary/60" onClick={() => setSelectedQuote(q)}>
                        <td className="px-3 py-2.5 font-mono font-semibold" onClick={e => e.stopPropagation()}>
                          <HoverCard
                            trigger={
                              <a href={ap(`/admin/quotations/${q.id}/view`)} className="text-accent-500 hover:text-accent-600 hover:underline">
                                {q.quote_number}
                              </a>
                            }
                            align="left"
                            side="bottom"
                            width="260px"
                          >
                            <div className="space-y-2 p-3">
                              <p className="font-mono text-sm font-semibold text-foreground">{q.quote_number}</p>
                              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 font-sans text-xs font-normal">
                                <span className="text-foreground-muted">Customer</span>
                                <span className="truncate font-medium text-foreground">{q.consignee_name || '—'}</span>
                                {q.consignee_phone && (
                                  <>
                                    <span className="text-foreground-muted">Phone</span>
                                    <span className="text-foreground">{q.consignee_phone}</span>
                                  </>
                                )}
                                {q.consignee_city && (
                                  <>
                                    <span className="text-foreground-muted">City</span>
                                    <span className="text-foreground">
                                      {q.consignee_city}
                                      {q.consignee_state ? `, ${q.consignee_state}` : ''}
                                    </span>
                                  </>
                                )}
                                <span className="text-foreground-muted">Date</span>
                                <span className="text-foreground">{fmtDate(q.quote_date)}</span>
                                <span className="text-foreground-muted">Total</span>
                                <span className="font-semibold text-foreground">₹{fmt2(Number(q.total_amount))}</span>
                                <span className="text-foreground-muted">Status</span>
                                <span>
                                  <StatusBadge status={q.status} map={QUOTATION_STATUS} />
                                </span>
                              </div>
                            </div>
                          </HoverCard>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-foreground-secondary">{fmtDate(q.quote_date)}</td>
                        <td className="px-3 py-2.5 text-foreground">{q.consignee_name || '—'}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right font-semibold tabular-nums text-foreground">₹{fmt2(Number(q.total_amount))}</td>
                        <td className="px-3 py-2.5">
                          <StatusBadge status={q.status} map={QUOTATION_STATUS} />
                        </td>
                        <td className="px-3 py-2.5" onClick={e => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-1">
                            <RowActions
                              size="sm"
                              actions={[
                                { key: 'edit', kind: 'edit', label: 'Edit', hidden: q.status !== 'draft' || q.from_rfq || !canWrite, onSelect: () => openEdit(q.id) },
                                { key: 'view', kind: 'open', label: 'View Detail', href: ap(`/admin/quotations/${q.id}/view`) },
                                { key: 'download', kind: 'download', label: 'Download PDF', href: `/api/admin/quotations/${q.id}/pdf`, target: '_blank' },
                                {
                                  key: 'email',
                                  kind: 'email',
                                  label: `Send email to ${q.consignee_email}`,
                                  hidden: q.status !== 'final' || !q.consignee_email,
                                  busy: sendingEmailId === q.id,
                                  onSelect: () => sendQuoteEmail(q.id),
                                },
                              ]}
                            />
                            {q.status === 'final' && !q.converted_order_id && canWrite && (
                              <button onClick={() => startConvert(q)} title="Convert to Invoice" className="control-sm whitespace-nowrap bg-accent-500 font-semibold text-white hover:bg-accent-600 disabled:opacity-50">
                                → Invoice
                              </button>
                            )}
                            {q.status === 'final' && q.converted_order_id && (
                              <a href={ap(`/admin/invoices/${q.converted_order_id}/view`)} className={`${badgeCls('blue')} hover:opacity-80`}>
                                Invoiced ↗
                              </a>
                            )}
                            <RowActions
                              size="sm"
                              actions={[
                                {
                                  key: 'delete',
                                  kind: 'delete',
                                  label: 'Delete',
                                  hidden: q.status !== 'draft' || !canWrite,
                                  onSelect: () => deleteQuote(q.id),
                                  confirm: { title: 'Delete Quotation', message: 'Delete this draft quotation? This cannot be undone.', confirmLabel: 'Delete', variant: 'danger' },
                                },
                              ]}
                            />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="md:hidden">
              <QuotationsMobileList quotations={sortedQuotations} canWrite={canWrite} sendingEmailId={sendingEmailId} onSendEmail={sendQuoteEmail} onDelete={deleteQuote} onConvert={startConvert} />
            </div>
          </>
        )}
        <InfiniteFooter shown={quotations.length} control={list} noun="quotations" />
        <QuotationDetailModal q={selectedQuote} onClose={() => setSelectedQuote(null)} />
        <Dialog
          open={showConvertModal}
          onClose={() => !convertingInvoice && (setShowConvertModal(false), setConvertQrImageUrl(null), setConvertSavedAsDraft(false))}
          zIndex="z-[400]"
          size={convertStep === 'assign' ? 'xl' : 'md'}
          hideClose={convertSavedAsDraft || (!(convertStep === 'assign' && (convertBatchPickerItems || convertSerialPickerItems)) && !!convertQrImageUrl)}
          title={convertSavedAsDraft ? 'Saved as Draft' : convertStep === 'assign' && (convertBatchPickerItems || convertSerialPickerItems) ? 'Assign Stock' : !convertQrImageUrl ? 'Convert to Invoice' : 'UPI QR Code'}
          description={
            !convertSavedAsDraft && convertStep === 'assign' && (convertBatchPickerItems || convertSerialPickerItems) ? (
              <span className="flex flex-wrap items-center gap-3">
                <span>
                  {convertBatchPickerItems && convertSerialPickerItems
                    ? 'Assign batches and serial numbers'
                    : convertBatchPickerItems
                      ? 'Select batches — quantities auto-filled (FIFO)'
                      : 'Select serial numbers per item'}
                </span>
                {convertSerialPickerItems && (
                        <button
                          type="button"
                          onClick={() => setConvertScanEnabled(v => !v)}
                          title={
                            convertScanEnabled
                              ? 'Scanner mode on — scan a serial to fill each field'
                              : 'Click to select serials manually, or turn scanner mode on'
                          }
                          className={`inline-flex items-center gap-1.5 text-xs font-semibold h-control-sm px-2.5 rounded-full border transition-colors ${
                            convertScanEnabled
                              ? 'border-accent-500 bg-accent-500/10 text-foreground'
                              : 'border-border-default text-foreground-muted hover:bg-surface-secondary'
                          }`}
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M4 5v14M8 5v14M12 5v14M16 5v14M20 5v14"
                            />
                          </svg>
                          {convertScanEnabled ? 'Scan: on' : 'Scan: off'}
                        </button>
                      )}
              </span>
            ) : undefined
          }
        >
          {convertSavedAsDraft ? (
            <>
              <div className="space-y-4">
                <div className="flex items-start gap-3 p-3 rounded-lg bg-orange-500/5 border border-orange-500/40">
                  <svg
                    className="w-5 h-5 text-orange-500 shrink-0 mt-0.5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M12 9v2m0 4h.01M12 3a9 9 0 100 18A9 9 0 0012 3z"
                    />
                  </svg>
                  <div>
                    <p className="text-sm font-semibold text-orange-700 dark:text-orange-400">
                      Some items are out of stock
                    </p>
                    <p className="text-xs text-orange-600 dark:text-orange-400 mt-0.5">
                      The invoice has been saved as a draft. It will be visible to the customer only after stock is
                      updated and the invoice is finalised.
                    </p>
                  </div>
                </div>
                {convertInsufficientItems.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-foreground-secondary uppercase tracking-wide mb-2">
                      Items needing stock
                    </p>
                    <ul className="space-y-1">
                      {convertInsufficientItems.map((name, i) => (
                        <li key={i} className="text-sm text-foreground-secondary flex items-center gap-2">
                          <span className="w-1.5 h-1.5 rounded-full bg-orange-400 shrink-0" />
                          {name}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <p className="text-xs text-foreground-muted">
                  Once stock is replenished, open the invoice and finalise it to make it visible and generate an
                  invoice number.
                </p>
              </div>
              <div className="-mx-5 -mb-5 mt-5 flex justify-end gap-2 border-t border-border-default px-5 py-3">
                <button
                  onClick={() => {
                    setShowConvertModal(false)
                    setConvertSavedAsDraft(false)
                  }}
                  className="px-4 h-control text-sm rounded-lg border border-border-default text-foreground hover:bg-surface-secondary transition-colors"
                >
                  Close
                </button>
                {convertResultOrderId && (
                  <a
                    href={ap(`/admin/invoices/${convertResultOrderId}/view`)}
                    className="px-4 py-2 text-sm rounded-lg bg-accent-500 hover:bg-accent-600 text-white font-semibold transition-colors"
                  >
                    View Draft Invoice →
                  </a>
                )}
              </div>
            </>
          ) : convertStep === 'assign' && (convertBatchPickerItems || convertSerialPickerItems) ? (
            <>
              <div className="space-y-6">
                {convertBatchPickerItems && (
                  <>
                    {convertBatchPickerItems && convertSerialPickerItems && (
                      <p className="text-xs font-semibold text-foreground-muted uppercase tracking-wide">
                        Batch Products
                      </p>
                    )}
                    {convertBatchPickerItems.filter(i => !i.already_assigned && i.batches.length === 0).length >
                      0 && (
                      <div className="bg-red-500/5 border border-red-500/40 rounded-lg p-4">
                        <p className="text-sm font-semibold text-red-600 dark:text-red-400 mb-1">
                          No batches available for:
                        </p>
                        <ul className="text-sm text-red-600 dark:text-red-400 list-disc ml-4 space-y-0.5">
                          {convertBatchPickerItems
                            .filter(i => !i.already_assigned && i.batches.length === 0)
                            .map(i => (
                              <li key={i.order_item_id}>
                                {i.product_name}
                                {i.variant_name ? ` / ${i.variant_name}` : ''} — requires {i.required_qty} units
                              </li>
                            ))}
                        </ul>
                        <p className="text-xs text-red-500 mt-2">
                          Receive stock via GRN before processing this order.
                        </p>
                      </div>
                    )}
                    {convertBatchPickerItems
                      .filter(i => !i.already_assigned && i.batches.length > 0)
                      .map(item => {
                        const sel = convertBatchSelections[item.order_item_id] ?? {}
                        const allocated = Object.values(sel).reduce((s, q) => s + q, 0)
                        const isOver = allocated > item.required_qty
                        const isFull = allocated >= item.required_qty
                        function setQty(batchId: string, val: number, maxAvail: number) {
                          setConvertBatchSelections(s => {
                            const prev = { ...(s[item.order_item_id] ?? {}) }
                            if (val <= 0) delete prev[batchId]
                            else prev[batchId] = Math.min(val, maxAvail)
                            return { ...s, [item.order_item_id]: prev }
                          })
                        }
                        function toggleBatch(batchId: string, maxAvail: number) {
                          setConvertBatchSelections(s => {
                            const prev = { ...(s[item.order_item_id] ?? {}) }
                            if (prev[batchId]) {
                              delete prev[batchId]
                            } else {
                              const already = Object.values(prev).reduce((a, b) => a + b, 0)
                              const needed = Math.max(0, item.required_qty - already)
                              prev[batchId] = Math.min(maxAvail, needed > 0 ? needed : item.required_qty)
                            }
                            return { ...s, [item.order_item_id]: prev }
                          })
                        }
                        return (
                          <div key={item.order_item_id}>
                            <div className="flex items-center justify-between mb-2">
                              <div>
                                <p className="font-semibold text-foreground text-sm">
                                  {item.product_name}
                                  {item.variant_name ? ` / ${item.variant_name}` : ''}
                                </p>
                                <p className="text-xs text-foreground-muted">Required: {item.required_qty} units</p>
                              </div>
                              <div
                                className={`text-sm font-semibold px-2 py-0.5 rounded ${isOver ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' : isFull ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'}`}
                              >
                                {allocated} / {item.required_qty}
                              </div>
                            </div>
                            <div className="border border-border-default rounded-lg overflow-hidden">
                              <table className="w-full text-sm">
                                <thead className="bg-surface border-b border-border-default">
                                  <tr>
                                    <th className="px-3 py-2 text-left text-xs text-foreground-muted font-medium w-8"></th>
                                    <th className="px-3 py-2 text-left text-xs text-foreground-muted font-medium">
                                      Lot
                                    </th>
                                    <th className="px-3 py-2 text-left text-xs text-foreground-muted font-medium">
                                      Expiry
                                    </th>
                                    <th className="px-3 py-2 text-left text-xs text-foreground-muted font-medium">
                                      Available
                                    </th>
                                    <th className="px-3 py-2 text-left text-xs text-foreground-muted font-medium">
                                      Take
                                    </th>
                                    <th className="px-3 py-2 text-left text-xs text-foreground-muted font-medium">
                                      Location
                                    </th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-border-default">
                                  {item.batches.map((batch, idx) => {
                                    const isChecked = !!sel[batch.id]
                                    const qty = sel[batch.id] ?? 0
                                    return (
                                      <tr
                                        key={batch.id}
                                        className={`transition-colors ${isChecked ? 'bg-accent-500/10' : 'hover:bg-surface cursor-pointer'}`}
                                        onClick={() => toggleBatch(batch.id, batch.quantity_remaining)}
                                      >
                                        <td className="px-3 py-2.5" onClick={e => e.stopPropagation()}>
                                          <input
                                            type="checkbox"
                                            checked={isChecked}
                                            onChange={() => toggleBatch(batch.id, batch.quantity_remaining)}
                                            className="accent-accent-500"
                                          />
                                        </td>
                                        <td className="px-3 py-2.5 font-mono text-xs text-foreground">
                                          {batch.lot_number || <span className="text-foreground-muted">—</span>}
                                          {idx === 0 && (
                                            <span className="ml-1.5 text-[10px] bg-accent-500/10 text-accent-600 px-1.5 py-0.5 rounded font-medium">
                                              FIFO
                                            </span>
                                          )}
                                        </td>
                                        <td className={`px-3 py-2.5 text-xs ${expiryColor(batch.expiry_date)}`}>
                                          {batch.expiry_date ? (
                                            new Date(batch.expiry_date).toLocaleDateString('en-IN', {
                                              day: 'numeric',
                                              month: 'short',
                                              year: 'numeric',
                                            })
                                          ) : (
                                            <span className="text-foreground-muted">—</span>
                                          )}
                                        </td>
                                        <td className="px-3 py-2.5 text-xs text-foreground">
                                          {batch.quantity_remaining}
                                          {batch.quantity_remaining < item.required_qty && (
                                            <span className="ml-1 text-orange-500 text-[10px]">⚠ low</span>
                                          )}
                                        </td>
                                        <td className="px-3 py-2.5" onClick={e => e.stopPropagation()}>
                                          {isChecked ? (
                                            <div className="flex items-center gap-1">
                                              <button
                                                type="button"
                                                onClick={() => setQty(batch.id, qty - 1, batch.quantity_remaining)}
                                                disabled={qty <= 1}
                                                className="w-6 h-6 flex items-center justify-center rounded border border-border-default bg-surface text-foreground hover:bg-surface-elevated disabled:opacity-30 text-xs font-bold transition-colors"
                                              >
                                                ‹
                                              </button>
                                              <input
                                                type="number"
                                                min={1}
                                                max={batch.quantity_remaining}
                                                value={qty}
                                                onChange={e => {
                                                  const v = parseInt(e.target.value)
                                                  if (!isNaN(v)) setQty(batch.id, v, batch.quantity_remaining)
                                                }}
                                                className="w-12 text-center text-xs font-medium text-foreground tabular-nums border border-border-default rounded bg-surface px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-accent-500"
                                              />
                                              <button
                                                type="button"
                                                onClick={() => setQty(batch.id, qty + 1, batch.quantity_remaining)}
                                                disabled={qty >= batch.quantity_remaining}
                                                className="w-6 h-6 flex items-center justify-center rounded border border-border-default bg-surface text-foreground hover:bg-surface-elevated disabled:opacity-30 text-xs font-bold transition-colors"
                                              >
                                                ›
                                              </button>
                                            </div>
                                          ) : (
                                            <span className="text-foreground-muted text-xs">—</span>
                                          )}
                                        </td>
                                        <td className="px-3 py-2.5 font-mono text-xs text-foreground-muted">
                                          {batch.location || <span>—</span>}
                                        </td>
                                      </tr>
                                    )
                                  })}
                                </tbody>
                              </table>
                            </div>
                            {isOver && (
                              <p className="text-xs text-orange-600 mt-1">
                                ⚠ Allocated {allocated} exceeds required {item.required_qty}
                              </p>
                            )}
                          </div>
                        )
                      })}
                  </>
                )}
                {convertSerialPickerItems &&
                  convertSerialPickerItems.filter(i => !i.already_assigned).length > 0 && (
                    <>
                      {convertBatchPickerItems && (
                        <div className="border-t border-border-default pt-4">
                          <p className="text-xs font-semibold text-foreground-muted uppercase tracking-wide mb-4">
                            Serialized Products
                          </p>
                        </div>
                      )}
                      {convertSerialPickerItems
                        .filter(i => !i.already_assigned)
                        .map(item => (
                          <SerialPicker
                            key={item.order_item_id}
                            item={item}
                            selected={convertSerialSelections[item.order_item_id] || new Set()}
                            onChange={next =>
                              setConvertSerialSelections(s => ({ ...s, [item.order_item_id]: next }))
                            }
                            scanEnabled={convertScanEnabled}
                          />
                        ))}
                    </>
                  )}
              </div>
              <div className="-mx-5 -mb-5 mt-5 flex justify-between gap-3 border-t border-border-default px-5 py-3">
                <button
                  onClick={() => setConvertStep('payment')}
                  className="px-4 h-control text-sm font-medium text-foreground border border-border-default rounded-lg hover:bg-surface transition-colors"
                >
                  ← Back
                </button>
                <button
                  onClick={() => {
                    const batchAssignments: BatchAssignment[] = []
                    if (convertBatchPickerItems) {
                      for (const [order_item_id, batchQtys] of Object.entries(convertBatchSelections)) {
                        for (const [batch_id, qty] of Object.entries(batchQtys)) {
                          if (qty > 0) batchAssignments.push({ order_item_id, batch_id, qty })
                        }
                      }
                    }
                    const serialAssignments: SerialAssignment[] = []
                    if (convertSerialPickerItems) {
                      for (const item of convertSerialPickerItems.filter(i => !i.already_assigned)) {
                        for (const sn of convertSerialSelections[item.order_item_id] || []) {
                          serialAssignments.push({ order_item_id: item.order_item_id, serial_number: sn })
                        }
                      }
                    }
                    if (pendingConvertArgs) {
                      const args = pendingConvertArgs
                      setPendingConvertArgs(null)
                      convertToInvoice(
                        args.quoteId,
                        args.paymentMode,
                        args.enableDelivery,
                        batchAssignments.length ? batchAssignments : undefined,
                        serialAssignments.length ? serialAssignments : undefined
                      )
                    }
                  }}
                  disabled={
                    convertBatchPickerItems?.some(i => !i.already_assigned && i.batches.length === 0) ||
                    convertBatchPickerItems
                      ?.filter(i => !i.already_assigned && i.batches.length > 0)
                      .some(item => {
                        const allocated = Object.values(convertBatchSelections[item.order_item_id] ?? {}).reduce(
                          (s, q) => s + q,
                          0
                        )
                        return allocated < item.required_qty || allocated > item.required_qty
                      }) ||
                    convertSerialPickerItems
                      ?.filter(i => !i.already_assigned)
                      .some(
                        item =>
                          (convertSerialSelections[item.order_item_id]?.size ?? 0) !==
                          (item.required_serials ?? item.required_qty)
                      )
                  }
                  className="px-4 h-control text-sm font-medium bg-accent-500 hover:bg-accent-600 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
                >
                  Confirm & Convert →
                </button>
              </div>
            </>
          ) : !convertQrImageUrl ? (
            <>
              <div className="space-y-5">
                <div>
                  <p className="text-xs font-semibold text-foreground-secondary uppercase tracking-wide mb-3">
                    Payment Mode
                  </p>
                  {convertHasStockIssue && (
                    <div className="mb-3 flex items-start gap-2 p-2.5 rounded-lg bg-orange-500/5 border border-orange-500/40">
                      <svg
                        className="w-4 h-4 text-orange-500 shrink-0 mt-0.5"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M12 9v2m0 4h.01M12 3a9 9 0 100 18A9 9 0 0012 3z"
                        />
                      </svg>
                      <p className="text-xs text-orange-700 dark:text-orange-400">
                        Some items may have insufficient stock — cash and bank transfer options are hidden until
                        stock is confirmed.
                      </p>
                    </div>
                  )}
                  <div className="space-y-2">
                    {[
                      { value: 'cash', label: 'Cash', desc: 'Paid immediately — marks order as paid' },
                      {
                        value: 'bank_transfer',
                        label: 'Bank Transfer',
                        desc: 'Paid via bank — marks order as paid',
                      },
                      { value: 'credit', label: 'Credit', desc: 'Deferred payment — order stays unpaid' },
                      { value: 'upi_qr', label: 'UPI QR', desc: 'Generate a one-time Razorpay QR code' },
                    ]
                      .filter(
                        opt => !convertHasStockIssue || (opt.value !== 'cash' && opt.value !== 'bank_transfer')
                      )
                      .map(opt => (
                        <label
                          key={opt.value}
                          className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${convertPaymentMode === opt.value ? 'border-accent-500 bg-accent-500/10' : 'border-border-default hover:bg-surface-secondary'}`}
                        >
                          <input
                            type="radio"
                            name="paymentMode"
                            value={opt.value}
                            checked={convertPaymentMode === opt.value}
                            onChange={() => setConvertPaymentMode(opt.value)}
                            className="mt-0.5 accent-accent-500"
                          />
                          <div>
                            <p className="text-sm font-medium text-foreground">{opt.label}</p>
                            <p className="text-xs text-foreground-secondary">{opt.desc}</p>
                          </div>
                        </label>
                      ))}
                  </div>
                </div>
                <div>
                  <p className="text-xs font-semibold text-foreground-secondary uppercase tracking-wide mb-3">
                    Delivery
                  </p>
                  <label className="flex items-start gap-3 p-3 rounded-lg border border-border-default hover:bg-surface-secondary cursor-pointer transition-colors">
                    <input
                      type="checkbox"
                      checked={convertEnableDelivery}
                      onChange={e => setConvertEnableDelivery(e.target.checked)}
                      className="mt-0.5 accent-accent-500"
                    />
                    <div>
                      <p className="text-sm font-medium text-foreground">Enable delivery tracking</p>
                      <p className="text-xs text-foreground-secondary">
                        A Delhivery shipment can be created from the order view once enabled
                      </p>
                    </div>
                  </label>
                </div>
              </div>
              <div className="-mx-5 -mb-5 mt-5 flex justify-end gap-2 border-t border-border-default px-5 py-3">
                <button
                  onClick={() => setShowConvertModal(false)}
                  disabled={convertingInvoice}
                  className="px-4 h-control text-sm rounded-lg border border-border-default text-foreground hover:bg-surface-secondary transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() =>
                    convertPendingQuoteId &&
                    convertToInvoice(convertPendingQuoteId, convertPaymentMode, convertEnableDelivery)
                  }
                  disabled={convertingInvoice || !convertPendingQuoteId}
                  className="px-4 h-control text-sm rounded-lg bg-accent-500 hover:bg-accent-600 text-white font-semibold disabled:opacity-50 transition-colors"
                >
                  {convertingInvoice ? 'Converting…' : 'Convert →'}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="flex flex-col items-center gap-4">
                <img
                  src={convertQrImageUrl!}
                  alt="UPI QR Code"
                  className="max-w-[240px] w-full rounded-lg border border-border-default"
                />
                <p className="text-sm font-semibold text-foreground">Scan to pay ₹{fmt2(convertQrTotal)}</p>
                <p className="text-xs text-foreground-secondary text-center">
                  Payment status will update automatically once scanned.
                </p>
              </div>
              <div className="-mx-5 -mb-5 mt-5 flex justify-end gap-2 border-t border-border-default px-5 py-3">
                <button
                  onClick={() => {
                    setShowConvertModal(false)
                    setConvertQrImageUrl(null)
                  }}
                  className="px-4 h-control text-sm rounded-lg border border-border-default text-foreground hover:bg-surface-secondary transition-colors"
                >
                  Done
                </button>
                {convertResultOrderId && (
                  <a
                    href={ap(`/admin/invoices/${convertResultOrderId}/view`)}
                    className="px-4 py-2 text-sm rounded-lg bg-accent-500 hover:bg-accent-600 text-white font-semibold transition-colors"
                  >
                    View Invoice →
                  </a>
                )}
              </div>
            </>
          )}
        </Dialog>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <PageHeader
        back={{ href: ap('/admin/quotations'), label: 'Quotations' }}
        title={editId ? quoteNumber : 'New Quotation'}
        badges={editId ? <StatusBadge status={isFinal ? 'final' : 'draft'} map={QUOTATION_STATUS} /> : undefined}
        description={isFinal ? 'This quotation is finalised and cannot be edited' : editId ? 'Update and finalise the quotation' : 'Fill in details and add line items'}
      />

      {isFinal && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-green-500/40 bg-green-500/5 px-4 py-3 text-sm text-foreground">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {convertedOrderId ? (
              <span>This quotation has been converted to an invoice.</span>
            ) : (
              <span>This quotation has been finalised. Download the PDF or convert it to an invoice.</span>
            )}
          </div>
          {!convertedOrderId && editId && (
            <button
              onClick={() => {
                setConvertPendingQuoteId(editId)
                setConvertPaymentMode('cash')
                setConvertEnableDelivery(false)
                setConvertQrImageUrl(null)
                setConvertSavedAsDraft(false)
                setConvertInsufficientItems([])
                const stockIssue = items.some(item => {
                  if (!item.product_id || item.inventory_quantity === null || item.inventory_quantity === undefined)
                    return false
                  const rawQty = parseFloat(String(item.quantity))
                  const factor = parseFloat(String(item.sell_unit_factor))
                  const baseQty = item.sell_unit_dimension === 'count' && factor > 1 ? rawQty * factor : rawQty
                  return parseFloat(String(item.inventory_quantity)) < baseQty
                })
                setConvertHasStockIssue(stockIssue)
                if (stockIssue) setConvertPaymentMode('credit')
                setConvertQrTotal(
                  items.reduce((sum, i) => {
                    const gst = parseFloat(String(i.gst_rate)) || 0
                    // unit_price is per piece incl. GST; count units scale by factor
                    const f = Number(i.sell_unit_factor) || 1
                    const factor = i.product_id && i.sell_unit_dimension === 'count' && f > 1 ? f : 1
                    const qty = (parseFloat(String(i.quantity)) || 0) * factor
                    const rate = (parseFloat(String(i.unit_price)) || 0) / (1 + gst / 100)
                    const disc = parseFloat(String(i.discount_pct)) || 0
                    const ex = lineItemExGst(qty, rate, disc)
                    return sum + ex + (ex * gst) / 100
                  }, 0)
                )
                setConvertStep('payment')
                setConvertBatchPickerItems(null)
                setConvertSerialPickerItems(null)
                setShowConvertModal(true)
              }}
              className="control-md shrink-0 whitespace-nowrap bg-accent-500 font-semibold text-white hover:bg-accent-600 disabled:opacity-50"
            >
              {convertingInvoice ? 'Converting…' : '→ Convert to Invoice'}
            </button>
          )}
          {convertedOrderId && (
            <a
              href={ap(`/admin/invoices/${convertedOrderId}/view`)}
              className="control-md shrink-0 whitespace-nowrap border border-green-500/40 font-semibold text-green-700 hover:bg-green-500/10 dark:text-green-400"
            >
              View Invoice →
            </a>
          )}
        </div>
      )}

      {saveError && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/5 px-4 py-3 text-sm text-red-600 dark:text-red-400">
          {saveError}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-surface-elevated border border-border-default rounded-xl p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground mb-3">Quote Details</h2>
          <div className="space-y-3">
            <div>
              <label className={labelCls}>Quote Number</label>
              <input
                value={quoteNumber || 'Auto-generated on save'}
                readOnly
                className={inputCls + ' bg-surface text-foreground-secondary cursor-not-allowed'}
              />
            </div>
            <div>
              <label className={labelCls}>Date</label>
              <DatePicker value={quoteDate} onChange={setQuoteDate} disabled={isFinal} />
            </div>
            <div>
              <label className={labelCls}>Notes (optional)</label>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                rows={2}
                disabled={isFinal}
                className={inputCls + ' resize-none'}
                placeholder="Any special terms or references..."
              />
            </div>
          </div>
        </div>

        <div className="bg-surface-elevated border border-border-default rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-foreground">Consignee (Ship to)</h2>
          </div>
          <div className="relative mb-2">
            <input
              type="text"
              value={custSearch}
              onChange={e => searchCustomers(e.target.value)}
              placeholder="Search existing customer…"
              disabled={isFinal}
              className={inputCls}
            />
            {showCustDrop && custResults.length > 0 && (
              <div className="absolute z-20 left-0 right-0 top-full mt-1 bg-surface-elevated border border-border-default rounded-lg shadow-lg max-h-48 overflow-y-auto">
                {custResults.map(c => (
                  <button
                    key={c.id}
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
          <div className="space-y-2">
            <input
              value={cName}
              onChange={e => setCName(e.target.value)}
              placeholder="Name / Company"
              disabled={isFinal}
              className={inputCls}
            />
            <input
              value={cAddr1}
              onChange={e => setCAddr1(e.target.value)}
              placeholder="Address line 1"
              disabled={isFinal}
              className={inputCls}
            />
            <input
              value={cAddr2}
              onChange={e => setCAddr2(e.target.value)}
              placeholder="Address line 2 (optional)"
              disabled={isFinal}
              className={inputCls}
            />
            <div className="flex gap-2">
              <input
                value={cCity}
                onChange={e => setCCity(e.target.value)}
                placeholder="City"
                disabled={isFinal}
                className={inputCls}
              />
              <input
                value={cState}
                onChange={e => setCState(e.target.value)}
                placeholder="State"
                disabled={isFinal}
                className={inputCls}
              />
            </div>
            <div className="flex gap-2">
              <div className="flex flex-1 min-w-0">
                <span className="inline-flex items-center px-3 rounded-l-lg border border-r-0 border-border-default bg-surface-secondary text-foreground-secondary text-sm select-none shrink-0">
                  +91
                </span>
                <input
                  type="tel"
                  inputMode="numeric"
                  maxLength={10}
                  value={cPhone}
                  onChange={e => setCPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                  placeholder="XXXXXXXXXX"
                  disabled={isFinal}
                  className={inputCls + ' rounded-l-none min-w-0'}
                />
              </div>
              <input
                type="email"
                value={cEmail}
                onChange={e => setCEmail(e.target.value)}
                placeholder="Email address"
                disabled={isFinal}
                className={inputCls + ' flex-1 min-w-0'}
              />
            </div>
            <input
              value={cPincode}
              onChange={e => setCPincode(e.target.value)}
              placeholder="Pincode"
              disabled={isFinal}
              className={inputCls + ' font-mono'}
            />
            <input
              value={cGstin}
              onChange={e => setCGstin(e.target.value.toUpperCase())}
              placeholder="00XXXXX0000X0Z0"
              disabled={isFinal}
              className={inputCls + ' font-mono'}
            />
          </div>
        </div>

        <div className="bg-surface-elevated border border-border-default rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-foreground">Buyer (Bill to)</h2>
            <Toggle
              checked={buyerSame}
              onChange={setBuyerSame}
              disabled={isFinal}
              label="Same as consignee"
              size="sm"
            />
          </div>
          {buyerSame ? (
            <p className="text-foreground-secondary text-xs py-4 text-center">Using same address as consignee</p>
          ) : (
            <div className="space-y-2">
              <div className="relative">
                <input
                  type="text"
                  value={buyerSearch}
                  onChange={e => searchBuyers(e.target.value)}
                  placeholder="Search existing customer…"
                  disabled={isFinal}
                  className={inputCls}
                />
                {showBuyerDrop && buyerResults.length > 0 && (
                  <div className="absolute z-20 left-0 right-0 top-full mt-1 bg-surface-elevated border border-border-default rounded-lg shadow-lg max-h-48 overflow-y-auto">
                    {buyerResults.map(c => (
                      <button
                        key={c.id}
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
              <input
                value={bName}
                onChange={e => setBName(e.target.value)}
                placeholder="Name / Company"
                disabled={isFinal}
                className={inputCls}
              />
              <input
                value={bAddr1}
                onChange={e => setBAddr1(e.target.value)}
                placeholder="Address line 1"
                disabled={isFinal}
                className={inputCls}
              />
              <input
                value={bAddr2}
                onChange={e => setBAddr2(e.target.value)}
                placeholder="Address line 2 (optional)"
                disabled={isFinal}
                className={inputCls}
              />
              <div className="flex gap-2">
                <input
                  value={bCity}
                  onChange={e => setBCity(e.target.value)}
                  placeholder="City"
                  disabled={isFinal}
                  className={inputCls}
                />
                <input
                  value={bState}
                  onChange={e => setBState(e.target.value)}
                  placeholder="State"
                  disabled={isFinal}
                  className={inputCls}
                />
              </div>
              <div className="flex gap-2">
                <div className="flex flex-1 min-w-0">
                  <span className="inline-flex items-center px-3 rounded-l-lg border border-r-0 border-border-default bg-surface-secondary text-foreground-secondary text-sm select-none shrink-0">
                    +91
                  </span>
                  <input
                    type="tel"
                    inputMode="numeric"
                    maxLength={10}
                    value={bPhone}
                    onChange={e => setBPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                    placeholder="XXXXXXXXXX"
                    disabled={isFinal}
                    className={inputCls + ' rounded-l-none min-w-0'}
                  />
                </div>
                <input
                  type="email"
                  value={bEmail}
                  onChange={e => setBEmail(e.target.value)}
                  placeholder="Email address"
                  disabled={isFinal}
                  className={inputCls + ' flex-1 min-w-0'}
                />
              </div>
              <input
                value={bPincode}
                onChange={e => setBPincode(e.target.value)}
                placeholder="Pincode"
                disabled={isFinal}
                className={inputCls + ' font-mono'}
              />
              <input
                value={bGstin}
                onChange={e => setBGstin(e.target.value.toUpperCase())}
                placeholder="00XXXXX0000X0Z0"
                disabled={isFinal}
                className={inputCls + ' font-mono'}
              />
            </div>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-border-default bg-surface-elevated p-5">
        <LineItemsSection items={isFinal ? items : items} onChange={isFinal ? () => {} : setItems} />
      </div>

      <FormFooter
        onCancel={() => navigateView('list')}
        cancelLabel="Back"
        secondary={
          autoSaveStatus === 'pending' ? (
            <span>Unsaved changes…</span>
          ) : autoSaveStatus === 'saving' ? (
            <span className="animate-pulse">Saving…</span>
          ) : autoSaveStatus === 'saved' ? (
            <span className="inline-flex items-center gap-1 text-green-700 dark:text-green-400">
              <Check className="h-3 w-3" /> Saved
            </span>
          ) : undefined
        }
      >
        <FormButton type="button" variant="secondary" onClick={downloadPDF} disabled={downloading || saving}>
          {downloading ? 'Generating…' : 'Download PDF'}
        </FormButton>
        {!isFinal && canWrite && (
          <FormButton type="button" onClick={() => save('final')} disabled={saving}>
            {saving ? 'Saving…' : 'Finalise & Save'}
          </FormButton>
        )}
      </FormFooter>

      <Dialog
        open={showConvertModal}
        onClose={() => !convertingInvoice && (setShowConvertModal(false), setConvertQrImageUrl(null), setConvertSavedAsDraft(false))}
        zIndex="z-[400]"
        size={convertStep === 'assign' ? 'xl' : 'md'}
        hideClose={convertSavedAsDraft || (!(convertStep === 'assign' && (convertBatchPickerItems || convertSerialPickerItems)) && !!convertQrImageUrl)}
        title={convertSavedAsDraft ? 'Saved as Draft' : convertStep === 'assign' && (convertBatchPickerItems || convertSerialPickerItems) ? 'Assign Stock' : !convertQrImageUrl ? 'Convert to Invoice' : 'UPI QR Code'}
        description={
          !convertSavedAsDraft && convertStep === 'assign' && (convertBatchPickerItems || convertSerialPickerItems) ? (
            <span className="flex flex-wrap items-center gap-3">
              <span>
                {convertBatchPickerItems && convertSerialPickerItems
                  ? 'Assign batches and serial numbers'
                  : convertBatchPickerItems
                    ? 'Select batches — quantities auto-filled (FIFO)'
                    : 'Select serial numbers per item'}
              </span>
              {convertSerialPickerItems && (
                      <button
                        type="button"
                        onClick={() => setConvertScanEnabled(v => !v)}
                        title={
                          convertScanEnabled
                            ? 'Scanner mode on — scan a serial to fill each field'
                            : 'Click to select serials manually, or turn scanner mode on'
                        }
                        className={`inline-flex items-center gap-1.5 text-xs font-semibold h-control-sm px-2.5 rounded-full border transition-colors ${
                          convertScanEnabled
                            ? 'border-accent-500 bg-accent-500/10 text-foreground'
                            : 'border-border-default text-foreground-muted hover:bg-surface-secondary'
                        }`}
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M4 5v14M8 5v14M12 5v14M16 5v14M20 5v14"
                          />
                        </svg>
                        {convertScanEnabled ? 'Scan: on' : 'Scan: off'}
                      </button>
                    )}
            </span>
          ) : undefined
        }
      >
        {convertSavedAsDraft ? (
          <>
            <div className="space-y-4">
              <div className="flex items-start gap-3 p-3 rounded-lg bg-orange-500/5 border border-orange-500/40">
                <svg
                  className="w-5 h-5 text-orange-500 shrink-0 mt-0.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 9v2m0 4h.01M12 3a9 9 0 100 18A9 9 0 0012 3z"
                  />
                </svg>
                <div>
                  <p className="text-sm font-semibold text-orange-700 dark:text-orange-400">
                    Some items are out of stock
                  </p>
                  <p className="text-xs text-orange-600 dark:text-orange-400 mt-0.5">
                    The invoice has been saved as a draft. It will be visible to the customer only after stock is
                    updated and the invoice is finalised.
                  </p>
                </div>
              </div>
              {convertInsufficientItems.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-foreground-secondary uppercase tracking-wide mb-2">
                    Items needing stock
                  </p>
                  <ul className="space-y-1">
                    {convertInsufficientItems.map((name, i) => (
                      <li key={i} className="text-sm text-foreground-secondary flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-orange-400 shrink-0" />
                        {name}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="text-xs text-foreground-muted">
                Once stock is replenished, open the invoice and finalise it to make it visible and generate an
                invoice number.
              </p>
            </div>
            <div className="-mx-5 -mb-5 mt-5 flex justify-end gap-2 border-t border-border-default px-5 py-3">
              <button
                onClick={() => {
                  setShowConvertModal(false)
                  setConvertSavedAsDraft(false)
                }}
                className="px-4 h-control text-sm rounded-lg border border-border-default text-foreground hover:bg-surface-secondary transition-colors"
              >
                Close
              </button>
              {convertResultOrderId && (
                <a
                  href={ap(`/admin/invoices/${convertResultOrderId}/view`)}
                  className="px-4 py-2 text-sm rounded-lg bg-accent-500 hover:bg-accent-600 text-white font-semibold transition-colors"
                >
                  View Draft Invoice →
                </a>
              )}
            </div>
          </>
        ) : convertStep === 'assign' && (convertBatchPickerItems || convertSerialPickerItems) ? (
          <>
            <div className="space-y-6">
              {convertBatchPickerItems && (
                <>
                  {convertBatchPickerItems && convertSerialPickerItems && (
                    <p className="text-xs font-semibold text-foreground-muted uppercase tracking-wide">
                      Batch Products
                    </p>
                  )}
                  {convertBatchPickerItems.filter(i => !i.already_assigned && i.batches.length === 0).length >
                    0 && (
                    <div className="bg-red-500/5 border border-red-500/40 rounded-lg p-4">
                      <p className="text-sm font-semibold text-red-600 dark:text-red-400 mb-1">
                        No batches available for:
                      </p>
                      <ul className="text-sm text-red-600 dark:text-red-400 list-disc ml-4 space-y-0.5">
                        {convertBatchPickerItems
                          .filter(i => !i.already_assigned && i.batches.length === 0)
                          .map(i => (
                            <li key={i.order_item_id}>
                              {i.product_name}
                              {i.variant_name ? ` / ${i.variant_name}` : ''} — requires {i.required_qty} units
                            </li>
                          ))}
                      </ul>
                      <p className="text-xs text-red-500 mt-2">
                        Receive stock via GRN before processing this order.
                      </p>
                    </div>
                  )}
                  {convertBatchPickerItems
                    .filter(i => !i.already_assigned && i.batches.length > 0)
                    .map(item => {
                      const sel = convertBatchSelections[item.order_item_id] ?? {}
                      const allocated = Object.values(sel).reduce((s, q) => s + q, 0)
                      const isOver = allocated > item.required_qty
                      const isFull = allocated >= item.required_qty
                      function setQty2(batchId: string, val: number, maxAvail: number) {
                        setConvertBatchSelections(s => {
                          const prev = { ...(s[item.order_item_id] ?? {}) }
                          if (val <= 0) delete prev[batchId]
                          else prev[batchId] = Math.min(val, maxAvail)
                          return { ...s, [item.order_item_id]: prev }
                        })
                      }
                      function toggleBatch2(batchId: string, maxAvail: number) {
                        setConvertBatchSelections(s => {
                          const prev = { ...(s[item.order_item_id] ?? {}) }
                          if (prev[batchId]) {
                            delete prev[batchId]
                          } else {
                            const already = Object.values(prev).reduce((a, b) => a + b, 0)
                            const needed = Math.max(0, item.required_qty - already)
                            prev[batchId] = Math.min(maxAvail, needed > 0 ? needed : item.required_qty)
                          }
                          return { ...s, [item.order_item_id]: prev }
                        })
                      }
                      return (
                        <div key={item.order_item_id}>
                          <div className="flex items-center justify-between mb-2">
                            <div>
                              <p className="font-semibold text-foreground text-sm">
                                {item.product_name}
                                {item.variant_name ? ` / ${item.variant_name}` : ''}
                              </p>
                              <p className="text-xs text-foreground-muted">Required: {item.required_qty} units</p>
                            </div>
                            <div
                              className={`text-sm font-semibold px-2 py-0.5 rounded ${isOver ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' : isFull ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'}`}
                            >
                              {allocated} / {item.required_qty}
                            </div>
                          </div>
                          <div className="border border-border-default rounded-lg overflow-hidden">
                            <table className="w-full text-sm">
                              <thead className="bg-surface border-b border-border-default">
                                <tr>
                                  <th className="px-3 py-2 text-left text-xs text-foreground-muted font-medium w-8"></th>
                                  <th className="px-3 py-2 text-left text-xs text-foreground-muted font-medium">
                                    Lot
                                  </th>
                                  <th className="px-3 py-2 text-left text-xs text-foreground-muted font-medium">
                                    Expiry
                                  </th>
                                  <th className="px-3 py-2 text-left text-xs text-foreground-muted font-medium">
                                    Available
                                  </th>
                                  <th className="px-3 py-2 text-left text-xs text-foreground-muted font-medium">
                                    Take
                                  </th>
                                  <th className="px-3 py-2 text-left text-xs text-foreground-muted font-medium">
                                    Location
                                  </th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-border-default">
                                {item.batches.map((batch, idx) => {
                                  const isChecked = !!sel[batch.id]
                                  const qty = sel[batch.id] ?? 0
                                  return (
                                    <tr
                                      key={batch.id}
                                      className={`transition-colors ${isChecked ? 'bg-accent-500/10' : 'hover:bg-surface cursor-pointer'}`}
                                      onClick={() => toggleBatch2(batch.id, batch.quantity_remaining)}
                                    >
                                      <td className="px-3 py-2.5" onClick={e => e.stopPropagation()}>
                                        <input
                                          type="checkbox"
                                          checked={isChecked}
                                          onChange={() => toggleBatch2(batch.id, batch.quantity_remaining)}
                                          className="accent-accent-500"
                                        />
                                      </td>
                                      <td className="px-3 py-2.5 font-mono text-xs text-foreground">
                                        {batch.lot_number || <span className="text-foreground-muted">—</span>}
                                        {idx === 0 && (
                                          <span className="ml-1.5 text-[10px] bg-accent-500/10 text-accent-600 px-1.5 py-0.5 rounded font-medium">
                                            FIFO
                                          </span>
                                        )}
                                      </td>
                                      <td className={`px-3 py-2.5 text-xs ${expiryColor(batch.expiry_date)}`}>
                                        {batch.expiry_date ? (
                                          new Date(batch.expiry_date).toLocaleDateString('en-IN', {
                                            day: 'numeric',
                                            month: 'short',
                                            year: 'numeric',
                                          })
                                        ) : (
                                          <span className="text-foreground-muted">—</span>
                                        )}
                                      </td>
                                      <td className="px-3 py-2.5 text-xs text-foreground">
                                        {batch.quantity_remaining}
                                        {batch.quantity_remaining < item.required_qty && (
                                          <span className="ml-1 text-orange-500 text-[10px]">⚠ low</span>
                                        )}
                                      </td>
                                      <td className="px-3 py-2.5" onClick={e => e.stopPropagation()}>
                                        {isChecked ? (
                                          <div className="flex items-center gap-1">
                                            <button
                                              type="button"
                                              onClick={() => setQty2(batch.id, qty - 1, batch.quantity_remaining)}
                                              disabled={qty <= 1}
                                              className="w-6 h-6 flex items-center justify-center rounded border border-border-default bg-surface text-foreground hover:bg-surface-elevated disabled:opacity-30 text-xs font-bold transition-colors"
                                            >
                                              ‹
                                            </button>
                                            <input
                                              type="number"
                                              min={1}
                                              max={batch.quantity_remaining}
                                              value={qty}
                                              onChange={e => {
                                                const v = parseInt(e.target.value)
                                                if (!isNaN(v)) setQty2(batch.id, v, batch.quantity_remaining)
                                              }}
                                              className="w-12 text-center text-xs font-medium text-foreground tabular-nums border border-border-default rounded bg-surface px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-accent-500"
                                            />
                                            <button
                                              type="button"
                                              onClick={() => setQty2(batch.id, qty + 1, batch.quantity_remaining)}
                                              disabled={qty >= batch.quantity_remaining}
                                              className="w-6 h-6 flex items-center justify-center rounded border border-border-default bg-surface text-foreground hover:bg-surface-elevated disabled:opacity-30 text-xs font-bold transition-colors"
                                            >
                                              ›
                                            </button>
                                          </div>
                                        ) : (
                                          <span className="text-foreground-muted text-xs">—</span>
                                        )}
                                      </td>
                                      <td className="px-3 py-2.5 font-mono text-xs text-foreground-muted">
                                        {batch.location || <span>—</span>}
                                      </td>
                                    </tr>
                                  )
                                })}
                              </tbody>
                            </table>
                          </div>
                          {isOver && (
                            <p className="text-xs text-orange-600 mt-1">
                              ⚠ Allocated {allocated} exceeds required {item.required_qty}
                            </p>
                          )}
                        </div>
                      )
                    })}
                </>
              )}
              {convertSerialPickerItems && convertSerialPickerItems.filter(i => !i.already_assigned).length > 0 && (
                <>
                  {convertBatchPickerItems && (
                    <div className="border-t border-border-default pt-4">
                      <p className="text-xs font-semibold text-foreground-muted uppercase tracking-wide mb-4">
                        Serialized Products
                      </p>
                    </div>
                  )}
                  {convertSerialPickerItems
                    .filter(i => !i.already_assigned)
                    .map(item => (
                      <SerialPicker
                        key={item.order_item_id}
                        item={item}
                        selected={convertSerialSelections[item.order_item_id] || new Set()}
                        onChange={next => setConvertSerialSelections(s => ({ ...s, [item.order_item_id]: next }))}
                        scanEnabled={convertScanEnabled}
                      />
                    ))}
                </>
              )}
            </div>
            <div className="-mx-5 -mb-5 mt-5 flex justify-between gap-3 border-t border-border-default px-5 py-3">
              <button
                onClick={() => setConvertStep('payment')}
                className="px-4 h-control text-sm font-medium text-foreground border border-border-default rounded-lg hover:bg-surface transition-colors"
              >
                ← Back
              </button>
              <button
                onClick={() => {
                  const batchAssignments: BatchAssignment[] = []
                  if (convertBatchPickerItems) {
                    for (const [order_item_id, batchQtys] of Object.entries(convertBatchSelections)) {
                      for (const [batch_id, qty] of Object.entries(batchQtys)) {
                        if (qty > 0) batchAssignments.push({ order_item_id, batch_id, qty })
                      }
                    }
                  }
                  const serialAssignments: SerialAssignment[] = []
                  if (convertSerialPickerItems) {
                    for (const item of convertSerialPickerItems.filter(i => !i.already_assigned)) {
                      for (const sn of convertSerialSelections[item.order_item_id] || []) {
                        serialAssignments.push({ order_item_id: item.order_item_id, serial_number: sn })
                      }
                    }
                  }
                  if (pendingConvertArgs) {
                    const args = pendingConvertArgs
                    setPendingConvertArgs(null)
                    convertToInvoice(
                      args.quoteId,
                      args.paymentMode,
                      args.enableDelivery,
                      batchAssignments.length ? batchAssignments : undefined,
                      serialAssignments.length ? serialAssignments : undefined
                    )
                  }
                }}
                disabled={
                  convertBatchPickerItems?.some(i => !i.already_assigned && i.batches.length === 0) ||
                  convertBatchPickerItems
                    ?.filter(i => !i.already_assigned && i.batches.length > 0)
                    .some(item => {
                      const allocated = Object.values(convertBatchSelections[item.order_item_id] ?? {}).reduce(
                        (s, q) => s + q,
                        0
                      )
                      return allocated < item.required_qty || allocated > item.required_qty
                    }) ||
                  convertSerialPickerItems
                    ?.filter(i => !i.already_assigned)
                    .some(
                      item =>
                        (convertSerialSelections[item.order_item_id]?.size ?? 0) !==
                        (item.required_serials ?? item.required_qty)
                    )
                }
                className="px-4 h-control text-sm font-medium bg-accent-500 hover:bg-accent-600 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
              >
                Confirm & Convert →
              </button>
            </div>
          </>
        ) : !convertQrImageUrl ? (
          <>
            <div className="space-y-5">
              <div>
                <p className="text-xs font-semibold text-foreground-secondary uppercase tracking-wide mb-3">
                  Payment Mode
                </p>
                {convertHasStockIssue && (
                  <div className="mb-3 flex items-start gap-2 p-2.5 rounded-lg bg-orange-500/5 border border-orange-500/40">
                    <svg
                      className="w-4 h-4 text-orange-500 shrink-0 mt-0.5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M12 9v2m0 4h.01M12 3a9 9 0 100 18A9 9 0 0012 3z"
                      />
                    </svg>
                    <p className="text-xs text-orange-700 dark:text-orange-400">
                      Some items may have insufficient stock — cash and bank transfer options are hidden until stock
                      is confirmed.
                    </p>
                  </div>
                )}
                <div className="space-y-2">
                  {[
                    { value: 'cash', label: 'Cash', desc: 'Paid immediately — marks order as paid' },
                    { value: 'bank_transfer', label: 'Bank Transfer', desc: 'Paid via bank — marks order as paid' },
                    { value: 'credit', label: 'Credit', desc: 'Deferred payment — order stays unpaid' },
                    { value: 'upi_qr', label: 'UPI QR', desc: 'Generate a one-time Razorpay QR code' },
                  ]
                    .filter(opt => !convertHasStockIssue || (opt.value !== 'cash' && opt.value !== 'bank_transfer'))
                    .map(opt => (
                      <label
                        key={opt.value}
                        className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${convertPaymentMode === opt.value ? 'border-accent-500 bg-accent-500/10' : 'border-border-default hover:bg-surface-secondary'}`}
                      >
                        <input
                          type="radio"
                          name="paymentMode"
                          value={opt.value}
                          checked={convertPaymentMode === opt.value}
                          onChange={() => setConvertPaymentMode(opt.value)}
                          className="mt-0.5 accent-accent-500"
                        />
                        <div>
                          <p className="text-sm font-medium text-foreground">{opt.label}</p>
                          <p className="text-xs text-foreground-secondary">{opt.desc}</p>
                        </div>
                      </label>
                    ))}
                </div>
              </div>
              <div>
                <p className="text-xs font-semibold text-foreground-secondary uppercase tracking-wide mb-3">
                  Delivery
                </p>
                <label className="flex items-start gap-3 p-3 rounded-lg border border-border-default hover:bg-surface-secondary cursor-pointer transition-colors">
                  <input
                    type="checkbox"
                    checked={convertEnableDelivery}
                    onChange={e => setConvertEnableDelivery(e.target.checked)}
                    className="mt-0.5 accent-accent-500"
                  />
                  <div>
                    <p className="text-sm font-medium text-foreground">Enable delivery tracking</p>
                    <p className="text-xs text-foreground-secondary">
                      A Delhivery shipment can be created from the order view once enabled
                    </p>
                  </div>
                </label>
              </div>
            </div>
            <div className="-mx-5 -mb-5 mt-5 flex justify-end gap-2 border-t border-border-default px-5 py-3">
              <button
                onClick={() => setShowConvertModal(false)}
                disabled={convertingInvoice}
                className="px-4 h-control text-sm rounded-lg border border-border-default text-foreground hover:bg-surface-secondary transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() =>
                  convertPendingQuoteId &&
                  convertToInvoice(convertPendingQuoteId, convertPaymentMode, convertEnableDelivery)
                }
                disabled={convertingInvoice || !convertPendingQuoteId}
                className="px-4 h-control text-sm rounded-lg bg-accent-500 hover:bg-accent-600 text-white font-semibold disabled:opacity-50 transition-colors"
              >
                {convertingInvoice ? 'Converting…' : 'Convert →'}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="flex flex-col items-center gap-4">
              <img
                src={convertQrImageUrl}
                alt="UPI QR Code"
                className="w-60 h-60 rounded-lg border border-border-default"
              />
              <p className="text-sm font-semibold text-foreground">Scan to pay ₹{fmt2(convertQrTotal)}</p>
              <p className="text-xs text-foreground-secondary text-center">
                Payment status will update automatically once scanned.
              </p>
            </div>
            <div className="-mx-5 -mb-5 mt-5 flex justify-end gap-2 border-t border-border-default px-5 py-3">
              <button
                onClick={() => {
                  setShowConvertModal(false)
                  setConvertQrImageUrl(null)
                }}
                className="px-4 h-control text-sm rounded-lg border border-border-default text-foreground hover:bg-surface-secondary transition-colors"
              >
                Done
              </button>
              {convertResultOrderId && (
                <a
                  href={ap(`/admin/invoices/${convertResultOrderId}/view`)}
                  className="px-4 py-2 text-sm rounded-lg bg-accent-500 hover:bg-accent-600 text-white font-semibold transition-colors"
                >
                  View Invoice →
                </a>
              )}
            </div>
          </>
        )}
      </Dialog>
    </div>
  )
}

function QuotationDetailModal({ q: maybe, onClose }: { q: Quotation | null; onClose: () => void }) {
  if (!maybe) return <Dialog open={false} onClose={onClose} title="" />
  const q = maybe
  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      zIndex="z-[300]"
      title={
        <a href={ap(`/admin/quotations/${q.id}/view`)} className="font-mono hover:text-accent-500 hover:underline">
          {q.quote_number}
        </a>
      }
      description={
        <span className="inline-flex items-center gap-2">
          {new Date(q.quote_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
          <StatusBadge status={q.status} map={QUOTATION_STATUS} />
        </span>
      }
    >
        <div className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-foreground-muted uppercase tracking-wide mb-1.5">Consignee</p>
              <p className="text-sm font-semibold text-foreground">{q.consignee_name}</p>
              {q.consignee_phone && <p className="text-xs text-foreground-secondary mt-0.5">{q.consignee_phone}</p>}
              {q.consignee_email && <p className="text-xs text-foreground-secondary mt-0.5">{q.consignee_email}</p>}
              {[q.consignee_addr1, q.consignee_addr2, q.consignee_city, q.consignee_state, q.consignee_pincode].filter(
                Boolean
              ).length > 0 && (
                <p className="text-xs text-foreground-secondary mt-0.5">
                  {[q.consignee_addr1, q.consignee_addr2, q.consignee_city, q.consignee_state, q.consignee_pincode]
                    .filter(Boolean)
                    .join(', ')}
                </p>
              )}
              {q.consignee_gstin && (
                <p className="text-xs text-foreground-secondary font-mono mt-0.5">{q.consignee_gstin}</p>
              )}
            </div>
            {!q.buyer_same && q.buyer_name && (
              <div>
                <p className="text-xs text-foreground-muted uppercase tracking-wide mb-1.5">Buyer</p>
                <p className="text-sm font-semibold text-foreground">{q.buyer_name}</p>
                {[q.buyer_addr1, q.buyer_addr2, q.buyer_city, q.buyer_state].filter(Boolean).length > 0 && (
                  <p className="text-xs text-foreground-secondary mt-0.5">
                    {[q.buyer_addr1, q.buyer_addr2, q.buyer_city, q.buyer_state].filter(Boolean).join(', ')}
                  </p>
                )}
                {q.buyer_gstin && <p className="text-xs text-foreground-secondary font-mono mt-0.5">{q.buyer_gstin}</p>}
              </div>
            )}
          </div>

          <div className="grid grid-cols-3 gap-3 p-3 rounded-lg bg-surface-secondary">
            <div>
              <p className="text-xs text-foreground-muted">Subtotal</p>
              <p className="text-sm font-semibold text-foreground">₹{fmt2(Number(q.subtotal || 0))}</p>
            </div>
            <div>
              <p className="text-xs text-foreground-muted">CGST + SGST</p>
              <p className="text-sm font-semibold text-foreground">
                {Number(q.cgst_amount) > 0 || Number(q.sgst_amount) > 0
                  ? `₹${fmt2(Number(q.cgst_amount))} + ₹${fmt2(Number(q.sgst_amount))}`
                  : '—'}
              </p>
            </div>
            <div>
              <p className="text-xs text-foreground-muted">Total</p>
              <p className="text-sm font-bold text-foreground">₹{fmt2(Number(q.total_amount))}</p>
            </div>
          </div>

          {q.converted_order_id && (
            <div className="flex items-center justify-between gap-2 p-3 rounded-lg bg-blue-500/5 border border-blue-500/40">
              <span className="text-xs font-medium text-blue-700 dark:text-blue-400">Converted to Invoice</span>
              <a
                href={ap(`/admin/invoices/${q.converted_order_id}/view`)}
                className="text-xs font-semibold text-blue-700 dark:text-blue-400 hover:underline"
              >
                View Invoice →
              </a>
            </div>
          )}

          <div className="flex flex-wrap gap-3 pt-1 border-t border-border-default">
            <a
              href={`/api/admin/quotations/${q.id}/pdf`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-3 h-control-sm rounded-lg text-xs font-semibold bg-surface-secondary hover:bg-surface-secondary/70 text-foreground transition-colors border border-border-default"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
              Download PDF
            </a>
            <a
              href={ap(`/admin/quotations/${q.id}/view`)}
              className="flex items-center gap-2 px-3 h-control-sm rounded-lg text-xs font-semibold bg-accent-500 hover:bg-accent-600 text-white transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                />
              </svg>
              View Detail
            </a>
          </div>
        </div>
    </Dialog>
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
