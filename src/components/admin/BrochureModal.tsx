'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'

type Mode = 'category' | 'brand'

interface Category {
  id: string
  name: string
  parent_category_id: string | null
}
interface Brand {
  id: string
  name: string
}
interface BrochureProduct {
  id: string
  name: string
  slug: string | null
  sku: string
  short_description: string | null
  mrp: number | null
  base_price: number | null
  brand_name: string | null
  category_name: string | null
  thumbnail_url: string | null
}

interface Props {
  open: boolean
  mode: Mode
  onClose: () => void
}

function rs(n: number | null): string {
  if (n == null) return '—'
  return 'Rs.' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/**
 * Admin brochure builder — 3 sections:
 *  1. Filter: category tree (category mode) OR brand list (brand mode).
 *  2. Products: live list from the section-1 selection, all pre-selected;
 *     admin deselects any to exclude them.
 *  3. Preview: HTML mock of the PDF rows (thumbnail, name/SKU/desc, QR, price).
 * Download posts the final productIds to /api/admin/brochure.
 */
export default function BrochureModal({ open, mode, onClose }: Props) {
  const [categories, setCategories] = useState<Category[]>([])
  const [brands, setBrands] = useState<Brand[]>([])
  const [loadingFilters, setLoadingFilters] = useState(false)

  const [selectedFilters, setSelectedFilters] = useState<Set<string>>(new Set())

  const [products, setProducts] = useState<BrochureProduct[]>([])
  const [loadingProducts, setLoadingProducts] = useState(false)
  const [selectedProducts, setSelectedProducts] = useState<Set<string>>(new Set())

  const [showPrices, setShowPrices] = useState(true)
  const [title, setTitle] = useState('')
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')

  const filterLabel = mode === 'category' ? 'Categories' : 'Brands'
  const reqSeq = useRef(0)

  // ── Load section-1 options ──
  useEffect(() => {
    if (!open) return
    setLoadingFilters(true)
    setError('')
    const url = mode === 'category' ? '/api/categories' : '/api/brands'
    fetch(url)
      .then(r => r.json())
      .then(d => {
        if (mode === 'category') setCategories(d.categories || [])
        else setBrands(d.brands || [])
      })
      .catch(() => setError(`Could not load ${mode === 'category' ? 'categories' : 'brands'}`))
      .finally(() => setLoadingFilters(false))
  }, [open, mode])

  // ── Reset all state when the popup closes ──
  useEffect(() => {
    if (open) { document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = '' } }
    setSelectedFilters(new Set())
    setProducts([])
    setSelectedProducts(new Set())
    setTitle('')
    setError('')
  }, [open])

  // ── Live-fetch section-2 products whenever section-1 selection changes ──
  useEffect(() => {
    if (!open) return
    if (selectedFilters.size === 0) {
      setProducts([])
      setSelectedProducts(new Set())
      return
    }
    const seq = ++reqSeq.current
    setLoadingProducts(true)
    const key = mode === 'category' ? 'categoryIds' : 'brandIds'
    const qs = Array.from(selectedFilters).map(id => `${key}=${encodeURIComponent(id)}`).join('&')
    fetch(`/api/admin/brochure/products?${qs}`)
      .then(r => r.json())
      .then(d => {
        if (seq !== reqSeq.current) return // a newer request superseded this one
        const rows: BrochureProduct[] = d.products || []
        setProducts(rows)
        setSelectedProducts(new Set(rows.map(p => p.id))) // all pre-selected
      })
      .catch(() => { if (seq === reqSeq.current) setError('Could not load products') })
      .finally(() => { if (seq === reqSeq.current) setLoadingProducts(false) })
  }, [open, mode, selectedFilters])

  const tree = useMemo(() => {
    const mains = categories.filter(c => !c.parent_category_id)
    const subsByParent = new Map<string, Category[]>()
    for (const c of categories) {
      if (c.parent_category_id) {
        const arr = subsByParent.get(c.parent_category_id) || []
        arr.push(c); subsByParent.set(c.parent_category_id, arr)
      }
    }
    const rows: { cat: Category; depth: number }[] = []
    for (const m of mains) {
      rows.push({ cat: m, depth: 0 })
      for (const sub of (subsByParent.get(m.id) || [])) rows.push({ cat: sub, depth: 1 })
    }
    const seen = new Set(rows.map(r => r.cat.id))
    for (const c of categories) if (!seen.has(c.id)) rows.push({ cat: c, depth: 0 })
    return rows
  }, [categories])

  const toggleFilter = useCallback((id: string) => {
    setSelectedFilters(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }, [])
  const toggleProduct = useCallback((id: string) => {
    setSelectedProducts(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }, [])

  const previewProducts = useMemo(
    () => products.filter(p => selectedProducts.has(p.id)),
    [products, selectedProducts]
  )

  const canGenerate = selectedProducts.size > 0 && !generating && !loadingProducts

  async function handleGenerate() {
    if (!canGenerate) return
    setError('')
    setGenerating(true)
    try {
      const res = await fetch('/api/admin/brochure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productIds: previewProducts.map(p => p.id),
          showPrices,
          title: title.trim() || undefined,
        }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || 'Failed to generate brochure')
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `brochure-${new Date().toISOString().slice(0, 10)}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e: any) {
      setError(e.message || 'Download failed')
    } finally {
      setGenerating(false)
    }
  }

  if (!open || typeof document === 'undefined') return null

  const filterOptions = mode === 'category'
    ? tree.map(({ cat, depth }) => ({ id: cat.id, name: cat.name, depth }))
    : brands.map(b => ({ id: b.id, name: b.name, depth: 0 }))

  const allFilterIds = mode === 'category' ? categories.map(c => c.id) : brands.map(b => b.id)

  return createPortal(
    <div className="fixed inset-0 z-[300] flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div
        className="relative bg-surface-elevated w-full sm:rounded-2xl rounded-t-2xl shadow-2xl max-h-[92vh] flex flex-col sm:max-w-5xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between px-5 pt-5 pb-4 border-b border-border-default shrink-0">
          <div className="min-w-0 pr-4">
            <h2 className="text-base font-bold text-foreground leading-tight">Generate Brochure</h2>
            <p className="text-sm text-foreground-muted mt-0.5">
              Pick {mode === 'category' ? 'categories / sub-categories' : 'brands'}, refine the products, then download the catalogue PDF
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-surface-secondary text-foreground-muted hover:text-foreground transition-colors shrink-0"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="overflow-y-auto flex-1 p-5">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* ── Section 1: filter ── */}
            <div className="min-w-0">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-foreground-secondary uppercase tracking-wide">1 · {filterLabel}</p>
                <div className="flex gap-2">
                  <button onClick={() => setSelectedFilters(new Set(allFilterIds))} className="text-[10px] text-accent-500 hover:text-accent-600">All</button>
                  <span className="text-foreground-muted text-[10px]">·</span>
                  <button onClick={() => setSelectedFilters(new Set())} className="text-[10px] text-foreground-muted hover:text-red-500">None</button>
                </div>
              </div>
              <div className="space-y-0.5 h-72 overflow-y-auto pr-1 border border-border-default rounded-lg p-1.5">
                {loadingFilters ? (
                  <div className="text-xs text-foreground-muted py-3 text-center">Loading…</div>
                ) : filterOptions.length === 0 ? (
                  <div className="text-xs text-foreground-muted py-3 text-center">No {filterLabel.toLowerCase()}</div>
                ) : filterOptions.map(opt => (
                  <label
                    key={opt.id}
                    className="flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer hover:bg-surface-secondary"
                    style={{ paddingLeft: opt.depth ? 22 : 8 }}
                  >
                    <input
                      type="checkbox"
                      checked={selectedFilters.has(opt.id)}
                      onChange={() => toggleFilter(opt.id)}
                      className="w-3.5 h-3.5 flex-shrink-0 accent-orange-500"
                    />
                    <span className={`text-sm truncate ${opt.depth ? 'text-foreground-secondary' : 'text-foreground font-medium'}`}>{opt.name}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* ── Section 2: products ── */}
            <div className="min-w-0">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-foreground-secondary uppercase tracking-wide">2 · Products</p>
                {products.length > 0 && (
                  <div className="flex gap-2">
                    <button onClick={() => setSelectedProducts(new Set(products.map(p => p.id)))} className="text-[10px] text-accent-500 hover:text-accent-600">All</button>
                    <span className="text-foreground-muted text-[10px]">·</span>
                    <button onClick={() => setSelectedProducts(new Set())} className="text-[10px] text-foreground-muted hover:text-red-500">None</button>
                  </div>
                )}
              </div>
              <div className="space-y-0.5 h-72 overflow-y-auto pr-1 border border-border-default rounded-lg p-1.5">
                {selectedFilters.size === 0 ? (
                  <div className="text-xs text-foreground-muted py-3 text-center px-2">Select {mode === 'category' ? 'a category' : 'a brand'} to list its products</div>
                ) : loadingProducts ? (
                  <div className="text-xs text-foreground-muted py-3 text-center">Loading products…</div>
                ) : products.length === 0 ? (
                  <div className="text-xs text-foreground-muted py-3 text-center">No products found</div>
                ) : products.map(p => (
                  <label key={p.id} className="flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer hover:bg-surface-secondary">
                    <input
                      type="checkbox"
                      checked={selectedProducts.has(p.id)}
                      onChange={() => toggleProduct(p.id)}
                      className="w-3.5 h-3.5 flex-shrink-0 accent-orange-500"
                    />
                    {p.thumbnail_url
                      ? <img src={p.thumbnail_url} alt="" className="w-7 h-7 rounded object-cover bg-surface-secondary flex-shrink-0" />
                      : <div className="w-7 h-7 rounded bg-surface-secondary flex-shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-foreground truncate">{p.name}</div>
                      <div className="text-xs text-foreground-muted truncate">{p.sku}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* ── Section 3: preview ── */}
            <div className="min-w-0">
              <p className="text-xs font-semibold text-foreground-secondary uppercase tracking-wide mb-2">3 · Preview</p>
              <div className="h-72 overflow-y-auto border border-border-default rounded-lg bg-white dark:bg-zinc-900">
                <div className="bg-[#3d6b00] text-white px-3 py-2">
                  <div className="text-[11px] font-bold uppercase truncate">{title.trim() || 'Product Brochure'}</div>
                  <div className="text-[8px] opacity-80 truncate">Jeffi Stores catalogue</div>
                </div>
                {previewProducts.length === 0 ? (
                  <div className="text-xs text-foreground-muted py-8 text-center px-3">Nothing selected yet</div>
                ) : (
                  <div>
                    {previewProducts.map((p, i) => (
                      <div key={p.id} className={`flex items-center gap-2 px-2 py-1.5 border-b border-gray-100 dark:border-zinc-800 ${i % 2 ? 'bg-[#fafcf5] dark:bg-zinc-800/40' : ''}`}>
                        {p.thumbnail_url
                          ? <img src={p.thumbnail_url} alt="" className="w-9 h-9 rounded object-cover bg-gray-100 flex-shrink-0" />
                          : <div className="w-9 h-9 rounded bg-gray-100 dark:bg-zinc-700 flex-shrink-0 flex items-center justify-center text-[6px] text-gray-400">No image</div>}
                        <div className="flex-1 min-w-0">
                          <div className="text-[10px] font-bold text-gray-900 dark:text-gray-100 truncate">{p.name}</div>
                          <div className="text-[8px] text-gray-500 truncate">SKU: {p.sku}{p.brand_name ? `  •  ${p.brand_name}` : ''}</div>
                          {p.short_description && <div className="text-[8px] text-gray-600 dark:text-gray-400 truncate">{p.short_description}</div>}
                        </div>
                        {showPrices && (
                          <div className="text-[10px] font-bold text-[#3d6b00] dark:text-green-400 shrink-0 text-right">{rs(p.base_price ?? p.mrp)}</div>
                        )}
                        {p.slug && (
                          <div className="w-8 h-8 shrink-0 grid place-items-center border border-gray-300 dark:border-zinc-600 rounded" title="QR → product page">
                            <svg viewBox="0 0 24 24" className="w-5 h-5 text-gray-700 dark:text-gray-300" fill="currentColor">
                              <path d="M3 3h8v8H3V3zm2 2v4h4V5H5zm8-2h8v8h-8V3zm2 2v4h4V5h-4zM3 13h8v8H3v-8zm2 2v4h4v-4H5zm13-2h3v2h-3v-2zm0 3h3v5h-5v-3h2v-2zm-5 0h3v3h-3v-3z" />
                            </svg>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Options row */}
          <div className="flex flex-col sm:flex-row gap-4 sm:items-end mt-4">
            <div className="flex-1">
              <p className="text-xs font-semibold text-foreground-secondary uppercase tracking-wide mb-2">Brochure title (optional)</p>
              <input
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                maxLength={120}
                placeholder="e.g. Summer Fastener Catalogue"
                className="w-full px-3 py-2 rounded-lg border border-border-default bg-surface-secondary text-foreground text-sm"
              />
            </div>
            <div className="shrink-0">
              <p className="text-xs font-semibold text-foreground-secondary uppercase tracking-wide mb-2">Prices</p>
              <label className="flex items-center gap-2 cursor-pointer select-none h-[38px]">
                <div
                  onClick={() => setShowPrices(v => !v)}
                  className={`relative w-9 h-5 rounded-full transition-colors cursor-pointer ${showPrices ? 'bg-orange-500' : 'bg-gray-200 dark:bg-zinc-600'}`}
                >
                  <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow-sm border border-gray-300 dark:border-zinc-500 transition-transform ${showPrices ? 'translate-x-4 border-orange-300' : 'translate-x-0.5'}`} />
                </div>
                <span className="text-xs text-foreground-secondary">{showPrices ? 'Show' : 'Hide'}</span>
              </label>
            </div>
          </div>

          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2 text-xs text-red-700 dark:text-red-400 mt-4">
              {error}
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-border-default shrink-0 flex items-center justify-between gap-3">
          <p className="text-xs text-foreground-muted">
            {selectedProducts.size} product{selectedProducts.size !== 1 ? 's' : ''} selected
          </p>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium border border-border-default rounded-lg text-foreground-secondary hover:bg-surface-secondary transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleGenerate}
              disabled={!canGenerate}
              title={selectedProducts.size === 0 ? 'Select at least one product' : ''}
              className="flex items-center gap-2 px-4 py-2 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-colors text-sm"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              {generating ? 'Generating…' : 'Download PDF'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
