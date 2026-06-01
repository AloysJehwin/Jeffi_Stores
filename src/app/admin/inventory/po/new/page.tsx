'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createPortal } from 'react-dom'
import AdminTypeahead from '@/components/admin/AdminTypeahead'
import AdminSelect from '@/components/admin/AdminSelect'
import DatePicker from '@/components/ui/DatePicker'

const inputCls = 'w-full px-3 py-2 rounded-lg border border-border-default bg-surface text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-secondary-500 focus:border-transparent transition-colors placeholder:text-foreground-muted'
const labelCls = 'block text-xs font-medium text-foreground-secondary mb-1'
const btnPrimary = 'px-4 py-2.5 rounded-lg text-sm font-medium bg-secondary-500 hover:bg-secondary-600 dark:bg-secondary-400 dark:hover:bg-secondary-300 text-white dark:text-secondary-900 transition-colors disabled:opacity-50'
const btnSecondary = 'px-4 py-2.5 rounded-lg text-sm font-medium border border-border-default bg-surface hover:bg-surface-secondary text-foreground transition-colors'

type Supplier = { id: string; name: string }
type POSearchMode = 'name' | 'sku' | 'category'

type POLineItem = {
  id: string; product_id: string; variant_id: string; product_name: string
  sku: string; quantity: string; unit_cost: string; tax_rate: string; hsn_code: string; mrp: number
}

type PickerProduct = {
  product_id: string; variant_id: string | null; name: string; variant_name: string | null
  sku: string; base_price: number | null; gst_percentage: number | null; hsn_code: string | null; mrp: number | null
}

function newPOLineItem(): POLineItem {
  return { id: Math.random().toString(36).slice(2), product_id: '', variant_id: '', product_name: '', sku: '', quantity: '1', unit_cost: '', tax_rate: '0', hsn_code: '', mrp: 0 }
}

function decodePOLineItemId(encoded: string) {
  const [product_id, variant_id_raw, , gst_raw, hsn_raw] = encoded.split('|')
  return { product_id, variant_id: variant_id_raw || '', tax_rate: gst_raw ? String(Math.round(parseFloat(gst_raw))) : '0', hsn_code: hsn_raw || '' }
}

function fmtINR2(n: number) {
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatINR(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)
}

export default function NewPOPage() {
  const router = useRouter()
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([])
  const [form, setForm] = useState({ supplier_id: '', order_date: '', expected_date: '', notes: '', status: 'draft' })
  const [lineItems, setLineItems] = useState<POLineItem[]>([newPOLineItem()])
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

  useEffect(() => {
    fetch('/api/admin/inventory/suppliers?limit=1000').then(r => r.json()).then(j => setSuppliers(j?.suppliers || []))
    fetch('/api/categories').then(r => r.json()).then(d => setCategories((d.categories || d || []).map((c: any) => ({ id: c.id, name: c.name }))))
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
    } catch { setPickerResults([]) }
    finally { setPickerLoading(false) }
  }

  function openPicker(itemId: string, catId: string) {
    setPickerItemId(itemId)
    setPickerCatId(catId)
    setPickerSearch('')
    setPickerResults([])
    setPickerOpen(true)
    loadPickerProducts(catId, '')
  }

  function applyPickerProduct(p: PickerProduct) {
    if (!pickerItemId) return
    const displayName = p.variant_name ? `${p.name} — ${p.variant_name}` : p.name
    setLineItems(items => items.map(it => it.id !== pickerItemId ? it : {
      ...it,
      product_id: p.product_id,
      product_name: displayName,
      sku: p.sku || '',
      variant_id: p.variant_id || '',
      tax_rate: p.gst_percentage != null ? String(Math.round(Number(p.gst_percentage))) : '0',
      hsn_code: p.hsn_code || '',
      mrp: Number(p.mrp) || 0,
    }))
    setPickerOpen(false)
    setPickerItemId(null)
  }

  function clearProduct(itemId: string) {
    setLineItems(items => items.map(it => it.id !== itemId ? it : {
      ...it, product_id: '', product_name: '', sku: '', variant_id: '', tax_rate: '0', hsn_code: '', mrp: 0,
    }))
    setNameInputs(p => { const n = { ...p }; delete n[itemId]; return n })
    setSkuInputs(p => { const n = { ...p }; delete n[itemId]; return n })
    setSearchModes(p => { const n = { ...p }; delete n[itemId]; return n })
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.supplier_id) { setError('Please select a supplier'); return }
    setError('')
    setSaving(true)
    const items = lineItems
      .filter(it => it.product_id && parseFloat(it.quantity) > 0)
      .map(it => ({
        product_id: it.product_id, variant_id: it.variant_id || null,
        product_name: it.product_name, sku: it.sku,
        quantity: parseFloat(it.quantity),
        unit_cost: parseFloat(it.unit_cost) || 0,
        tax_rate: parseFloat(it.tax_rate) || 0,
        hsn_code: it.hsn_code,
      }))
    try {
      const res = await fetch('/api/admin/inventory/po', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, items }),
      })
      const json = await res.json()
      if (!res.ok) { setError(json.error || 'Failed to create PO'); setSaving(false); return }
      router.push('/admin/inventory?tab=po')
    } catch {
      setError('Failed to create purchase order')
      setSaving(false)
    }
  }

  const taxableValue = lineItems.reduce((s, it) => s + (parseFloat(it.quantity) || 0) * (parseFloat(it.unit_cost) || 0), 0)
  const cgst = lineItems.reduce((s, it) => s + (parseFloat(it.quantity) || 0) * (parseFloat(it.unit_cost) || 0) * (parseFloat(it.tax_rate) || 0) / 200, 0)
  const sgst = cgst
  const rawTotal = taxableValue + cgst + sgst
  const poTotal = Math.round(rawTotal)
  const roundOff = poTotal - rawTotal

  return (
    <div className="p-4 sm:p-6">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/admin/inventory?tab=po" className="p-1.5 text-foreground-secondary hover:text-foreground rounded-lg hover:bg-surface-secondary transition-colors">
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
              <label className={labelCls}>Supplier <span className="text-red-500">*</span></label>
              <AdminSelect
                value={form.supplier_id}
                onChange={v => setForm(p => ({ ...p, supplier_id: v }))}
                placeholder="Select supplier"
                options={[{ value: '', label: 'Select supplier' }, ...suppliers.map(s => ({ value: s.id, label: s.name }))]}
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
                value={form.status}
                onChange={v => setForm(p => ({ ...p, status: v }))}
                options={[{ value: 'draft', label: 'Draft' }, { value: 'sent', label: 'Sent to Supplier' }]}
              />
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>Notes</label>
              <input className={inputCls} value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} placeholder="Optional notes..." />
            </div>
          </div>
        </div>

        <div className="bg-surface-elevated rounded-xl border border-border-default p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">Line Items</h2>
            <button type="button" onClick={() => setLineItems(items => [...items, newPOLineItem()])}
              className="flex items-center gap-1 text-xs text-secondary-500 dark:text-secondary-300 font-semibold hover:text-secondary-600 dark:hover:text-secondary-200 transition-colors">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
              Add Item
            </button>
          </div>

          <div className="space-y-3">
            {lineItems.map((it, idx) => {
              const mode = searchModes[it.id] ?? 'name'
              const hasProduct = !!it.product_name
              return (
                <div key={it.id} className="border border-border-default rounded-lg p-3 space-y-3 bg-surface">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-foreground-muted uppercase tracking-wide">Item {idx + 1}</span>
                    {lineItems.length > 1 && (
                      <button type="button" className="text-xs text-red-500 hover:text-red-600 font-medium"
                        onClick={() => setLineItems(items => items.filter(r => r.id !== it.id))}>Remove</button>
                    )}
                  </div>

                  {hasProduct ? (
                    <div className="flex items-center justify-between gap-2 px-3 py-2 bg-surface-secondary rounded-lg border border-border-default">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{it.product_name}</p>
                        {it.sku && <p className="text-xs text-foreground-muted mt-0.5 font-mono">{it.sku}</p>}
                      </div>
                      <button type="button" onClick={() => clearProduct(it.id)}
                        className="shrink-0 text-xs text-secondary-500 dark:text-secondary-300 font-semibold hover:text-secondary-600 transition-colors">
                        Change
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex gap-1 p-1 bg-surface-secondary rounded-lg w-fit">
                        {(['name', 'sku', 'category'] as POSearchMode[]).map(m => (
                          <button key={m} type="button"
                            onClick={() => {
                              setSearchModes(p => ({ ...p, [it.id]: m }))
                              setNameInputs(p => { const n = { ...p }; delete n[it.id]; return n })
                              setSkuInputs(p => { const n = { ...p }; delete n[it.id]; return n })
                            }}
                            className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${mode === m ? 'bg-secondary-500 dark:bg-secondary-400 text-white dark:text-secondary-900 shadow-sm' : 'text-foreground-secondary hover:text-foreground'}`}>
                            {m === 'name' ? 'Name' : m === 'sku' ? 'SKU' : 'Category'}
                          </button>
                        ))}
                      </div>

                      {mode === 'name' && (
                        <AdminTypeahead type="po_line_items" value={nameInputs[it.id] ?? ''}
                          onChange={v => setNameInputs(p => ({ ...p, [it.id]: v }))}
                          onSelect={s => {
                            const d = decodePOLineItemId(s.id)
                            const sku = s.sublabel?.split(' · ')[0] ?? ''
                            setLineItems(items => items.map(r => r.id !== it.id ? r : { ...r, product_id: d.product_id, product_name: s.label, sku, variant_id: d.variant_id, tax_rate: d.tax_rate, hsn_code: d.hsn_code }))
                          }}
                          inputClassName={inputCls} placeholder="Search by product name..." />
                      )}
                      {mode === 'sku' && (
                        <AdminTypeahead type="po_line_items" value={skuInputs[it.id] ?? ''}
                          onChange={v => setSkuInputs(p => ({ ...p, [it.id]: v }))}
                          onSelect={s => {
                            const d = decodePOLineItemId(s.id)
                            const sku = s.sublabel?.split(' · ')[0] ?? ''
                            setLineItems(items => items.map(r => r.id !== it.id ? r : { ...r, product_id: d.product_id, product_name: s.label, sku, variant_id: d.variant_id, tax_rate: d.tax_rate, hsn_code: d.hsn_code }))
                          }}
                          inputClassName={inputCls + ' font-mono'} placeholder="e.g. JFS-1234" />
                      )}
                      {mode === 'category' && (
                        <div className="flex gap-2">
                          <div className="flex-1">
                            <AdminSelect value={categoryIds[it.id] ?? ''} onChange={v => setCategoryIds(p => ({ ...p, [it.id]: v }))}
                              placeholder="— Select category —"
                              options={categories.map(c => ({ value: c.id, label: c.name }))} />
                          </div>
                          <button type="button" disabled={!categoryIds[it.id]}
                            onClick={() => openPicker(it.id, categoryIds[it.id] ?? '')}
                            className="px-3 py-2 bg-secondary-500 hover:bg-secondary-600 dark:bg-secondary-400 dark:hover:bg-secondary-300 dark:text-secondary-900 disabled:opacity-40 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap">
                            Select Product
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <div>
                      <label className={labelCls}>HSN Code</label>
                      <input type="text" value={it.hsn_code}
                        onChange={e => setLineItems(items => items.map(r => r.id !== it.id ? r : { ...r, hsn_code: e.target.value }))}
                        className={inputCls + ' font-mono'} placeholder="9999" />
                    </div>
                    <div>
                      <label className={labelCls}>Tax %</label>
                      <AdminSelect value={it.tax_rate}
                        onChange={v => setLineItems(items => items.map(r => r.id !== it.id ? r : { ...r, tax_rate: v }))}
                        options={[{ value: '0', label: '0%' }, { value: '5', label: '5%' }, { value: '12', label: '12%' }, { value: '18', label: '18%' }, { value: '28', label: '28%' }]} />
                    </div>
                    <div>
                      <label className={labelCls}>Quantity <span className="text-red-500">*</span></label>
                      <input type="number" min="0.001" step="0.001" className={inputCls} value={it.quantity}
                        onChange={e => setLineItems(items => items.map(r => r.id !== it.id ? r : { ...r, quantity: e.target.value }))} />
                    </div>
                    <div>
                      <label className={labelCls}>Unit Cost (₹) <span className="text-red-500">*</span></label>
                      <input type="number" min="0" step="0.01" className={inputCls} value={it.unit_cost}
                        onChange={e => setLineItems(items => items.map(r => r.id !== it.id ? r : { ...r, unit_cost: e.target.value }))} />
                    </div>
                  </div>

                  {it.unit_cost && (
                    <p className="text-xs text-foreground-secondary text-right">
                      Line total: <span className="font-semibold text-foreground">₹{fmtINR2((parseFloat(it.quantity) || 0) * (parseFloat(it.unit_cost) || 0) * (1 + (parseFloat(it.tax_rate) || 0) / 100))}</span>
                      {parseFloat(it.tax_rate) > 0 && <span className="ml-1 text-foreground-muted">(incl. {it.tax_rate}% GST)</span>}
                    </p>
                  )}
                </div>
              )
            })}
          </div>

          {lineItems.some(it => it.unit_cost) && (
            <div className="border-t border-border-default pt-3 mt-3 flex justify-end">
              <div className="text-right space-y-1 min-w-[220px]">
                <div className="flex justify-between text-xs text-foreground-secondary"><span>Taxable Value</span><span>₹{fmtINR2(taxableValue)}</span></div>
                <div className="flex justify-between text-xs text-foreground-secondary"><span>CGST</span><span>₹{fmtINR2(cgst)}</span></div>
                <div className="flex justify-between text-xs text-foreground-secondary"><span>SGST</span><span>₹{fmtINR2(sgst)}</span></div>
                {Math.abs(roundOff) >= 0.005 && (
                  <div className="flex justify-between text-xs text-foreground-secondary"><span>Round Off</span><span>{roundOff > 0 ? '+' : ''}₹{fmtINR2(roundOff)}</span></div>
                )}
                <div className="flex justify-between text-sm font-bold text-foreground border-t border-border-default pt-1 mt-1"><span>Total</span><span>{formatINR(poTotal)}</span></div>
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
          <button type="submit" disabled={saving || !form.supplier_id} className={btnPrimary}>
            {saving ? 'Creating...' : 'Create PO'}
          </button>
          <Link href="/admin/inventory?tab=po" className={btnSecondary}>
            Cancel
          </Link>
        </div>
      </form>

      {pickerOpen && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/50">
          <div className="bg-surface-elevated border border-border-default rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border-default shrink-0">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Select Product</h3>
                <p className="text-xs text-foreground-muted mt-0.5">{categories.find(c => c.id === pickerCatId)?.name || 'All products'}</p>
              </div>
              <button type="button" onClick={() => setPickerOpen(false)} className="p-1.5 text-foreground-secondary hover:text-foreground transition-colors rounded-lg hover:bg-surface-secondary">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="px-5 py-3 border-b border-border-default shrink-0">
              <input type="text" value={pickerSearch}
                onChange={e => { setPickerSearch(e.target.value); loadPickerProducts(pickerCatId, e.target.value) }}
                className={inputCls} placeholder="Filter by name or SKU…" autoFocus />
            </div>
            <div className="overflow-y-auto flex-1">
              {pickerLoading ? (
                <div className="p-8 text-center text-foreground-muted text-sm">Loading…</div>
              ) : pickerResults.length === 0 ? (
                <div className="p-8 text-center text-foreground-muted text-sm">No products found in this category.</div>
              ) : (() => {
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
                        <th className="px-4 py-2.5 text-left text-xs font-semibold text-foreground-secondary">Product / Variant</th>
                        <th className="px-4 py-2.5 text-left text-xs font-semibold text-foreground-secondary">SKU</th>
                        <th className="px-4 py-2.5 text-right text-xs font-semibold text-foreground-secondary">Price</th>
                      </tr>
                    </thead>
                    <tbody>
                      {groups.map(g => (
                        <>
                          {g.items.length > 1 && (
                            <tr key={`${g.productId}-header`}>
                              <td colSpan={3} className="px-4 pt-3 pb-1 text-xs font-semibold text-foreground-muted uppercase tracking-wider bg-surface-secondary">{g.name}</td>
                            </tr>
                          )}
                          {g.items.map(p => (
                            <tr key={`${p.product_id}-${p.variant_id || ''}`}
                              onClick={() => applyPickerProduct(p)}
                              className="border-t border-border-default hover:bg-surface-secondary cursor-pointer transition-colors">
                              <td className="px-4 py-2.5">
                                {g.items.length > 1 ? <span className="text-foreground pl-2">{p.variant_name || p.name}</span> : <span className="font-medium text-foreground">{p.name}</span>}
                              </td>
                              <td className="px-4 py-2.5 font-mono text-xs text-foreground-muted">{p.sku}</td>
                              <td className="px-4 py-2.5 text-right font-medium text-foreground">{p.base_price != null ? `₹${p.base_price}` : '—'}</td>
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
