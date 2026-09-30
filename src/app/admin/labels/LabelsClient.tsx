'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { createPortal } from 'react-dom'
import { LabelSpec, LabelSize } from '@/lib/label-sizes'
import AdminSelect, { SelectOption } from '@/components/admin/AdminSelect'
import BatchSerialLabels from '@/components/admin/BatchSerialLabels'
import { LabelPreview, fmtPrice, type PreviewProduct } from '@/components/admin/label-preview'
import CopySku from '@/components/ui/CopySku'

function Highlight({ text, query }: { text: string; query: string }) {
  const trimmed = query.trim()
  if (!trimmed) return <>{text}</>
  const words = trimmed.split(/\s+/).filter(Boolean)
  const pattern = new RegExp(`(${words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi')
  const parts = text.split(pattern)
  if (parts.length === 1) return <>{text}</>
  return (
    <>
      {parts.map((part, i) =>
        pattern.test(part) ? (
          <mark
            key={i}
            className="bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300 rounded-sm not-italic font-semibold"
          >
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  )
}

interface Category {
  id: string
  name: string
  parent_category_id: string | null
}

interface ProductResult {
  id: string
  product_id?: string
  variant_id?: string | null
  name: string
  variant_name?: string | null
  sku: string
  slug: string
  mrp: number | null
  price_ex_gst: number | null
  base_price: number
  gst_percentage: number
  brand_name: string | null
  gtin: string | null
}

interface SelectedProduct extends ProductResult {
  copies: number
}

interface Props {
  labelSizes: LabelSpec[]
  categories: Category[]
}

export default function LabelsClient({ labelSizes, categories }: Props) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const TAB_KEYS = ['product', 'batch', 'serial'] as const
  type LabelTab = (typeof TAB_KEYS)[number]
  const urlTab = searchParams.get('tab') as LabelTab | null
  const [labelTab, setLabelTab] = useState<LabelTab>(urlTab && TAB_KEYS.includes(urlTab) ? urlTab : 'product')

  // Keep the tab in the URL so browser back/forward (and swipe-back) move between
  // tabs. Sync FROM the URL when it changes externally (back/forward navigation).
  useEffect(() => {
    const t = searchParams.get('tab') as LabelTab | null
    const next = t && TAB_KEYS.includes(t) ? t : 'product'
    setLabelTab(prev => (prev === next ? prev : next))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  function changeTab(t: LabelTab) {
    setLabelTab(t)
    const params = new URLSearchParams(searchParams.toString())
    params.set('tab', t)
    router.push(`${pathname}?${params.toString()}`, { scroll: false })
  }

  const [selectedSize, setSelectedSize] = useState<LabelSize>('40x60')
  const [outputMode, setOutputMode] = useState<'thermal' | 'sheet'>('thermal')
  const [copies, setCopies] = useState(1)
  const [query, setQuery] = useState('')
  const [selectedMainCat, setSelectedMainCat] = useState('')
  const [selectedSubCat, setSelectedSubCat] = useState('')
  const [searchResults, setSearchResults] = useState<ProductResult[]>([])
  const [searching, setSearching] = useState(false)
  const [selectedProducts, setSelectedProducts] = useState<SelectedProduct[]>([])
  const [previewIndex, setPreviewIndex] = useState(0)
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState('')
  const [showPrice, setShowPrice] = useState(false)
  const [qrAction, setQrAction] = useState(false)
  const debounceRef = useRef<NodeJS.Timeout | null>(null)

  const [taItems, setTaItems] = useState<{ id: string; label: string; sublabel?: string }[]>([])
  const [taOpen, setTaOpen] = useState(false)
  const [taIndex, setTaIndex] = useState(-1)
  const [taRect, setTaRect] = useState<DOMRect | null>(null)
  const taDebounceRef = useRef<NodeJS.Timeout | null>(null)
  const taAbortRef = useRef<AbortController | null>(null)
  const taInputRef = useRef<HTMLInputElement | null>(null)

  const mainCategories = categories.filter(c => !c.parent_category_id)
  const subCategories = selectedMainCat ? categories.filter(c => c.parent_category_id === selectedMainCat) : []

  const activeCategoryId = selectedSubCat || selectedMainCat

  const activeSize = labelSizes.find(s => s.size === selectedSize)!

  const PREVIEW_MAX_W = 200
  const PREVIEW_MAX_H = 240
  const previewScale = Math.min(PREVIEW_MAX_W / activeSize.widthPt, PREVIEW_MAX_H / activeSize.heightPt)
  const previewW = Math.round(activeSize.widthPt * previewScale)
  const previewH = Math.round(activeSize.heightPt * previewScale)

  const search = useCallback(async (q: string, catId: string) => {
    setSearching(true)
    try {
      const params = new URLSearchParams({ q, limit: '40' })
      if (catId) params.set('category_id', catId)
      const res = await fetch(`/api/admin/labels/products?${params}`)
      const data = await res.json()
      setSearchResults(data.products || [])
    } catch {
      setSearchResults([])
    } finally {
      setSearching(false)
    }
  }, [])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => search(query, activeCategoryId), 280)
  }, [query, activeCategoryId, search])

  useEffect(() => {
    search('', '')
  }, [search])

  useEffect(() => {
    setPreviewIndex(0)
  }, [selectedProducts.length])

  function onMainCatChange(id: string) {
    setSelectedMainCat(id)
    setSelectedSubCat('')
  }

  function toggleProduct(p: ProductResult) {
    setSelectedProducts(prev => {
      const exists = prev.find(sp => sp.id === p.id)
      if (exists) return prev.filter(sp => sp.id !== p.id)
      return [...prev, { ...p, copies: 1 }]
    })
  }

  function fetchTypeahead(q: string) {
    if (taAbortRef.current) taAbortRef.current.abort()
    if (q.length < 2) {
      setTaItems([])
      setTaOpen(false)
      return
    }
    const ctrl = new AbortController()
    taAbortRef.current = ctrl
    fetch(`/api/admin/suggest?type=label_products&q=${encodeURIComponent(q)}`, {
      signal: ctrl.signal,
      credentials: 'include',
    })
      .then(r => r.json())
      .then(d => {
        setTaItems(d.items || [])
        setTaOpen((d.items || []).length > 0)
        setTaIndex(-1)
      })
      .catch(() => {})
  }

  function selectTaItem(item: { id: string; label: string; sublabel?: string }) {
    const parts = item.id.split('\x1f')
    const p: ProductResult = {
      id: parts[0] ?? '',
      name: parts[1] ?? '',
      variant_name: parts[2] || null,
      sku: parts[3] ?? '',
      slug: parts[4] ?? '',
      mrp: parts[5] ? parseFloat(parts[5]) : null,
      price_ex_gst: parts[6] ? parseFloat(parts[6]) : null,
      base_price: parts[7] ? parseFloat(parts[7]) : 0,
      gst_percentage: parts[8] ? parseFloat(parts[8]) : 0,
      brand_name: parts[9] || null,
      gtin: parts[10] || null,
    }
    toggleProduct(p)
    setQuery('')
    setTaItems([])
    setTaOpen(false)
  }

  function updateProductCopies(id: string, c: number) {
    setSelectedProducts(prev => prev.map(p => (p.id === id ? { ...p, copies: Math.max(1, Math.min(100, c)) } : p)))
  }

  async function handleDownload() {
    if (selectedProducts.length === 0) return
    setError('')
    setDownloading(true)
    try {
      const res = await fetch('/api/admin/labels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_ids: selectedProducts.flatMap(p => Array(p.copies * copies).fill(p.id)),
          size: selectedSize,
          copies: 1,
          sheet: outputMode === 'sheet',
          showPrice,
          qrAction,
        }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to generate labels')
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `labels-${selectedSize}-${new Date().toISOString().slice(0, 10)}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e: any) {
      setError(e.message || 'Download failed')
    } finally {
      setDownloading(false)
    }
  }

  const totalLabels = selectedProducts.reduce((sum, p) => sum + p.copies, 0) * copies
  const safePreviewIdx = Math.min(previewIndex, Math.max(0, selectedProducts.length - 1))
  const previewProduct = selectedProducts.length > 0 ? selectedProducts[safePreviewIdx] : searchResults[0] || null

  const RULER_LEFT = 28 // px reserved for y-axis ruler

  return (
    <div className="space-y-5">
      {/* Label type tabs */}
      <div className="flex items-center gap-1 border-b border-border-default">
        {(
          [
            { key: 'product', label: 'Product' },
            { key: 'batch', label: 'Batch product' },
            { key: 'serial', label: 'Serial product' },
          ] as const
        ).map(t => (
          <button
            key={t.key}
            type="button"
            onClick={() => changeTab(t.key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${labelTab === t.key ? 'border-orange-500 text-orange-600 dark:text-orange-400' : 'border-transparent text-foreground-secondary hover:text-foreground'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {labelTab === 'batch' && <BatchSerialLabels mode="batch" labelSizes={labelSizes} />}
      {labelTab === 'serial' && <BatchSerialLabels mode="serial" labelSizes={labelSizes} />}

      {labelTab === 'product' && (
        <div className="flex flex-col xl:flex-row gap-6 items-start">
          {/* ── Left panel ── */}
          <div className="flex-1 min-w-0 space-y-4">
            {/* Size selector */}
            <div className="bg-surface-elevated border border-border-default rounded-xl p-4">
              <h2 className="text-sm font-semibold text-foreground mb-3">Label Size</h2>
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                {labelSizes
                  .filter(spec => spec.size !== 'shelf-card')
                  .map(spec => {
                    const isActive = spec.size === selectedSize
                    const maxDim = Math.max(spec.widthMm, spec.heightMm)
                    const rW = Math.round((spec.widthMm / maxDim) * 34)
                    const rH = Math.round((spec.heightMm / maxDim) * 34)
                    return (
                      <button
                        key={spec.size}
                        onClick={() => setSelectedSize(spec.size)}
                        className={`flex flex-col items-center gap-2 py-3 px-2 rounded-lg border-2 transition-all ${
                          isActive
                            ? 'border-orange-500 bg-orange-50 dark:bg-orange-900/20'
                            : 'border-border-default hover:border-orange-300 bg-surface-secondary'
                        }`}
                      >
                        <div className="flex items-center justify-center h-9 w-full">
                          <div
                            style={{ width: rW, height: rH }}
                            className={`border-2 rounded-sm transition-colors ${
                              isActive
                                ? 'border-orange-500 bg-orange-100 dark:bg-orange-800/30'
                                : 'border-border-strong'
                            }`}
                          />
                        </div>
                        <span
                          className={`text-[11px] font-semibold leading-tight text-center ${
                            isActive ? 'text-orange-600 dark:text-orange-400' : 'text-foreground-secondary'
                          }`}
                        >
                          {spec.label}
                        </span>
                      </button>
                    )
                  })}
              </div>
            </div>

            {/* Output + copies */}
            <div className="bg-surface-elevated border border-border-default rounded-xl p-4 flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                {(['thermal', 'sheet'] as const).map(m => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setOutputMode(m)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${outputMode === m ? 'border-orange-500 bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400' : 'border-border-default text-foreground-secondary hover:bg-surface-secondary'}`}
                  >
                    {m === 'thermal' ? 'Thermal (1/page)' : 'A4 sheet'}
                  </button>
                ))}
              </div>
              <label className="flex items-center gap-2 text-sm text-foreground-secondary">
                Copies
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={copies}
                  onChange={e => setCopies(Math.max(1, Math.min(100, parseInt(e.target.value) || 1)))}
                  className="w-16 px-2 py-1 rounded-lg border border-border-default bg-surface text-sm"
                />
              </label>
              <button
                type="button"
                onClick={() => setShowPrice(v => !v)}
                title="Print price on label"
                className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${showPrice ? 'border-orange-500 bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400' : 'border-border-default text-foreground-secondary hover:bg-surface-secondary'}`}
              >
                Print Price: {showPrice ? 'On' : 'Off'}
              </button>
              <button
                type="button"
                onClick={() => setQrAction(v => !v)}
                title="QR opens quick actions when scanned"
                className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${qrAction ? 'border-orange-500 bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400' : 'border-border-default text-foreground-secondary hover:bg-surface-secondary'}`}
              >
                QR Action: {qrAction ? 'On' : 'Off'}
              </button>
              <button
                type="button"
                onClick={handleDownload}
                disabled={selectedProducts.length === 0 || downloading}
                className="ml-auto px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {downloading
                  ? 'Generating…'
                  : selectedProducts.length === 0
                    ? 'Select products to download'
                    : `Download PDF — ${totalLabels} label${totalLabels !== 1 ? 's' : ''}`}
              </button>
            </div>

            {/* Category filter + product search */}
            <div className="bg-surface-elevated border border-border-default rounded-xl p-4">
              <h2 className="text-sm font-semibold text-foreground mb-3">Select Products &amp; Variants</h2>

              {/* Category filters */}
              <div className="flex gap-2 mb-3">
                <div className="flex-1 min-w-0">
                  <AdminSelect
                    sm
                    value={selectedMainCat}
                    placeholder="All categories"
                    options={
                      [
                        { value: '', label: 'All categories' },
                        ...mainCategories.map(c => ({ value: c.id, label: c.name })),
                      ] as SelectOption[]
                    }
                    onChange={v => onMainCatChange(v)}
                  />
                </div>
                {subCategories.length > 0 && (
                  <div className="flex-1 min-w-0">
                    <AdminSelect
                      sm
                      value={selectedSubCat}
                      placeholder="All subcategories"
                      options={
                        [
                          { value: '', label: 'All subcategories' },
                          ...subCategories.map(c => ({ value: c.id, label: c.name })),
                        ] as SelectOption[]
                      }
                      onChange={v => setSelectedSubCat(v)}
                    />
                  </div>
                )}
              </div>

              {/* Search box */}
              <div className="relative mb-3">
                <input
                  ref={taInputRef}
                  type="text"
                  placeholder="Search by name, variant or SKU…"
                  value={query}
                  onChange={e => {
                    setQuery(e.target.value)
                    if (taDebounceRef.current) clearTimeout(taDebounceRef.current)
                    taDebounceRef.current = setTimeout(() => {
                      fetchTypeahead(e.target.value)
                      setTaRect(taInputRef.current?.getBoundingClientRect() ?? null)
                    }, 180)
                  }}
                  onFocus={() => {
                    setTaRect(taInputRef.current?.getBoundingClientRect() ?? null)
                    if (query.length >= 2 && taItems.length > 0) setTaOpen(true)
                  }}
                  onBlur={() => setTimeout(() => setTaOpen(false), 150)}
                  onKeyDown={e => {
                    if (!taOpen) return
                    if (e.key === 'ArrowDown') {
                      e.preventDefault()
                      setTaIndex(i => Math.min(i + 1, taItems.length - 1))
                    } else if (e.key === 'ArrowUp') {
                      e.preventDefault()
                      setTaIndex(i => Math.max(i - 1, -1))
                    } else if (e.key === 'Enter' && taIndex >= 0) {
                      e.preventDefault()
                      selectTaItem(taItems[taIndex])
                    } else if (e.key === 'Escape') setTaOpen(false)
                  }}
                  className="w-full px-3 py-1.5 pl-9 rounded-lg border border-border-default bg-surface-secondary text-foreground text-sm placeholder:text-foreground-muted"
                />
                <svg
                  className="absolute left-3 top-2.5 w-4 h-4 text-foreground-muted"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                  />
                </svg>
                {taOpen &&
                  taRect &&
                  taItems.length > 0 &&
                  typeof document !== 'undefined' &&
                  createPortal(
                    <div
                      style={{
                        position: 'fixed',
                        top: taRect.bottom + 4,
                        left: taRect.left,
                        width: taRect.width,
                        zIndex: 9999,
                      }}
                      className="bg-surface-elevated rounded-lg shadow-xl border border-border-default overflow-hidden max-h-64 overflow-y-auto"
                    >
                      {taItems.map((item, idx) => {
                        const isSelected = selectedProducts.some(sp => sp.id === item.id.split('\x1f')[0])
                        return (
                          <button
                            key={item.id}
                            onMouseDown={e => {
                              e.preventDefault()
                              selectTaItem(item)
                            }}
                            className={`w-full text-left px-3 py-2 text-sm flex flex-col gap-0.5 transition-colors ${
                              idx === taIndex ? 'bg-orange-50 dark:bg-orange-900/20' : 'hover:bg-surface-secondary'
                            } ${isSelected ? 'opacity-60' : ''}`}
                          >
                            <span className="font-medium text-foreground truncate">
                              <Highlight text={item.label} query={query} />
                            </span>
                            {item.sublabel && (
                              <span className="text-xs text-foreground-muted truncate">{item.sublabel}</span>
                            )}
                          </button>
                        )
                      })}
                    </div>,
                    document.body
                  )}
              </div>

              {/* Results list */}
              <div className="space-y-0.5 max-h-72 overflow-y-auto">
                {searching && <div className="text-sm text-foreground-muted text-center py-6">Searching…</div>}
                {!searching && searchResults.length === 0 && (
                  <div className="text-sm text-foreground-muted text-center py-6">No products found</div>
                )}
                {!searching &&
                  searchResults.map(p => {
                    const isSelected = selectedProducts.some(sp => sp.id === p.id)
                    const displayPrice = fmtPrice(p.base_price)
                    return (
                      <label
                        key={p.id}
                        className={`flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors ${
                          isSelected ? 'bg-orange-50 dark:bg-orange-900/20' : 'hover:bg-surface-secondary'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleProduct(p)}
                          className="w-4 h-4 flex-shrink-0 accent-orange-500"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-foreground truncate leading-tight">{p.name}</div>
                          {p.variant_name && (
                            <div className="text-xs text-foreground-secondary truncate">{p.variant_name}</div>
                          )}
                          <div className="text-xs text-foreground-muted">
                            <span className="inline-flex items-center gap-1">
                              {p.sku}
                              {p.sku && <CopySku sku={p.sku} />}
                            </span>
                            {p.brand_name ? ` · ${p.brand_name}` : ''}
                          </div>
                        </div>
                        {displayPrice && (
                          <div className="text-xs font-medium text-foreground-secondary shrink-0">{displayPrice}</div>
                        )}
                      </label>
                    )
                  })}
              </div>
            </div>

            {/* Selected basket */}
            {selectedProducts.length > 0 && (
              <div className="bg-surface-elevated border border-border-default rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-semibold text-foreground">
                    Selected — {selectedProducts.length} item{selectedProducts.length !== 1 ? 's' : ''}
                  </h2>
                  <button
                    onClick={() => setSelectedProducts([])}
                    className="text-xs text-foreground-muted hover:text-red-500 transition-colors"
                  >
                    Clear all
                  </button>
                </div>
                <div className="space-y-1.5">
                  {selectedProducts.map((p, idx) => (
                    <div
                      key={p.id}
                      className={`flex items-center gap-3 rounded-lg px-3 py-2 transition-colors cursor-pointer ${
                        idx === safePreviewIdx
                          ? 'bg-orange-50 dark:bg-orange-900/20 ring-1 ring-orange-200 dark:ring-orange-800'
                          : 'bg-surface-secondary'
                      }`}
                      onClick={() => setPreviewIndex(idx)}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-foreground truncate leading-tight">{p.name}</div>
                        {p.variant_name && <div className="text-xs text-foreground-secondary">{p.variant_name}</div>}
                        <div className="text-xs text-foreground-muted">
                          <span className="inline-flex items-center gap-1">
                            {p.sku}
                            {p.sku && <CopySku sku={p.sku} />}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <span className="text-xs text-foreground-muted mr-0.5">qty</span>
                        <button
                          onClick={e => {
                            e.stopPropagation()
                            updateProductCopies(p.id, p.copies - 1)
                          }}
                          className="w-6 h-6 flex items-center justify-center rounded border border-border-default bg-surface-primary text-foreground-secondary hover:bg-surface-secondary transition-colors text-sm font-medium"
                        >
                          −
                        </button>
                        <span className="w-7 text-center text-sm font-medium text-foreground tabular-nums">
                          {p.copies}
                        </span>
                        <button
                          onClick={e => {
                            e.stopPropagation()
                            updateProductCopies(p.id, p.copies + 1)
                          }}
                          className="w-6 h-6 flex items-center justify-center rounded border border-border-default bg-surface-primary text-foreground-secondary hover:bg-surface-secondary transition-colors text-sm font-medium"
                        >
                          +
                        </button>
                      </div>
                      <button
                        onClick={e => {
                          e.stopPropagation()
                          toggleProduct(p)
                        }}
                        className="text-foreground-muted hover:text-red-500 transition-colors flex-shrink-0"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {error && (
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-4 py-3 text-sm text-red-700 dark:text-red-400">
                {error}
              </div>
            )}
          </div>

          {/* ── Right panel — preview ── */}
          <div className="w-full xl:w-72 shrink-0">
            <div className="bg-surface-elevated border border-border-default rounded-xl p-4 sticky top-4">
              <div className="flex items-center justify-between mb-1">
                <h2 className="text-sm font-semibold text-foreground">Preview</h2>
                <span className="text-xs text-foreground-muted">{activeSize.label}</span>
              </div>
              <p className="text-xs text-foreground-muted mb-3">
                {activeSize.widthMm} × {activeSize.heightMm} mm
              </p>

              {/* Preview box — ruler + label */}
              <div className="bg-[#f0f0f0] dark:bg-zinc-800 rounded-lg py-6 flex items-center justify-center overflow-hidden">
                <div style={{ display: 'inline-flex', alignItems: 'flex-start' }}>
                  {/* Y-axis ruler — same height as label, vertically centered text */}
                  <div
                    style={{
                      width: RULER_LEFT,
                      height: previewH,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 9,
                        color: '#999',
                        writingMode: 'vertical-rl' as any,
                        transform: 'rotate(180deg)',
                        userSelect: 'none',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {activeSize.heightMm} mm
                    </span>
                  </div>

                  {/* Label + X-axis ruler stacked */}
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                    <LabelPreview
                      size={activeSize}
                      product={previewProduct}
                      scale={previewScale}
                      showPrice={showPrice}
                    />
                    <div
                      style={{
                        width: previewW,
                        textAlign: 'center',
                        fontSize: 9,
                        color: '#999',
                        userSelect: 'none',
                      }}
                    >
                      ←── {activeSize.widthMm} mm ──→
                    </div>
                  </div>
                </div>
              </div>

              {/* Multi-product carousel nav */}
              {selectedProducts.length > 1 && (
                <div className="flex items-center justify-between mt-3">
                  <button
                    onClick={() => setPreviewIndex(i => Math.max(0, i - 1))}
                    disabled={safePreviewIdx === 0}
                    className="px-3 py-1.5 rounded-lg border border-border-default text-xs font-medium text-foreground-secondary disabled:opacity-40 hover:bg-surface-secondary transition-colors"
                  >
                    ← Prev
                  </button>
                  <span className="text-xs text-foreground-muted">
                    {safePreviewIdx + 1} / {selectedProducts.length}
                  </span>
                  <button
                    onClick={() => setPreviewIndex(i => Math.min(selectedProducts.length - 1, i + 1))}
                    disabled={safePreviewIdx === selectedProducts.length - 1}
                    className="px-3 py-1.5 rounded-lg border border-border-default text-xs font-medium text-foreground-secondary disabled:opacity-40 hover:bg-surface-secondary transition-colors"
                  >
                    Next →
                  </button>
                </div>
              )}

              {previewProduct ? (
                <p className="text-xs text-foreground-muted text-center mt-2 truncate">
                  {previewProduct.name}
                  {previewProduct.variant_name ? ` — ${previewProduct.variant_name}` : ''}
                </p>
              ) : (
                <p className="text-xs text-foreground-muted text-center mt-2">Select a product to preview</p>
              )}

              {/* Summary grid */}
              <div className="mt-4 pt-3 border-t border-border-default grid grid-cols-2 gap-y-1.5">
                {[
                  ['Size', activeSize.label],
                  ['Format', outputMode === 'thermal' ? 'Thermal' : 'A4 sheet'],
                  ['Items', String(selectedProducts.length)],
                  ['Total labels', totalLabels ? String(totalLabels) : '—'],
                ].map(([label, val]) => (
                  <div key={label} className="contents">
                    <span className="text-xs text-foreground-muted">{label}</span>
                    <span className="text-xs font-medium text-foreground text-right">{val}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
