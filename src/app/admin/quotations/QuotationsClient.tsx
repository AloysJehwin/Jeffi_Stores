'use client'

import { useState, useEffect, useRef, useCallback } from 'react'

interface QuoteItem {
  id?: string
  description: string
  hsn_code: string
  gst_rate: number
  quantity: number
  unit: string
  rate: number
  discount_pct: number
  amount: number
  product_id?: string | null
  variant_id?: string | null
}

interface Quotation {
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
  buyer_same: boolean
  buyer_name: string | null
  buyer_addr1: string | null
  buyer_addr2: string | null
  buyer_city: string | null
  buyer_state: string | null
  buyer_gstin: string | null
  notes: string | null
  subtotal: number
  cgst_amount: number
  sgst_amount: number
  total_amount: number
  created_at: string
}

interface ProductResult {
  id: string
  product_id: string
  variant_id: string | null
  name: string
  variant_name: string | null
  sku: string
  base_price: number
  gst_percentage: number
}

type View = 'list' | 'editor'

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  final: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
}

const UNITS = ['PCS', 'NOS', 'KG', 'MTR', 'LTR', 'BOX', 'SET', 'PKT', 'PAIR', 'RFT', 'SFT']

function emptyItem(): QuoteItem {
  return { description: '', hsn_code: '', gst_rate: 18, quantity: 1, unit: 'PCS', rate: 0, discount_pct: 0, amount: 0 }
}

function calcItemAmount(item: QuoteItem): number {
  return Number(item.quantity) * Number(item.rate) * (1 - (Number(item.discount_pct) || 0) / 100)
}

function fmt2(n: number) {
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDate(d: string) {
  if (!d) return ''
  const dt = new Date(d)
  return `${String(dt.getDate()).padStart(2, '0')}-${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][dt.getMonth()]}-${dt.getFullYear()}`
}

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

export default function QuotationsClient() {
  const [view, setView] = useState<View>('list')
  const [quotations, setQuotations] = useState<Quotation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [searchQ, setSearchQ] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')

  const [editId, setEditId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [downloading, setDownloading] = useState(false)

  const [quoteNumber, setQuoteNumber] = useState('')
  const [quoteDate, setQuoteDate] = useState(todayISO())
  const [notes, setNotes] = useState('')

  const [cName, setCName] = useState('')
  const [cAddr1, setCAddr1] = useState('')
  const [cAddr2, setCAddr2] = useState('')
  const [cCity, setCCity] = useState('')
  const [cState, setCState] = useState('Chhattisgarh')
  const [cGstin, setCGstin] = useState('')

  const [buyerSame, setBuyerSame] = useState(true)
  const [bName, setBName] = useState('')
  const [bAddr1, setBAddr1] = useState('')
  const [bAddr2, setBAddr2] = useState('')
  const [bCity, setBCity] = useState('')
  const [bState, setBState] = useState('Chhattisgarh')
  const [bGstin, setBGstin] = useState('')

  const [items, setItems] = useState<QuoteItem[]>([emptyItem()])

  const [custSearch, setCustSearch] = useState('')
  const [custResults, setCustResults] = useState<any[]>([])
  const [showCustDrop, setShowCustDrop] = useState(false)
  const custTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [productModalOpen, setProductModalOpen] = useState(false)
  const [productModalRow, setProductModalRow] = useState<number | null>(null)
  const [prodSearch, setProdSearch] = useState('')
  const [prodResults, setProdResults] = useState<ProductResult[]>([])
  const [prodLoading, setProdLoading] = useState(false)
  const prodTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [prodCategory, setProdCategory] = useState('')
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([])

  const subtotal = items.reduce((s, i) => s + i.amount, 0)
  const cgst = items.reduce((s, i) => s + i.amount * i.gst_rate / 200, 0)
  const sgst = cgst
  const rawTotal = subtotal + cgst + sgst
  const total = Math.round(rawTotal)
  const roundOff = total - rawTotal

  async function loadList() {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (statusFilter !== 'all') params.set('status', statusFilter)
      if (searchQ) params.set('q', searchQ)
      if (fromDate) params.set('from', fromDate)
      if (toDate) params.set('to', toDate)
      const res = await fetch(`/api/admin/quotations?${params}`)
      const data = await res.json()
      setQuotations(data.quotations || [])
    } catch {
      setError('Failed to load quotations')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { if (view === 'list') loadList() }, [view, statusFilter])

  function newQuotation() {
    setEditId(null)
    setQuoteNumber('')
    setQuoteDate(todayISO())
    setNotes('')
    setCName(''); setCAddr1(''); setCAddr2(''); setCCity(''); setCState('Chhattisgarh'); setCGstin('')
    setBuyerSame(true)
    setBName(''); setBAddr1(''); setBAddr2(''); setBCity(''); setBState('Chhattisgarh'); setBGstin('')
    setItems([emptyItem()])
    setSaveError('')
    setView('editor')
  }

  async function openEdit(id: string) {
    setSaveError('')
    try {
      const res = await fetch(`/api/admin/quotations/${id}`)
      const data = await res.json()
      const q: Quotation = data.quotation
      setEditId(id)
      setQuoteNumber(q.quote_number)
      setQuoteDate(q.quote_date?.slice(0, 10) || todayISO())
      setNotes(q.notes || '')
      setCName(q.consignee_name || ''); setCAddr1(q.consignee_addr1 || ''); setCAddr2(q.consignee_addr2 || '')
      setCCity(q.consignee_city || ''); setCState(q.consignee_state || 'Chhattisgarh'); setCGstin(q.consignee_gstin || '')
      setBuyerSame(q.buyer_same)
      setBName(q.buyer_name || ''); setBAddr1(q.buyer_addr1 || ''); setBAddr2(q.buyer_addr2 || '')
      setBCity(q.buyer_city || ''); setBState(q.buyer_state || 'Chhattisgarh'); setBGstin(q.buyer_gstin || '')
      const loadedItems: QuoteItem[] = (data.items || []).map((i: any) => ({
        id: i.id,
        description: i.description,
        hsn_code: i.hsn_code || '',
        gst_rate: Number(i.gst_rate),
        quantity: Number(i.quantity),
        unit: i.unit,
        rate: Number(i.rate),
        discount_pct: Number(i.discount_pct),
        amount: Number(i.amount),
        product_id: i.product_id,
        variant_id: i.variant_id,
      }))
      setItems(loadedItems.length ? loadedItems : [emptyItem()])
      setView('editor')
    } catch {
      setError('Failed to load quotation')
    }
  }

  async function save(newStatus?: string) {
    setSaving(true)
    setSaveError('')
    try {
      const body = {
        quote_date: quoteDate,
        notes,
        consignee_name: cName, consignee_addr1: cAddr1, consignee_addr2: cAddr2 || null,
        consignee_city: cCity, consignee_state: cState, consignee_gstin: cGstin || null,
        buyer_same: buyerSame,
        buyer_name: buyerSame ? null : bName, buyer_addr1: buyerSame ? null : bAddr1,
        buyer_addr2: buyerSame ? null : (bAddr2 || null),
        buyer_city: buyerSame ? null : bCity, buyer_state: buyerSame ? null : bState,
        buyer_gstin: buyerSame ? null : (bGstin || null),
        items: items.map(i => ({
          description: i.description,
          hsn_code: i.hsn_code || null,
          gst_rate: i.gst_rate,
          quantity: i.quantity,
          unit: i.unit,
          rate: i.rate,
          discount_pct: i.discount_pct,
          amount: i.amount,
          product_id: i.product_id || null,
          variant_id: i.variant_id || null,
        })),
        ...(newStatus ? { status: newStatus } : {}),
      }

      let res: Response
      if (editId) {
        res = await fetch(`/api/admin/quotations/${editId}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        })
      } else {
        res = await fetch('/api/admin/quotations', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        })
      }
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Save failed')
      if (!editId) setEditId(data.quotation.id)
      setQuoteNumber(data.quotation.quote_number)
      if (newStatus === 'final') {
        setView('list')
      }
    } catch (e: any) {
      setSaveError(e.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function downloadPDF() {
    if (!editId) { await save(); }
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

  async function deleteQuote(id: string) {
    if (!confirm('Delete this draft quotation?')) return
    try {
      const res = await fetch(`/api/admin/quotations/${id}`, { method: 'DELETE' })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error) }
      setQuotations(prev => prev.filter(q => q.id !== id))
    } catch (e: any) {
      setError(e.message || 'Delete failed')
    }
  }

  function updateItem(idx: number, field: keyof QuoteItem, value: any) {
    setItems(prev => {
      const next = prev.map((item, i) => {
        if (i !== idx) return item
        const updated = { ...item, [field]: value }
        updated.amount = calcItemAmount(updated)
        return updated
      })
      return next
    })
  }

  function addItem() {
    setItems(prev => [...prev, emptyItem()])
  }

  function removeItem(idx: number) {
    setItems(prev => prev.length === 1 ? prev : prev.filter((_, i) => i !== idx))
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
    setCName(c.addr_name || c.full_name || '')
    setCAddr1(c.address_line1 || '')
    setCAddr2(c.address_line2 || '')
    setCCity(c.city || '')
    setCState(c.state || 'Chhattisgarh')
    setCGstin(c.gst_number || '')
    setCustSearch('')
    setShowCustDrop(false)
  }

  function openProductModal(rowIdx: number) {
    setProductModalRow(rowIdx)
    setProdSearch('')
    setProdResults([])
    setProdCategory('')
    setProductModalOpen(true)
    if (categories.length === 0) {
      fetch('/api/categories')
        .then(r => r.json())
        .then(d => setCategories((d.categories || []).map((c: any) => ({ id: c.id, name: c.name }))))
        .catch(() => {})
    }
    loadProducts('', '')
  }

  function loadProducts(q: string, catId: string) {
    if (prodTimer.current) clearTimeout(prodTimer.current)
    prodTimer.current = setTimeout(async () => {
      setProdLoading(true)
      try {
        const params = new URLSearchParams({ limit: '40' })
        if (q.trim()) params.set('q', q.trim())
        if (catId) params.set('category_id', catId)
        const res = await fetch(`/api/admin/labels/products?${params}`)
        const data = await res.json()
        setProdResults(data.products || [])
      } finally {
        setProdLoading(false)
      }
    }, q ? 300 : 0)
  }

  function searchProducts(q: string) {
    setProdSearch(q)
    loadProducts(q, prodCategory)
  }

  function selectProduct(p: ProductResult) {
    if (productModalRow === null) return
    const desc = p.variant_name ? `${p.name} ${p.variant_name}` : p.name
    updateItem(productModalRow, 'description', desc)
    setItems(prev => prev.map((item, i) => {
      if (i !== productModalRow) return item
      const updated = {
        ...item,
        description: desc,
        gst_rate: p.gst_percentage || 18,
        rate: Number(p.base_price) || 0,
        product_id: p.product_id,
        variant_id: p.variant_id || null,
      }
      updated.amount = calcItemAmount(updated)
      return updated
    }))
    setProductModalOpen(false)
    setProductModalRow(null)
  }

  const inputCls = 'w-full px-2 py-1.5 rounded border border-border-default bg-surface-secondary text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-secondary-500'
  const labelCls = 'block text-xs font-medium text-foreground-secondary mb-1'

  if (view === 'list') {
    return (
      <div>
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-secondary-500 dark:text-foreground">Quotations</h1>
            <p className="text-foreground-secondary mt-1 text-sm">Create and manage B2B quotations</p>
          </div>
          <button
            onClick={newQuotation}
            className="px-4 py-2 bg-secondary-500 hover:bg-secondary-600 text-white font-semibold rounded-lg text-sm transition-colors"
          >
            + New Quotation
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-400 text-sm">
            {error}
          </div>
        )}

        <div className="bg-surface-elevated border border-border-default rounded-xl p-4 mb-4">
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <div className="flex gap-1 mb-0">
                {['all', 'draft', 'final'].map(s => (
                  <button key={s} onClick={() => setStatusFilter(s)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors ${
                      statusFilter === s
                        ? 'bg-secondary-500 text-white'
                        : 'bg-surface-primary text-foreground-secondary hover:bg-surface-secondary border border-border-default'
                    }`}
                  >{s}</button>
                ))}
              </div>
            </div>
            <div className="flex-1 min-w-[160px]">
              <input
                type="text" placeholder="Search quote # or consignee..." value={searchQ}
                onChange={e => setSearchQ(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && loadList()}
                className={inputCls}
              />
            </div>
            <div className="flex gap-2 items-center">
              <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className={inputCls + ' w-36'} />
              <span className="text-foreground-secondary text-xs">to</span>
              <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} className={inputCls + ' w-36'} />
            </div>
            <button onClick={loadList} className="px-4 py-1.5 bg-secondary-500 hover:bg-secondary-600 text-white rounded-lg text-sm font-medium transition-colors">
              Search
            </button>
          </div>
        </div>

        <div className="bg-surface-elevated border border-border-default rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-default bg-surface-primary">
                  <th className="px-4 py-3 text-left font-semibold text-foreground-secondary text-xs">Quote #</th>
                  <th className="px-4 py-3 text-left font-semibold text-foreground-secondary text-xs">Date</th>
                  <th className="px-4 py-3 text-left font-semibold text-foreground-secondary text-xs">Consignee</th>
                  <th className="px-4 py-3 text-right font-semibold text-foreground-secondary text-xs">Total</th>
                  <th className="px-4 py-3 text-center font-semibold text-foreground-secondary text-xs">Status</th>
                  <th className="px-4 py-3 text-center font-semibold text-foreground-secondary text-xs">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-foreground-secondary">Loading…</td></tr>
                ) : quotations.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-12 text-center text-foreground-secondary">No quotations found. Create your first one.</td></tr>
                ) : quotations.map(q => (
                  <tr key={q.id} className="border-b border-border-default hover:bg-surface-primary transition-colors">
                    <td className="px-4 py-3 font-mono font-semibold text-foreground">{q.quote_number}</td>
                    <td className="px-4 py-3 text-foreground-secondary">{fmtDate(q.quote_date)}</td>
                    <td className="px-4 py-3 text-foreground">{q.consignee_name || '—'}</td>
                    <td className="px-4 py-3 text-right font-semibold text-foreground">₹{fmt2(Number(q.total_amount))}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[q.status] || 'bg-gray-100 text-gray-700'}`}>
                        {q.status === 'final' ? 'Final' : 'Draft'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-2">
                        <button onClick={() => openEdit(q.id)} title="Edit"
                          className="p-1.5 text-foreground-secondary hover:text-secondary-500 transition-colors">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </button>
                        <a href={`/api/admin/quotations/${q.id}/pdf`} target="_blank" rel="noopener noreferrer" title="Download PDF"
                          className="p-1.5 text-foreground-secondary hover:text-secondary-500 transition-colors">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                          </svg>
                        </a>
                        {q.status === 'draft' && (
                          <button onClick={() => deleteQuote(q.id)} title="Delete"
                            className="p-1.5 text-foreground-secondary hover:text-red-500 transition-colors">
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
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
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => setView('list')}
          className="p-2 text-foreground-secondary hover:text-foreground transition-colors">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div>
          <h1 className="text-xl font-bold text-foreground">
            {editId ? `Edit ${quoteNumber}` : 'New Quotation'}
          </h1>
          <p className="text-foreground-secondary text-xs mt-0.5">
            {editId ? 'Update and finalise the quotation' : 'Fill in details and add line items'}
          </p>
        </div>
      </div>

      {saveError && (
        <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-400 text-sm">
          {saveError}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
        <div className="bg-surface-elevated border border-border-default rounded-xl p-4">
          <h2 className="text-sm font-semibold text-foreground mb-3">Quote Details</h2>
          <div className="space-y-3">
            <div>
              <label className={labelCls}>Quote Number</label>
              <input value={quoteNumber || 'Auto-generated on save'} readOnly
                className={inputCls + ' bg-surface-primary text-foreground-secondary cursor-not-allowed'} />
            </div>
            <div>
              <label className={labelCls}>Date</label>
              <input type="date" value={quoteDate} onChange={e => setQuoteDate(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Notes (optional)</label>
              <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
                className={inputCls + ' resize-none'} placeholder="Any special terms or references..." />
            </div>
          </div>
        </div>

        <div className="bg-surface-elevated border border-border-default rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-foreground">Consignee (Ship to)</h2>
          </div>
          <div className="relative mb-2">
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
          <div className="space-y-2">
            <input value={cName} onChange={e => setCName(e.target.value)} placeholder="Name / Company" className={inputCls} />
            <input value={cAddr1} onChange={e => setCAddr1(e.target.value)} placeholder="Address line 1" className={inputCls} />
            <input value={cAddr2} onChange={e => setCAddr2(e.target.value)} placeholder="Address line 2 (optional)" className={inputCls} />
            <div className="flex gap-2">
              <input value={cCity} onChange={e => setCCity(e.target.value)} placeholder="City" className={inputCls} />
              <input value={cState} onChange={e => setCState(e.target.value)} placeholder="State" className={inputCls} />
            </div>
            <input value={cGstin} onChange={e => setCGstin(e.target.value)} placeholder="GSTIN (optional)" className={inputCls + ' font-mono'} />
          </div>
        </div>

        <div className="bg-surface-elevated border border-border-default rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-foreground">Buyer (Bill to)</h2>
            <label className="flex items-center gap-2 text-xs text-foreground-secondary cursor-pointer select-none">
              <input type="checkbox" checked={buyerSame} onChange={e => setBuyerSame(e.target.checked)}
                className="w-3.5 h-3.5 accent-secondary-500" />
              Same as consignee
            </label>
          </div>
          {buyerSame ? (
            <p className="text-foreground-secondary text-xs py-4 text-center">Using same address as consignee</p>
          ) : (
            <div className="space-y-2">
              <input value={bName} onChange={e => setBName(e.target.value)} placeholder="Name / Company" className={inputCls} />
              <input value={bAddr1} onChange={e => setBAddr1(e.target.value)} placeholder="Address line 1" className={inputCls} />
              <input value={bAddr2} onChange={e => setBAddr2(e.target.value)} placeholder="Address line 2 (optional)" className={inputCls} />
              <div className="flex gap-2">
                <input value={bCity} onChange={e => setBCity(e.target.value)} placeholder="City" className={inputCls} />
                <input value={bState} onChange={e => setBState(e.target.value)} placeholder="State" className={inputCls} />
              </div>
              <input value={bGstin} onChange={e => setBGstin(e.target.value)} placeholder="GSTIN (optional)" className={inputCls + ' font-mono'} />
            </div>
          )}
        </div>
      </div>

      <div className="bg-surface-elevated border border-border-default rounded-xl p-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-foreground">Line Items</h2>
          <button onClick={addItem}
            className="px-3 py-1.5 bg-secondary-500 hover:bg-secondary-600 text-white rounded-lg text-xs font-medium transition-colors">
            + Add Row
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border-default">
                <th className="pb-2 pr-2 text-left font-semibold text-foreground-secondary w-6">#</th>
                <th className="pb-2 pr-2 text-left font-semibold text-foreground-secondary min-w-[180px]">Description</th>
                <th className="pb-2 pr-2 text-left font-semibold text-foreground-secondary w-20">HSN/SAC</th>
                <th className="pb-2 pr-2 text-left font-semibold text-foreground-secondary w-16">GST %</th>
                <th className="pb-2 pr-2 text-left font-semibold text-foreground-secondary w-20">Qty</th>
                <th className="pb-2 pr-2 text-left font-semibold text-foreground-secondary w-20">Unit</th>
                <th className="pb-2 pr-2 text-left font-semibold text-foreground-secondary w-24">Rate (ex-GST)</th>
                <th className="pb-2 pr-2 text-left font-semibold text-foreground-secondary w-16">Disc %</th>
                <th className="pb-2 pr-2 text-right font-semibold text-foreground-secondary w-24">Amount</th>
                <th className="pb-2 w-6"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, idx) => (
                <tr key={idx} className="border-b border-border-default/50">
                  <td className="py-1.5 pr-2 text-foreground-secondary">{idx + 1}</td>
                  <td className="py-1.5 pr-2">
                    <div className="flex gap-1 items-center">
                      <input value={item.description} onChange={e => updateItem(idx, 'description', e.target.value)}
                        placeholder="Description of goods" className={inputCls + ' min-w-[160px]'} />
                      <button onClick={() => openProductModal(idx)} title="Pick from products"
                        className="shrink-0 p-1.5 text-foreground-secondary hover:text-secondary-500 transition-colors border border-border-default rounded">
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                      </button>
                    </div>
                  </td>
                  <td className="py-1.5 pr-2">
                    <input value={item.hsn_code} onChange={e => updateItem(idx, 'hsn_code', e.target.value)}
                      placeholder="7318" className={inputCls + ' font-mono'} />
                  </td>
                  <td className="py-1.5 pr-2">
                    <input type="number" value={item.gst_rate} min={0} max={28} step={0.5}
                      onChange={e => updateItem(idx, 'gst_rate', parseFloat(e.target.value) || 0)}
                      className={inputCls} />
                  </td>
                  <td className="py-1.5 pr-2">
                    <input type="number" value={item.quantity} min={0} step="any"
                      onChange={e => updateItem(idx, 'quantity', parseFloat(e.target.value) || 0)}
                      className={inputCls} />
                  </td>
                  <td className="py-1.5 pr-2">
                    <select value={item.unit} onChange={e => updateItem(idx, 'unit', e.target.value)}
                      className={inputCls}>
                      {UNITS.map(u => <option key={u}>{u}</option>)}
                    </select>
                  </td>
                  <td className="py-1.5 pr-2">
                    <input type="number" value={item.rate} min={0} step="any"
                      onChange={e => updateItem(idx, 'rate', parseFloat(e.target.value) || 0)}
                      className={inputCls} />
                  </td>
                  <td className="py-1.5 pr-2">
                    <input type="number" value={item.discount_pct} min={0} max={100} step="any"
                      onChange={e => updateItem(idx, 'discount_pct', parseFloat(e.target.value) || 0)}
                      className={inputCls} />
                  </td>
                  <td className="py-1.5 pr-2 text-right font-semibold text-foreground tabular-nums">
                    ₹{fmt2(item.amount)}
                  </td>
                  <td className="py-1.5">
                    <button onClick={() => removeItem(idx)} disabled={items.length === 1}
                      className="p-1 text-foreground-secondary hover:text-red-500 disabled:opacity-30 transition-colors">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex justify-end mt-4">
          <div className="w-64 space-y-1.5 text-sm">
            <div className="flex justify-between text-foreground-secondary">
              <span>Subtotal</span>
              <span className="tabular-nums">₹{fmt2(subtotal)}</span>
            </div>
            <div className="flex justify-between text-foreground-secondary">
              <span>CGST</span>
              <span className="tabular-nums">₹{fmt2(cgst)}</span>
            </div>
            <div className="flex justify-between text-foreground-secondary">
              <span>SGST</span>
              <span className="tabular-nums">₹{fmt2(sgst)}</span>
            </div>
            {Math.abs(roundOff) >= 0.005 && (
              <div className="flex justify-between text-foreground-secondary">
                <span>Round Off</span>
                <span className="tabular-nums">{roundOff > 0 ? '+' : ''}₹{fmt2(roundOff)}</span>
              </div>
            )}
            <div className="flex justify-between font-bold text-foreground text-base border-t border-border-default pt-2">
              <span>Total</span>
              <span className="tabular-nums">₹{fmt2(total)}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 justify-end">
        <button onClick={() => save()} disabled={saving}
          className="px-5 py-2.5 border border-border-default text-foreground hover:bg-surface-secondary rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
          {saving ? 'Saving…' : 'Save Draft'}
        </button>
        <button onClick={() => save('final')} disabled={saving}
          className="px-5 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
          {saving ? 'Saving…' : 'Finalise & Save'}
        </button>
        <button onClick={downloadPDF} disabled={downloading || saving}
          className="px-5 py-2.5 bg-secondary-500 hover:bg-secondary-600 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
          {downloading ? 'Generating…' : 'Download PDF'}
        </button>
      </div>

      {productModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-surface-elevated border border-border-default rounded-2xl w-full max-w-md max-h-[80vh] flex flex-col shadow-xl">
            <div className="flex items-center justify-between p-4 border-b border-border-default">
              <h3 className="font-semibold text-foreground text-sm">Pick a Product</h3>
              <button onClick={() => setProductModalOpen(false)}
                className="p-1 text-foreground-secondary hover:text-foreground">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-4 border-b border-border-default space-y-2">
              {categories.length > 0 && (
                <select
                  value={prodCategory}
                  onChange={e => { setProdCategory(e.target.value); loadProducts(prodSearch, e.target.value) }}
                  className={inputCls}
                >
                  <option value="">All Categories</option>
                  {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              )}
              <input
                autoFocus type="text" value={prodSearch}
                onChange={e => searchProducts(e.target.value)}
                placeholder="Search by name or SKU…" className={inputCls}
              />
            </div>
            <div className="flex-1 overflow-y-auto">
              {prodLoading && <p className="p-4 text-center text-foreground-secondary text-sm">Searching…</p>}
              {!prodLoading && prodResults.length === 0 && (
                <p className="p-4 text-center text-foreground-secondary text-sm">No products found</p>
              )}
              {prodResults.map(p => (
                <button key={p.id} onClick={() => selectProduct(p)}
                  className="w-full text-left px-4 py-3 hover:bg-surface-secondary transition-colors border-b border-border-default/50 last:border-0">
                  <p className="text-sm font-medium text-foreground">{p.name}{p.variant_name ? ` — ${p.variant_name}` : ''}</p>
                  <div className="flex gap-3 mt-0.5">
                    <span className="text-xs text-foreground-secondary font-mono">{p.sku}</span>
                    <span className="text-xs text-secondary-500 font-semibold">₹{fmt2(Number(p.base_price))}</span>
                    <span className="text-xs text-foreground-secondary">GST {p.gst_percentage}%</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
