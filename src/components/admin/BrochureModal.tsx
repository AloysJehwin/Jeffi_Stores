'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'

interface Category {
  id: string
  name: string
  parent_category_id: string | null
}
interface Brand {
  id: string
  name: string
}

interface Props {
  open: boolean
  onClose: () => void
}

/**
 * Admin brochure builder. Loads the active category tree + brand list, lets the
 * admin multi-select ≥1 category AND ≥1 brand (strict intersection), toggle
 * prices, name the brochure, then POSTs to /api/admin/brochure and downloads the
 * streamed PDF. Selecting a parent category server-side auto-includes its
 * sub-categories (recursive), so only the parent need be checked here.
 */
export default function BrochureModal({ open, onClose }: Props) {
  const [categories, setCategories] = useState<Category[]>([])
  const [brands, setBrands] = useState<Brand[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedCats, setSelectedCats] = useState<Set<string>>(new Set())
  const [selectedBrands, setSelectedBrands] = useState<Set<string>>(new Set())
  const [showPrices, setShowPrices] = useState(true)
  const [title, setTitle] = useState('')
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setLoading(true)
    setError('')
    Promise.all([
      fetch('/api/categories').then(r => r.json()),
      fetch('/api/brands').then(r => r.json()),
    ])
      .then(([c, b]) => {
        setCategories(c.categories || [])
        setBrands(b.brands || [])
      })
      .catch(() => setError('Could not load categories or brands'))
      .finally(() => setLoading(false))
  }, [open])

  useEffect(() => {
    if (!open) return
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [open])

  // Order categories as a main→sub tree for display
  const tree = useMemo(() => {
    const mains = categories.filter(c => !c.parent_category_id)
    const subsByParent = new Map<string, Category[]>()
    for (const c of categories) {
      if (c.parent_category_id) {
        const arr = subsByParent.get(c.parent_category_id) || []
        arr.push(c)
        subsByParent.set(c.parent_category_id, arr)
      }
    }
    const rows: { cat: Category; depth: number }[] = []
    for (const m of mains) {
      rows.push({ cat: m, depth: 0 })
      for (const sub of (subsByParent.get(m.id) || [])) rows.push({ cat: sub, depth: 1 })
    }
    // Include any orphaned sub-categories whose parent is inactive/missing
    const seen = new Set(rows.map(r => r.cat.id))
    for (const c of categories) if (!seen.has(c.id)) rows.push({ cat: c, depth: 0 })
    return rows
  }, [categories])

  const toggleCat = useCallback((id: string) => {
    setSelectedCats(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }, [])
  const toggleBrand = useCallback((id: string) => {
    setSelectedBrands(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }, [])

  const canGenerate = selectedCats.size > 0 && selectedBrands.size > 0 && !generating && !loading

  async function handleGenerate() {
    if (!canGenerate) return
    setError('')
    setGenerating(true)
    try {
      const res = await fetch('/api/admin/brochure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          categoryIds: Array.from(selectedCats),
          brandIds: Array.from(selectedBrands),
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

  return createPortal(
    <div className="fixed inset-0 z-[300] flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div
        className="relative bg-surface-elevated w-full sm:rounded-2xl rounded-t-2xl shadow-2xl max-h-[92vh] flex flex-col sm:max-w-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between px-5 pt-5 pb-4 border-b border-border-default shrink-0">
          <div className="min-w-0 pr-4">
            <h2 className="text-base font-bold text-foreground leading-tight">Generate Brochure</h2>
            <p className="text-sm text-foreground-muted mt-0.5">Pick categories and brands to include in the catalogue PDF</p>
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

        <div className="overflow-y-auto flex-1 p-5 space-y-5">
          {loading ? (
            <div className="text-xs text-foreground-muted py-8 text-center">Loading categories &amp; brands…</div>
          ) : (
            <>
              <div className="flex gap-4">
                {/* Categories */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-semibold text-foreground-secondary uppercase tracking-wide">Categories</p>
                    <div className="flex gap-2">
                      <button onClick={() => setSelectedCats(new Set(categories.map(c => c.id)))} className="text-[10px] text-accent-500 hover:text-accent-600">All</button>
                      <span className="text-foreground-muted text-[10px]">·</span>
                      <button onClick={() => setSelectedCats(new Set())} className="text-[10px] text-foreground-muted hover:text-red-500">None</button>
                    </div>
                  </div>
                  <div className="space-y-0.5 max-h-64 overflow-y-auto pr-1 border border-border-default rounded-lg p-1.5">
                    {tree.length === 0 ? (
                      <div className="text-xs text-foreground-muted py-3 text-center">No categories</div>
                    ) : tree.map(({ cat, depth }) => (
                      <label
                        key={cat.id}
                        className="flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer hover:bg-surface-secondary"
                        style={{ paddingLeft: depth ? 22 : 8 }}
                      >
                        <input
                          type="checkbox"
                          checked={selectedCats.has(cat.id)}
                          onChange={() => toggleCat(cat.id)}
                          className="w-3.5 h-3.5 flex-shrink-0 accent-orange-500"
                        />
                        <span className={`text-sm truncate ${depth ? 'text-foreground-secondary' : 'text-foreground font-medium'}`}>{cat.name}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Brands */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-semibold text-foreground-secondary uppercase tracking-wide">Brands</p>
                    <div className="flex gap-2">
                      <button onClick={() => setSelectedBrands(new Set(brands.map(b => b.id)))} className="text-[10px] text-accent-500 hover:text-accent-600">All</button>
                      <span className="text-foreground-muted text-[10px]">·</span>
                      <button onClick={() => setSelectedBrands(new Set())} className="text-[10px] text-foreground-muted hover:text-red-500">None</button>
                    </div>
                  </div>
                  <div className="space-y-0.5 max-h-64 overflow-y-auto pr-1 border border-border-default rounded-lg p-1.5">
                    {brands.length === 0 ? (
                      <div className="text-xs text-foreground-muted py-3 text-center">No brands</div>
                    ) : brands.map(b => (
                      <label key={b.id} className="flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer hover:bg-surface-secondary">
                        <input
                          type="checkbox"
                          checked={selectedBrands.has(b.id)}
                          onChange={() => toggleBrand(b.id)}
                          className="w-3.5 h-3.5 flex-shrink-0 accent-orange-500"
                        />
                        <span className="text-sm text-foreground truncate">{b.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex gap-4 items-end">
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
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2 text-xs text-red-700 dark:text-red-400">
                  {error}
                </div>
              )}
            </>
          )}
        </div>

        <div className="px-5 py-4 border-t border-border-default shrink-0 flex items-center justify-between gap-3">
          <p className="text-xs text-foreground-muted">
            {selectedCats.size} categor{selectedCats.size === 1 ? 'y' : 'ies'} · {selectedBrands.size} brand{selectedBrands.size !== 1 ? 's' : ''}
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
              title={selectedCats.size === 0 || selectedBrands.size === 0 ? 'Select at least one category and one brand' : ''}
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
