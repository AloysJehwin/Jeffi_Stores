'use client'

import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useToast } from '@/contexts/ToastContext'
import AdminSelect from '@/components/admin/AdminSelect'
import AdminTypeahead from '@/components/admin/AdminTypeahead'
import HoverCard from '@/components/ui/HoverCard'
import LineItemsSection, { LineItem, newLineItem } from '@/components/admin/LineItemsSection'
import SortableHeader, { sortOptions, type SortDir } from '@/components/admin/SortableHeader'

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
  consignee_phone: string | null
  consignee_pincode: string | null
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
  converted_order_id: string | null
  created_at: string
}

type View = 'list' | 'editor'

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  final: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
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
  const { showToast, showConfirm } = useToast()
  const [view, setView] = useState<View>('list')
  const [quotations, setQuotations] = useState<Quotation[]>([])
  const [selectedQuote, setSelectedQuote] = useState<Quotation | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [searchQ, setSearchQ] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [sortCol, setSortCol] = useState<string | undefined>(undefined)
  const [sortDir, setSortDir] = useState<SortDir | undefined>(undefined)

  function handleSort(col: string, dir: SortDir) {
    setSortCol(col)
    setSortDir(dir)
  }

  const [editId, setEditId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [autoSaveStatus, setAutoSaveStatus] = useState<'idle' | 'pending' | 'saving' | 'saved'>('idle')
  const [isFinal, setIsFinal] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [convertingInvoice, setConvertingInvoice] = useState(false)
  const [convertedOrderId, setConvertedOrderId] = useState<string | null>(null)
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

  const [buyerSame, setBuyerSame] = useState(true)
  const [bName, setBName] = useState('')
  const [bAddr1, setBAddr1] = useState('')
  const [bAddr2, setBAddr2] = useState('')
  const [bCity, setBCity] = useState('')
  const [bState, setBState] = useState('Chhattisgarh')
  const [bGstin, setBGstin] = useState('')

  const [items, setItems] = useState<LineItem[]>([newLineItem()])

  const [custSearch, setCustSearch] = useState('')
  const [custResults, setCustResults] = useState<any[]>([])
  const [showCustDrop, setShowCustDrop] = useState(false)
  const custTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const isEditorMounted = useRef(false)


  const QUOTE_SORT_KEYS: Record<string, keyof Quotation> = {
    quote_number: 'quote_number',
    date: 'quote_date',
    consignee: 'consignee_name',
    total: 'total_amount',
    status: 'status',
  }

  const sortedQuotations = sortCol && QUOTE_SORT_KEYS[sortCol]
    ? [...quotations].sort((a, b) => {
        const key = QUOTE_SORT_KEYS[sortCol]
        const av = a[key] ?? ''
        const bv = b[key] ?? ''
        const cmp = String(av).localeCompare(String(bv), 'en', { numeric: true })
        return sortDir === 'asc' ? cmp : -cmp
      })
    : quotations


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
    setCName(''); setCAddr1(''); setCAddr2(''); setCCity(''); setCState('Chhattisgarh'); setCGstin(''); setCPhone(''); setCPincode('')
    setBuyerSame(true)
    setBName(''); setBAddr1(''); setBAddr2(''); setBCity(''); setBState('Chhattisgarh'); setBGstin('')
    setItems([newLineItem()])
    setSaveError('')
    setIsFinal(false)
    setAutoSaveStatus('idle')
    isEditorMounted.current = false
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
      setCPhone((q.consignee_phone || '').replace(/^\+?91/, '').replace(/\D/g, '').slice(-10)); setCPincode(q.consignee_pincode || '')
      setBuyerSame(q.buyer_same)
      setBName(q.buyer_name || ''); setBAddr1(q.buyer_addr1 || ''); setBAddr2(q.buyer_addr2 || '')
      setBCity(q.buyer_city || ''); setBState(q.buyer_state || 'Chhattisgarh'); setBGstin(q.buyer_gstin || '')
      const loadedItems: LineItem[] = (data.items || []).map((i: any) => {
        const gstRate = Number(i.gst_rate) || 0
        const rateExGst = Number(i.rate) || 0
        const unitPrice = rateExGst * (1 + gstRate / 100)
        const mrp = Number(i.mrp) || 0
        const discPct = mrp > 0 && unitPrice < mrp
          ? Math.round((1 - unitPrice / mrp) * 100 * 100) / 100
          : Number(i.discount_pct) || 0
        return {
          id: i.id || Math.random().toString(36).slice(2),
          product_id: i.product_id || null,
          product_name: i.description || '',
          product_sku: i.sku || '',
          variant_id: i.variant_id || null,
          variant_name: '',
          hsn_code: i.hsn_code || '',
          gst_rate: String(gstRate),
          quantity: Number(i.quantity) || 1,
          unit: i.unit || 'PCS',
          unit_price: unitPrice,
          discount_pct: discPct,
          mrp,
          inventory_quantity: null,
        }
      })
      setItems(loadedItems.length ? loadedItems : [newLineItem()])
      setIsFinal(q.status === 'final')
      setConvertedOrderId(q.converted_order_id || null)
      setAutoSaveStatus('idle')
      isEditorMounted.current = false
      setView('editor')
    } catch {
      setError('Failed to load quotation')
    }
  }

  async function convertToInvoice(quoteId: string, paymentMode = 'cash') {
    setConvertingInvoice(true)
    try {
      const res = await fetch(`/api/admin/quotations/${quoteId}/convert-to-invoice`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentMode }),
      })
      const data = await res.json()
      if (!res.ok) { showToast(data.error || 'Conversion failed', 'error'); return }
      showToast(`Invoice ${data.invoiceNumber} created`, 'success')
      setConvertedOrderId(data.orderId)
      loadList()
      if (data.invoiceUrl) window.open(data.invoiceUrl, '_blank')
    } catch {
      showToast('Failed to convert quotation', 'error')
    } finally {
      setConvertingInvoice(false)
    }
  }

  async function save(newStatus?: string) {
    setSaving(true)
    setSaveError('')
    setAutoSaveStatus('saving')
    try {
      const body = {
        quote_date: quoteDate,
        notes,
        consignee_name: cName, consignee_addr1: cAddr1, consignee_addr2: cAddr2 || null,
        consignee_city: cCity, consignee_state: cState, consignee_gstin: cGstin || null,
        consignee_phone: cPhone || null, consignee_pincode: cPincode || null,
        buyer_same: buyerSame,
        buyer_name: buyerSame ? null : bName, buyer_addr1: buyerSame ? null : bAddr1,
        buyer_addr2: buyerSame ? null : (bAddr2 || null),
        buyer_city: buyerSame ? null : bCity, buyer_state: buyerSame ? null : bState,
        buyer_gstin: buyerSame ? null : (bGstin || null),
        items: items.map(i => {
          const gstRate = Number(i.gst_rate) || 0
          const unitPrice = Number(i.unit_price) || 0
          const rateExGst = unitPrice / (1 + gstRate / 100)
          return {
            description: i.product_name,
            hsn_code: i.hsn_code || null,
            gst_rate: gstRate,
            quantity: i.quantity,
            unit: i.unit,
            rate: rateExGst,
            discount_pct: i.discount_pct,
            amount: (Number(i.quantity) || 0) * rateExGst * (1 - (i.discount_pct || 0) / 100),
            product_id: i.product_id || null,
            variant_id: i.variant_id || null,
          }
        }),
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
      setAutoSaveStatus('saved')
      setTimeout(() => setAutoSaveStatus('idle'), 2000)
      if (newStatus === 'final') {
        setIsFinal(true)
        setView('list')
      }
    } catch (e: any) {
      setSaveError(e.message || 'Save failed')
      setAutoSaveStatus('idle')
    } finally {
      setSaving(false)
    }
  }

  function scheduleAutoSave() {
    if (isFinal) return
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)
    setAutoSaveStatus('pending')
    autoSaveTimer.current = setTimeout(() => { save() }, 1500)
  }

  useEffect(() => {
    if (view !== 'editor') return
    if (!isEditorMounted.current) { isEditorMounted.current = true; return }
    scheduleAutoSave()
  }, [quoteDate, notes, cName, cAddr1, cAddr2, cCity, cState, cGstin, cPhone, cPincode,
      buyerSame, bName, bAddr1, bAddr2, bCity, bState, bGstin, items])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSelectedQuote(null) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

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
    const confirmed = await showConfirm({
      title: 'Delete Quotation',
      message: 'Delete this draft quotation? This cannot be undone.',
      confirmText: 'Delete',
      type: 'danger',
      onConfirm: () => {},
    })
    if (!confirmed) return
    try {
      const res = await fetch(`/api/admin/quotations/${id}`, { method: 'DELETE' })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error) }
      setQuotations(prev => prev.filter(q => q.id !== id))
    } catch (e: any) {
      setError(e.message || 'Delete failed')
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
    setCName(c.addr_name || c.full_name || '')
    setCAddr1(c.address_line1 || '')
    setCAddr2(c.address_line2 || '')
    setCCity(c.city || '')
    setCState(c.state || 'Chhattisgarh')
    setCGstin(c.gst_number || '')
    setCPhone((c.phone || '').replace(/^\+?91/, '').replace(/\D/g, '').slice(-10))
    setCPincode(c.postal_code || '')
    setCustSearch('')
    setShowCustDrop(false)
  }

  const inputCls = 'w-full px-2 py-1.5 rounded border border-border-default bg-surface-secondary text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-secondary-500 disabled:opacity-60 disabled:cursor-not-allowed'
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
              <AdminTypeahead
                type="quotations"
                value={searchQ}
                onChange={setSearchQ}
                onEnter={() => loadList()}
                placeholder="Search quote # or consignee..."
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
                  <SortableHeader label="Quote #" column="quote_number" options={sortOptions('text')} onSort={handleSort} currentSort={sortCol} currentDir={sortDir} />
                  <SortableHeader label="Date" column="date" options={sortOptions('date')} onSort={handleSort} currentSort={sortCol} currentDir={sortDir} />
                  <SortableHeader label="Consignee" column="consignee" options={sortOptions('text')} onSort={handleSort} currentSort={sortCol} currentDir={sortDir} />
                  <SortableHeader label="Total" column="total" options={sortOptions('number')} onSort={handleSort} currentSort={sortCol} currentDir={sortDir} />
                  <SortableHeader label="Status" column="status" options={sortOptions('text')} onSort={handleSort} currentSort={sortCol} currentDir={sortDir} />
                  <th className="px-4 py-3 text-center font-semibold text-foreground-secondary text-xs">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-foreground-secondary">Loading…</td></tr>
                ) : quotations.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-12 text-center text-foreground-secondary">No quotations found. Create your first one.</td></tr>
                ) : sortedQuotations.map(q => (
                  <tr key={q.id} className="border-b border-border-default hover:bg-surface-secondary transition-colors cursor-pointer" onClick={() => setSelectedQuote(q)}>
                    <td className="px-4 py-3 font-mono font-semibold text-foreground">
                      <HoverCard
                        trigger={
                          <span className="cursor-default underline decoration-dotted underline-offset-2 hover:text-accent-500 transition-colors" onClick={e => e.stopPropagation()}>
                            {q.quote_number}
                          </span>
                        }
                        align="left"
                        side="bottom"
                        width="270px"
                      >
                        <div className="p-3 space-y-2">
                          <div className="flex items-center justify-between">
                            <p className="font-semibold text-foreground text-sm">{q.quote_number}</p>
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[q.status] || 'bg-gray-100 text-gray-700'}`}>
                              {q.status === 'final' ? 'Final' : 'Draft'}
                            </span>
                          </div>
                          <div className="text-xs text-foreground-secondary space-y-1">
                            <div className="flex justify-between gap-4">
                              <span>Consignee</span>
                              <span className="text-foreground font-medium">{q.consignee_name || '—'}</span>
                            </div>
                            {q.consignee_city && (
                              <div className="flex justify-between gap-4">
                                <span>City</span>
                                <span className="text-foreground">{q.consignee_city}</span>
                              </div>
                            )}
                            {q.consignee_gstin && (
                              <div className="flex justify-between gap-4">
                                <span>GSTIN</span>
                                <span className="font-mono text-foreground">{q.consignee_gstin}</span>
                              </div>
                            )}
                            <div className="flex justify-between gap-4">
                              <span>Total</span>
                              <span className="font-semibold text-foreground">₹{fmt2(Number(q.total_amount))}</span>
                            </div>
                            {(Number(q.cgst_amount) > 0 || Number(q.sgst_amount) > 0) && (
                              <div className="flex justify-between gap-4">
                                <span>CGST + SGST</span>
                                <span className="text-foreground">
                                  ₹{fmt2(Number(q.cgst_amount))} + ₹{fmt2(Number(q.sgst_amount))}
                                </span>
                              </div>
                            )}
                            {q.converted_order_id && (
                              <div className="flex justify-between gap-4">
                                <span>Converted</span>
                                <span className="font-medium text-blue-600 dark:text-blue-400">Invoiced</span>
                              </div>
                            )}
                          </div>
                          <div className="pt-1 border-t border-border-default">
                            <a
                              href={`/api/admin/quotations/${q.id}/pdf`}
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
                    <td className="px-4 py-3 text-foreground-secondary">{fmtDate(q.quote_date)}</td>
                    <td className="px-4 py-3 text-foreground">{q.consignee_name || '—'}</td>
                    <td className="px-4 py-3 text-right font-semibold text-foreground">₹{fmt2(Number(q.total_amount))}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[q.status] || 'bg-gray-100 text-gray-700'}`}>
                        {q.status === 'final' ? 'Final' : 'Draft'}
                      </span>
                    </td>
                    <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-center gap-2">
                        {q.status === 'draft' && (
                          <button onClick={() => openEdit(q.id)} title="Edit"
                            className="p-1.5 text-foreground-secondary hover:text-secondary-500 transition-colors">
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                          </button>
                        )}
                        <a href={`/api/admin/quotations/${q.id}/pdf`} target="_blank" rel="noopener noreferrer" title="Download PDF"
                          className="p-1.5 text-foreground-secondary hover:text-secondary-500 transition-colors">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                          </svg>
                        </a>
                        {q.status === 'final' && !q.converted_order_id && (
                          <button onClick={() => convertToInvoice(q.id)} disabled={convertingInvoice} title="Convert to Invoice"
                            className="px-2 py-1 rounded text-xs font-semibold bg-secondary-500 hover:bg-secondary-600 dark:bg-secondary-400 dark:hover:bg-secondary-300 dark:text-secondary-900 text-white disabled:opacity-50 transition-colors whitespace-nowrap">
                            {convertingInvoice ? '…' : '→ Invoice'}
                          </button>
                        )}
                        {q.status === 'final' && q.converted_order_id && (
                          <a href={`/admin/orders/${q.converted_order_id}`} className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 whitespace-nowrap hover:bg-blue-200 dark:hover:bg-blue-800/50 transition-colors">
                            Invoiced ↗
                          </a>
                        )}
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
        {selectedQuote && <QuotationDetailModal q={selectedQuote} onClose={() => setSelectedQuote(null)} />}
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
            {editId ? quoteNumber : 'New Quotation'}
          </h1>
          <p className="text-foreground-secondary text-xs mt-0.5">
            {isFinal ? 'This quotation is finalised and cannot be edited' : (editId ? 'Update and finalise the quotation' : 'Fill in details and add line items')}
          </p>
        </div>
      </div>

      {isFinal && (
        <div className="mb-4 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg text-green-700 dark:text-green-400 text-sm flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {convertedOrderId
              ? <span>This quotation has been converted to an invoice.</span>
              : <span>This quotation has been finalised. Download the PDF or convert it to an invoice.</span>
            }
          </div>
          {!convertedOrderId && editId && (
            <button
              onClick={() => convertToInvoice(editId)}
              disabled={convertingInvoice}
              className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold bg-secondary-500 hover:bg-secondary-600 dark:bg-secondary-400 dark:hover:bg-secondary-300 dark:text-secondary-900 text-white disabled:opacity-50 transition-colors whitespace-nowrap">
              {convertingInvoice ? 'Converting…' : '→ Convert to Invoice'}
            </button>
          )}
          {convertedOrderId && (
            <a href={`/admin/orders/${convertedOrderId}`}
              className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold border border-green-400 dark:border-green-600 text-green-700 dark:text-green-300 hover:bg-green-100 dark:hover:bg-green-900/30 transition-colors whitespace-nowrap">
              View Invoice →
            </a>
          )}
        </div>
      )}

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
              <input type="date" value={quoteDate} onChange={e => setQuoteDate(e.target.value)} disabled={isFinal} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Notes (optional)</label>
              <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} disabled={isFinal}
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
              placeholder="Search existing customer…" disabled={isFinal} className={inputCls}
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
            <input value={cName} onChange={e => setCName(e.target.value)} placeholder="Name / Company" disabled={isFinal} className={inputCls} />
            <input value={cAddr1} onChange={e => setCAddr1(e.target.value)} placeholder="Address line 1" disabled={isFinal} className={inputCls} />
            <input value={cAddr2} onChange={e => setCAddr2(e.target.value)} placeholder="Address line 2 (optional)" disabled={isFinal} className={inputCls} />
            <div className="flex gap-2">
              <input value={cCity} onChange={e => setCCity(e.target.value)} placeholder="City" disabled={isFinal} className={inputCls} />
              <input value={cState} onChange={e => setCState(e.target.value)} placeholder="State" disabled={isFinal} className={inputCls} />
            </div>
            <div className="flex">
              <span className="inline-flex items-center px-3 rounded-l-lg border border-r-0 border-border-default bg-surface-secondary text-foreground-secondary text-sm select-none">+91</span>
              <input type="tel" inputMode="numeric" maxLength={10} value={cPhone} onChange={e => setCPhone(e.target.value.replace(/\D/g, '').slice(0, 10))} placeholder="XXXXXXXXXX" disabled={isFinal} className={inputCls + ' rounded-l-none'} />
            </div>
            <input value={cPincode} onChange={e => setCPincode(e.target.value)} placeholder="Pincode" disabled={isFinal} className={inputCls + ' font-mono'} />
            <input value={cGstin} onChange={e => setCGstin(e.target.value.toUpperCase())} placeholder="00XXXXX0000X0Z0" disabled={isFinal} className={inputCls + ' font-mono'} />
          </div>
        </div>

        <div className="bg-surface-elevated border border-border-default rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-foreground">Buyer (Bill to)</h2>
            <label className="flex items-center gap-2 text-xs text-foreground-secondary cursor-pointer select-none">
              <input type="checkbox" checked={buyerSame} onChange={e => setBuyerSame(e.target.checked)}
                disabled={isFinal} className="w-3.5 h-3.5 accent-secondary-500" />
              Same as consignee
            </label>
          </div>
          {buyerSame ? (
            <p className="text-foreground-secondary text-xs py-4 text-center">Using same address as consignee</p>
          ) : (
            <div className="space-y-2">
              <input value={bName} onChange={e => setBName(e.target.value)} placeholder="Name / Company" disabled={isFinal} className={inputCls} />
              <input value={bAddr1} onChange={e => setBAddr1(e.target.value)} placeholder="Address line 1" disabled={isFinal} className={inputCls} />
              <input value={bAddr2} onChange={e => setBAddr2(e.target.value)} placeholder="Address line 2 (optional)" disabled={isFinal} className={inputCls} />
              <div className="flex gap-2">
                <input value={bCity} onChange={e => setBCity(e.target.value)} placeholder="City" disabled={isFinal} className={inputCls} />
                <input value={bState} onChange={e => setBState(e.target.value)} placeholder="State" disabled={isFinal} className={inputCls} />
              </div>
              <input value={bGstin} onChange={e => setBGstin(e.target.value.toUpperCase())} placeholder="00XXXXX0000X0Z0" disabled={isFinal} className={inputCls + ' font-mono'} />
            </div>
          )}
        </div>
      </div>

      <div className="mb-4">
        <LineItemsSection items={isFinal ? items : items} onChange={isFinal ? () => {} : setItems} />
      </div>

      <div className="flex flex-wrap gap-3 justify-end items-center">
        {autoSaveStatus === 'pending' && (
          <span className="text-xs text-foreground-secondary">Unsaved changes…</span>
        )}
        {autoSaveStatus === 'saving' && (
          <span className="text-xs text-foreground-secondary animate-pulse">Saving…</span>
        )}
        {autoSaveStatus === 'saved' && (
          <span className="text-xs text-green-600 dark:text-green-400">✓ Saved</span>
        )}
        {!isFinal && (
          <button onClick={() => save('final')} disabled={saving}
            className="px-5 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
            {saving ? 'Saving…' : 'Finalise & Save'}
          </button>
        )}
        <button onClick={downloadPDF} disabled={downloading || saving}
          className="px-5 py-2.5 bg-secondary-500 hover:bg-secondary-600 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
          {downloading ? 'Generating…' : 'Download PDF'}
        </button>
      </div>
    </div>
  )
}

function QuotationDetailModal({ q, onClose }: { q: Quotation; onClose: () => void }) {
  if (typeof document === 'undefined') return null
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div
        className="relative bg-surface-elevated rounded-xl shadow-2xl border border-border-default w-full max-w-2xl max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between p-5 border-b border-border-default">
          <div className="min-w-0 pr-4">
            <h2 className="text-lg font-bold text-foreground leading-tight font-mono">{q.quote_number}</h2>
            <p className="text-xs text-foreground-muted mt-0.5">
              {new Date(q.quote_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className={`px-2.5 py-0.5 text-xs font-semibold rounded-full ${STATUS_COLORS[q.status] || 'bg-gray-100 text-gray-700'}`}>
              {q.status === 'final' ? 'Final' : 'Draft'}
            </span>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-surface-secondary text-foreground-muted hover:text-foreground transition-colors"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="p-5 space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-foreground-muted uppercase tracking-wide mb-1.5">Consignee</p>
              <p className="text-sm font-semibold text-foreground">{q.consignee_name}</p>
              {q.consignee_phone && <p className="text-xs text-foreground-secondary mt-0.5">{q.consignee_phone}</p>}
              {[q.consignee_addr1, q.consignee_addr2, q.consignee_city, q.consignee_state, q.consignee_pincode].filter(Boolean).length > 0 && (
                <p className="text-xs text-foreground-secondary mt-0.5">
                  {[q.consignee_addr1, q.consignee_addr2, q.consignee_city, q.consignee_state, q.consignee_pincode].filter(Boolean).join(', ')}
                </p>
              )}
              {q.consignee_gstin && <p className="text-xs text-foreground-secondary font-mono mt-0.5">{q.consignee_gstin}</p>}
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

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3 rounded-lg bg-surface-secondary">
            <div>
              <p className="text-xs text-foreground-muted">Subtotal</p>
              <p className="text-sm font-semibold text-foreground">₹{Number(q.subtotal).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
            </div>
            {Number(q.cgst_amount) > 0 && (
              <div>
                <p className="text-xs text-foreground-muted">CGST + SGST</p>
                <p className="text-sm font-semibold text-foreground">
                  ₹{Number(q.cgst_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })} + ₹{Number(q.sgst_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </p>
              </div>
            )}
            <div>
              <p className="text-xs text-foreground-muted">Total</p>
              <p className="text-sm font-bold text-foreground">₹{Number(q.total_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
            </div>
          </div>

          {q.converted_order_id && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
              <span className="text-xs font-medium text-blue-700 dark:text-blue-300">Converted to Invoice</span>
            </div>
          )}

          <div className="flex flex-wrap gap-3 pt-1 border-t border-border-default">
            <a
              href={`/api/admin/quotations/${q.id}/pdf`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold bg-surface-secondary hover:bg-surface-secondary/70 text-foreground transition-colors border border-border-default"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Quotation PDF
            </a>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}

