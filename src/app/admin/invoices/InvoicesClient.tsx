'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import AdminSelect from '@/components/admin/AdminSelect'
import { useToast } from '@/contexts/ToastContext'
import HoverCard from '@/components/ui/HoverCard'

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

interface LineItem {
  id: string
  product_id: string | null
  product_name: string
  product_sku: string
  variant_id: string | null
  variant_name: string
  hsn_code: string
  gst_rate: string
  quantity: string
  unit_price: string
}

interface Suggestion {
  id: string
  product_id: string
  variant_id: string | null
  name: string
  variant_name: string | null
  sku: string
  base_price: number | null
  gst_percentage: number | null
  hsn_code: string | null
}

interface Category {
  id: string
  name: string
}

type View = 'list' | 'create' | 'edit'
type SearchMode = 'name' | 'sku' | 'category'

const PAYMENT_MODES = [
  { value: 'cash',    label: 'Cash',         paid: true },
  { value: 'upi',     label: 'UPI',          paid: true },
  { value: 'upi_qr',  label: 'UPI (QR Scan)', paid: true },
  { value: 'credit',  label: 'Credit',       paid: false },
]

function newItem(): LineItem {
  return {
    id: Math.random().toString(36).slice(2),
    product_id: null, product_name: '', product_sku: '',
    variant_id: null, variant_name: '',
    hsn_code: '', gst_rate: '18', quantity: '1', unit_price: '',
  }
}

function calcLine(it: LineItem) {
  return (parseFloat(it.quantity) || 0) * (parseFloat(it.unit_price) || 0)
}

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
}

export default function InvoicesClient() {
  const { showToast } = useToast()
  const [view, setView] = useState<View>('list')
  const [editId, setEditId] = useState<string | null>(null)

  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null)
  const [cancellingId, setCancellingId] = useState<string | null>(null)
  const [confirmCancelId, setConfirmCancelId] = useState<string | null>(null)
  const [sourceFilter, setSourceFilter] = useState('')
  const [paymentFilter, setPaymentFilter] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [searchQ, setSearchQ] = useState('')
  const [searchInput, setSearchInput] = useState('')

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
  const [invoiceDate, setInvoiceDate] = useState('')
  const [notes, setNotes] = useState('')
  const [creditWarning, setCreditWarning] = useState<{ outstanding: number; creditLimit: number } | null>(null)
  const [items, setItems] = useState<LineItem[]>([newItem()])
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState('')
  const [editLoading, setEditLoading] = useState(false)

  const [searchMode, setSearchMode] = useState<SearchMode>('name')
  const [skuInput, setSkuInput] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [categories, setCategories] = useState<Category[]>([])
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [activeItemId, setActiveItemId] = useState<string | null>(null)
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerItemId, setPickerItemId] = useState<string | null>(null)
  const [pickerCatId, setPickerCatId] = useState('')
  const [pickerProducts, setPickerProducts] = useState<Suggestion[]>([])
  const [pickerLoading, setPickerLoading] = useState(false)
  const [pickerSearch, setPickerSearch] = useState('')

  const totalPages = Math.ceil(total / 25)

  useEffect(() => {
    fetch('/api/categories', { credentials: 'include' })
      .then(r => r.json())
      .then(d => setCategories(d.categories || d || []))
      .catch(() => {})
  }, [])

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

  const searchProducts = useCallback((query: string, itemId: string, catId?: string) => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    if (!query.trim() && !catId) { setSuggestions([]); return }
    searchTimerRef.current = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ limit: '10' })
        if (query.trim()) params.set('q', query.trim())
        if (catId) params.set('category_id', catId)
        const res = await fetch(`/api/admin/labels/products?${params}`, { credentials: 'include' })
        if (!res.ok) return
        const data = await res.json()
        setSuggestions(data.products || [])
        setActiveItemId(itemId)
      } catch { setSuggestions([]) }
    }, 250)
  }, [])

  function openPicker(itemId: string, catId: string) {
    setPickerItemId(itemId)
    setPickerCatId(catId)
    setPickerSearch('')
    setPickerProducts([])
    setPickerOpen(true)
    loadPickerProducts(catId, '')
  }

  async function loadPickerProducts(catId: string, q: string) {
    if (!catId) return
    setPickerLoading(true)
    try {
      const params = new URLSearchParams({ limit: '100' })
      params.set('category_id', catId)
      if (q.trim()) params.set('q', q.trim())
      const res = await fetch(`/api/admin/labels/products?${params}`, { credentials: 'include' })
      const data = await res.json()
      setPickerProducts(data.products || [])
    } catch { setPickerProducts([]) }
    finally { setPickerLoading(false) }
  }

  function applyPickerProduct(s: Suggestion) {
    if (!pickerItemId) return
    applyProduct(pickerItemId, s)
    setPickerOpen(false)
    setPickerItemId(null)
  }

  function applyProduct(itemId: string, s: Suggestion) {
    setItems(prev => prev.map(it => it.id !== itemId ? it : {
      ...it,
      product_id: s.product_id,
      product_name: s.variant_name ? `${s.name} — ${s.variant_name}` : s.name,
      product_sku: s.sku,
      variant_id: s.variant_id,
      variant_name: s.variant_name || '',
      hsn_code: s.hsn_code || '',
      gst_rate: String(s.gst_percentage ?? 18),
      unit_price: String(s.base_price ?? ''),
    }))
    setSuggestions([])
    setActiveItemId(null)
    setSkuInput('')
  }

  function updateItem(id: string, field: keyof LineItem, value: string) {
    setItems(prev => prev.map(it => it.id === id ? { ...it, [field]: value } : it))
  }

  function resetForm() {
    setCustomerName(''); setCustomerPhone(''); setCustomerEmail('')
    setAddressLine1(''); setAddressLine2(''); setCity(''); setState(''); setPostalCode('')
    setBuyerGstin(''); setPaymentMode('cash'); setInvoiceDate(''); setNotes('')
    setItems([newItem()]); setFormError('')
    setSearchMode('name'); setSkuInput(''); setCategoryId('')
    setSuggestions([]); setActiveItemId(null)
    setEditId(null)
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
      setCustomerPhone(order.customer_phone || '')
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
        variant_name: it.variant_name || '',
        hsn_code: it.hsn_code || '',
        gst_rate: String(it.gst_rate ?? '18'),
        quantity: String(it.quantity ?? '1'),
        unit_price: String(it.unit_price ?? ''),
      })) : [newItem()])

      setFormError('')
      setSearchMode('name')
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

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!customerName.trim()) { setFormError('Customer name is required'); return }
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
      showToast(`Invoice ${data.invoiceNumber || ''} created`, 'success')
      resetForm()
      setView('list')
      fetchInvoices(1)
      if (data.invoiceUrl) window.open(data.invoiceUrl, '_blank')
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
      showToast('Invoice updated', 'success')
      resetForm()
      setView('list')
      fetchInvoices(1)
    } catch (err: any) {
      setFormError(err.message || 'Failed')
    } finally {
      setSubmitting(false)
    }
  }

  const subtotal = items.reduce((s, it) => s + calcLine(it), 0)
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
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Customer Name <span className="text-red-500">*</span></label>
                <input type="text" value={customerName} onChange={e => setCustomerName(e.target.value)} required
                  className={inputCls} placeholder="Full name" />
              </div>
              <div>
                <label className={labelCls}>Phone</label>
                <input type="tel" value={customerPhone} onChange={e => setCustomerPhone(e.target.value)}
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
                  className={inputCls} placeholder="+91 XXXXX XXXXX" />
              </div>
              <div>
                <label className={labelCls}>Email</label>
                <input type="email" value={customerEmail} onChange={e => setCustomerEmail(e.target.value)}
                  className={inputCls} placeholder="customer@example.com" />
              </div>
              <div>
                <label className={labelCls}>Buyer GSTIN</label>
                <input type="text" value={buyerGstin} onChange={e => setBuyerGstin(e.target.value.toUpperCase())} maxLength={15}
                  className={inputCls + ' font-mono'} placeholder="29XXXXX..." />
              </div>
              {isEdit && (
                <div>
                  <label className={labelCls}>Invoice Date</label>
                  <input type="date" value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)} className={inputCls} />
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
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-foreground">Line Items</h2>
              <button type="button" onClick={() => setItems(p => [...p, newItem()])}
                className="flex items-center gap-1 text-xs text-secondary-500 dark:text-secondary-300 font-semibold hover:text-secondary-600 dark:hover:text-secondary-200 transition-colors">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add Item
              </button>
            </div>

            <div className="flex gap-1 mb-3 p-1 bg-surface-secondary rounded-lg w-fit">
              {(['name', 'sku', 'category'] as SearchMode[]).map(m => (
                <button key={m} type="button" onClick={() => { setSearchMode(m); setSuggestions([]); setSkuInput(''); setCategoryId('') }}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-colors capitalize ${searchMode === m ? 'bg-secondary-500 dark:bg-secondary-400 text-white dark:text-secondary-900 shadow-sm' : 'text-foreground-secondary hover:text-foreground'}`}>
                  {m === 'name' ? 'Name' : m === 'sku' ? 'SKU' : 'Category'}
                </button>
              ))}
            </div>

            <div className="space-y-3">
              {items.map((item, idx) => (
                <div key={item.id} className="border border-border-default rounded-lg p-3 space-y-3 bg-surface-elevated">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-foreground-muted uppercase tracking-wide">Item {idx + 1}</span>
                    {items.length > 1 && (
                      <button type="button" onClick={() => setItems(p => p.filter(i => i.id !== item.id))}
                        className="text-xs text-red-500 hover:text-red-600 font-medium">Remove</button>
                    )}
                  </div>

                  <div className="relative">
                    {searchMode === 'name' && (
                      <>
                        <label className={labelCls}>Product / Description <span className="text-red-500">*</span></label>
                        <input type="text" value={item.product_name}
                          onChange={e => { updateItem(item.id, 'product_name', e.target.value); searchProducts(e.target.value, item.id) }}
                          onFocus={() => item.product_name && searchProducts(item.product_name, item.id)}
                          onBlur={() => setTimeout(() => { setSuggestions([]); setActiveItemId(null) }, 200)}
                          required className={inputCls} placeholder="Search by product name..." />
                      </>
                    )}

                    {searchMode === 'sku' && (
                      <>
                        <label className={labelCls}>Search by SKU</label>
                        <input type="text" value={activeItemId === item.id ? skuInput : ''}
                          onChange={e => { setSkuInput(e.target.value); setActiveItemId(item.id); searchProducts(e.target.value, item.id) }}
                          onFocus={() => { setActiveItemId(item.id) }}
                          onBlur={() => setTimeout(() => { setSuggestions([]); setActiveItemId(null) }, 200)}
                          className={inputCls + ' font-mono'} placeholder="e.g. JFS-1234" />
                        {item.product_name && (
                          <p className="text-xs text-foreground-secondary mt-1">Selected: <span className="font-medium text-foreground">{item.product_name}</span> <span className="text-foreground-muted">({item.product_sku})</span></p>
                        )}
                      </>
                    )}

                    {searchMode === 'category' && (
                      <>
                        <label className={labelCls}>Browse by Category</label>
                        <div className="flex gap-2">
                          <div className="flex-1">
                            <AdminSelect
                              value={categoryId}
                              onChange={v => setCategoryId(v)}
                              placeholder="— Select category —"
                              options={categories.map(c => ({ value: c.id, label: c.name }))}
                            />
                          </div>
                          <button type="button"
                            disabled={!categoryId}
                            onClick={() => openPicker(item.id, categoryId)}
                            className="px-3 py-1.5 bg-secondary-500 hover:bg-secondary-600 dark:bg-secondary-400 dark:hover:bg-secondary-300 dark:text-secondary-900 disabled:opacity-40 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap">
                            Select Product
                          </button>
                        </div>
                        {item.product_name && (
                          <p className="text-xs text-foreground-secondary mt-1.5">Selected: <span className="font-medium text-foreground">{item.product_name}</span> <span className="text-foreground-muted font-mono">({item.product_sku})</span></p>
                        )}
                      </>
                    )}

                    {activeItemId === item.id && suggestions.length > 0 && (
                      <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-surface-elevated border border-border-default rounded-lg shadow-lg max-h-52 overflow-y-auto">
                        {suggestions.map(s => (
                          <button key={s.id} type="button" onMouseDown={() => applyProduct(item.id, s)}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-surface-secondary flex items-center justify-between gap-2">
                            <span>
                              <span className="font-medium text-foreground">{s.name}</span>
                              {s.variant_name && <span className="text-foreground-muted ml-1">— {s.variant_name}</span>}
                              <span className="text-foreground-muted text-xs ml-2 font-mono">{s.sku}</span>
                            </span>
                            {s.base_price != null && (
                              <span className="text-xs text-foreground-muted shrink-0">₹{s.base_price}</span>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <div>
                      <label className={labelCls}>HSN Code</label>
                      <input type="text" value={item.hsn_code} onChange={e => updateItem(item.id, 'hsn_code', e.target.value)}
                        className={inputCls} placeholder="9999" />
                    </div>
                    <div>
                      <label className={labelCls}>GST %</label>
                      {searchMode === 'name' ? (
                        <AdminSelect
                          value={item.gst_rate}
                          onChange={v => updateItem(item.id, 'gst_rate', v)}
                          className="[&_button]:py-1.5 [&_button]:px-2 [&_button]:text-sm [&_button]:rounded [&_button]:border-border-default"
                          options={[
                            { value: '0', label: '0%' }, { value: '5', label: '5%' },
                            { value: '12', label: '12%' }, { value: '18', label: '18%' },
                            { value: '28', label: '28%' },
                          ]}
                        />
                      ) : (
                        <div className={inputCls + ' bg-surface-elevated text-foreground-muted cursor-not-allowed select-none'}>
                          {item.gst_rate}%
                        </div>
                      )}
                    </div>
                    <div>
                      <label className={labelCls}>Quantity <span className="text-red-500">*</span></label>
                      <input type="number" min="0.001" step="any" value={item.quantity}
                        onChange={e => updateItem(item.id, 'quantity', e.target.value)} required className={inputCls} />
                    </div>
                    <div>
                      <label className={labelCls}>Unit Price (incl. GST) <span className="text-red-500">*</span></label>
                      <input type="number" min="0" step="0.01" value={item.unit_price}
                        onChange={e => updateItem(item.id, 'unit_price', e.target.value)} required
                        className={inputCls} placeholder="0.00" />
                    </div>
                  </div>

                  {item.unit_price && (
                    <p className="text-xs text-foreground-secondary text-right">
                      Line total: <span className="font-semibold text-foreground">₹{fmt(calcLine(item))}</span>
                    </p>
                  )}
                </div>
              ))}
            </div>

            <div className="flex justify-end border-t border-border-default pt-3 mt-1">
              <div className="text-right">
                <p className="text-xs text-foreground-secondary">Total (incl. GST)</p>
                <p className="text-xl font-bold text-foreground">₹{fmt(subtotal)}</p>
              </div>
            </div>
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
                  <div className="mt-2 px-3 py-2 rounded-lg bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-700 text-xs text-yellow-700 dark:text-yellow-300">
                    ⚠ {creditWarning.creditLimit > 0
                      ? `Credit limit warning: ₹${creditWarning.outstanding.toLocaleString('en-IN')} outstanding of ₹${creditWarning.creditLimit.toLocaleString('en-IN')} limit`
                      : `₹${creditWarning.outstanding.toLocaleString('en-IN')} already outstanding for this customer`}
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
            <button type="button" onClick={() => { resetForm(); setView('list') }}
              className="px-6 py-2 border border-border-default rounded-lg text-sm font-medium text-foreground hover:bg-surface-secondary transition-colors">
              Cancel
            </button>
          </div>
        </form>

        {pickerOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
            <div className="bg-surface-elevated border border-border-default rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col">
              <div className="flex items-center justify-between px-4 py-3 border-b border-border-default shrink-0">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">Select Product</h3>
                  <p className="text-xs text-foreground-muted mt-0.5">
                    {categories.find(c => c.id === pickerCatId)?.name || 'All products'}
                  </p>
                </div>
                <button type="button" onClick={() => setPickerOpen(false)}
                  className="p-1.5 text-foreground-secondary hover:text-foreground transition-colors">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="px-4 py-3 border-b border-border-default shrink-0">
                <input
                  type="text"
                  value={pickerSearch}
                  onChange={e => { setPickerSearch(e.target.value); loadPickerProducts(pickerCatId, e.target.value) }}
                  className={inputCls}
                  placeholder="Filter by name or SKU…"
                  autoFocus
                />
              </div>

              <div className="overflow-y-auto flex-1">
                {pickerLoading ? (
                  <div className="p-8 text-center text-foreground-muted text-sm">Loading…</div>
                ) : pickerProducts.length === 0 ? (
                  <div className="p-8 text-center text-foreground-muted text-sm">No products found in this category.</div>
                ) : (() => {
                  const groups: { productId: string; name: string; items: Suggestion[] }[] = []
                  for (const p of pickerProducts) {
                    const g = groups.find(g => g.productId === p.product_id)
                    if (g) g.items.push(p)
                    else groups.push({ productId: p.product_id, name: p.name, items: [p] })
                  }
                  return (
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-surface-secondary">
                        <tr>
                          <th className="px-4 py-2 text-left text-xs font-semibold text-foreground-secondary">Product / Variant</th>
                          <th className="px-4 py-2 text-left text-xs font-semibold text-foreground-secondary">SKU</th>
                          <th className="px-4 py-2 text-right text-xs font-semibold text-foreground-secondary">Price</th>
                        </tr>
                      </thead>
                      <tbody>
                        {groups.map(g => (
                          <>
                            {g.items.length > 1 && (
                              <tr key={`${g.productId}-header`}>
                                <td colSpan={3} className="px-4 pt-2.5 pb-1 text-xs font-semibold text-foreground-muted uppercase tracking-wider bg-surface-secondary">
                                  {g.name}
                                </td>
                              </tr>
                            )}
                            {g.items.map(s => (
                              <tr key={s.id}
                                onClick={() => applyPickerProduct(s)}
                                className="border-t border-border-default hover:bg-surface-secondary cursor-pointer transition-colors">
                                <td className="px-4 py-2.5">
                                  {g.items.length > 1 ? (
                                    <span className="text-foreground pl-2">{s.variant_name || s.name}</span>
                                  ) : (
                                    <span className="font-medium text-foreground">{s.name}</span>
                                  )}
                                </td>
                                <td className="px-4 py-2.5 font-mono text-xs text-foreground-muted">{s.sku}</td>
                                <td className="px-4 py-2.5 text-right text-foreground font-medium">
                                  {s.base_price != null ? `₹${s.base_price}` : '—'}
                                </td>
                              </tr>
                            ))}
                          </>
                        ))}
                      </tbody>
                    </table>
                  )
                })()}
              </div>
            </div>
          </div>
        )}
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
        <div className="flex flex-wrap gap-2 items-end">
          <div className="flex-1 min-w-48">
            <input type="text" value={searchInput} onChange={e => setSearchInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && setSearchQ(searchInput)}
              placeholder="Search invoice, order, customer…"
              className={inputCls} />
          </div>
          <button onClick={() => setSearchQ(searchInput)}
            className="px-4 py-1.5 bg-secondary-500 hover:bg-secondary-600 dark:bg-secondary-400 dark:hover:bg-secondary-300 dark:text-secondary-900 text-white rounded-lg text-sm font-medium transition-colors">
            Search
          </button>
          {(searchQ || sourceFilter || paymentFilter || fromDate || toDate) && (
            <button onClick={() => { setSearchQ(''); setSearchInput(''); setSourceFilter(''); setPaymentFilter(''); setFromDate(''); setToDate('') }}
              className="px-4 py-1.5 border border-border-default rounded-lg text-sm text-foreground-secondary hover:bg-surface-secondary transition-colors">
              Clear
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <AdminSelect value={sourceFilter} onChange={setSourceFilter} placeholder="All Sources"
            options={[{ value: 'online', label: 'Online' }, { value: 'offline', label: 'Offline' }]} />
          <AdminSelect value={paymentFilter} onChange={setPaymentFilter} placeholder="All Payments"
            options={[
              { value: 'paid', label: 'Paid' }, { value: 'unpaid', label: 'Unpaid' },
              { value: 'refunded', label: 'Refunded' }, { value: 'failed', label: 'Failed' },
            ]} />
          <div className="flex items-center gap-2">
            <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
              className={inputCls + ' w-36'} />
            <span className="text-foreground-secondary text-xs">to</span>
            <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
              className={inputCls + ' w-36'} />
          </div>
        </div>
      </div>

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
                    {['Invoice No', 'Date', 'Customer', 'Source', 'Amount', 'Payment', 'IRN', 'Actions'].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-foreground-secondary">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {invoices.map(inv => (
                    <tr key={inv.id} className="border-b border-border-default hover:bg-surface-secondary transition-colors cursor-pointer" onClick={() => setSelectedInvoice(inv)}>
                      <td className="px-4 py-3 font-mono font-semibold text-foreground text-sm" onClick={e => e.stopPropagation()}>
                        <HoverCard
                          trigger={
                            <span className="cursor-default underline decoration-dotted underline-offset-2 hover:text-accent-500 transition-colors">
                              {inv.invoice_number}
                            </span>
                          }
                          align="left"
                          side="bottom"
                          width="280px"
                        >
                          <div className="p-3 space-y-2">
                            <p className="font-semibold text-foreground text-sm">{inv.invoice_number}</p>
                            <div className="text-xs text-foreground-secondary space-y-1">
                              <div className="flex justify-between gap-4">
                                <span>Customer</span>
                                <span className="text-foreground font-medium">{inv.customer_name}</span>
                              </div>
                              {inv.buyer_gstin && (
                                <div className="flex justify-between gap-4">
                                  <span>GSTIN</span>
                                  <span className="font-mono text-foreground">{inv.buyer_gstin}</span>
                                </div>
                              )}
                              <div className="flex justify-between gap-4">
                                <span>Taxable</span>
                                <span className="text-foreground">₹{parseFloat(inv.taxable_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                              </div>
                              {parseFloat(inv.cgst_amount) > 0 && (
                                <div className="flex justify-between gap-4">
                                  <span>CGST + SGST</span>
                                  <span className="text-foreground">
                                    ₹{parseFloat(inv.cgst_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })} + ₹{parseFloat(inv.sgst_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                                  </span>
                                </div>
                              )}
                              {parseFloat(inv.igst_amount) > 0 && (
                                <div className="flex justify-between gap-4">
                                  <span>IGST</span>
                                  <span className="text-foreground">₹{parseFloat(inv.igst_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                                </div>
                              )}
                              {inv.irn && (
                                <div className="flex justify-between gap-4">
                                  <span>IRN</span>
                                  <span className={`font-medium ${inv.irn_status === 'generated' ? 'text-green-600 dark:text-green-400' : 'text-yellow-600 dark:text-yellow-400'}`}>
                                    {inv.irn_status === 'generated' ? 'Generated ✓' : 'Stub'}
                                  </span>
                                </div>
                              )}
                            </div>
                            <div className="pt-1 border-t border-border-default">
                              <a
                                href={`/api/orders/${inv.id}/invoice`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1.5 text-xs text-accent-500 hover:text-accent-600 font-medium"
                              >
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                                </svg>
                                Download PDF
                              </a>
                            </div>
                          </div>
                        </HoverCard>
                      </td>
                      <td className="px-4 py-3 text-foreground-secondary whitespace-nowrap text-sm">{fmtDate(inv.invoice_date)}</td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-foreground text-sm">{inv.customer_name}</div>
                        {inv.buyer_gstin && <div className="text-xs text-foreground-muted font-mono">{inv.buyer_gstin}</div>}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${SOURCE_COLORS[inv.source] || ''}`}>
                          {inv.source === 'offline' ? 'Offline' : 'Online'}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-semibold text-foreground whitespace-nowrap text-sm">
                        ₹{parseFloat(inv.total_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${PAYMENT_COLORS[inv.payment_status] || ''}`}>
                          {inv.payment_status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {inv.irn ? (
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${inv.irn_status === 'generated' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300'}`}>
                            {inv.irn_status === 'generated' ? 'IRN ✓' : 'Stub'}
                          </span>
                        ) : (
                          <span className="text-xs text-foreground-muted">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center gap-3">
                          <a href={`/api/orders/${inv.id}/invoice`} target="_blank" rel="noreferrer"
                            className="text-xs text-secondary-500 dark:text-secondary-300 hover:underline font-medium">PDF</a>
                          {inv.source === 'offline' ? (
                            <>
                              {inv.status !== 'cancelled' && (
                                <button onClick={() => openEdit(inv)}
                                  className="text-xs text-foreground-secondary hover:text-foreground font-medium transition-colors">
                                  Edit
                                </button>
                              )}
                              {inv.status !== 'cancelled' && (
                                confirmCancelId === inv.id ? (
                                  <>
                                    <span className="text-xs text-foreground-secondary">Cancel {inv.invoice_number}?</span>
                                    <button onClick={() => cancelInvoice(inv)} disabled={cancellingId === inv.id}
                                      className="text-xs text-red-600 hover:text-red-700 font-medium disabled:opacity-50">
                                      {cancellingId === inv.id ? '…' : 'Confirm'}
                                    </button>
                                    <button onClick={() => setConfirmCancelId(null)}
                                      className="text-xs text-foreground-muted hover:text-foreground font-medium">
                                      No
                                    </button>
                                  </>
                                ) : (
                                  <button onClick={() => cancelInvoice(inv)} disabled={cancellingId === inv.id}
                                    className="text-xs text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 font-medium transition-colors disabled:opacity-50">
                                    Cancel
                                  </button>
                                )
                              )}
                              {inv.status === 'cancelled' && (
                                <span className="text-xs text-foreground-muted italic">Cancelled</span>
                              )}
                            </>
                          ) : (
                            <a href={`/admin/orders/${inv.id}`}
                              className="text-xs text-foreground-secondary hover:text-foreground">Order</a>
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
                <div key={inv.id} className="p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-semibold text-foreground text-sm">{inv.invoice_number}</span>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${SOURCE_COLORS[inv.source] || ''}`}>
                      {inv.source === 'offline' ? 'Offline' : 'Online'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-foreground">{inv.customer_name}</span>
                    <span className="font-semibold text-foreground text-sm">
                      ₹{parseFloat(inv.total_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-foreground-muted">{fmtDate(inv.invoice_date)}</span>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${PAYMENT_COLORS[inv.payment_status] || ''}`}>
                      {inv.payment_status}
                    </span>
                  </div>
                  <div className="flex gap-4 pt-1">
                    <a href={`/api/orders/${inv.id}/invoice`} target="_blank" rel="noreferrer"
                      className="text-xs text-secondary-500 dark:text-secondary-300 font-medium hover:underline">Download PDF</a>
                    {inv.source === 'offline' ? (
                      <>
                        {inv.status !== 'cancelled' && (
                          <button onClick={() => openEdit(inv)}
                            className="text-xs text-foreground-secondary hover:text-foreground font-medium">Edit</button>
                        )}
                        {inv.status !== 'cancelled' && (
                          confirmCancelId === inv.id ? (
                            <>
                              <span className="text-xs text-foreground-secondary">Cancel {inv.invoice_number}?</span>
                              <button onClick={() => cancelInvoice(inv)} disabled={cancellingId === inv.id}
                                className="text-xs text-red-600 hover:text-red-700 font-medium disabled:opacity-50">
                                {cancellingId === inv.id ? '…' : 'Confirm'}
                              </button>
                              <button onClick={() => setConfirmCancelId(null)}
                                className="text-xs text-foreground-muted hover:text-foreground font-medium">
                                No
                              </button>
                            </>
                          ) : (
                            <button onClick={() => cancelInvoice(inv)} disabled={cancellingId === inv.id}
                              className="text-xs text-red-500 hover:text-red-700 dark:text-red-400 font-medium disabled:opacity-50">
                              Cancel
                            </button>
                          )
                        )}
                        {inv.status === 'cancelled' && (
                          <span className="text-xs text-foreground-muted italic">Cancelled</span>
                        )}
                      </>
                    ) : (
                      <a href={`/admin/orders/${inv.id}`} className="text-xs text-foreground-secondary hover:text-foreground">View Order</a>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {totalPages > 1 && (
              <div className="px-4 py-3 border-t border-border-default flex items-center justify-between">
                <p className="text-xs text-foreground-muted">Page {page} of {totalPages} — {total} invoices</p>
                <div className="flex gap-2">
                  <button disabled={page <= 1} onClick={() => fetchInvoices(page - 1)}
                    className="px-3 py-1.5 border border-border-default rounded text-xs text-foreground disabled:opacity-40 hover:bg-surface-secondary transition-colors">Prev</button>
                  <button disabled={page >= totalPages} onClick={() => fetchInvoices(page + 1)}
                    className="px-3 py-1.5 border border-border-default rounded text-xs text-foreground disabled:opacity-40 hover:bg-surface-secondary transition-colors">Next</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
      {selectedInvoice && <InvoiceDetailModal inv={selectedInvoice} onClose={() => setSelectedInvoice(null)} />}
    </div>
  )
}

function InvoiceDetailModal({ inv, onClose }: { inv: Invoice; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
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
              {inv.source === 'offline' ? 'Offline' : 'Online'}
            </span>
            {inv.irn && (
              <span className={`px-2.5 py-0.5 text-xs font-semibold rounded-full ${inv.irn_status === 'generated' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300'}`}>
                {inv.irn_status === 'generated' ? 'IRN ✓' : 'IRN Stub'}
              </span>
            )}
          </div>

          {/* Customer */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-foreground-muted uppercase tracking-wide mb-1.5">Customer</p>
              <p className="text-sm font-semibold text-foreground">{inv.customer_name}</p>
              {inv.customer_phone && <p className="text-xs text-foreground-secondary mt-0.5">{inv.customer_phone}</p>}
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
          </div>
        </div>
      </div>
    </div>
  )
}
