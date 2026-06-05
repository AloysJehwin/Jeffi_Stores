'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { createPortal } from 'react-dom'
import { AlertTriangle, Check } from 'lucide-react'
import AdminSelect from '@/components/admin/AdminSelect'
import AdminTypeahead from '@/components/admin/AdminTypeahead'
import { useToast } from '@/contexts/ToastContext'
import HoverCard from '@/components/ui/HoverCard'
import LineItemsSection, { newLineItem, type LineItem as LILineItem } from '@/components/admin/LineItemsSection'
import SortableHeader, { sortOptions, type SortDir } from '@/components/admin/SortableHeader'
import DatePicker from '@/components/ui/DatePicker'

interface Invoice {
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
  { value: 'cash',    label: 'Cash',         paid: true },
  { value: 'upi',     label: 'UPI',          paid: true },
  { value: 'upi_qr',  label: 'UPI (QR Scan)', paid: true },
  { value: 'credit',  label: 'Credit',       paid: false },
]

function fmt(n: number) {
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDate(s: string) {
  if (!s) return ''
  const d = new Date(s)
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

const inputCls = 'w-full px-2 py-1.5 rounded border border-border-default bg-surface-secondary text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-secondary-500 dark:focus:ring-secondary-400 disabled:opacity-60 disabled:cursor-not-allowed'
const labelCls = 'block text-xs font-medium text-foreground-secondary mb-1'

const PAYMENT_COLORS: Record<string, string> = {
  paid: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  unpaid: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  refunded: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
  failed: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  cancelled: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
}

const SOURCE_COLORS: Record<string, string> = {
  online: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  offline: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  cash_sale: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
}

export default function InvoicesClient() {
  const { showToast } = useToast()
  const searchParams = useSearchParams()
  const router = useRouter()
  const [view, setView] = useState<View>('list')
  const [editId, setEditId] = useState<string | null>(null)

  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null)
  const [cancellingId, setCancellingId] = useState<string | null>(null)
  const [confirmCancelId, setConfirmCancelId] = useState<string | null>(null)
  const [sendingEmailId, setSendingEmailId] = useState<string | null>(null)
  const [sourceFilter, setSourceFilter] = useState(searchParams.get('source') || '')
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
      if (v) p.set(k, v); else p.delete(k)
    }
    router.replace(`/admin/invoices?${p.toString()}`, { scroll: false })
  }

  function handleSort(col: string, dir: SortDir) {
    setSortCol(col)
    setSortDir(dir)
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
  const [editLoading, setEditLoading] = useState(false)
  const [drafts, setDrafts] = useState<any[]>([])
  const [draftsLoading, setDraftsLoading] = useState(false)
  const [finalizingId, setFinalizingId] = useState<string | null>(null)
  const [editIsDraft, setEditIsDraft] = useState(false)

  const totalPages = Math.ceil(total / 25)

  const INVOICE_SORT_KEYS: Record<string, keyof Invoice> = {
    invoice_number: 'invoice_number',
    date: 'invoice_date',
    customer: 'customer_name',
    amount: 'total_amount',
    payment: 'payment_status',
    source: 'source',
  }

  const sortedInvoices = sortCol && INVOICE_SORT_KEYS[sortCol]
    ? [...invoices].sort((a, b) => {
        const key = INVOICE_SORT_KEYS[sortCol]
        const av = a[key] ?? ''
        const bv = b[key] ?? ''
        const cmp = String(av).localeCompare(String(bv), 'en', { numeric: true })
        return sortDir === 'asc' ? cmp : -cmp
      })
    : invoices

  const fetchInvoices = useCallback(async (p = 1) => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (sourceFilter) params.set('source', sourceFilter)
      if (paymentFilter) params.set('payment', paymentFilter)
      if (fromDate) params.set('from', fromDate)
      if (toDate) params.set('to', toDate)
      if (searchQ) params.set('search', searchQ)
      params.set('page', String(p))
      const res = await fetch(`/api/admin/invoices?${params}`, { credentials: 'include' })
      if (!res.ok) throw new Error('Failed')
      const data = await res.json()
      setInvoices(data.invoices || [])
      setTotal(data.total || 0)
      setPage(p)
    } catch {
      showToast('Failed to load invoices', 'error')
    } finally {
      setLoading(false)
    }
  }, [sourceFilter, paymentFilter, fromDate, toDate, searchQ, showToast])

  useEffect(() => { fetchInvoices(1) }, [sourceFilter, paymentFilter, fromDate, toDate, searchQ])

  const fetchDrafts = useCallback(async () => {
    setDraftsLoading(true)
    try {
      const res = await fetch('/api/admin/invoices/drafts', { credentials: 'include' })
      if (res.ok) setDrafts((await res.json()).drafts || [])
    } finally {
      setDraftsLoading(false)
    }
  }, [])

  useEffect(() => { fetchDrafts() }, [fetchDrafts])

  async function finalizeDraft(id: string) {
    setFinalizingId(id)
    try {
      const res = await fetch(`/api/admin/invoices/drafts/${id}/finalize`, { method: 'POST', credentials: 'include' })
      const data = await res.json()
      if (!res.ok) { showToast(data.error || 'Failed to finalize', 'error'); return }
      showToast(`Invoice ${data.invoiceNumber || ''} finalized`, 'success')
      fetchDrafts()
      fetchInvoices(1)
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
    if (q.length < 2) { setCustResults([]); setShowCustDrop(false); return }
    custTimer.current = setTimeout(async () => {
      const res = await fetch(`/api/admin/customers/search?q=${encodeURIComponent(q)}`)
      const data = await res.json()
      setCustResults(data.results || [])
      setShowCustDrop(true)
    }, 300)
  }

  function selectCustomer(c: any) {
    setCustomerName(c.addr_name || c.full_name || '')
    setCustomerPhone((c.phone || '').replace(/^\+?91/, '').replace(/\D/g, '').slice(-10))
    setCustomerEmail(c.email || '')
    setAddressLine1(c.address_line1 || '')
    setAddressLine2(c.address_line2 || '')
    setCity(c.city || '')
    setState(c.state || '')
    setPostalCode(c.postal_code || '')
    setBuyerGstin(c.gst_number || '')
    setCustSearch(''); setCustResults([]); setShowCustDrop(false)
  }

  function resetForm() {
    setCustomerName(''); setCustomerPhone(''); setCustomerEmail('')
    setAddressLine1(''); setAddressLine2(''); setCity(''); setState(''); setPostalCode('')
    setBuyerGstin(''); setPaymentMode('cash'); setInvoiceDate(''); setNotes('')
    setItems([newLineItem()]); setFormError('')
    setEditId(null)
    setEditIsDraft(false)
    setCustSearch(''); setCustResults([]); setShowCustDrop(false)
  }

  async function openEdit(inv: Invoice) {
    setEditLoading(true)
    try {
      const res = await fetch(`/api/admin/orders/${inv.id}`, { credentials: 'include' })
      const data = await res.json()
      const order = data.order || data
      const orderItems: any[] = data.items || []

      setEditId(inv.id)
      setCustomerName(order.customer_name || '')
      setCustomerPhone((order.customer_phone || '').replace(/^\+?91/, '').replace(/\D/g, '').slice(-10))
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

      setItems(orderItems.length > 0 ? orderItems.map((it: any) => ({
        id: it.id || Math.random().toString(36).slice(2),
        product_id: it.product_id || null,
        product_name: it.product_name || '',
        product_sku: it.product_sku || '',
        variant_id: it.variant_id || null,
        sub_variant_id: it.sub_variant_id || null,
        variant_name: it.variant_name || '',
        hsn_code: it.hsn_code || '',
        gst_rate: String(it.gst_rate ?? '18'),
        quantity: String(it.quantity ?? '1'),
        unit: it.unit || 'pcs',
        unit_price: String(it.unit_price ?? ''),
        discount_pct: it.discount_pct ?? 0,
        mrp: it.mrp ?? 0,
        inventory_quantity: it.sub_variant?.inventory_quantity ?? it.variant?.inventory_quantity ?? it.inventory_quantity ?? null,
      })) : [newLineItem()])

      setFormError('')
      setEditIsDraft(inv.status === 'draft')
      setView('edit')
    } catch {
      showToast('Failed to load invoice for editing', 'error')
    } finally {
      setEditLoading(false)
    }
  }

  async function cancelInvoice(inv: Invoice) {
    if (confirmCancelId !== inv.id) { setConfirmCancelId(inv.id); return }
    setConfirmCancelId(null)
    setCancellingId(inv.id)
    try {
      const res = await fetch(`/api/admin/orders/${inv.id}/cancel`, { method: 'POST', credentials: 'include' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to cancel')
      showToast(`Invoice ${inv.invoice_number} cancelled`, 'success')
      fetchInvoices(page)
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

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!customerName.trim()) { setFormError('Customer name is required'); return }
    if (!addressLine1.trim()) { setFormError('Address line 1 is required'); return }
    if (!city.trim()) { setFormError('City is required'); return }
    if (!customerPhone.trim()) { setFormError('Phone number is required'); return }
    if (items.some(it => !it.product_name.trim() || !it.unit_price)) {
      setFormError('All items need a name and price'); return
    }
    setFormError(''); setSubmitting(true)
    try {
      const res = await fetch('/api/admin/orders/create', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName, customerPhone, customerEmail,
          addressLine1, addressLine2, city, state, postalCode,
          buyerGstin, paymentMode, notes,
          items: items.map(it => ({
            product_id: it.product_id, product_name: it.product_name,
            product_sku: it.product_sku, variant_id: it.variant_id,
            variant_name: it.variant_name, hsn_code: it.hsn_code,
            gst_rate: it.gst_rate, quantity: it.quantity, unit_price: it.unit_price,
          })),
        }),
      })
      const data = await res.json()
      if (!res.ok) { setFormError(data.error || 'Failed'); return }
      if (data.savedAsDraft) {
        showToast(`Saved as draft — insufficient stock: ${data.insufficientItems.join(', ')}`, 'error')
      } else {
        showToast(`Invoice ${data.invoiceNumber || ''} created`, 'success')
        if (data.invoiceUrl) window.open(data.invoiceUrl, '_blank')
      }
      resetForm()
      setView('list')
      fetchInvoices(1)
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
    if (!customerName.trim()) { setFormError('Customer name is required'); return }
    if (!addressLine1.trim()) { setFormError('Address line 1 is required'); return }
    if (!city.trim()) { setFormError('City is required'); return }
    if (!customerPhone.trim()) { setFormError('Phone number is required'); return }
    if (items.some(it => !it.product_name.trim() || !it.unit_price)) {
      setFormError('All items need a name and price'); return
    }
    setFormError(''); setSubmitting(true)
    try {
      const res = await fetch(`/api/admin/invoices/${editId}`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName, customerPhone, customerEmail,
          addressLine1, addressLine2, city, state, postalCode,
          buyerGstin, paymentMode, invoiceDate, notes,
          items: items.map(it => ({
            product_id: it.product_id, product_name: it.product_name,
            product_sku: it.product_sku, variant_id: it.variant_id,
            variant_name: it.variant_name, hsn_code: it.hsn_code,
            gst_rate: it.gst_rate, quantity: it.quantity, unit_price: it.unit_price,
          })),
        }),
      })
      const data = await res.json()
      if (!res.ok) { setFormError(data.error || 'Failed'); return }
      if (data.movedToDraft) {
        showToast(`Invoice moved to draft — insufficient stock: ${data.insufficientItems.join(', ')}`, 'error')
      } else {
        showToast('Invoice updated', 'success')
      }
      resetForm()
      setView('list')
      fetchInvoices(1)
      fetchDrafts()
    } catch (err: any) {
      setFormError(err.message || 'Failed')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleFinalizeEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!editId) return
    if (!customerName.trim()) { setFormError('Customer name is required'); return }
    if (!addressLine1.trim()) { setFormError('Address line 1 is required'); return }
    if (!city.trim()) { setFormError('City is required'); return }
    if (!customerPhone.trim()) { setFormError('Phone number is required'); return }
    if (items.some(it => !it.product_name.trim() || !it.unit_price)) {
      setFormError('All items need a name and price'); return
    }
    setFormError(''); setSubmitting(true)
    try {
      const saveRes = await fetch(`/api/admin/invoices/${editId}`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName, customerPhone, customerEmail,
          addressLine1, addressLine2, city, state, postalCode,
          buyerGstin, paymentMode, invoiceDate, notes,
          items: items.map(it => ({
            product_id: it.product_id, product_name: it.product_name,
            product_sku: it.product_sku, variant_id: it.variant_id,
            variant_name: it.variant_name, hsn_code: it.hsn_code,
            gst_rate: it.gst_rate, quantity: it.quantity, unit_price: it.unit_price,
          })),
        }),
      })
      const saveData = await saveRes.json()
      if (!saveRes.ok) { setFormError(saveData.error || 'Failed to save'); return }
      if (saveData.movedToDraft) {
        showToast(`Cannot finalize — insufficient stock: ${saveData.insufficientItems.join(', ')}`, 'error')
        fetchDrafts()
        return
      }

      const finalRes = await fetch(`/api/admin/invoices/drafts/${editId}/finalize`, { method: 'POST', credentials: 'include' })
      const finalData = await finalRes.json()
      if (!finalRes.ok) { setFormError(finalData.error || 'Failed to finalize'); return }
      showToast(`Invoice ${finalData.invoiceNumber || ''} finalized`, 'success')
      resetForm()
      setView('list')
      fetchInvoices(1)
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
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => { resetForm(); setView('list') }}
            className="p-2 text-foreground-secondary hover:text-foreground transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
          </button>
          <div>
            <h1 className="text-xl font-bold text-foreground">
              {isEdit ? 'Edit Offline Invoice' : 'New Offline Invoice'}
            </h1>
            <p className="text-foreground-secondary text-xs mt-0.5">
              {isEdit ? 'Update customer details, items and payment mode' : 'Walk-in, credit sale, B2B or bulk order'}
            </p>
          </div>
        </div>

        {formError && (
          <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-300 text-sm">
            {formError}
          </div>
        )}

        <form onSubmit={isEdit ? handleEdit : handleCreate} className="space-y-4">

          <div className="bg-surface-elevated border border-border-default rounded-xl p-4">
            <h2 className="text-sm font-semibold text-foreground mb-3">Customer Details</h2>
            <div className="relative mb-3">
              <input
                type="text" value={custSearch} onChange={e => searchCustomers(e.target.value)}
                placeholder="Search existing customer…" className={inputCls}
              />
              {showCustDrop && custResults.length > 0 && (
                <div className="absolute z-20 left-0 right-0 top-full mt-1 bg-surface-elevated border border-border-default rounded-lg shadow-lg max-h-48 overflow-y-auto">
                  {custResults.map(c => (
                    <button key={c.id} onClick={() => selectCustomer(c)}
                      className="w-full text-left px-3 py-2 hover:bg-surface-secondary transition-colors">
                      <p className="text-sm font-medium text-foreground">{c.company_name || c.full_name}</p>
                      <p className="text-xs text-foreground-secondary">{c.city}, {c.state}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Customer Name <span className="text-red-500">*</span></label>
                <input type="text" value={customerName} onChange={e => setCustomerName(e.target.value)} required
                  className={inputCls} placeholder="Full name" />
              </div>
              <div>
                <label className={labelCls}>Buyer GSTIN</label>
                <input type="text" value={buyerGstin} onChange={e => setBuyerGstin(e.target.value.toUpperCase())} maxLength={15}
                  className={inputCls + ' font-mono'} placeholder="29XXXXX..." />
              </div>
              <div className="sm:col-span-2">
                <label className={labelCls}>Phone &amp; Email</label>
                <div className="flex gap-2">
                  <div className="flex flex-1 min-w-0">
                    <span className="inline-flex items-center px-3 rounded-l-lg border border-r-0 border-border-default bg-surface-secondary text-foreground-secondary text-sm select-none shrink-0">+91</span>
                    <input type="tel" inputMode="numeric" maxLength={10} value={customerPhone}
                      onChange={e => setCustomerPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                      onBlur={async () => {
                        if (paymentMode !== 'credit' || !customerPhone.trim()) { setCreditWarning(null); return }
                        const res = await fetch(`/api/admin/financial/receivables?customerPhone=${encodeURIComponent(customerPhone.trim())}`)
                        const json = await res.json()
                        if (json.summary?.total > 0 || json.rows?.[0]?.credit_limit > 0) {
                          setCreditWarning({ outstanding: json.summary.total, creditLimit: json.rows?.[0]?.credit_limit || 0 })
                        } else {
                          setCreditWarning(null)
                        }
                      }}
                      className={inputCls + ' rounded-l-none min-w-0'} placeholder="XXXXXXXXXX" />
                  </div>
                  <input type="email" value={customerEmail} onChange={e => setCustomerEmail(e.target.value)}
                    className={inputCls + ' flex-1 min-w-0'} placeholder="customer@example.com" />
                </div>
              </div>
              {isEdit && (
                <div>
                  <label className={labelCls}>Invoice Date</label>
                  <DatePicker value={invoiceDate} onChange={setInvoiceDate} />
                </div>
              )}
              <div className="sm:col-span-2">
                <label className={labelCls}>Address Line 1</label>
                <input type="text" value={addressLine1} onChange={e => setAddressLine1(e.target.value)}
                  className={inputCls} placeholder="Street address" />
              </div>
              <div className="sm:col-span-2">
                <label className={labelCls}>Address Line 2</label>
                <input type="text" value={addressLine2} onChange={e => setAddressLine2(e.target.value)}
                  className={inputCls} placeholder="Apt, area, landmark" />
              </div>
              <div>
                <label className={labelCls}>City</label>
                <input type="text" value={city} onChange={e => setCity(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>State</label>
                <input type="text" value={state} onChange={e => setState(e.target.value)}
                  className={inputCls} placeholder="Tamil Nadu" />
              </div>
              <div>
                <label className={labelCls}>Postal Code</label>
                <input type="text" value={postalCode} onChange={e => setPostalCode(e.target.value)} className={inputCls} />
              </div>
            </div>
          </div>

          <div className="bg-surface-elevated border border-border-default rounded-xl p-4">
            <LineItemsSection items={items} onChange={setItems} />
          </div>


          <div className="bg-surface-elevated border border-border-default rounded-xl p-4">
            <h2 className="text-sm font-semibold text-foreground mb-3">Payment &amp; Notes</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Payment Mode</label>
                <div className="grid grid-cols-2 gap-2 mt-1">
                  {PAYMENT_MODES.map(m => (
                    <label key={m.value}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-colors ${paymentMode === m.value ? 'border-secondary-500 dark:border-secondary-400 bg-secondary-50 dark:bg-secondary-700/30 text-secondary-700 dark:text-secondary-200' : 'border-border-default bg-surface-secondary text-foreground-secondary hover:border-secondary-400 dark:hover:border-secondary-500'}`}>
                      <input type="radio" name="paymentMode" value={m.value} checked={paymentMode === m.value}
                        onChange={() => setPaymentMode(m.value)} className="accent-secondary-500 shrink-0" />
                      <span className="text-sm font-medium">{m.label}</span>
                    </label>
                  ))}
                </div>
                {!selectedPayment?.paid && (
                  <p className="text-xs text-yellow-600 dark:text-yellow-400 mt-2">Payment status will be <strong>Unpaid</strong> — credit sale</p>
                )}
                {paymentMode === 'credit' && creditWarning && (
                  <div className="mt-2 px-3 py-2 rounded-lg bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-700 text-xs text-yellow-700 dark:text-yellow-300 flex items-start gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>{creditWarning.creditLimit > 0
                      ? `Credit limit warning: ₹${creditWarning.outstanding.toLocaleString('en-IN')} outstanding of ₹${creditWarning.creditLimit.toLocaleString('en-IN')} limit`
                      : `₹${creditWarning.outstanding.toLocaleString('en-IN')} already outstanding for this customer`}</span>
                  </div>
                )}
              </div>
              <div>
                <label className={labelCls}>Notes</label>
                <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
                  className={inputCls + ' resize-none'} placeholder="Any additional notes..." />
              </div>
            </div>
          </div>

          <div className="flex gap-3 pb-6">
            <button type="submit" disabled={submitting}
              className="px-6 py-2 bg-secondary-500 hover:bg-secondary-600 dark:bg-secondary-400 dark:hover:bg-secondary-300 dark:text-secondary-900 text-white rounded-lg text-sm font-semibold disabled:opacity-50 transition-colors">
              {submitting ? (isEdit ? 'Saving…' : 'Creating…') : (isEdit ? 'Save Changes' : 'Create Invoice')}
            </button>
            {isEdit && editIsDraft && (
              <button
                type="button"
                disabled={submitting}
                onClick={handleFinalizeEdit}
                className="px-6 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50 transition-colors"
              >
                {submitting ? 'Finalizing…' : 'Save & Finalize'}
              </button>
            )}
            <button type="button" onClick={() => { resetForm(); setView('list') }}
              className="px-6 py-2 border border-border-default rounded-lg text-sm font-medium text-foreground hover:bg-surface-secondary transition-colors">
              Cancel
            </button>
          </div>
        </form>
      </div>
    )
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSelectedInvoice(null) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  if (view === 'create') return renderForm(false)
  if (view === 'edit') return editLoading
    ? <div className="p-12 text-center text-foreground-muted text-sm">Loading invoice…</div>
    : renderForm(true)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-2">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-secondary-500 dark:text-foreground">Invoices</h1>
          <p className="text-foreground-secondary mt-1 text-sm">All online and offline invoices</p>
        </div>
        <button onClick={() => setView('create')}
          className="flex items-center gap-2 px-4 py-2 bg-secondary-500 hover:bg-secondary-600 dark:bg-secondary-400 dark:hover:bg-secondary-300 dark:text-secondary-900 text-white rounded-lg text-sm font-semibold transition-colors">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New Offline Invoice
        </button>
      </div>

      <div className="bg-surface-elevated border border-border-default rounded-xl p-4 space-y-3">
        <div className="flex flex-wrap gap-2 items-center">
          <div className="flex-1 min-w-[200px]">
            <AdminTypeahead
              type="invoices"
              value={searchInput}
              onChange={setSearchInput}
              onSelect={item => { setSearchInput(item.label); setSearchQ(item.label); syncUrl({ search: item.label }) }}
              onEnter={val => { setSearchQ(val); syncUrl({ search: val }) }}
              placeholder="Search invoice, order, customer…"
              inputClassName={inputCls + ' pr-9'}
            />
          </div>
          <button onClick={() => { setSearchQ(searchInput); syncUrl({ search: searchInput }) }}
            className="px-4 py-1.5 bg-secondary-500 hover:bg-secondary-600 dark:bg-secondary-400 dark:hover:bg-secondary-300 dark:text-secondary-900 text-white rounded-lg text-sm font-medium transition-colors">
            Search
          </button>
          {(searchQ || sourceFilter || paymentFilter || fromDate || toDate) && (
            <button onClick={() => { setSearchQ(''); setSearchInput(''); setSourceFilter(''); setPaymentFilter(''); setFromDate(''); setToDate(''); syncUrl({ search: '', source: '', payment: '', from: '', to: '' }) }}
              className="px-4 py-1.5 border border-border-default rounded-lg text-sm text-foreground-secondary hover:bg-surface-secondary transition-colors">
              Clear
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <AdminSelect value={sourceFilter} onChange={v => { setSourceFilter(v); syncUrl({ source: v }) }} placeholder="All Sources"
            options={[{ value: 'online', label: 'Online' }, { value: 'offline', label: 'Offline' }, { value: 'cash_sale', label: 'Offline (Cash Sale)' }]} />
          <AdminSelect value={paymentFilter} onChange={v => { setPaymentFilter(v); syncUrl({ payment: v }) }} placeholder="All Payments"
            options={[
              { value: 'paid', label: 'Paid' }, { value: 'unpaid', label: 'Unpaid' },
              { value: 'refunded', label: 'Refunded' }, { value: 'failed', label: 'Failed' },
            ]} />
          <div className="flex items-center gap-2">
            <DatePicker className="w-36" value={fromDate} onChange={v => { setFromDate(v); syncUrl({ from: v }) }} />
            <span className="text-foreground-secondary text-xs">to</span>
            <DatePicker className="w-36" value={toDate} onChange={v => { setToDate(v); syncUrl({ to: v }) }} />
          </div>
        </div>
      </div>

      {(draftsLoading || drafts.length > 0) && (
        <div className="bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-700/50 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-amber-200 dark:border-amber-700/50 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              </svg>
              <span className="text-sm font-semibold text-amber-800 dark:text-amber-300">Draft Invoices</span>
              {drafts.length > 0 && (
                <span className="px-1.5 py-0.5 rounded-full text-xs font-semibold bg-amber-200 dark:bg-amber-800/50 text-amber-800 dark:text-amber-300">
                  {drafts.length}
                </span>
              )}
            </div>
            <p className="text-xs text-amber-700 dark:text-amber-400">Saved due to insufficient stock — finalize once stock is restocked</p>
          </div>

          {draftsLoading ? (
            <div className="p-6 text-center text-sm text-amber-700 dark:text-amber-400">Loading drafts…</div>
          ) : (
            <>
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-amber-200 dark:border-amber-700/50 bg-amber-100/50 dark:bg-amber-900/20">
                      {['Order No', 'Customer', 'Phone', 'Amount', 'Created', 'Actions'].map(h => (
                        <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold text-amber-700 dark:text-amber-400">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {drafts.map(draft => (
                      <tr key={draft.id} className="border-b border-amber-100 dark:border-amber-800/30 hover:bg-amber-100/40 dark:hover:bg-amber-900/20 transition-colors">
                        <td className="px-4 py-3 font-mono text-xs text-foreground font-medium">{draft.order_number}</td>
                        <td className="px-4 py-3 text-sm text-foreground">{draft.customer_name}</td>
                        <td className="px-4 py-3 text-xs text-foreground-secondary">{draft.customer_phone ? `+91 ${draft.customer_phone}` : '—'}</td>
                        <td className="px-4 py-3 text-sm font-semibold text-foreground">
                          ₹{parseFloat(draft.total_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </td>
                        <td className="px-4 py-3 text-xs text-foreground-secondary whitespace-nowrap">{fmtDate(draft.created_at)}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <button
                              onClick={() => openEdit({ id: draft.id, source: 'offline', invoice_number: '', status: 'draft' } as Invoice)}
                              className="text-xs text-foreground-secondary hover:text-foreground font-medium transition-colors"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => finalizeDraft(draft.id)}
                              disabled={finalizingId === draft.id}
                              className="text-xs font-semibold text-amber-700 dark:text-amber-300 hover:text-amber-900 dark:hover:text-amber-100 disabled:opacity-50 transition-colors"
                            >
                              {finalizingId === draft.id ? 'Finalizing…' : 'Finalize'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="md:hidden divide-y divide-amber-100 dark:divide-amber-800/30">
                {drafts.map(draft => (
                  <div key={draft.id} className="p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs font-medium text-foreground">{draft.order_number}</span>
                      <span className="text-sm font-semibold text-foreground">
                        ₹{parseFloat(draft.total_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-foreground">{draft.customer_name}</span>
                      <span className="text-xs text-foreground-secondary">{fmtDate(draft.created_at)}</span>
                    </div>
                    {draft.customer_phone && (
                      <p className="text-xs text-foreground-secondary">+91 {draft.customer_phone}</p>
                    )}
                    <div className="flex gap-4 pt-1">
                      <button
                        onClick={() => openEdit({ id: draft.id, source: 'offline', invoice_number: '', status: 'draft' } as Invoice)}
                        className="text-xs text-foreground-secondary hover:text-foreground font-medium"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => finalizeDraft(draft.id)}
                        disabled={finalizingId === draft.id}
                        className="text-xs font-semibold text-amber-700 dark:text-amber-300 hover:text-amber-900 disabled:opacity-50"
                      >
                        {finalizingId === draft.id ? 'Finalizing…' : 'Finalize'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      <div className="bg-surface-elevated border border-border-default rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-foreground-muted text-sm">Loading invoices…</div>
        ) : invoices.length === 0 ? (
          <div className="p-12 text-center text-foreground-muted text-sm">No invoices found.</div>
        ) : (
          <>
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border-default bg-surface-secondary">
                    <SortableHeader label="Invoice No" column="invoice_number" options={sortOptions('text')} onSort={handleSort} currentSort={sortCol} currentDir={sortDir} />
                    <SortableHeader label="Date" column="date" options={sortOptions('date')} onSort={handleSort} currentSort={sortCol} currentDir={sortDir} />
                    <SortableHeader label="Customer" column="customer" options={sortOptions('text')} onSort={handleSort} currentSort={sortCol} currentDir={sortDir} />
                    <SortableHeader label="Amount" column="amount" options={sortOptions('number')} onSort={handleSort} currentSort={sortCol} currentDir={sortDir} />
                    <SortableHeader label="Payment" column="payment" options={sortOptions('text')} onSort={handleSort} currentSort={sortCol} currentDir={sortDir} />
                    <SortableHeader label="Source" column="source" options={sortOptions('text')} onSort={handleSort} currentSort={sortCol} currentDir={sortDir} />
                    <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-secondary">IRN</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-foreground-secondary">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedInvoices.map(inv => (
                    <tr
                      key={inv.id}
                      className="border-b border-border-default hover:bg-surface-secondary transition-colors cursor-pointer"
                      onClick={() => setSelectedInvoice(inv)}
                    >
                      <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                        <HoverCard
                          trigger={
                            <a
                              href={inv.source === 'cash_sale' ? `/admin/cash-sale/${inv.id}` : `/admin/invoices/${inv.id}`}
                              className="font-mono font-semibold text-sm text-accent-500 hover:text-accent-600 underline decoration-dotted underline-offset-2"
                            >
                              {inv.invoice_number}
                            </a>
                          }
                          align="left"
                          side="bottom"
                          width="260px"
                        >
                          <div className="p-3 space-y-2">
                            <p className="font-mono font-semibold text-foreground text-sm">{inv.invoice_number}</p>
                            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                              <span className="text-foreground-muted">Customer</span>
                              <span className="text-foreground font-medium truncate">{inv.customer_name || '—'}</span>
                              {inv.customer_phone && (<><span className="text-foreground-muted">Phone</span><span className="text-foreground">+91 {inv.customer_phone}</span></>)}
                              <span className="text-foreground-muted">Date</span>
                              <span className="text-foreground">{fmtDate(inv.invoice_date)}</span>
                              <span className="text-foreground-muted">Total</span>
                              <span className="text-foreground font-semibold">₹{fmt(parseFloat(inv.total_amount))}</span>
                              <span className="text-foreground-muted">Payment</span>
                              <span className={`font-medium ${inv.payment_status === 'paid' ? 'text-green-600 dark:text-green-400' : inv.payment_status === 'unpaid' ? 'text-red-600 dark:text-red-400' : 'text-yellow-600 dark:text-yellow-400'}`}>{inv.payment_status}</span>
                              <span className="text-foreground-muted">Source</span>
                              <span className="text-foreground">{inv.source === 'online' ? 'Online' : 'Offline'}</span>
                            </div>
                          </div>
                        </HoverCard>
                        {inv.order_number && (
                          <div className="text-xs text-foreground-muted mt-0.5 font-mono">{inv.order_number}</div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-foreground text-sm">{inv.customer_name}</div>
                        {inv.customer_phone && (
                          <div className="text-xs text-foreground-muted mt-0.5">+91 {inv.customer_phone}</div>
                        )}
                        {inv.buyer_gstin && (
                          <div className="text-xs text-foreground-muted font-mono mt-0.5">{inv.buyer_gstin}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-foreground-secondary whitespace-nowrap text-sm">
                        {fmtDate(inv.invoice_date)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="font-semibold text-foreground text-sm">
                          ₹{parseFloat(inv.total_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </div>
                        {parseFloat(inv.taxable_amount) > 0 && (
                          <div className="text-xs text-foreground-muted mt-0.5">
                            Taxable ₹{parseFloat(inv.taxable_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${PAYMENT_COLORS[inv.payment_status] || ''}`}>
                          {inv.payment_status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-1">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${SOURCE_COLORS[inv.source] || ''}`}>
                            {inv.source === 'online' ? 'Online' : 'Offline'}
                          </span>
                          {inv.status === 'cancelled' && (
                            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300">
                              Cancelled
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {inv.irn ? (
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium inline-flex items-center gap-1 ${inv.irn_status === 'generated' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300'}`}>
                            {inv.irn_status === 'generated' ? <><Check className="w-3 h-3" /> IRN</> : 'Stub'}
                          </span>
                        ) : (
                          <span className="text-xs text-foreground-muted">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1">
                          {inv.source === 'cash_sale' ? (
                            <>
                              <a
                                href={`/api/admin/cash-sale/${inv.id}/receipt`}
                                target="_blank"
                                rel="noreferrer"
                                title="Download Receipt PDF"
                                className="p-1.5 rounded-lg hover:bg-surface-secondary text-foreground-secondary hover:text-foreground transition-colors"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                </svg>
                              </a>
                              <a
                                href={`/admin/cash-sale/${inv.id}`}
                                title="View Sale"
                                className="p-1.5 rounded-lg hover:bg-surface-secondary text-foreground-secondary hover:text-accent-500 transition-colors"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                </svg>
                              </a>
                            </>
                          ) : (
                            <>
                          <a
                            href={`/api/orders/${inv.id}/invoice`}
                            target="_blank"
                            rel="noreferrer"
                            title="Download Invoice PDF"
                            className="p-1.5 rounded-lg hover:bg-surface-secondary text-foreground-secondary hover:text-foreground transition-colors"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                          </a>
                          <a
                            href={`/admin/invoices/${inv.id}`}
                            title="View Invoice"
                            className="p-1.5 rounded-lg hover:bg-surface-secondary text-foreground-secondary hover:text-accent-500 transition-colors"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                            </svg>
                          </a>
                          {inv.customer_email && (
                            <button
                              onClick={() => sendInvoiceEmail(inv)}
                              disabled={sendingEmailId === inv.id}
                              title={`Send email to ${inv.customer_email}`}
                              className="p-1.5 rounded-lg hover:bg-surface-secondary text-foreground-secondary hover:text-blue-500 transition-colors disabled:opacity-40"
                            >
                              {sendingEmailId === inv.id ? (
                                <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                </svg>
                              ) : (
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                                </svg>
                              )}
                            </button>
                          )}
                          {inv.source === 'offline' && inv.status !== 'cancelled' && (
                            <button
                              onClick={() => openEdit(inv)}
                              title="Edit Invoice"
                              className="p-1.5 rounded-lg hover:bg-surface-secondary text-foreground-secondary hover:text-accent-500 transition-colors"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                              </svg>
                            </button>
                          )}
                          {inv.source === 'offline' && inv.status !== 'cancelled' && (
                            confirmCancelId === inv.id ? (
                              <div className="flex items-center gap-1.5 ml-1">
                                <span className="text-xs text-foreground-secondary">Confirm?</span>
                                <button
                                  onClick={() => cancelInvoice(inv)}
                                  disabled={cancellingId === inv.id}
                                  className="text-xs text-red-600 hover:text-red-700 font-semibold disabled:opacity-50"
                                >
                                  {cancellingId === inv.id ? '…' : 'Yes'}
                                </button>
                                <button
                                  onClick={() => setConfirmCancelId(null)}
                                  className="text-xs text-foreground-muted hover:text-foreground font-medium"
                                >
                                  No
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => cancelInvoice(inv)}
                                disabled={cancellingId === inv.id}
                                title="Cancel Invoice"
                                className="p-1.5 rounded-lg hover:bg-surface-secondary text-foreground-secondary hover:text-red-500 transition-colors disabled:opacity-50"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              </button>
                            )
                          )}
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="md:hidden divide-y divide-border-default">
              {invoices.map(inv => (
                <div
                  key={inv.id}
                  className="p-4 space-y-2.5 hover:bg-surface-secondary transition-colors cursor-pointer"
                  onClick={() => setSelectedInvoice(inv)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div onClick={e => e.stopPropagation()}>
                      <a
                        href={inv.source === 'cash_sale' ? `/admin/cash-sale/${inv.id}` : `/admin/invoices/${inv.id}`}
                        className="font-mono font-semibold text-sm text-accent-500 hover:underline"
                      >
                        {inv.invoice_number}
                      </a>
                      {inv.order_number && (
                        <div className="text-xs text-foreground-muted mt-0.5 font-mono">{inv.order_number}</div>
                      )}
                    </div>
                    <span className="font-semibold text-foreground text-sm shrink-0">
                      ₹{parseFloat(inv.total_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <span className="text-sm text-foreground font-medium">{inv.customer_name}</span>
                      {inv.customer_phone && (
                        <span className="text-xs text-foreground-muted ml-2">+91 {inv.customer_phone}</span>
                      )}
                    </div>
                    <span className="text-xs text-foreground-muted shrink-0">{fmtDate(inv.invoice_date)}</span>
                  </div>
                  {inv.buyer_gstin && (
                    <div className="text-xs text-foreground-muted font-mono">{inv.buyer_gstin}</div>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${PAYMENT_COLORS[inv.payment_status] || ''}`}>
                      {inv.payment_status}
                    </span>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${SOURCE_COLORS[inv.source] || ''}`}>
                      {inv.source === 'online' ? 'Online' : 'Offline'}
                    </span>
                    {inv.status === 'cancelled' && (
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300">
                        Cancelled
                      </span>
                    )}
                    {inv.irn && (
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium inline-flex items-center gap-1 ${inv.irn_status === 'generated' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300'}`}>
                        {inv.irn_status === 'generated' ? <><Check className="w-3 h-3" /> IRN</> : 'IRN Stub'}
                      </span>
                    )}
                  </div>
                  <div className="flex gap-4 pt-1 border-t border-border-default" onClick={e => e.stopPropagation()}>
                    {inv.source === 'cash_sale' ? (
                      <>
                        <a
                          href={`/api/admin/cash-sale/${inv.id}/receipt`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-secondary-500 dark:text-secondary-300 font-medium hover:underline"
                        >
                          Receipt PDF
                        </a>
                        <a
                          href={`/admin/cash-sale/${inv.id}`}
                          className="text-xs text-accent-500 hover:text-accent-600 font-medium"
                        >
                          View Sale
                        </a>
                      </>
                    ) : (
                      <>
                    <a
                      href={`/api/orders/${inv.id}/invoice`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-secondary-500 dark:text-secondary-300 font-medium hover:underline"
                    >
                      PDF
                    </a>
                    <a
                      href={`/admin/invoices/${inv.id}`}
                      className="text-xs text-accent-500 hover:text-accent-600 font-medium"
                    >
                      View Invoice
                    </a>
                    {inv.customer_email && (
                      <button
                        onClick={() => sendInvoiceEmail(inv)}
                        disabled={sendingEmailId === inv.id}
                        className="text-xs text-blue-600 dark:text-blue-400 hover:underline font-medium disabled:opacity-50"
                      >
                        {sendingEmailId === inv.id ? 'Sending…' : 'Send Email'}
                      </button>
                    )}
                    {inv.source === 'offline' && inv.status !== 'cancelled' && (
                      <button
                        onClick={() => openEdit(inv)}
                        className="text-xs text-foreground-secondary hover:text-foreground font-medium"
                      >
                        Edit
                      </button>
                    )}
                    {inv.source === 'offline' && inv.status !== 'cancelled' && (
                      confirmCancelId === inv.id ? (
                        <>
                          <span className="text-xs text-foreground-secondary">Cancel?</span>
                          <button
                            onClick={() => cancelInvoice(inv)}
                            disabled={cancellingId === inv.id}
                            className="text-xs text-red-600 font-semibold disabled:opacity-50"
                          >
                            {cancellingId === inv.id ? '…' : 'Yes'}
                          </button>
                          <button
                            onClick={() => setConfirmCancelId(null)}
                            className="text-xs text-foreground-muted"
                          >
                            No
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => cancelInvoice(inv)}
                          disabled={cancellingId === inv.id}
                          className="text-xs text-red-500 hover:text-red-700 font-medium disabled:opacity-50"
                        >
                          Cancel
                        </button>
                      )
                    )}
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
      {totalPages > 1 && (
        <div className="px-4 py-3 border border-border-default border-t-0 rounded-b-xl bg-surface-elevated flex items-center justify-between gap-2">
          <p className="text-xs text-foreground-muted whitespace-nowrap">
            <span className="font-medium text-foreground">{(page - 1) * 25 + 1}–{Math.min(page * 25, total)}</span>
            {' '}of <span className="font-medium text-foreground">{total}</span> invoices
          </p>
          <div className="flex items-center gap-1.5">
            <button disabled={page <= 1} onClick={() => fetchInvoices(page - 1)}
              className="px-3 py-1.5 text-xs font-medium border border-border-default rounded-lg text-foreground-secondary hover:bg-surface-secondary disabled:opacity-40 disabled:pointer-events-none transition-colors">Prev</button>
            <span className="text-xs text-foreground-muted whitespace-nowrap">{page}/{totalPages}</span>
            <button disabled={page >= totalPages} onClick={() => fetchInvoices(page + 1)}
              className="px-3 py-1.5 text-xs font-medium border border-border-default rounded-lg text-foreground-secondary hover:bg-surface-secondary disabled:opacity-40 disabled:pointer-events-none transition-colors">Next</button>
          </div>
        </div>
      )}
      {selectedInvoice && <InvoiceDetailModal inv={selectedInvoice} onClose={() => setSelectedInvoice(null)} />}
    </div>
  )
}

function InvoiceDetailModal({ inv, onClose }: { inv: Invoice; onClose: () => void }) {
  if (typeof document === 'undefined') return null
  return createPortal(
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div
        className="relative bg-surface-elevated rounded-xl shadow-2xl border border-border-default w-full max-w-2xl max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-border-default">
          <div className="min-w-0 pr-4">
            <h2 className="text-lg font-bold text-foreground leading-tight font-mono">{inv.invoice_number}</h2>
            <p className="text-xs text-foreground-muted mt-0.5">
              {new Date(inv.invoice_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
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
          {/* Badges */}
          <div className="flex flex-wrap gap-2">
            <span className={`px-2.5 py-0.5 text-xs font-semibold rounded-full ${PAYMENT_COLORS[inv.payment_status] || ''}`}>
              {inv.payment_status}
            </span>
            <span className={`px-2.5 py-0.5 text-xs font-semibold rounded-full ${SOURCE_COLORS[inv.source] || ''}`}>
              {inv.source === 'online' ? 'Online' : 'Offline'}
            </span>
            {inv.irn && (
              <span className={`px-2.5 py-0.5 text-xs font-semibold rounded-full inline-flex items-center gap-1 ${inv.irn_status === 'generated' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300'}`}>
                {inv.irn_status === 'generated' ? <><Check className="w-3 h-3" /> IRN</> : 'IRN Stub'}
              </span>
            )}
          </div>

          {/* Customer */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-foreground-muted uppercase tracking-wide mb-1.5">Customer</p>
              <p className="text-sm font-semibold text-foreground">{inv.customer_name}</p>
              {inv.customer_phone && <p className="text-xs text-foreground-secondary mt-0.5">+91 {inv.customer_phone}</p>}
              {inv.customer_email && <p className="text-xs text-foreground-secondary mt-0.5">{inv.customer_email}</p>}
              {inv.buyer_gstin && <p className="text-xs text-foreground-secondary font-mono mt-0.5">{inv.buyer_gstin}</p>}
            </div>
            <div>
              <p className="text-xs text-foreground-muted uppercase tracking-wide mb-1.5">Order</p>
              <p className="text-sm text-foreground font-mono">{inv.order_number}</p>
            </div>
          </div>

          {/* Tax breakdown */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3 rounded-lg bg-surface-secondary">
            <div>
              <p className="text-xs text-foreground-muted">Taxable</p>
              <p className="text-sm font-semibold text-foreground">₹{parseFloat(inv.taxable_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
            </div>
            {parseFloat(inv.cgst_amount) > 0 && (
              <div>
                <p className="text-xs text-foreground-muted">CGST + SGST</p>
                <p className="text-sm font-semibold text-foreground">
                  ₹{parseFloat(inv.cgst_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })} + ₹{parseFloat(inv.sgst_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </p>
              </div>
            )}
            {parseFloat(inv.igst_amount) > 0 && (
              <div>
                <p className="text-xs text-foreground-muted">IGST</p>
                <p className="text-sm font-semibold text-foreground">₹{parseFloat(inv.igst_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
              </div>
            )}
            <div>
              <p className="text-xs text-foreground-muted">Total</p>
              <p className="text-sm font-bold text-foreground">₹{parseFloat(inv.total_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
            </div>
          </div>

          {/* Downloads */}
          <div className="flex flex-wrap gap-3 pt-1 border-t border-border-default">
            {inv.source === 'cash_sale' ? (
              <a
                href={`/api/admin/cash-sale/${inv.id}/receipt`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold bg-surface-secondary hover:bg-surface-secondary/70 text-foreground transition-colors border border-border-default"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                Receipt PDF
              </a>
            ) : (
            <a
              href={`/api/orders/${inv.id}/invoice`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold bg-surface-secondary hover:bg-surface-secondary/70 text-foreground transition-colors border border-border-default"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Invoice PDF
            </a>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
