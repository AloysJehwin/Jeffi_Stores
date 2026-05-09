'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import AdminSelect from '@/components/admin/AdminSelect'
import { useToast } from '@/contexts/ToastContext'

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
  name: string
  sku: string
  hsn_code: string | null
  gst_rate: number | null
  price: number | null
  variants: { id: string; variant_name: string; price: number | null; sku: string }[]
}

type View = 'list' | 'create'

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

const PAYMENT_COLORS: Record<string, string> = {
  paid: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  unpaid: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  refunded: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
  failed: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
}

const SOURCE_COLORS: Record<string, string> = {
  online: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  offline: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
}

export default function InvoicesClient() {
  const { showToast } = useToast()
  const [view, setView] = useState<View>('list')

  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
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
  const [notes, setNotes] = useState('')
  const [items, setItems] = useState<LineItem[]>([newItem()])
  const [submitting, setSubmitting] = useState(false)
  const [createError, setCreateError] = useState('')

  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [activeItemId, setActiveItemId] = useState<string | null>(null)
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const totalPages = Math.ceil(total / 25)

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

  const searchProducts = useCallback((query: string, itemId: string) => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    if (!query.trim()) { setSuggestions([]); return }
    searchTimerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/admin/labels/products?q=${encodeURIComponent(query)}&limit=8`, { credentials: 'include' })
        if (!res.ok) return
        const data = await res.json()
        setSuggestions(data.products || [])
        setActiveItemId(itemId)
      } catch { setSuggestions([]) }
    }, 300)
  }, [])

  function applyProduct(itemId: string, p: Suggestion, v?: Suggestion['variants'][0]) {
    setItems(prev => prev.map(it => it.id !== itemId ? it : {
      ...it,
      product_id: p.id,
      product_name: p.name,
      product_sku: v?.sku || p.sku,
      variant_id: v?.id || null,
      variant_name: v?.variant_name || '',
      hsn_code: p.hsn_code || '',
      gst_rate: String(p.gst_rate ?? 18),
      unit_price: String(v?.price ?? p.price ?? ''),
    }))
    setSuggestions([])
    setActiveItemId(null)
  }

  function updateItem(id: string, field: keyof LineItem, value: string) {
    setItems(prev => prev.map(it => it.id === id ? { ...it, [field]: value } : it))
  }

  function resetCreate() {
    setCustomerName(''); setCustomerPhone(''); setCustomerEmail('')
    setAddressLine1(''); setAddressLine2(''); setCity(''); setState(''); setPostalCode('')
    setBuyerGstin(''); setPaymentMode('cash'); setNotes('')
    setItems([newItem()]); setCreateError('')
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!customerName.trim()) { setCreateError('Customer name is required'); return }
    if (items.some(it => !it.product_name.trim() || !it.unit_price)) {
      setCreateError('All items need a name and price'); return
    }
    setCreateError(''); setSubmitting(true)
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
      if (!res.ok) { setCreateError(data.error || 'Failed'); return }
      showToast(`Invoice ${data.invoiceNumber || ''} created`, 'success')
      resetCreate()
      setView('list')
      fetchInvoices(1)
      if (data.invoiceUrl) window.open(data.invoiceUrl, '_blank')
    } catch (err: any) {
      setCreateError(err.message || 'Failed')
    } finally {
      setSubmitting(false)
    }
  }

  const subtotal = items.reduce((s, it) => s + calcLine(it), 0)

  if (view === 'create') {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">New Offline Invoice</h1>
            <p className="text-foreground-secondary text-sm mt-1">Walk-in, credit sale, B2B or bulk order</p>
          </div>
          <button
            onClick={() => { resetCreate(); setView('list') }}
            className="flex items-center gap-2 px-4 py-2 border border-border rounded-lg text-sm text-foreground hover:bg-surface-secondary"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            Back to Invoices
          </button>
        </div>

        <form onSubmit={handleCreate} className="space-y-5">
          <div className="bg-surface-elevated rounded-lg shadow p-4 sm:p-6 space-y-4">
            <h2 className="text-sm font-semibold text-foreground uppercase tracking-wide">Customer Details</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-foreground-secondary mb-1">Customer Name <span className="text-red-500">*</span></label>
                <input type="text" value={customerName} onChange={e => setCustomerName(e.target.value)} required
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30" placeholder="Full name" />
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground-secondary mb-1">Phone</label>
                <input type="tel" value={customerPhone} onChange={e => setCustomerPhone(e.target.value)}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30" placeholder="+91 XXXXX XXXXX" />
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground-secondary mb-1">Email</label>
                <input type="email" value={customerEmail} onChange={e => setCustomerEmail(e.target.value)}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30" placeholder="customer@example.com" />
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground-secondary mb-1">Buyer GSTIN</label>
                <input type="text" value={buyerGstin} onChange={e => setBuyerGstin(e.target.value.toUpperCase())} maxLength={15}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background text-foreground font-mono focus:outline-none focus:ring-2 focus:ring-primary/30" placeholder="29XXXXX..." />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-foreground-secondary mb-1">Address Line 1</label>
                <input type="text" value={addressLine1} onChange={e => setAddressLine1(e.target.value)}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30" placeholder="Street address" />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-foreground-secondary mb-1">Address Line 2</label>
                <input type="text" value={addressLine2} onChange={e => setAddressLine2(e.target.value)}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30" placeholder="Apt, area, landmark" />
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground-secondary mb-1">City</label>
                <input type="text" value={city} onChange={e => setCity(e.target.value)}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30" />
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground-secondary mb-1">State</label>
                <input type="text" value={state} onChange={e => setState(e.target.value)}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30" placeholder="Tamil Nadu" />
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground-secondary mb-1">Postal Code</label>
                <input type="text" value={postalCode} onChange={e => setPostalCode(e.target.value)}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30" />
              </div>
            </div>
          </div>

          <div className="bg-surface-elevated rounded-lg shadow p-4 sm:p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-foreground uppercase tracking-wide">Line Items</h2>
              <button type="button" onClick={() => setItems(p => [...p, newItem()])}
                className="flex items-center gap-1 text-sm text-primary font-medium hover:text-primary/80">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add Item
              </button>
            </div>

            <div className="space-y-3">
              {items.map((item, idx) => (
                <div key={item.id} className="border border-border-default rounded-lg p-4 space-y-3 bg-background">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-foreground-muted uppercase tracking-wide">Item {idx + 1}</span>
                    {items.length > 1 && (
                      <button type="button" onClick={() => setItems(p => p.filter(i => i.id !== item.id))}
                        className="text-xs text-red-500 hover:text-red-600 font-medium">Remove</button>
                    )}
                  </div>

                  <div className="relative">
                    <label className="block text-xs font-medium text-foreground-secondary mb-1">Product / Description <span className="text-red-500">*</span></label>
                    <input type="text" value={item.product_name}
                      onChange={e => { updateItem(item.id, 'product_name', e.target.value); searchProducts(e.target.value, item.id) }}
                      onFocus={() => item.product_name && searchProducts(item.product_name, item.id)}
                      onBlur={() => setTimeout(() => setSuggestions([]), 200)}
                      required
                      className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-surface-elevated text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                      placeholder="Search or type product name" />
                    {activeItemId === item.id && suggestions.length > 0 && (
                      <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-surface-elevated border border-border rounded-lg shadow-lg max-h-52 overflow-y-auto">
                        {suggestions.map(p => (
                          <div key={p.id}>
                            {p.variants?.length > 0 ? p.variants.map(v => (
                              <button key={v.id} type="button" onMouseDown={() => applyProduct(item.id, p, v)}
                                className="w-full text-left px-3 py-2 text-sm hover:bg-surface-secondary flex items-center justify-between gap-2">
                                <span><span className="font-medium text-foreground">{p.name}</span><span className="text-foreground-muted ml-1">— {v.variant_name}</span></span>
                                {v.price && <span className="text-xs text-foreground-muted shrink-0">Rs {v.price}</span>}
                              </button>
                            )) : (
                              <button type="button" onMouseDown={() => applyProduct(item.id, p)}
                                className="w-full text-left px-3 py-2 text-sm hover:bg-surface-secondary flex items-center justify-between gap-2">
                                <span><span className="font-medium text-foreground">{p.name}</span><span className="text-foreground-muted text-xs ml-2">{p.sku}</span></span>
                                {p.price && <span className="text-xs text-foreground-muted shrink-0">Rs {p.price}</span>}
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-foreground-secondary mb-1">HSN Code</label>
                      <input type="text" value={item.hsn_code} onChange={e => updateItem(item.id, 'hsn_code', e.target.value)}
                        className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-surface-elevated text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30" placeholder="9999" />
                    </div>
                    <div>
                      <AdminSelect
                        label="GST %"
                        value={item.gst_rate}
                        onChange={v => updateItem(item.id, 'gst_rate', v)}
                        options={[
                          { value: '0', label: '0%' }, { value: '5', label: '5%' },
                          { value: '12', label: '12%' }, { value: '18', label: '18%' },
                          { value: '28', label: '28%' },
                        ]}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-foreground-secondary mb-1">Quantity <span className="text-red-500">*</span></label>
                      <input type="number" min="0.001" step="any" value={item.quantity} onChange={e => updateItem(item.id, 'quantity', e.target.value)} required
                        className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-surface-elevated text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-foreground-secondary mb-1">Unit Price (incl. GST) <span className="text-red-500">*</span></label>
                      <input type="number" min="0" step="0.01" value={item.unit_price} onChange={e => updateItem(item.id, 'unit_price', e.target.value)} required
                        className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-surface-elevated text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30" placeholder="0.00" />
                    </div>
                  </div>
                  {item.unit_price && (
                    <p className="text-xs text-foreground-secondary text-right">Line total: <span className="font-semibold text-foreground">Rs {fmt(calcLine(item))}</span></p>
                  )}
                </div>
              ))}
            </div>

            <div className="flex justify-end border-t border-border pt-3">
              <div className="text-right">
                <p className="text-xs text-foreground-secondary">Total (incl. GST)</p>
                <p className="text-xl font-bold text-foreground">Rs {fmt(subtotal)}</p>
              </div>
            </div>
          </div>

          <div className="bg-surface-elevated rounded-lg shadow p-4 sm:p-6">
            <h2 className="text-sm font-semibold text-foreground uppercase tracking-wide mb-4">Payment & Notes</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-foreground-secondary mb-2">Payment Mode</label>
                <div className="flex gap-4">
                  {(['cash', 'upi', 'credit'] as const).map(mode => (
                    <label key={mode} className="flex items-center gap-2 cursor-pointer">
                      <input type="radio" name="paymentMode" value={mode} checked={paymentMode === mode}
                        onChange={() => setPaymentMode(mode)} className="accent-primary" />
                      <span className="text-sm text-foreground capitalize">{mode}</span>
                    </label>
                  ))}
                </div>
                {paymentMode === 'credit' && (
                  <p className="text-xs text-yellow-600 dark:text-yellow-400 mt-1">Payment status will be Unpaid — credit sale</p>
                )}
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground-secondary mb-1">Notes</label>
                <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                  placeholder="Any additional notes..." />
              </div>
            </div>
          </div>

          {createError && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 text-sm text-red-700 dark:text-red-300">
              {createError}
            </div>
          )}

          <div className="flex gap-3 pb-6">
            <button type="submit" disabled={submitting}
              className="px-6 py-2.5 bg-primary text-white rounded-lg text-sm font-semibold disabled:opacity-50 hover:bg-primary/90 transition-colors">
              {submitting ? 'Creating...' : 'Create Invoice'}
            </button>
            <button type="button" onClick={() => { resetCreate(); setView('list') }}
              className="px-6 py-2.5 bg-surface border border-border rounded-lg text-sm font-medium text-foreground hover:bg-surface-secondary transition-colors">
              Cancel
            </button>
          </div>
        </form>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-secondary-500 dark:text-foreground">Invoices</h1>
          <p className="text-foreground-secondary text-sm mt-1">All online and offline invoices</p>
        </div>
        <button onClick={() => setView('create')}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-semibold hover:bg-primary/90 transition-colors">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New Offline Invoice
        </button>
      </div>

      <div className="bg-surface-elevated rounded-lg shadow p-4 space-y-3">
        <div className="flex flex-wrap gap-3">
          <input type="text" value={searchInput} onChange={e => setSearchInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && setSearchQ(searchInput)}
            placeholder="Search invoice, order, customer..."
            className="flex-1 min-w-48 border border-border rounded-lg px-3 py-2 text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30" />
          <button onClick={() => setSearchQ(searchInput)}
            className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium">Search</button>
          {(searchQ || sourceFilter || paymentFilter || fromDate || toDate) && (
            <button onClick={() => { setSearchQ(''); setSearchInput(''); setSourceFilter(''); setPaymentFilter(''); setFromDate(''); setToDate('') }}
              className="px-4 py-2 border border-border rounded-lg text-sm text-foreground-secondary hover:bg-surface-secondary">Clear</button>
          )}
        </div>
        <div className="flex flex-wrap gap-3">
          <AdminSelect value={sourceFilter} onChange={setSourceFilter} placeholder="All Sources"
            options={[{ value: 'online', label: 'Online' }, { value: 'offline', label: 'Offline' }]} />
          <AdminSelect value={paymentFilter} onChange={setPaymentFilter} placeholder="All Payments"
            options={[
              { value: 'paid', label: 'Paid' }, { value: 'unpaid', label: 'Unpaid' },
              { value: 'refunded', label: 'Refunded' }, { value: 'failed', label: 'Failed' },
            ]} />
          <div className="flex items-center gap-2">
            <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
              className="border border-border rounded-lg px-3 py-2 text-sm bg-background text-foreground" />
            <span className="text-foreground-secondary text-sm">to</span>
            <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
              className="border border-border rounded-lg px-3 py-2 text-sm bg-background text-foreground" />
          </div>
        </div>
      </div>

      <div className="bg-surface-elevated rounded-lg shadow overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-foreground-muted text-sm">Loading invoices...</div>
        ) : invoices.length === 0 ? (
          <div className="p-12 text-center text-foreground-muted text-sm">No invoices found.</div>
        ) : (
          <>
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm divide-y divide-border-default">
                <thead className="bg-surface-secondary">
                  <tr>
                    {['Invoice No', 'Date', 'Customer', 'Source', 'Amount', 'Payment', 'IRN', 'Actions'].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-default">
                  {invoices.map(inv => (
                    <tr key={inv.id} className="hover:bg-surface-secondary">
                      <td className="px-4 py-3 font-medium text-foreground">{inv.invoice_number}</td>
                      <td className="px-4 py-3 text-foreground-secondary whitespace-nowrap">{fmtDate(inv.invoice_date)}</td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-foreground">{inv.customer_name}</div>
                        {inv.buyer_gstin && <div className="text-xs text-foreground-muted font-mono">{inv.buyer_gstin}</div>}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${SOURCE_COLORS[inv.source] || ''}`}>
                          {inv.source === 'offline' ? 'Offline' : 'Online'}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-semibold text-foreground whitespace-nowrap">
                        Rs {parseFloat(inv.total_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${PAYMENT_COLORS[inv.payment_status] || ''}`}>
                          {inv.payment_status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {inv.irn ? (
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${inv.irn_status === 'generated' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300'}`}>
                            {inv.irn_status === 'generated' ? 'IRN Generated' : 'Stub'}
                          </span>
                        ) : (
                          <span className="text-xs text-foreground-muted">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <a href={`/api/orders/${inv.id}/invoice`} target="_blank" rel="noreferrer"
                            className="text-xs text-primary hover:underline font-medium">PDF</a>
                          <a href={`/admin/orders/${inv.id}`}
                            className="text-xs text-foreground-secondary hover:text-foreground">Order</a>
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
                    <span className="font-semibold text-foreground text-sm">{inv.invoice_number}</span>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${SOURCE_COLORS[inv.source] || ''}`}>
                      {inv.source === 'offline' ? 'Offline' : 'Online'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-foreground">{inv.customer_name}</span>
                    <span className="font-semibold text-foreground text-sm">
                      Rs {parseFloat(inv.total_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-foreground-muted">{fmtDate(inv.invoice_date)}</span>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${PAYMENT_COLORS[inv.payment_status] || ''}`}>
                      {inv.payment_status}
                    </span>
                  </div>
                  <div className="flex gap-3 pt-1">
                    <a href={`/api/orders/${inv.id}/invoice`} target="_blank" rel="noreferrer"
                      className="text-xs text-primary font-medium hover:underline">Download PDF</a>
                    <a href={`/admin/orders/${inv.id}`} className="text-xs text-foreground-secondary hover:text-foreground">View Order</a>
                  </div>
                </div>
              ))}
            </div>

            {totalPages > 1 && (
              <div className="px-4 py-3 border-t border-border-default flex items-center justify-between">
                <p className="text-xs text-foreground-muted">Page {page} of {totalPages} — {total} invoices</p>
                <div className="flex gap-2">
                  <button disabled={page <= 1} onClick={() => fetchInvoices(page - 1)}
                    className="px-3 py-1.5 border border-border rounded text-xs text-foreground disabled:opacity-40 hover:bg-surface-secondary">Prev</button>
                  <button disabled={page >= totalPages} onClick={() => fetchInvoices(page + 1)}
                    className="px-3 py-1.5 border border-border rounded text-xs text-foreground disabled:opacity-40 hover:bg-surface-secondary">Next</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
