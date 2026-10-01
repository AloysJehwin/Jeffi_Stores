'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { createPortal } from 'react-dom'
import AdminTypeahead from '@/components/admin/AdminTypeahead'
import AdminSelect from '@/components/admin/AdminSelect'
import DatePicker from '@/components/ui/DatePicker'
import CopySku from '@/components/ui/CopySku'
import { useBarcodeScanner } from '@/hooks/useBarcodeScanner'
import { ap } from '@/lib/shared/admin-path'
import { formatINR as formatINRBase } from '@/lib/shared/format'
import { RequireWrite } from '@/contexts/AdminScopesContext'
import MobileEditBlock from '@/components/admin/MobileEditBlock'
import { useToast } from '@/contexts/ToastContext'

const PURCHASE_UNITS = [
  { value: '', label: '— same as sell unit —' },
  { value: 'Carton', label: 'Carton' },
  { value: 'Box', label: 'Box' },
  { value: 'Case', label: 'Case' },
  { value: 'Bag', label: 'Bag' },
  { value: 'Drum', label: 'Drum' },
  { value: 'Pallet', label: 'Pallet' },
  { value: 'Bundle', label: 'Bundle' },
  { value: 'Roll', label: 'Roll' },
  { value: 'Pack', label: 'Pack' },
  { value: 'Dozen', label: 'Dozen (12)' },
  { value: 'Gross', label: 'Gross (144)' },
  { value: 'Sack', label: 'Sack' },
  { value: 'Barrel', label: 'Barrel' },
  { value: 'Tin', label: 'Tin' },
  { value: 'Bottle', label: 'Bottle' },
  { value: 'Tube', label: 'Tube' },
  { value: 'Coil', label: 'Coil' },
  { value: 'Set', label: 'Set' },
  { value: 'Kit', label: 'Kit' },
]

const inputCls =
  'w-full px-3 py-1.5 rounded-lg border border-border-default bg-surface text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-secondary-500 focus:border-transparent transition-colors placeholder:text-foreground-muted'
const labelCls = 'block text-xs font-medium text-foreground-secondary mb-1'
const btnPrimary =
  'control-sm border border-transparent bg-secondary-500 hover:bg-secondary-600 dark:bg-secondary-400 dark:hover:bg-secondary-300 text-white dark:text-secondary-900 font-medium transition-colors disabled:opacity-50'
const btnSecondary =
  'control-sm border border-border-default bg-surface hover:bg-surface-secondary text-foreground font-medium transition-colors'

type Supplier = { id: string; name: string }
type POSearchMode = 'name' | 'sku' | 'category' | 'scanner'

type POLineItem = {
  id: string
  product_id: string
  variant_id: string
  sub_variant_id: string
  product_name: string
  sku: string
  quantity: string
  tax_rate: string
  hsn_code: string
  mrp: number
  sell_unit_label: string
  sell_unit_dimension: string
  purchase_unit: string
  purchase_unit_factor: string
  line_total_incl_gst: string
  gst_inclusive: boolean
}

type PickerProduct = {
  product_id: string
  variant_id: string | null
  sub_variant_id: string | null
  name: string
  variant_name: string | null
  sku: string
  base_price: number | null
  gst_percentage: number | null
  hsn_code: string | null
  mrp: number | null
  sell_unit_label: string | null
  sell_unit_dimension: string | null
}

function newPOLineItem(): POLineItem {
  return {
    id: Math.random().toString(36).slice(2),
    product_id: '',
    variant_id: '',
    sub_variant_id: '',
    product_name: '',
    sku: '',
    quantity: '1',
    tax_rate: '0',
    hsn_code: '',
    mrp: 0,
    sell_unit_label: '',
    sell_unit_dimension: '',
    purchase_unit: '',
    purchase_unit_factor: '1',
    line_total_incl_gst: '',
    gst_inclusive: true,
  }
}

function decodePOLineItemId(encoded: string) {
  // po_line_items suggest encoding (src/app/api/admin/suggest/route.ts):
  // [0]product_id [1]variant_id [2]base_price [3]gst [4]hsn [5]mrp [6]inventory [7]sub_variant_id [8]discount
  const parts = encoded.split('|')
  return {
    product_id: parts[0],
    variant_id: parts[1] || '',
    sub_variant_id: parts[7] || '',
    tax_rate: parts[3] ? String(Math.round(parseFloat(parts[3]))) : '0',
    hsn_code: parts[4] || '',
    sell_unit_label: '',
    sell_unit_dimension: '',
  }
}

/** Stock is always in pc for count-dimension products; use sell_unit_label for others */
function poLineBaseLabel(it: Pick<POLineItem, 'sell_unit_label' | 'sell_unit_dimension'>): string {
  if (!it.sell_unit_dimension || it.sell_unit_dimension === 'count') return 'pc'
  return it.sell_unit_label || 'units'
}

function fmtINR2(n: number) {
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const formatINR = (n: number) => formatINRBase(n, 0)

export default function NewPOPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { showToast } = useToast()
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([])
  const [form, setForm] = useState({ supplier_id: '', order_date: '', expected_date: '', notes: '', status: 'draft' })
  const [lineItems, setLineItems] = useState<POLineItem[]>([newPOLineItem()])

  // Deep-link preseed (scan → New PO): ?product=<id> seeds the first PO line.
  // Best-effort via the shared scan resolver; silent no-op if it can't resolve.
  const poSeededRef = useRef(false)
  useEffect(() => {
    if (poSeededRef.current) return
    const pid = searchParams.get('product')
    if (!pid) return
    poSeededRef.current = true
    const vid = searchParams.get('variant')
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/admin/scan/resolve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ code: vid || pid }),
        })
        const data = await res.json().catch(() => ({}))
        const it = data?.item
        if (cancelled || !it || !it.product_id) return
        const seeded: POLineItem = {
          ...newPOLineItem(),
          product_id: it.product_id,
          variant_id: it.variant_id || '',
          sub_variant_id: it.sub_variant_id || '',
          product_name: it.variant_name ? `${it.name} — ${it.variant_name}` : it.name,
          sku: it.sku || '',
          tax_rate: it.gst_percentage != null ? String(Math.round(Number(it.gst_percentage))) : '0',
          hsn_code: it.hsn_code || '',
          mrp: Number(it.mrp) || 0,
          sell_unit_label: it.sell_unit_label || '',
          sell_unit_dimension: it.sell_unit_dimension || '',
        }
        setLineItems(prev => (prev.length === 1 && !prev[0].product_id ? [seeded] : [seeded, ...prev]))
      } catch {
        /* best-effort */
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [searchModes, setSearchModes] = useState<Record<string, POSearchMode>>({})
  const [nameInputs, setNameInputs] = useState<Record<string, string>>({})
  const [skuInputs, setSkuInputs] = useState<Record<string, string>>({})
  const [categoryIds, setCategoryIds] = useState<Record<string, string>>({})
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerItemId, setPickerItemId] = useState<string | null>(null)
  const [pickerCatId, setPickerCatId] = useState('')
  const [pickerSearch, setPickerSearch] = useState('')
  const [pickerResults, setPickerResults] = useState<PickerProduct[]>([])
  const [pickerLoading, setPickerLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  // Barcode scanning — default ON. A scan (SKU/barcode/GTIN/serial/lot, CR-terminated)
  // resolves to a product and adds/increments a PO line. captureInInputs so it fires
  // even while a form field is focused; the hook swallows the burst chars.
  const [scanEnabled, setScanEnabled] = useState(true)
  const [scanMsg, setScanMsg] = useState<{ text: string; kind: 'ok' | 'err' } | null>(null)
  // Per-line Scanner mode input text, keyed by line id (predictive-search fields
  // drop chars mid-burst; a plain per-line scan field doesn't). data-scan-box so
  // the global keyboard-wedge hook ignores it (no double-add).
  const [scanInputs, setScanInputs] = useState<Record<string, string>>({})
  const lineItemsRef = useRef(lineItems)
  lineItemsRef.current = lineItems

  useEffect(() => {
    fetch('/api/admin/inventory/suppliers?limit=1000')
      .then(r => r.json())
      .then(j => setSuppliers(j?.suppliers || []))
    fetch('/api/categories')
      .then(r => r.json())
      .then(d => setCategories((d.categories || d || []).map((c: any) => ({ id: c.id, name: c.name }))))
  }, [])

  async function loadPickerProducts(catId: string, q: string) {
    if (!catId) return
    setPickerLoading(true)
    try {
      const params = new URLSearchParams({ limit: '10000', category_id: catId })
      if (q.trim()) params.set('q', q.trim())
      const res = await fetch(`/api/admin/labels/products?${params}`, { credentials: 'include' })
      const json = await res.json()
      setPickerResults(json?.products || [])
    } catch {
      setPickerResults([])
    } finally {
      setPickerLoading(false)
    }
  }

  function openPicker(itemId: string, catId: string) {
    setPickerItemId(itemId)
    setPickerCatId(catId)
    setPickerSearch('')
    setPickerResults([])
    setPickerOpen(true)
    loadPickerProducts(catId, '')
  }

  function mergeOrReplaceLineItem(targetItemId: string, populated: POLineItem): POLineItem[] {
    if (!populated.product_id) {
      return lineItems.map(it => (it.id === targetItemId ? populated : it))
    }
    const dupIdx = lineItems.findIndex(
      it =>
        it.id !== targetItemId &&
        it.product_id === populated.product_id &&
        (it.variant_id || '') === (populated.variant_id || '')
    )
    if (dupIdx === -1) {
      return lineItems.map(it => (it.id === targetItemId ? populated : it))
    }
    const addQty = parseFloat(String(populated.quantity)) || 1
    return lineItems
      .map((it, i) => {
        if (i === dupIdx) {
          const existing = parseFloat(String(it.quantity)) || 0
          return { ...it, quantity: String(existing + addQty) }
        }
        return it
      })
      .filter(it => it.id !== targetItemId)
  }

  // ── Barcode scan (SKU / barcode / GTIN / serial / lot → add PO line) ────────
  // A PO is a purchase order (incoming stock), so ANY resolved code just adds/
  // increments the product line — no serial-uniqueness rejection (serials are
  // assigned at receive, not order). Resolve returns `item` (product/variant/batch)
  // or `serial`; both carry product_id/variant_id/sub_variant_id + name/sku.
  async function handlePoScan(code: string) {
    try {
      const res = await fetch('/api/admin/scan/resolve', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.kind === 'not_found' || (!data.item && !data.serial)) {
        setScanMsg({ text: `No product found for "${code}"`, kind: 'err' })
        return
      }
      const s = data.kind === 'serial' ? data.serial : data.item
      const name = s.name || s.product_name
      const displayName = s.variant_name ? `${name} — ${s.variant_name}` : name
      // Target the first blank line, else append a fresh one to merge into.
      const cur = lineItemsRef.current
      let targetId = cur.find(it => !it.product_id)?.id
      let base: POLineItem[] = cur
      if (!targetId) {
        const blank = newPOLineItem()
        base = [...cur, blank]
        targetId = blank.id
      }
      const target = base.find(it => it.id === targetId)!
      const populated: POLineItem = {
        ...target,
        product_id: s.product_id,
        product_name: displayName,
        sku: s.sku || s.variant_sku || s.product_sku || '',
        variant_id: s.variant_id || '',
        sub_variant_id: s.sub_variant_id || '',
        tax_rate: s.gst_percentage != null ? String(Math.round(Number(s.gst_percentage))) : target.tax_rate || '0',
        hsn_code: s.hsn_code || target.hsn_code || '',
        mrp: Number(s.mrp) || target.mrp || 0,
        sell_unit_label: s.sell_unit_label || target.sell_unit_label || '',
        sell_unit_dimension: s.sell_unit_dimension || target.sell_unit_dimension || '',
      }
      if (!populated.product_id) return
      // Always increment on duplicate (PO orders quantities; no serial uniqueness).
      const dupIdx = base.findIndex(
        it =>
          it.id !== targetId &&
          it.product_id === populated.product_id &&
          (it.variant_id || '') === (populated.variant_id || '')
      )
      if (dupIdx === -1) {
        setLineItems(base.map(it => (it.id === targetId ? populated : it)))
      } else {
        const addQty = parseFloat(String(populated.quantity)) || 1
        setLineItems(
          base
            .map((it, i) =>
              i === dupIdx ? { ...it, quantity: String((parseFloat(String(it.quantity)) || 0) + addQty) } : it
            )
            .filter(it => it.id !== targetId)
        )
      }
      setScanMsg({ text: `✓ ${displayName}`, kind: 'ok' })
    } catch {
      setScanMsg({ text: 'Scan lookup failed', kind: 'err' })
    }
  }

  useBarcodeScanner({ onScan: handlePoScan, enabled: scanEnabled, captureInInputs: true })

  // Per-line Scanner mode: resolve the scanned code and FILL this line (it.id),
  // then auto-append a fresh blank line (also in Scanner mode) so the operator can
  // keep scanning continuously. Mirrors applyPickerProduct's fill path.
  async function fillScanLine(itemId: string, code: string) {
    const trimmed = code.trim()
    if (!trimmed) return
    const target = lineItems.find(it => it.id === itemId)
    if (!target) return
    try {
      const res = await fetch('/api/admin/scan/resolve', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: trimmed }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.kind === 'not_found' || (!data.item && !data.serial)) {
        setScanMsg({ text: `No product found for "${trimmed}"`, kind: 'err' })
        // Clear this line's scan field so the operator can immediately re-scan.
        setScanInputs(p => {
          const n = { ...p }
          delete n[itemId]
          return n
        })
        return
      }
      const s = data.kind === 'serial' ? data.serial : data.item
      const name = s.name || s.product_name
      const displayName = s.variant_name ? `${name} — ${s.variant_name}` : name
      const populated: POLineItem = {
        ...target,
        product_id: s.product_id,
        product_name: displayName,
        sku: s.sku || s.variant_sku || s.product_sku || '',
        variant_id: s.variant_id || '',
        sub_variant_id: s.sub_variant_id || '',
        tax_rate: s.gst_percentage != null ? String(Math.round(Number(s.gst_percentage))) : target.tax_rate || '0',
        hsn_code: s.hsn_code || target.hsn_code || '',
        mrp: Number(s.mrp) || target.mrp || 0,
        sell_unit_label: s.sell_unit_label || target.sell_unit_label || '',
        sell_unit_dimension: s.sell_unit_dimension || target.sell_unit_dimension || '',
      }
      if (!populated.product_id) return
      // Fill/merge this line, then append a fresh blank line in Scanner mode so the
      // next scan has somewhere to land without the operator adding a line manually.
      const merged = mergeOrReplaceLineItem(itemId, populated)
      const blank = newPOLineItem()
      setLineItems([...merged, blank])
      setSearchModes(p => ({ ...p, [blank.id]: 'scanner' }))
      setScanInputs(p => {
        const n = { ...p }
        delete n[itemId]
        return n
      })
      prefillPurchaseUnit(itemId, s.product_id, s.variant_id || '', s.sub_variant_id || '')
      setScanMsg({ text: `✓ ${displayName}`, kind: 'ok' })
    } catch {
      setScanMsg({ text: 'Scan lookup failed', kind: 'err' })
    }
  }

  useEffect(() => {
    if (!scanMsg) return
    const t = setTimeout(() => setScanMsg(null), 2500)
    return () => clearTimeout(t)
  }, [scanMsg])

  // Prefill a line's base unit (from the product's stored sell unit) and its purchase
  // unit + factor (from the remembered supplier+product conversion). Base unit loads
  // regardless of supplier; the purchase-unit conversion needs a supplier. Only fills
  // fields still at their default so a manual entry is never clobbered.
  async function prefillPurchaseUnit(itemId: string, productId: string, variantId: string, subVariantId: string) {
    if (!productId) return
    try {
      const params = new URLSearchParams({ product_id: productId })
      if (form.supplier_id) params.set('supplier_id', form.supplier_id)
      if (variantId) params.set('variant_id', variantId)
      if (subVariantId) params.set('sub_variant_id', subVariantId)
      const res = await fetch(`/api/admin/inventory/po/purchase-unit?${params}`, { credentials: 'include' })
      const data = await res.json().catch(() => ({}))
      const c = data?.conversion
      const b = data?.baseUnit
      setLineItems(items =>
        items.map(r => {
          if (r.id !== itemId) return r
          let next = r
          // base unit: fill when the line hasn't got one yet
          if (b && b.unit && !r.sell_unit_label) {
            next = { ...next, sell_unit_label: b.label || b.unit, sell_unit_dimension: b.dimension || 'count' }
          }
          // purchase-unit conversion: fill when still at default
          if (
            c &&
            c.purchase_unit &&
            !next.purchase_unit &&
            (!next.purchase_unit_factor || next.purchase_unit_factor === '1')
          ) {
            next = { ...next, purchase_unit: c.purchase_unit, purchase_unit_factor: String(c.purchase_unit_factor) }
          }
          return next
        })
      )
    } catch {
      /* best-effort prefill */
    }
  }

  function applyPickerProduct(p: PickerProduct) {
    if (!pickerItemId) return
    const target = lineItems.find(it => it.id === pickerItemId)
    if (!target) return
    const displayName = p.variant_name ? `${p.name} — ${p.variant_name}` : p.name
    const populated: POLineItem = {
      ...target,
      product_id: p.product_id,
      product_name: displayName,
      sku: p.sku || '',
      variant_id: p.variant_id || '',
      sub_variant_id: p.sub_variant_id || '',
      tax_rate: p.gst_percentage != null ? String(Math.round(Number(p.gst_percentage))) : '0',
      hsn_code: p.hsn_code || '',
      mrp: Number(p.mrp) || 0,
      sell_unit_label: p.sell_unit_label || '',
      sell_unit_dimension: p.sell_unit_dimension || '',
    }
    const targetId = pickerItemId
    setLineItems(mergeOrReplaceLineItem(pickerItemId, populated))
    setPickerOpen(false)
    setPickerItemId(null)
    prefillPurchaseUnit(targetId, p.product_id, p.variant_id || '', p.sub_variant_id || '')
  }

  function clearProduct(itemId: string) {
    setLineItems(items =>
      items.map(it =>
        it.id !== itemId
          ? it
          : {
              ...it,
              product_id: '',
              product_name: '',
              sku: '',
              variant_id: '',
              tax_rate: '0',
              hsn_code: '',
              mrp: 0,
            }
      )
    )
    setNameInputs(p => {
      const n = { ...p }
      delete n[itemId]
      return n
    })
    setSkuInputs(p => {
      const n = { ...p }
      delete n[itemId]
      return n
    })
    setSearchModes(p => {
      const n = { ...p }
      delete n[itemId]
      return n
    })
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.supplier_id) {
      setError('Please select a supplier')
      return
    }
    setError('')
    setSaving(true)
    const items = lineItems
      .filter(it => it.product_id && parseFloat(it.quantity) > 0)
      .map(it => ({
        product_id: it.product_id,
        variant_id: it.variant_id || null,
        sub_variant_id: it.sub_variant_id || null,
        product_name: it.product_name,
        sku: it.sku,
        quantity: parseFloat(it.quantity),
        tax_rate: parseFloat(it.tax_rate) || 0,
        hsn_code: it.hsn_code,
        purchase_unit: it.purchase_unit || null,
        purchase_unit_factor: parseFloat(it.purchase_unit_factor) || 1,
        line_total_incl_gst: parseFloat(it.line_total_incl_gst) || 0,
        gst_inclusive: it.gst_inclusive,
      }))
    try {
      const res = await fetch('/api/admin/inventory/po', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, items }),
      })
      const json = await res.json()
      if (!res.ok) {
        showToast(json.error || 'Failed to create PO', 'error')
        setSaving(false)
        return
      }
      router.push(ap('/admin/inventory?tab=po'))
    } catch {
      showToast('Failed to create purchase order', 'error')
      setSaving(false)
    }
  }

  const taxableValue = lineItems.reduce((s, it) => {
    const gstRate = parseFloat(it.tax_rate) || 0
    const inclGst = parseFloat(it.line_total_incl_gst) || 0
    return s + (it.gst_inclusive ? inclGst / (1 + gstRate / 100) : inclGst)
  }, 0)
  const cgst = lineItems.reduce((s, it) => {
    const gstRate = parseFloat(it.tax_rate) || 0
    const inclGst = parseFloat(it.line_total_incl_gst) || 0
    const exGst = it.gst_inclusive ? inclGst / (1 + gstRate / 100) : inclGst
    return s + (exGst * gstRate) / 200
  }, 0)
  const sgst = cgst
  const rawTotal = taxableValue + cgst + sgst
  const poTotal = Math.round(rawTotal)
  const roundOff = poTotal - rawTotal

  return (
    <MobileEditBlock>
    <div className="p-4 sm:p-6">
      <div className="flex items-center gap-3 mb-6">
        <Link
          href={ap('/admin/inventory?tab=po')}
          className="p-1.5 text-foreground-secondary hover:text-foreground rounded-lg hover:bg-surface-secondary transition-colors"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-foreground">New Purchase Order</h1>
          <p className="text-foreground-secondary text-sm mt-0.5">Create a new PO for a supplier</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="bg-surface-elevated rounded-xl border border-border-default p-5 space-y-4">
          <h2 className="text-sm font-semibold text-foreground">Order Details</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className={labelCls}>
                Supplier <span className="text-red-500">*</span>
              </label>
              <AdminSelect
                sm
                value={form.supplier_id}
                onChange={v => setForm(p => ({ ...p, supplier_id: v }))}
                placeholder="Select supplier"
                options={[
                  { value: '', label: 'Select supplier' },
                  ...suppliers.map(s => ({ value: s.id, label: s.name })),
                ]}
              />
            </div>
            <div>
              <label className={labelCls}>Order Date</label>
              <DatePicker value={form.order_date} onChange={v => setForm(p => ({ ...p, order_date: v }))} />
            </div>
            <div>
              <label className={labelCls}>Expected Date</label>
              <DatePicker value={form.expected_date} onChange={v => setForm(p => ({ ...p, expected_date: v }))} />
            </div>
            <div>
              <label className={labelCls}>Status</label>
              <AdminSelect
                sm
                value={form.status}
                onChange={v => setForm(p => ({ ...p, status: v }))}
                options={[
                  { value: 'draft', label: 'Draft' },
                  { value: 'sent', label: 'Sent to Supplier' },
                ]}
              />
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>Notes</label>
              <input
                className={inputCls}
                value={form.notes}
                onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
                placeholder="Optional notes..."
              />
            </div>
          </div>
        </div>

        <div className="bg-surface-elevated rounded-xl border border-border-default p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">Line Items</h2>
            <div className="flex items-center gap-3">
              {scanMsg && (
                <span
                  className={`text-xs font-medium px-2 py-0.5 rounded ${scanMsg.kind === 'ok' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'}`}
                >
                  {scanMsg.text}
                </span>
              )}
              <button
                type="button"
                onClick={() => setScanEnabled(v => !v)}
                title={scanEnabled ? 'Barcode scanning on — scan SKU/lot/serial to add a line' : 'Barcode scanning off'}
                className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border transition-colors ${scanEnabled ? 'border-secondary-500 bg-secondary-50 dark:bg-secondary-900/20 text-secondary-700 dark:text-secondary-400' : 'border-border-default text-foreground-muted hover:bg-surface-secondary'}`}
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 5v14M8 5v14M12 5v14M16 5v14M20 5v14"
                  />
                </svg>
                {scanEnabled ? 'Scan: on' : 'Scan: off'}
              </button>
              <button
                type="button"
                disabled={!form.supplier_id}
                onClick={() => setLineItems(items => [...items, newPOLineItem()])}
                className="flex items-center gap-1 text-xs text-secondary-500 dark:text-secondary-300 font-semibold hover:text-secondary-600 dark:hover:text-secondary-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add Item
              </button>
            </div>
          </div>

          {!form.supplier_id ? (
            <div className="rounded-lg border border-dashed border-border-default bg-surface-secondary/50 px-4 py-8 text-center">
              <p className="text-sm font-medium text-foreground">Select a supplier first</p>
              <p className="text-xs text-foreground-muted mt-1">
                Choose a supplier above to add products and their purchase units.
              </p>
            </div>
          ) : (
            <>
              <div className="space-y-3">
                {lineItems.map((it, idx) => {
                  const mode = searchModes[it.id] ?? 'scanner'
                  const hasProduct = !!it.product_name
                  return (
                    <div key={it.id} className="border border-border-default rounded-lg p-3 space-y-3 bg-surface">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-foreground-muted uppercase tracking-wide">
                          Item {idx + 1}
                        </span>
                        {lineItems.length > 1 && (
                          <button
                            type="button"
                            className="text-xs text-red-500 hover:text-red-600 font-medium"
                            onClick={() => setLineItems(items => items.filter(r => r.id !== it.id))}
                          >
                            Remove
                          </button>
                        )}
                      </div>

                      {hasProduct ? (
                        <div className="flex items-center justify-between gap-2 px-3 py-2 bg-surface-secondary rounded-lg border border-border-default">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-foreground truncate">{it.product_name}</p>
                            {it.sku && (
                              <p className="text-xs text-foreground-muted mt-0.5 font-mono inline-flex items-center gap-1">
                                {it.sku}
                                <CopySku sku={it.sku} />
                              </p>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => clearProduct(it.id)}
                            className="shrink-0 text-xs text-secondary-500 dark:text-secondary-300 font-semibold hover:text-secondary-600 transition-colors"
                          >
                            Change
                          </button>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <div className="flex gap-1 p-1 bg-surface-secondary rounded-lg w-fit">
                            {(['name', 'sku', 'category', 'scanner'] as POSearchMode[]).map(m => (
                              <button
                                key={m}
                                type="button"
                                onClick={() => {
                                  setSearchModes(p => ({ ...p, [it.id]: m }))
                                  setNameInputs(p => {
                                    const n = { ...p }
                                    delete n[it.id]
                                    return n
                                  })
                                  setSkuInputs(p => {
                                    const n = { ...p }
                                    delete n[it.id]
                                    return n
                                  })
                                  setScanInputs(p => {
                                    const n = { ...p }
                                    delete n[it.id]
                                    return n
                                  })
                                }}
                                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${mode === m ? 'bg-secondary-500 dark:bg-secondary-400 text-white dark:text-secondary-900 shadow-sm' : 'text-foreground-secondary hover:text-foreground'}`}
                              >
                                {m === 'name'
                                  ? 'Name'
                                  : m === 'sku'
                                    ? 'SKU'
                                    : m === 'category'
                                      ? 'Category'
                                      : 'Scanner'}
                              </button>
                            ))}
                          </div>

                          {mode === 'name' && (
                            <AdminTypeahead
                              type="po_line_items"
                              value={nameInputs[it.id] ?? ''}
                              onChange={v => setNameInputs(p => ({ ...p, [it.id]: v }))}
                              onSelect={s => {
                                const d = decodePOLineItemId(s.id)
                                const sku = s.sublabel?.split(' · ')[0] ?? ''
                                const populated: POLineItem = {
                                  ...it,
                                  product_id: d.product_id,
                                  product_name: s.label,
                                  sku,
                                  variant_id: d.variant_id,
                                  sub_variant_id: d.sub_variant_id,
                                  tax_rate: d.tax_rate,
                                  hsn_code: d.hsn_code,
                                  sell_unit_label: d.sell_unit_label,
                                  sell_unit_dimension: d.sell_unit_dimension,
                                }
                                setLineItems(mergeOrReplaceLineItem(it.id, populated))
                                prefillPurchaseUnit(it.id, d.product_id, d.variant_id, d.sub_variant_id)
                              }}
                              inputClassName={inputCls}
                              placeholder="Search by product name..."
                            />
                          )}
                          {mode === 'sku' && (
                            <AdminTypeahead
                              type="po_line_items"
                              value={skuInputs[it.id] ?? ''}
                              onChange={v => setSkuInputs(p => ({ ...p, [it.id]: v }))}
                              onSelect={s => {
                                const d = decodePOLineItemId(s.id)
                                const sku = s.sublabel?.split(' · ')[0] ?? ''
                                const populated: POLineItem = {
                                  ...it,
                                  product_id: d.product_id,
                                  product_name: s.label,
                                  sku,
                                  variant_id: d.variant_id,
                                  sub_variant_id: d.sub_variant_id,
                                  tax_rate: d.tax_rate,
                                  hsn_code: d.hsn_code,
                                  sell_unit_label: d.sell_unit_label,
                                  sell_unit_dimension: d.sell_unit_dimension,
                                }
                                setLineItems(mergeOrReplaceLineItem(it.id, populated))
                                prefillPurchaseUnit(it.id, d.product_id, d.variant_id, d.sub_variant_id)
                              }}
                              inputClassName={inputCls + ' font-mono'}
                              placeholder="e.g. JFS-1234"
                            />
                          )}
                          {mode === 'category' && (
                            <div className="flex gap-2">
                              <div className="flex-1">
                                <AdminSelect
                                  sm
                                  value={categoryIds[it.id] ?? ''}
                                  onChange={v => setCategoryIds(p => ({ ...p, [it.id]: v }))}
                                  placeholder="— Select category —"
                                  options={categories.map(c => ({ value: c.id, label: c.name }))}
                                />
                              </div>
                              <button
                                type="button"
                                disabled={!categoryIds[it.id]}
                                onClick={() => openPicker(it.id, categoryIds[it.id] ?? '')}
                                className="px-3 py-2 bg-secondary-500 hover:bg-secondary-600 dark:bg-secondary-400 dark:hover:bg-secondary-300 dark:text-secondary-900 disabled:opacity-40 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap"
                              >
                                Select Product
                              </button>
                            </div>
                          )}
                          {mode === 'scanner' && (
                            <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-secondary-500 bg-secondary-50 dark:bg-secondary-900/20">
                              <svg
                                className="w-4 h-4 shrink-0 text-secondary-600 dark:text-secondary-400"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                                strokeWidth={2}
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  d="M4 5v14M8 5v14M12 5v14M16 5v14M20 5v14"
                                />
                              </svg>
                              <input
                                data-scan-box
                                type="text"
                                value={scanInputs[it.id] ?? ''}
                                onChange={e => setScanInputs(p => ({ ...p, [it.id]: e.target.value }))}
                                onKeyDown={e => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault()
                                    e.stopPropagation()
                                    fillScanLine(it.id, scanInputs[it.id] ?? '')
                                  }
                                }}
                                className="flex-1 bg-transparent border-none outline-none text-sm text-foreground placeholder:text-foreground-muted"
                                placeholder="Scan a SKU / lot / serial…"
                                autoComplete="off"
                                spellCheck={false}
                                autoFocus
                              />
                            </div>
                          )}
                        </div>
                      )}

                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        <div>
                          <label className={labelCls}>HSN Code</label>
                          <input
                            type="text"
                            value={it.hsn_code}
                            onChange={e =>
                              setLineItems(items =>
                                items.map(r => (r.id !== it.id ? r : { ...r, hsn_code: e.target.value }))
                              )
                            }
                            className={inputCls + ' font-mono'}
                            placeholder="9999"
                          />
                        </div>
                        <div>
                          <label className={labelCls}>Tax %</label>
                          <AdminSelect
                            sm
                            value={it.tax_rate}
                            onChange={v =>
                              setLineItems(items => items.map(r => (r.id !== it.id ? r : { ...r, tax_rate: v })))
                            }
                            options={[
                              { value: '0', label: '0%' },
                              { value: '5', label: '5%' },
                              { value: '12', label: '12%' },
                              { value: '18', label: '18%' },
                              { value: '28', label: '28%' },
                            ]}
                          />
                        </div>
                        <div>
                          <label className={labelCls}>
                            Qty ({it.purchase_unit || poLineBaseLabel(it)}) <span className="text-red-500">*</span>
                          </label>
                          <input
                            type="number"
                            min="0.001"
                            step="0.001"
                            className={inputCls}
                            value={it.quantity}
                            onChange={e =>
                              setLineItems(items =>
                                items.map(r => (r.id !== it.id ? r : { ...r, quantity: e.target.value }))
                              )
                            }
                          />
                        </div>
                      </div>

                      {(() => {
                        const gstRate = parseFloat(it.tax_rate) || 0
                        const factor = parseFloat(it.purchase_unit_factor) || 1
                        const qty = parseFloat(it.quantity) || 0
                        const baseQty = qty * factor
                        const lineInclGst = parseFloat(it.line_total_incl_gst) || 0
                        const totalExGst =
                          lineInclGst > 0 ? (it.gst_inclusive ? lineInclGst / (1 + gstRate / 100) : lineInclGst) : 0
                        const perPc = baseQty > 0 && totalExGst > 0 ? totalExGst / baseQty : 0
                        const gstAmt = (totalExGst * gstRate) / 100
                        return (
                          <div className="bg-surface-secondary rounded-lg border border-border-default p-3 space-y-3">
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                              <div>
                                <label className={labelCls}>Purchase Unit</label>
                                <AdminSelect
                                  sm
                                  value={it.purchase_unit}
                                  onChange={v =>
                                    setLineItems(items =>
                                      items.map(r => (r.id !== it.id ? r : { ...r, purchase_unit: v }))
                                    )
                                  }
                                  options={PURCHASE_UNITS}
                                />
                              </div>
                              <div>
                                <label className={labelCls}>
                                  {poLineBaseLabel(it)} per {it.purchase_unit || 'purchase unit'}{' '}
                                  <span className="text-red-500">*</span>
                                </label>
                                <input
                                  type="number"
                                  min="1"
                                  step="1"
                                  value={it.purchase_unit_factor}
                                  onChange={e =>
                                    setLineItems(items =>
                                      items.map(r =>
                                        r.id !== it.id ? r : { ...r, purchase_unit_factor: e.target.value }
                                      )
                                    )
                                  }
                                  className={inputCls}
                                  placeholder="200"
                                />
                                {factor > 0 && it.purchase_unit && (
                                  <p className="mt-1 text-xs text-foreground-muted">
                                    1 {it.purchase_unit} = {factor} {poLineBaseLabel(it)}
                                    {qty > 0 && (
                                      <span className="ml-1 text-secondary-500 dark:text-secondary-300">
                                        → {(qty * factor).toLocaleString('en-IN')} {poLineBaseLabel(it)} total
                                      </span>
                                    )}
                                  </p>
                                )}
                              </div>
                              <div>
                                <label className={labelCls}>
                                  Line total (₹) <span className="text-red-500">*</span>
                                  <span className="ml-1 text-foreground-muted normal-case font-normal">
                                    {it.gst_inclusive ? 'incl. GST' : 'excl. GST'}
                                  </span>
                                </label>
                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={it.line_total_incl_gst}
                                  onChange={e =>
                                    setLineItems(items =>
                                      items.map(r =>
                                        r.id !== it.id ? r : { ...r, line_total_incl_gst: e.target.value }
                                      )
                                    )
                                  }
                                  className={inputCls}
                                  placeholder="0.00"
                                />
                              </div>
                            </div>

                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() =>
                                  setLineItems(items =>
                                    items.map(r => (r.id !== it.id ? r : { ...r, gst_inclusive: !r.gst_inclusive }))
                                  )
                                }
                                className={`relative inline-flex h-4 w-7 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ${it.gst_inclusive ? 'bg-secondary-500 dark:bg-secondary-400' : 'bg-border-default'}`}
                                role="switch"
                                aria-checked={it.gst_inclusive}
                              >
                                <span
                                  className={`pointer-events-none inline-block h-3 w-3 rounded-full bg-white shadow ring-0 transition-transform duration-200 ${it.gst_inclusive ? 'translate-x-3' : 'translate-x-0'}`}
                                />
                              </button>
                              <span className="text-xs text-foreground-secondary">Amount includes GST</span>
                            </div>

                            {perPc > 0 && (
                              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 border-t border-border-default text-xs">
                                <div className="text-center p-2 bg-surface rounded-lg border border-border-default">
                                  <div className="text-foreground-muted mb-0.5">Base qty</div>
                                  <div className="font-semibold text-foreground">
                                    {baseQty.toLocaleString('en-IN')} {poLineBaseLabel(it)}
                                  </div>
                                </div>
                                <div className="text-center p-2 bg-surface rounded-lg border border-border-default">
                                  <div className="text-foreground-muted mb-0.5">Ex-GST total</div>
                                  <div className="font-semibold text-foreground">₹{fmtINR2(totalExGst)}</div>
                                </div>
                                <div className="text-center p-2 bg-surface rounded-lg border border-border-default">
                                  <div className="text-foreground-muted mb-0.5">Per {poLineBaseLabel(it)} (ex-GST)</div>
                                  <div className="font-semibold text-secondary-600 dark:text-secondary-300">
                                    ₹{fmtINR2(perPc)}
                                  </div>
                                </div>
                                <div className="text-center p-2 bg-surface rounded-lg border border-border-default">
                                  <div className="text-foreground-muted mb-0.5">GST ({it.tax_rate}%)</div>
                                  <div className="font-semibold text-foreground">₹{fmtINR2(gstAmt)}</div>
                                </div>
                              </div>
                            )}
                          </div>
                        )
                      })()}
                    </div>
                  )
                })}
              </div>

              {lineItems.length > 0 && (
                <button
                  type="button"
                  onClick={() => setLineItems([...lineItems, newPOLineItem()])}
                  className="mt-3 w-full flex items-center justify-center gap-1.5 py-2 rounded-lg border border-dashed border-border-default text-xs font-semibold text-secondary-500 dark:text-secondary-300 hover:bg-surface-secondary hover:border-secondary-400 transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Add Item
                </button>
              )}
            </>
          )}

          {lineItems.some(it => it.line_total_incl_gst) && (
            <div className="border-t border-border-default pt-3 mt-3 flex justify-end">
              <div className="text-right space-y-1 min-w-[220px]">
                <div className="flex justify-between text-xs text-foreground-secondary">
                  <span>Taxable Value</span>
                  <span>₹{fmtINR2(taxableValue)}</span>
                </div>
                <div className="flex justify-between text-xs text-foreground-secondary">
                  <span>CGST</span>
                  <span>₹{fmtINR2(cgst)}</span>
                </div>
                <div className="flex justify-between text-xs text-foreground-secondary">
                  <span>SGST</span>
                  <span>₹{fmtINR2(sgst)}</span>
                </div>
                {Math.abs(roundOff) >= 0.005 && (
                  <div className="flex justify-between text-xs text-foreground-secondary">
                    <span>Round Off</span>
                    <span>
                      {roundOff > 0 ? '+' : ''}₹{fmtINR2(roundOff)}
                    </span>
                  </div>
                )}
                <div className="flex justify-between text-sm font-bold text-foreground border-t border-border-default pt-1 mt-1">
                  <span>Total</span>
                  <span>{formatINR(poTotal)}</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 text-sm text-red-700 dark:text-red-300">
            {error}
          </div>
        )}

        <div className="flex gap-3">
          <RequireWrite scope="inventory">
            <button type="submit" disabled={saving || !form.supplier_id} className={btnPrimary}>
              {saving ? 'Creating...' : 'Create PO'}
            </button>
          </RequireWrite>
          <Link href={ap('/admin/inventory?tab=po')} className={btnSecondary}>
            Cancel
          </Link>
        </div>
      </form>

      {pickerOpen &&
        typeof document !== 'undefined' &&
        createPortal(
          <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/50">
            <div className="bg-surface-elevated border border-border-default rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col">
              <div className="flex items-center justify-between px-5 py-4 border-b border-border-default shrink-0">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">Select Product</h3>
                  <p className="text-xs text-foreground-muted mt-0.5">
                    {categories.find(c => c.id === pickerCatId)?.name || 'All products'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setPickerOpen(false)}
                  className="p-1.5 text-foreground-secondary hover:text-foreground transition-colors rounded-lg hover:bg-surface-secondary"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="px-5 py-3 border-b border-border-default shrink-0">
                <input
                  type="text"
                  value={pickerSearch}
                  onChange={e => {
                    setPickerSearch(e.target.value)
                    loadPickerProducts(pickerCatId, e.target.value)
                  }}
                  className={inputCls}
                  placeholder="Filter by name or SKU…"
                  autoFocus
                />
              </div>
              <div className="overflow-y-auto flex-1">
                {pickerLoading ? (
                  <div className="p-8 text-center text-foreground-muted text-sm">Loading…</div>
                ) : pickerResults.length === 0 ? (
                  <div className="p-8 text-center text-foreground-muted text-sm">
                    No products found in this category.
                  </div>
                ) : (
                  (() => {
                    const groups: { productId: string; name: string; items: PickerProduct[] }[] = []
                    for (const p of pickerResults) {
                      const g = groups.find(g => g.productId === p.product_id)
                      if (g) g.items.push(p)
                      else groups.push({ productId: p.product_id, name: p.name, items: [p] })
                    }
                    return (
                      <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-surface-secondary border-b border-border-default">
                          <tr>
                            <th className="px-4 py-2.5 text-left text-xs font-semibold text-foreground-secondary">
                              Product / Variant
                            </th>
                            <th className="px-4 py-2.5 text-left text-xs font-semibold text-foreground-secondary">
                              SKU
                            </th>
                            <th className="px-4 py-2.5 text-right text-xs font-semibold text-foreground-secondary">
                              Price
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {groups.map(g => (
                            <>
                              {g.items.length > 1 && (
                                <tr key={`${g.productId}-header`}>
                                  <td
                                    colSpan={3}
                                    className="px-4 pt-3 pb-1 text-xs font-semibold text-foreground-muted uppercase tracking-wider bg-surface-secondary"
                                  >
                                    {g.name}
                                  </td>
                                </tr>
                              )}
                              {g.items.map(p => (
                                <tr
                                  key={`${p.product_id}-${p.variant_id || ''}`}
                                  onClick={() => applyPickerProduct(p)}
                                  className="border-t border-border-default hover:bg-surface-secondary cursor-pointer transition-colors"
                                >
                                  <td className="px-4 py-2.5">
                                    {g.items.length > 1 ? (
                                      <span className="text-foreground pl-2">{p.variant_name || p.name}</span>
                                    ) : (
                                      <span className="font-medium text-foreground">{p.name}</span>
                                    )}
                                  </td>
                                  <td className="px-4 py-2.5 font-mono text-xs text-foreground-muted">
                                    <span className="inline-flex items-center gap-1">
                                      {p.sku}
                                      {p.sku && <CopySku sku={p.sku} />}
                                    </span>
                                  </td>
                                  <td className="px-4 py-2.5 text-right font-medium text-foreground">
                                    {p.base_price != null ? `₹${p.base_price}` : '—'}
                                  </td>
                                </tr>
                              ))}
                            </>
                          ))}
                        </tbody>
                      </table>
                    )
                  })()
                )}
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
    </MobileEditBlock>
  )
}
