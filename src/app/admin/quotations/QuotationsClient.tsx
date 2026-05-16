'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useToast } from '@/contexts/ToastContext'
import AdminSelect from '@/components/admin/AdminSelect'
import AdminTypeahead from '@/components/admin/AdminTypeahead'
import HoverCard from '@/components/ui/HoverCard'

interface QuoteItem {
  id?: string
  description: string
  hsn_code: string
  gst_rate: number
  quantity: string | number
  unit: string
  rate: string | number
  discount_pct: number
  amount: number
  product_id?: string | null
  variant_id?: string | null
  is_draft_product?: boolean
  is_active_product?: boolean
  inventory_quantity?: number | null
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

interface ProductResult {
  id: string
  product_id: string
  variant_id: string | null
  name: string
  variant_name: string | null
  sku: string
  mrp: number
  base_price: number
  gst_percentage: number
  hsn_code: string | null
  is_active: boolean
  inventory_quantity?: number | null
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
  return Number(item.quantity) * Number(item.rate)
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

  const [items, setItems] = useState<QuoteItem[]>([emptyItem()])

  const [custSearch, setCustSearch] = useState('')
  const [custResults, setCustResults] = useState<any[]>([])
  const [showCustDrop, setShowCustDrop] = useState(false)
  const custTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const isEditorMounted = useRef(false)

  const [productModalOpen, setProductModalOpen] = useState(false)
  const [productModalRow, setProductModalRow] = useState<number | null>(null)
  const [prodSearch, setProdSearch] = useState('')
  const [prodResults, setProdResults] = useState<ProductResult[]>([])
  const [prodLoading, setProdLoading] = useState(false)
  const [creatingDraft, setCreatingDraft] = useState(false)
  const prodTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [prodCategory, setProdCategory] = useState('')
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([])
  const [prodSearchMode, setProdSearchMode] = useState<'name' | 'sku' | 'category'>('name')
  const [catPickerOpen, setCatPickerOpen] = useState(false)
  const [catPickerSearch, setCatPickerSearch] = useState('')
  const [catPickerResults, setCatPickerResults] = useState<ProductResult[]>([])
  const [catPickerLoading, setCatPickerLoading] = useState(false)
  const [catPickerActiveCatId, setCatPickerActiveCatId] = useState('')

  const [qSearchModes, setQSearchModes] = useState<Record<number, 'name' | 'sku' | 'category'>>({})
  const [qNameInputs, setQNameInputs] = useState<Record<number, string>>({})
  const [qSkuInputs, setQSkuInputs] = useState<Record<number, string>>({})
  const [qCategoryIds, setQCategoryIds] = useState<Record<number, string>>({})
  const [qPickerOpen, setQPickerOpen] = useState(false)
  const [qPickerRow, setQPickerRow] = useState<number | null>(null)

  const rawTotal = items.reduce((s, i) => s + i.amount, 0)
  const subtotal = items.reduce((s, i) => s + i.amount / (1 + (Number(i.gst_rate) || 0) / 100), 0)
  const cgst = items.reduce((s, i) => s + (i.amount / (1 + (Number(i.gst_rate) || 0) / 100)) * (Number(i.gst_rate) || 0) / 200, 0)
  const sgst = cgst
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

  function decodeLineItemId(encoded: string) {
    const [product_id, variant_id_raw, base_price_raw, gst_raw, hsn_raw, mrp_raw, inv_raw] = encoded.split('|')
    const rate = parseFloat(base_price_raw) || 0
    const mrp = parseFloat(mrp_raw) || 0
    const discount_pct = mrp > 0 && rate < mrp
      ? Math.round((1 - rate / mrp) * 100 * 100) / 100
      : 0
    return {
      product_id,
      variant_id: variant_id_raw || null,
      rate,
      discount_pct,
      gst_percentage: parseFloat(gst_raw) || 18,
      hsn_code: hsn_raw || '',
      inventory_quantity: inv_raw !== undefined && inv_raw !== '' ? parseFloat(inv_raw) : null,
    }
  }

  function newQuotation() {
    setEditId(null)
    setQuoteNumber('')
    setQuoteDate(todayISO())
    setNotes('')
    setCName(''); setCAddr1(''); setCAddr2(''); setCCity(''); setCState('Chhattisgarh'); setCGstin(''); setCPhone(''); setCPincode('')
    setBuyerSame(true)
    setBName(''); setBAddr1(''); setBAddr2(''); setBCity(''); setBState('Chhattisgarh'); setBGstin('')
    setItems([emptyItem()])
    setSaveError('')
    setIsFinal(false)
    setAutoSaveStatus('idle')
    isEditorMounted.current = false
    setQSearchModes({})
    setQNameInputs({})
    setQSkuInputs({})
    setQCategoryIds({})
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
      setCPhone(q.consignee_phone || ''); setCPincode(q.consignee_pincode || '')
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
      setIsFinal(q.status === 'final')
      setConvertedOrderId(q.converted_order_id || null)
      setAutoSaveStatus('idle')
      isEditorMounted.current = false
      setQSearchModes({})
      setQNameInputs({})
      setQSkuInputs({})
      setQCategoryIds({})
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
        items: items.map(i => ({
          description: i.description,
          hsn_code: i.hsn_code || null,
          gst_rate: i.gst_rate,
          quantity: parseFloat(String(i.quantity)) || 0,
          unit: i.unit,
          rate: parseFloat(String(i.rate)) || 0,
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

  useEffect(() => {
    const hasCategory = Object.values(qSearchModes).includes('category')
    if (hasCategory && categories.length === 0) {
      fetch('/api/categories')
        .then(r => r.json())
        .then(d => setCategories((d.categories || []).map((c: any) => ({ id: c.id, name: c.name }))))
        .catch(() => {})
    }
  }, [qSearchModes])

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
    setCPhone(c.phone || '')
    setCPincode(c.postal_code || '')
    setCustSearch('')
    setShowCustDrop(false)
  }

  function openProductModal(rowIdx: number) {
    setProductModalRow(rowIdx)
    setProdSearch('')
    setProdResults([])
    setProdCategory('')
    setProdSearchMode('name')
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
        const res = await fetch(`/api/admin/quotations/products?${params}`)
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

  async function loadCatPickerProducts(catId: string, q: string) {
    if (!catId) return
    setCatPickerLoading(true)
    try {
      const params = new URLSearchParams({ limit: '10000' })
      params.set('category_id', catId)
      if (q.trim()) params.set('q', q.trim())
      const res = await fetch(`/api/admin/quotations/products?${params}`)
      const data = await res.json()
      setCatPickerResults(data.products || [])
    } catch { setCatPickerResults([]) }
    finally { setCatPickerLoading(false) }
  }

  function openCatPicker() {
    setCatPickerActiveCatId(prodCategory)
    setCatPickerSearch('')
    setCatPickerOpen(true)
    loadCatPickerProducts(prodCategory, '')
  }

  function openQPicker(rowIdx: number) {
    const catId = qCategoryIds[rowIdx] || ''
    setQPickerRow(rowIdx)
    setCatPickerActiveCatId(catId)
    setCatPickerSearch('')
    setCatPickerOpen(true)
    loadCatPickerProducts(catId, '')
  }

  function applyProductToRow(rowIdx: number, p: ProductResult) {
    const desc = p.variant_name ? `${p.name} ${p.variant_name}` : p.name
    setItems(prev => prev.map((item, i) => {
      if (i !== rowIdx) return item
      const gst = parseFloat(String(p.gst_percentage)) || 18
      const basePrice_incl = Number(p.base_price) || 0
      const updated = {
        ...item,
        description: desc,
        hsn_code: p.hsn_code || '',
        gst_rate: gst,
        rate: basePrice_incl,
        discount_pct: (() => {
          const mrp = Number(p.mrp) || 0
          return mrp > 0 && basePrice_incl < mrp
            ? Math.round((1 - basePrice_incl / mrp) * 100 * 100) / 100
            : 0
        })(),
        product_id: p.product_id,
        variant_id: p.variant_id || null,
        is_draft_product: false,
        is_active_product: p.is_active,
        inventory_quantity: p.inventory_quantity ?? null,
      }
      updated.amount = calcItemAmount(updated)
      return updated
    }))
  }

  function selectProduct(p: ProductResult) {
    const rowIdx = qPickerRow !== null ? qPickerRow : productModalRow
    if (rowIdx === null) return
    applyProductToRow(rowIdx, p)
    setCatPickerOpen(false)
    setQPickerRow(null)
    setProductModalOpen(false)
    setProductModalRow(null)
  }

  async function createDraftProduct() {
    const name = prodSearch.trim()
    if (!name || productModalRow === null) return
    setCreatingDraft(true)
    try {
      const res = await fetch('/api/admin/products/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setItems(prev => prev.map((item, i) => {
        if (i !== productModalRow) return item
        const updated = { ...item, description: data.name, product_id: data.id, is_draft_product: true }
        updated.amount = calcItemAmount(updated)
        return updated
      }))
      setProductModalOpen(false)
      setProductModalRow(null)
      showToast(`Draft product "${data.name}" created — edit it in the new tab (SKU: ${data.sku})`, 'warning')
      window.open(`/admin/products/edit/${data.id}`, '_blank')
    } catch (e: any) {
      showToast(e.message || 'Failed to create draft product', 'error')
    } finally {
      setCreatingDraft(false)
    }
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
                          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 whitespace-nowrap">
                            Invoiced
                          </span>
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
            <div className="flex gap-2">
              <input value={cPhone} onChange={e => setCPhone(e.target.value)} placeholder="Phone" disabled={isFinal} className={inputCls} />
              <input value={cPincode} onChange={e => setCPincode(e.target.value)} placeholder="Pincode" disabled={isFinal} className={inputCls + ' font-mono'} />
            </div>
            <input value={cGstin} onChange={e => setCGstin(e.target.value)} placeholder="GSTIN (optional)" disabled={isFinal} className={inputCls + ' font-mono'} />
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
              <input value={bGstin} onChange={e => setBGstin(e.target.value)} placeholder="GSTIN (optional)" disabled={isFinal} className={inputCls + ' font-mono'} />
            </div>
          )}
        </div>
      </div>

      <div className="bg-surface-elevated border border-border-default rounded-xl p-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-foreground">Line Items</h2>
          {!isFinal && (
            <button type="button" onClick={addItem}
              className="flex items-center gap-1 text-xs text-secondary-500 dark:text-secondary-300 font-semibold hover:text-secondary-600 dark:hover:text-secondary-200 transition-colors">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Add Item
            </button>
          )}
        </div>


        <div className="space-y-3">
          {items.map((item, idx) => (
            <div key={idx} className="border border-border-default rounded-lg p-3 space-y-3 bg-surface-elevated">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-foreground-muted uppercase tracking-wide">Item {idx + 1}</span>
                  {item.product_id && item.is_draft_product && (
                    <button type="button" title="Draft product — click to edit in new tab"
                      onClick={() => window.open(`/admin/products/edit/${item.product_id}`, '_blank')}
                      className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-400 border border-yellow-300 dark:border-yellow-700 hover:bg-yellow-200 transition-colors">
                      Draft ↗
                    </button>
                  )}
                  {item.product_id && !item.is_draft_product && item.is_active_product === false && (
                    <span title="Inactive product" className="w-2 h-2 rounded-full bg-yellow-400" />
                  )}
                  {item.product_id && !item.is_draft_product && item.is_active_product !== false && (
                    <span title="Linked to product" className="w-2 h-2 rounded-full bg-green-500" />
                  )}
                </div>
                {!isFinal && items.length > 1 && (
                  <button type="button" onClick={() => removeItem(idx)}
                    className="text-xs text-red-500 hover:text-red-600 font-medium">Remove</button>
                )}
              </div>

              <div className="relative">
                {item.description && !isFinal ? (
                  <div className="flex items-center justify-between gap-2 px-3 py-2 bg-surface-secondary rounded-lg border border-border-default">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{item.description}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        {item.hsn_code && <p className="text-xs text-foreground-muted">HSN {item.hsn_code}</p>}
                        {item.inventory_quantity !== null && item.inventory_quantity !== undefined && (
                          <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${
                            item.inventory_quantity === 0
                              ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                              : item.inventory_quantity <= 5
                              ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
                              : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                          }`}>
                            {item.inventory_quantity === 0 ? 'Out of stock' : `Stock: ${item.inventory_quantity}`}
                          </span>
                        )}
                      </div>
                    </div>
                    <button type="button"
                      onClick={() => {
                        setItems(prev => prev.map((it, i) => i !== idx ? it : {
                          ...it, description: '', product_id: null, variant_id: null,
                          hsn_code: '', gst_rate: 18, rate: 0, amount: 0,
                          is_draft_product: false, is_active_product: undefined,
                          inventory_quantity: null,
                        }))
                        setQNameInputs(p => { const n = { ...p }; delete n[idx]; return n })
                        setQSkuInputs(p => { const n = { ...p }; delete n[idx]; return n })
                        setQSearchModes(p => { const n = { ...p }; delete n[idx]; return n })
                      }}
                      className="shrink-0 text-xs text-secondary-500 dark:text-secondary-300 font-semibold hover:text-secondary-600 dark:hover:text-secondary-200 transition-colors">
                      Change
                    </button>
                  </div>
                ) : item.description && isFinal ? (
                  <>
                    <label className={labelCls}>Product / Description</label>
                    <input value={item.description} disabled className={inputCls} />
                  </>
                ) : !isFinal ? (
                  <>
                    <div className="flex gap-1 mb-2 p-1 bg-surface-secondary rounded-lg w-fit">
                      {(['name', 'sku', 'category'] as const).map(m => {
                        const mode = qSearchModes[idx] ?? 'name'
                        return (
                          <button key={m} type="button"
                            onClick={() => {
                              setQSearchModes(p => ({ ...p, [idx]: m }))
                              setQNameInputs(p => { const n = { ...p }; delete n[idx]; return n })
                              setQSkuInputs(p => { const n = { ...p }; delete n[idx]; return n })
                            }}
                            className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${mode === m ? 'bg-secondary-500 dark:bg-secondary-400 text-white dark:text-secondary-900 shadow-sm' : 'text-foreground-secondary hover:text-foreground'}`}>
                            {m === 'name' ? 'Name' : m === 'sku' ? 'SKU' : 'Category'}
                          </button>
                        )
                      })}
                    </div>
                    {(qSearchModes[idx] ?? 'name') === 'name' && (
                      <AdminTypeahead
                        type="admin_line_items"
                        value={qNameInputs[idx] ?? ''}
                        onChange={v => setQNameInputs(p => ({ ...p, [idx]: v }))}
                        onSelect={s => {
                          const d = decodeLineItemId(s.id)
                          setQNameInputs(p => ({ ...p, [idx]: s.label }))
                          setItems(prev => prev.map((it, i) => {
                            if (i !== idx) return it
                            const updated = { ...it, description: s.label, product_id: d.product_id, variant_id: d.variant_id, hsn_code: d.hsn_code, gst_rate: d.gst_percentage, rate: d.rate, discount_pct: d.discount_pct, is_draft_product: false, is_active_product: true, inventory_quantity: d.inventory_quantity }
                            updated.amount = calcItemAmount(updated)
                            return updated
                          }))
                        }}
                        inputClassName={inputCls}
                        placeholder="Search by product name..."
                      />
                    )}
                    {(qSearchModes[idx] ?? 'name') === 'sku' && (
                      <AdminTypeahead
                        type="admin_line_items"
                        value={qSkuInputs[idx] ?? ''}
                        onChange={v => setQSkuInputs(p => ({ ...p, [idx]: v }))}
                        onSelect={s => {
                          const d = decodeLineItemId(s.id)
                          const sku = s.sublabel?.split(' · ')[0] ?? ''
                          setQSkuInputs(p => ({ ...p, [idx]: sku }))
                          setItems(prev => prev.map((it, i) => {
                            if (i !== idx) return it
                            const updated = { ...it, description: s.label, product_id: d.product_id, variant_id: d.variant_id, hsn_code: d.hsn_code, gst_rate: d.gst_percentage, rate: d.rate, discount_pct: d.discount_pct, is_draft_product: false, is_active_product: true, inventory_quantity: d.inventory_quantity }
                            updated.amount = calcItemAmount(updated)
                            return updated
                          }))
                        }}
                        inputClassName={inputCls + ' font-mono'}
                        placeholder="e.g. JFS-1234"
                      />
                    )}
                    {(qSearchModes[idx] ?? 'name') === 'category' && (
                      <div className="flex gap-2">
                        <div className="flex-1">
                          <AdminSelect
                            value={qCategoryIds[idx] ?? ''}
                            onChange={v => setQCategoryIds(p => ({ ...p, [idx]: v }))}
                            placeholder="— Select category —"
                            options={categories.map(c => ({ value: c.id, label: c.name }))}
                          />
                        </div>
                        <button type="button" disabled={!qCategoryIds[idx]}
                          onClick={() => openQPicker(idx)}
                          className="px-3 py-1.5 bg-secondary-500 hover:bg-secondary-600 dark:bg-secondary-400 dark:hover:bg-secondary-300 dark:text-secondary-900 disabled:opacity-40 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap">
                          Select Product
                        </button>
                      </div>
                    )}
                  </>
                ) : null}
              </div>

              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                <div>
                  <label className={labelCls}>HSN/SAC</label>
                  <input type="text" value={item.hsn_code} onChange={e => updateItem(idx, 'hsn_code', e.target.value)}
                    disabled={isFinal} className={inputCls + ' font-mono'} placeholder="7318" />
                </div>
                <div>
                  <label className={labelCls}>GST %</label>
                  <AdminSelect
                    value={String(item.gst_rate)}
                    onChange={v => updateItem(idx, 'gst_rate', parseFloat(v) || 0)}
                    disabled={isFinal}
                    className="[&_button]:!bg-surface-secondary [&_button]:!border-border-default [&_button]:!rounded [&_button]:!py-1.5 [&_button]:!px-2 [&_button]:!text-sm [&_button]:!w-full"
                    options={[
                      { value: '0', label: '0%' }, { value: '5', label: '5%' },
                      { value: '12', label: '12%' }, { value: '18', label: '18%' },
                      { value: '28', label: '28%' },
                    ]}
                  />
                </div>
                <div>
                  <label className={labelCls}>Qty <span className="text-red-500">*</span></label>
                  <input type="number" min="0.001" step="any" value={item.quantity}
                    onChange={e => updateItem(idx, 'quantity', e.target.value)}
                    disabled={isFinal} required className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Unit</label>
                  <div className="flex items-center gap-0.5 w-full px-2 py-1.5 rounded border border-border-default bg-surface-secondary">
                    <button type="button" disabled={isFinal} onClick={() => {
                      const i = UNITS.indexOf(item.unit)
                      updateItem(idx, 'unit', UNITS[(i - 1 + UNITS.length) % UNITS.length])
                    }} className="text-foreground-secondary hover:text-foreground transition-colors disabled:opacity-40">
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
                    </button>
                    <span className="text-sm font-medium text-foreground flex-1 text-center tabular-nums">{item.unit}</span>
                    <button type="button" disabled={isFinal} onClick={() => {
                      const i = UNITS.indexOf(item.unit)
                      updateItem(idx, 'unit', UNITS[(i + 1) % UNITS.length])
                    }} className="text-foreground-secondary hover:text-foreground transition-colors disabled:opacity-40">
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                    </button>
                  </div>
                </div>
                <div>
                  <label className={labelCls}>Rate (incl. GST) <span className="text-red-500">*</span></label>
                  <input type="number" min="0" step="any" value={item.rate}
                    onChange={e => updateItem(idx, 'rate', e.target.value)}
                    disabled={isFinal} required className={inputCls} placeholder="0.00" />
                </div>
                <div>
                  <label className={labelCls}>Disc %</label>
                  <input type="number" min="0" max="100" step="any" value={item.discount_pct}
                    onChange={e => updateItem(idx, 'discount_pct', parseFloat(e.target.value) || 0)}
                    disabled={isFinal} className={inputCls} placeholder="0" />
                </div>
              </div>

              <p className="text-xs text-foreground-secondary text-right">
                Line total: <span className="font-semibold text-foreground">₹{fmt2(item.amount)}</span>
              </p>
            </div>
          ))}
        </div>

        <div className="flex justify-end border-t border-border-default pt-3 mt-1">
          <div className="w-64 space-y-1.5 text-sm">
            <div className="flex justify-between text-foreground-secondary">
              <span>Taxable Value</span>
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
                <span className="tabular-nums">{roundOff >= 0 ? '+' : ''}₹{fmt2(roundOff)}</span>
              </div>
            )}
            <div className="flex justify-between font-bold text-foreground text-base border-t border-border-default pt-2">
              <span>Total (incl. GST)</span>
              <span className="tabular-nums">₹{fmt2(total)}</span>
            </div>
          </div>
        </div>
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

      {productModalOpen && typeof document !== 'undefined' && createPortal(
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
              <div className="flex gap-1 p-1 bg-surface-secondary rounded-lg w-fit">
                {(['name', 'sku', 'category'] as const).map(m => (
                  <button key={m} type="button"
                    onClick={() => { setProdSearchMode(m); setProdSearch(''); setProdCategory(''); loadProducts('', m === 'category' ? prodCategory : '') }}
                    className={`px-3 py-1 rounded-md text-xs font-medium transition-colors capitalize ${prodSearchMode === m ? 'bg-secondary-500 dark:bg-secondary-400 text-white dark:text-secondary-900 shadow-sm' : 'text-foreground-secondary hover:text-foreground'}`}>
                    {m === 'name' ? 'Name' : m === 'sku' ? 'SKU' : 'Category'}
                  </button>
                ))}
              </div>
              {prodSearchMode === 'category' ? (
                <div className="space-y-2">
                  <AdminSelect
                    value={prodCategory}
                    placeholder="All Categories"
                    options={[{ value: '', label: 'All Categories' }, ...categories.map(c => ({ value: c.id, label: c.name }))]}
                    onChange={val => { setProdCategory(val); loadProducts(prodSearch, val) }}
                  />
                  <button
                    type="button"
                    disabled={!prodCategory}
                    onClick={openCatPicker}
                    className="w-full py-1.5 bg-secondary-500 hover:bg-secondary-600 dark:bg-secondary-400 dark:hover:bg-secondary-300 dark:text-secondary-900 disabled:opacity-40 text-white text-xs font-semibold rounded-lg transition-colors"
                  >
                    Browse Products in Category
                  </button>
                </div>
              ) : (
                <AdminTypeahead
                  type="admin_line_items"
                  value={prodSearch}
                  onChange={setProdSearch}
                  onSelect={s => {
                    const [pid, vid_raw, price_raw, gst_raw, hsn_raw, mrp_raw, inv_raw] = s.id.split('|')
                    const sku = s.sublabel?.split(' · ')[0] ?? ''
                    const p: ProductResult = {
                      id: s.id,
                      product_id: pid,
                      variant_id: vid_raw || null,
                      name: s.label.includes(' — ') ? s.label.split(' — ')[0] : s.label,
                      variant_name: s.label.includes(' — ') ? s.label.split(' — ')[1] : null,
                      sku,
                      mrp: parseFloat(mrp_raw) || 0,
                      base_price: parseFloat(price_raw) || 0,
                      gst_percentage: parseFloat(gst_raw) || 18,
                      hsn_code: hsn_raw || null,
                      is_active: true,
                      inventory_quantity: inv_raw !== undefined && inv_raw !== '' ? parseFloat(inv_raw) : null,
                    }
                    selectProduct(p)
                  }}
                  autoFocus
                  inputClassName={inputCls}
                  placeholder={prodSearchMode === 'sku' ? 'Search by SKU…' : 'Search by name…'}
                />
              )}
            </div>
            {prodSearchMode !== 'category' && (
            <div className="flex-1 overflow-y-auto">
              {prodLoading && <p className="p-4 text-center text-foreground-secondary text-sm">Searching…</p>}
              {!prodLoading && prodResults.length === 0 && (
                <p className="p-4 text-center text-foreground-secondary text-sm">No products found</p>
              )}
              {!prodLoading && (() => {
                const groups: { productId: string; name: string; items: ProductResult[] }[] = []
                for (const p of prodResults) {
                  const g = groups.find(g => g.productId === p.product_id)
                  if (g) g.items.push(p)
                  else groups.push({ productId: p.product_id, name: p.name, items: [p] })
                }
                return groups.map(g => (
                  <div key={g.productId} className="border-b border-border-default last:border-0">
                    {g.items.length > 1 && (
                      <p className="px-4 pt-2.5 pb-1 text-xs font-semibold text-foreground-muted uppercase tracking-wider bg-surface-secondary">{g.name}</p>
                    )}
                    {g.items.map(p => (
                      <button key={p.id} onClick={() => selectProduct(p)}
                        className="w-full text-left px-4 py-2.5 hover:bg-surface-secondary transition-colors border-b border-border-default/30 last:border-0">
                        <div className="flex items-center gap-1.5">
                          <span className={`shrink-0 w-1.5 h-1.5 rounded-full ${p.is_active ? 'bg-green-500' : 'bg-yellow-400'}`} />
                          <p className={`text-sm font-medium ${p.is_active ? 'text-foreground' : 'text-foreground-secondary'}`}>
                            {g.items.length > 1 ? (p.variant_name || p.name) : p.name}
                            {!p.is_active && <span className="ml-1.5 text-[10px] font-normal text-yellow-600 dark:text-yellow-400">(inactive)</span>}
                          </p>
                        </div>
                        <div className="flex gap-3 mt-0.5 pl-3">
                          <span className="text-xs text-foreground-secondary font-mono">{p.sku}</span>
                          <span className="text-xs text-secondary-500 font-semibold">₹{fmt2(Number(p.mrp || p.base_price))}</span>
                          <span className="text-xs text-foreground-secondary">GST {p.gst_percentage}%</span>
                          {p.hsn_code && <span className="text-xs text-foreground-muted">HSN {p.hsn_code}</span>}
                        </div>
                      </button>
                    ))}
                  </div>
                ))
              })()}
            </div>
            )}
            {prodSearch.trim() && prodSearchMode !== 'category' && productModalRow !== null && !items[productModalRow]?.product_id && (
              <div className="p-3 border-t border-border-default bg-surface-secondary">
                <button
                  type="button"
                  onClick={createDraftProduct}
                  disabled={creatingDraft}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-border-default hover:border-accent-500 hover:bg-accent-50 dark:hover:bg-accent-900/20 text-sm text-foreground-secondary hover:text-accent-600 transition-colors disabled:opacity-50"
                >
                  <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                  <span>{creatingDraft ? 'Creating…' : <>Create draft product <span className="font-medium text-foreground">&quot;{prodSearch.trim()}&quot;</span></>}</span>
                </button>
              </div>
            )}
          </div>
        </div>,
        document.body
      )}

      {catPickerOpen && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50">
          <div className="bg-surface-elevated border border-border-default rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border-default shrink-0">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Select Product</h3>
                <p className="text-xs text-foreground-muted mt-0.5">
                  {categories.find(c => c.id === catPickerActiveCatId)?.name || 'All products'}
                </p>
              </div>
              <button type="button" onClick={() => setCatPickerOpen(false)}
                className="p-1.5 text-foreground-secondary hover:text-foreground transition-colors">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="px-4 py-3 border-b border-border-default shrink-0">
              <input
                type="text"
                value={catPickerSearch}
                onChange={e => { setCatPickerSearch(e.target.value); loadCatPickerProducts(catPickerActiveCatId, e.target.value) }}
                className={inputCls}
                placeholder="Filter by name or SKU…"
                autoFocus
              />
            </div>
            <div className="overflow-y-auto flex-1">
              {catPickerLoading ? (
                <div className="p-8 text-center text-foreground-muted text-sm">Loading…</div>
              ) : catPickerResults.length === 0 ? (
                <div className="p-8 text-center text-foreground-muted text-sm">No products found in this category.</div>
              ) : (() => {
                const groups: { productId: string; name: string; items: ProductResult[] }[] = []
                for (const p of catPickerResults) {
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
                          {g.items.map(p => (
                            <tr key={p.id}
                              onClick={() => { selectProduct(p); setCatPickerOpen(false) }}
                              className="border-t border-border-default hover:bg-surface-secondary cursor-pointer transition-colors">
                              <td className="px-4 py-2.5">
                                {g.items.length > 1 ? (
                                  <span className="text-foreground pl-2">{p.variant_name || p.name}</span>
                                ) : (
                                  <span className="font-medium text-foreground">{p.name}</span>
                                )}
                                {!p.is_active && <span className="ml-1.5 text-[10px] text-yellow-600 dark:text-yellow-400">(inactive)</span>}
                              </td>
                              <td className="px-4 py-2.5 font-mono text-xs text-foreground-muted">{p.sku}</td>
                              <td className="px-4 py-2.5 text-right text-foreground font-medium">
                                {p.mrp || p.base_price ? `₹${fmt2(Number(p.mrp || p.base_price))}` : '—'}
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
        </div>,
        document.body
      )}
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
