'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { createPortal } from 'react-dom'
import AdminSelect from '@/components/admin/AdminSelect'

export interface LineItem {
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

type SearchMode = 'name' | 'sku' | 'category'

export function newLineItem(): LineItem {
  return {
    id: Math.random().toString(36).slice(2),
    product_id: null, product_name: '', product_sku: '',
    variant_id: null, variant_name: '',
    hsn_code: '', gst_rate: '18', quantity: '1', unit_price: '',
  }
}

export function calcLineTotal(item: LineItem) {
  return (parseFloat(item.quantity) || 0) * (parseFloat(item.unit_price) || 0)
}

interface Props {
  items: LineItem[]
  onChange: (items: LineItem[]) => void
  categories?: Category[]
  disabled?: boolean
  inputCls?: string
  labelCls?: string
}

const defaultInputCls = 'w-full px-2 py-1.5 rounded border border-border-default bg-surface-secondary text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-secondary-500 dark:focus:ring-secondary-400 disabled:opacity-60 disabled:cursor-not-allowed'
const defaultLabelCls = 'block text-xs font-medium text-foreground-secondary mb-1'

export default function LineItemsSection({ items, onChange, categories: categoriesProp, disabled, inputCls = defaultInputCls, labelCls = defaultLabelCls }: Props) {
  const [searchMode, setSearchMode] = useState<SearchMode>('name')
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [activeItemId, setActiveItemId] = useState<string | null>(null)
  const [skuInput, setSkuInput] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerItemId, setPickerItemId] = useState<string | null>(null)
  const [pickerCatId, setPickerCatId] = useState('')
  const [pickerProducts, setPickerProducts] = useState<Suggestion[]>([])
  const [pickerLoading, setPickerLoading] = useState(false)
  const [pickerSearch, setPickerSearch] = useState('')

  const [categories, setCategories] = useState<Category[]>(categoriesProp || [])

  useEffect(() => {
    if (categoriesProp) { setCategories(categoriesProp); return }
    fetch('/api/categories', { credentials: 'include' })
      .then(r => r.json())
      .then(d => setCategories(d.categories || d || []))
      .catch(() => {})
  }, [categoriesProp])

  const searchProducts = useCallback((query: string, itemId: string) => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    if (!query.trim()) { setSuggestions([]); return }
    searchTimerRef.current = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ limit: '10' })
        if (query.trim()) params.set('q', query.trim())
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

  function applyProduct(itemId: string, s: Suggestion) {
    onChange(items.map(it => it.id !== itemId ? it : {
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

  function applyPickerProduct(s: Suggestion) {
    if (!pickerItemId) return
    applyProduct(pickerItemId, s)
    setPickerOpen(false)
    setPickerItemId(null)
  }

  function updateItem(id: string, field: keyof LineItem, value: string) {
    onChange(items.map(it => it.id === id ? { ...it, [field]: value } : it))
  }

  const subtotal = items.reduce((s, it) => s + calcLineTotal(it), 0)
  const fmtNum = (n: number) => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  return (
    <>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-foreground">Line Items</h2>
        <button type="button" disabled={disabled}
          onClick={() => onChange([...items, newLineItem()])}
          className="flex items-center gap-1 text-xs text-secondary-500 dark:text-secondary-300 font-semibold hover:text-secondary-600 dark:hover:text-secondary-200 transition-colors disabled:opacity-40">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add Item
        </button>
      </div>

      <div className="flex gap-1 mb-3 p-1 bg-surface-secondary rounded-lg w-fit">
        {(['name', 'sku', 'category'] as SearchMode[]).map(m => (
          <button key={m} type="button"
            onClick={() => { setSearchMode(m); setSuggestions([]); setSkuInput(''); setCategoryId('') }}
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
                <button type="button" disabled={disabled}
                  onClick={() => onChange(items.filter(i => i.id !== item.id))}
                  className="text-xs text-red-500 hover:text-red-600 font-medium disabled:opacity-40">Remove</button>
              )}
            </div>

            <div className="relative">
              {searchMode === 'name' && (
                <>
                  <label className={labelCls}>Product / Description <span className="text-red-500">*</span></label>
                  <input type="text" value={item.product_name} disabled={disabled}
                    onChange={e => { updateItem(item.id, 'product_name', e.target.value); searchProducts(e.target.value, item.id) }}
                    onFocus={() => item.product_name && searchProducts(item.product_name, item.id)}
                    onBlur={() => setTimeout(() => { setSuggestions([]); setActiveItemId(null) }, 200)}
                    required className={inputCls} placeholder="Search by product name…" />
                </>
              )}

              {searchMode === 'sku' && (
                <>
                  <label className={labelCls}>Search by SKU</label>
                  <input type="text" value={activeItemId === item.id ? skuInput : ''} disabled={disabled}
                    onChange={e => { setSkuInput(e.target.value); setActiveItemId(item.id); searchProducts(e.target.value, item.id) }}
                    onFocus={() => setActiveItemId(item.id)}
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
                    <button type="button" disabled={!categoryId || disabled}
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
                <input type="text" value={item.hsn_code} disabled={disabled}
                  onChange={e => updateItem(item.id, 'hsn_code', e.target.value)}
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
                <input type="number" min="0.001" step="any" value={item.quantity} disabled={disabled}
                  onChange={e => updateItem(item.id, 'quantity', e.target.value)} required className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Unit Price (incl. GST) <span className="text-red-500">*</span></label>
                <input type="number" min="0" step="0.01" value={item.unit_price} disabled={disabled}
                  onChange={e => updateItem(item.id, 'unit_price', e.target.value)} required
                  className={inputCls} placeholder="0.00" />
              </div>
            </div>

            {item.unit_price && (
              <p className="text-xs text-foreground-secondary text-right">
                Line total: <span className="font-semibold text-foreground">₹{fmtNum(calcLineTotal(item))}</span>
              </p>
            )}
          </div>
        ))}
      </div>

      <div className="flex justify-end border-t border-border-default pt-3 mt-1">
        <div className="text-right">
          <p className="text-xs text-foreground-secondary">Total (incl. GST)</p>
          <p className="text-xl font-bold text-foreground">₹{fmtNum(subtotal)}</p>
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
              <input type="text" value={pickerSearch}
                onChange={e => { setPickerSearch(e.target.value); loadPickerProducts(pickerCatId, e.target.value) }}
                className={defaultInputCls}
                placeholder="Filter by name or SKU…"
                autoFocus />
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
    </>
  )
}
