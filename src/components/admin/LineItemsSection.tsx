'use client'

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import AdminSelect from '@/components/admin/AdminSelect'
import AdminTypeahead from '@/components/admin/AdminTypeahead'

export interface LineItem {
  id: string
  product_id: string | null
  product_name: string
  product_sku: string
  variant_id: string | null
  variant_name: string
  hsn_code: string
  gst_rate: string
  quantity: string | number
  unit: string
  unit_price: string | number
  discount_pct: number
  mrp: number
  inventory_quantity: number | null
}

interface Suggestion {
  id: string
  product_id: string
  variant_id: string | null
  name: string
  variant_name: string | null
  sku: string
  base_price: number | null
  mrp: number | null
  gst_percentage: number | null
  hsn_code: string | null
  inventory_quantity: number | null
}

interface Category {
  id: string
  name: string
}

type SearchMode = 'name' | 'sku' | 'category'

const UNITS = ['PCS', 'NOS', 'KG', 'MTR', 'LTR', 'BOX', 'SET', 'PKT', 'PAIR', 'RFT', 'SFT']

export function newLineItem(): LineItem {
  return {
    id: Math.random().toString(36).slice(2),
    product_id: null, product_name: '', product_sku: '',
    variant_id: null, variant_name: '',
    hsn_code: '', gst_rate: '18', quantity: 1, unit: 'PCS', unit_price: 0,
    discount_pct: 0, mrp: 0, inventory_quantity: null,
  }
}

function calcLine(it: LineItem) {
  return (Number(it.quantity) || 0) * (Number(it.unit_price) || 0)
}

function fmt(n: number) {
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function decodeLineItemId(encoded: string) {
  const [product_id, variant_id_raw, base_price_raw, gst_raw, hsn_raw, mrp_raw, inv_raw] = encoded.split('|')
  const unit_price = parseFloat(base_price_raw) || 0
  const mrp = parseFloat(mrp_raw) || 0
  const discount_pct = mrp > 0 && unit_price < mrp
    ? Math.round((1 - unit_price / mrp) * 100 * 100) / 100
    : 0
  return {
    product_id,
    variant_id: variant_id_raw || null,
    unit_price,
    discount_pct,
    mrp,
    gst_percentage: gst_raw ? String(Math.round(parseFloat(gst_raw))) : '18',
    hsn_code: hsn_raw || '',
    inventory_quantity: inv_raw !== undefined && inv_raw !== '' ? parseFloat(inv_raw) : null,
  }
}

const inputCls = 'w-full px-2 py-1.5 rounded border border-border-default bg-surface-secondary text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-secondary-500 dark:focus:ring-secondary-400 disabled:opacity-60 disabled:cursor-not-allowed'
const labelCls = 'block text-xs font-medium text-foreground-secondary mb-1'

interface LineItemsSectionProps {
  items: LineItem[]
  onChange: (items: LineItem[]) => void
}

export default function LineItemsSection({ items, onChange }: LineItemsSectionProps) {
  const [searchModes, setSearchModes] = useState<Record<string, SearchMode>>({})
  const [nameInputs, setNameInputs] = useState<Record<string, string>>({})
  const [skuInputs, setSkuInputs] = useState<Record<string, string>>({})
  const [categoryIds, setCategoryIds] = useState<Record<string, string>>({})

  const [categories, setCategories] = useState<Category[]>([])

  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerItemId, setPickerItemId] = useState<string | null>(null)
  const [pickerCatId, setPickerCatId] = useState('')
  const [pickerProducts, setPickerProducts] = useState<Suggestion[]>([])
  const [pickerLoading, setPickerLoading] = useState(false)
  const [pickerSearch, setPickerSearch] = useState('')

  useEffect(() => {
    fetch('/api/categories', { credentials: 'include' })
      .then(r => r.json())
      .then(d => setCategories(d.categories || d || []))
      .catch(() => {})
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
      const params = new URLSearchParams({ limit: '10000', category_id: catId })
      if (q.trim()) params.set('q', q.trim())
      const res = await fetch(`/api/admin/labels/products?${params}`, { credentials: 'include' })
      const data = await res.json()
      setPickerProducts(data.products || [])
    } catch { setPickerProducts([]) }
    finally { setPickerLoading(false) }
  }

  function buildLineItemFromSuggestion(it: LineItem, s: Suggestion): LineItem {
    const mrp = Number(s.mrp) || 0
    const basePrice = Number(s.base_price) || 0
    const discount_pct = mrp > 0 && basePrice < mrp
      ? Math.round((1 - basePrice / mrp) * 100 * 100) / 100
      : 0
    return {
      ...it,
      product_id: s.product_id,
      product_name: s.variant_name ? `${s.name} — ${s.variant_name}` : s.name,
      product_sku: s.sku,
      variant_id: s.variant_id,
      variant_name: s.variant_name || '',
      hsn_code: s.hsn_code || '',
      gst_rate: String(Math.round(Number(s.gst_percentage ?? 18))),
      unit_price: basePrice,
      discount_pct,
      mrp,
      inventory_quantity: s.inventory_quantity ?? null,
    }
  }

  function applyPickerProduct(s: Suggestion) {
    if (!pickerItemId) return
    onChange(items.map(it => it.id !== pickerItemId ? it : buildLineItemFromSuggestion(it, s)))
    setPickerOpen(false)
    setPickerItemId(null)
  }

  function clearProduct(itemId: string) {
    onChange(items.map(it => it.id !== itemId ? it : {
      ...it, product_id: null, product_name: '', product_sku: '',
      variant_id: null, variant_name: '', hsn_code: '', gst_rate: '18',
      unit_price: 0, discount_pct: 0, mrp: 0, inventory_quantity: null,
    }))
    setNameInputs(p => { const n = { ...p }; delete n[itemId]; return n })
    setSkuInputs(p => { const n = { ...p }; delete n[itemId]; return n })
    setSearchModes(p => { const n = { ...p }; delete n[itemId]; return n })
  }

  function updateItem(id: string, field: keyof LineItem, value: string) {
    onChange(items.map(it => it.id === id ? { ...it, [field]: value } : it))
  }

  const rawTotal = items.reduce((s, it) => s + calcLine(it), 0)
  const taxableValue = items.reduce((s, it) => s + calcLine(it) / (1 + (Number(it.gst_rate) || 0) / 100), 0)
  const cgst = items.reduce((s, it) => s + (calcLine(it) / (1 + (Number(it.gst_rate) || 0) / 100)) * (Number(it.gst_rate) || 0) / 200, 0)
  const sgst = cgst
  const total = Math.round(rawTotal)
  const roundOff = total - rawTotal

  return (
    <div className="bg-surface-elevated border border-border-default rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-foreground">Line Items</h2>
        <button type="button" onClick={() => onChange([...items, newLineItem()])}
          className="flex items-center gap-1 text-xs text-secondary-500 dark:text-secondary-300 font-semibold hover:text-secondary-600 dark:hover:text-secondary-200 transition-colors">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          + Add Item
        </button>
      </div>

      <div className="space-y-3">
        {items.map((item, idx) => {
          const mode = searchModes[item.id] ?? 'name'
          const hasProduct = !!item.product_name

          return (
            <div key={item.id} className="border border-border-default rounded-lg p-3 space-y-3 bg-surface-elevated">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-foreground-muted uppercase tracking-wide">Item {idx + 1}</span>
                {items.length > 1 && (
                  <button type="button" onClick={() => onChange(items.filter(i => i.id !== item.id))}
                    className="text-xs text-red-500 hover:text-red-600 font-medium">Remove</button>
                )}
              </div>

              <div className="relative">
                {hasProduct ? (
                  <div className="flex items-center justify-between gap-2 px-3 py-2 bg-surface-secondary rounded-lg border border-border-default">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{item.product_name}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        {item.product_sku && <p className="text-xs text-foreground-muted font-mono">{item.product_sku}</p>}
                        {item.inventory_quantity !== null && (
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
                      onClick={() => clearProduct(item.id)}
                      className="shrink-0 text-xs text-secondary-500 dark:text-secondary-300 font-semibold hover:text-secondary-600 dark:hover:text-secondary-200 transition-colors">
                      Change
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="flex gap-1 mb-2 p-1 bg-surface-secondary rounded-lg w-fit">
                      {(['name', 'sku', 'category'] as SearchMode[]).map(m => (
                        <button key={m} type="button"
                          onClick={() => {
                            setSearchModes(p => ({ ...p, [item.id]: m }))
                            setNameInputs(p => { const n = { ...p }; delete n[item.id]; return n })
                            setSkuInputs(p => { const n = { ...p }; delete n[item.id]; return n })
                          }}
                          className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${mode === m ? 'bg-secondary-500 dark:bg-secondary-400 text-white dark:text-secondary-900 shadow-sm' : 'text-foreground-secondary hover:text-foreground'}`}>
                          {m === 'name' ? 'Name' : m === 'sku' ? 'SKU' : 'Category'}
                        </button>
                      ))}
                    </div>

                    {mode === 'name' && (
                      <AdminTypeahead
                        type="line_items"
                        value={nameInputs[item.id] ?? ''}
                        onChange={v => setNameInputs(p => ({ ...p, [item.id]: v }))}
                        onSelect={s => {
                          const d = decodeLineItemId(s.id)
                          onChange(items.map(it => it.id !== item.id ? it : {
                            ...it,
                            product_id: d.product_id,
                            product_name: s.label,
                            product_sku: s.sublabel?.split(' · ')[0] ?? '',
                            variant_id: d.variant_id,
                            variant_name: s.label.includes(' — ') ? s.label.split(' — ')[1] : '',
                            hsn_code: d.hsn_code,
                            gst_rate: d.gst_percentage,
                            unit_price: d.unit_price,
                            discount_pct: d.discount_pct,
                            mrp: d.mrp,
                            inventory_quantity: d.inventory_quantity,
                          }))
                        }}
                        inputClassName={inputCls}
                        placeholder="Search by product name..."
                      />
                    )}

                    {mode === 'sku' && (
                      <AdminTypeahead
                        type="line_items"
                        value={skuInputs[item.id] ?? ''}
                        onChange={v => setSkuInputs(p => ({ ...p, [item.id]: v }))}
                        onSelect={s => {
                          const d = decodeLineItemId(s.id)
                          const sku = s.sublabel?.split(' · ')[0] ?? ''
                          onChange(items.map(it => it.id !== item.id ? it : {
                            ...it,
                            product_id: d.product_id,
                            product_name: s.label,
                            product_sku: sku,
                            variant_id: d.variant_id,
                            variant_name: s.label.includes(' — ') ? s.label.split(' — ')[1] : '',
                            hsn_code: d.hsn_code,
                            gst_rate: d.gst_percentage,
                            unit_price: d.unit_price,
                            discount_pct: d.discount_pct,
                            mrp: d.mrp,
                            inventory_quantity: d.inventory_quantity,
                          }))
                        }}
                        inputClassName={inputCls + ' font-mono'}
                        placeholder="e.g. JFS-1234"
                      />
                    )}

                    {mode === 'category' && (
                      <div className="flex gap-2">
                        <div className="flex-1">
                          <AdminSelect
                            value={categoryIds[item.id] ?? ''}
                            onChange={v => setCategoryIds(p => ({ ...p, [item.id]: v }))}
                            placeholder="— Select category —"
                            options={categories.map(c => ({ value: c.id, label: c.name }))}
                          />
                        </div>
                        <button type="button"
                          disabled={!categoryIds[item.id]}
                          onClick={() => openPicker(item.id, categoryIds[item.id] ?? '')}
                          className="px-3 py-1.5 bg-secondary-500 hover:bg-secondary-600 dark:bg-secondary-400 dark:hover:bg-secondary-300 dark:text-secondary-900 disabled:opacity-40 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap">
                          Select Product
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>

              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                <div>
                  <label className={labelCls}>HSN Code</label>
                  <input type="text" value={item.hsn_code} onChange={e => updateItem(item.id, 'hsn_code', e.target.value)}
                    className={inputCls + ' font-mono'} placeholder="9999" />
                </div>
                <div>
                  <label className={labelCls}>GST %</label>
                  <AdminSelect
                    value={item.gst_rate}
                    onChange={v => updateItem(item.id, 'gst_rate', v)}
                    className="[&_button]:!bg-surface-secondary [&_button]:!border-border-default [&_button]:!rounded [&_button]:!py-1.5 [&_button]:!px-2 [&_button]:!text-sm [&_button]:!w-full"
                    options={[
                      { value: '0', label: '0%' }, { value: '5', label: '5%' },
                      { value: '12', label: '12%' }, { value: '18', label: '18%' },
                      { value: '28', label: '28%' },
                    ]}
                  />
                </div>
                <div>
                  <label className={labelCls}>Quantity <span className="text-red-500">*</span></label>
                  <input type="number" min="0.001" step="any" value={item.quantity}
                    onChange={e => updateItem(item.id, 'quantity', e.target.value)} required className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Unit</label>
                  <div className="flex items-center gap-0.5 w-full px-2 py-1.5 rounded border border-border-default bg-surface-secondary">
                    <button type="button" onClick={() => {
                      const i = UNITS.indexOf(item.unit)
                      updateItem(item.id, 'unit', UNITS[(i - 1 + UNITS.length) % UNITS.length])
                    }} className="text-foreground-secondary hover:text-foreground transition-colors">
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
                    </button>
                    <span className="text-sm font-medium text-foreground flex-1 text-center tabular-nums">{item.unit || 'PCS'}</span>
                    <button type="button" onClick={() => {
                      const i = UNITS.indexOf(item.unit)
                      updateItem(item.id, 'unit', UNITS[(i + 1) % UNITS.length])
                    }} className="text-foreground-secondary hover:text-foreground transition-colors">
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                    </button>
                  </div>
                </div>
                <div>
                  <label className={labelCls}>Unit Price (incl. GST) <span className="text-red-500">*</span></label>
                  <input type="number" min="0" step="0.01" value={item.unit_price}
                    onChange={e => updateItem(item.id, 'unit_price', e.target.value)} required
                    className={inputCls} placeholder="0.00" />
                </div>
                <div>
                  <label className={labelCls}>Disc %</label>
                  <input type="number" min="0" max="100" step="any" value={item.discount_pct}
                    readOnly className={inputCls + ' bg-surface-elevated text-foreground-muted cursor-default'} placeholder="0" />
                </div>
              </div>

              {(Number(item.unit_price) > 0 || item.mrp > 0) && (
                <div className="flex items-center justify-between text-xs text-foreground-secondary">
                  {item.mrp > 0 && item.discount_pct > 0 ? (
                    <span>MRP: <span className="line-through text-foreground-muted">₹{fmt(item.mrp)}</span> · Disc: <span className="text-green-600 dark:text-green-400 font-medium">{item.discount_pct}%</span></span>
                  ) : <span />}
                  {Number(item.unit_price) > 0 ? (
                    <span>Line total: <span className="font-semibold text-foreground">₹{fmt(calcLine(item))}</span></span>
                  ) : null}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="flex justify-end border-t border-border-default pt-3 mt-1">
        <div className="text-right space-y-1 min-w-[220px]">
          <div className="flex justify-between gap-8 text-xs text-foreground-secondary">
            <span>Taxable Value</span>
            <span>₹{fmt(taxableValue)}</span>
          </div>
          <div className="flex justify-between gap-8 text-xs text-foreground-secondary">
            <span>CGST</span>
            <span>₹{fmt(cgst)}</span>
          </div>
          <div className="flex justify-between gap-8 text-xs text-foreground-secondary">
            <span>SGST</span>
            <span>₹{fmt(sgst)}</span>
          </div>
          {Math.abs(roundOff) >= 0.005 && (
            <div className="flex justify-between gap-8 text-xs text-foreground-secondary">
              <span>Round Off</span>
              <span>{roundOff >= 0 ? '+' : ''}₹{fmt(roundOff)}</span>
            </div>
          )}
          <div className="flex justify-between gap-8 border-t border-border-default pt-1 mt-1">
            <span className="text-xs text-foreground-secondary font-medium">Total (incl. GST)</span>
            <span className="text-xl font-bold text-foreground">₹{fmt(total)}</span>
          </div>
        </div>
      </div>

      {pickerOpen && typeof document !== 'undefined' && createPortal(
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
        </div>,
        document.body
      )}
    </div>
  )
}
