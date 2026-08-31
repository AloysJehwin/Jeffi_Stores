'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import Toggle from '@/components/ui/Toggle'
import CopySku from '@/components/ui/CopySku'
import { useStoreConfig } from '@/contexts/StoreConfigContext'

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
function discountPct(mrp: number | null, price: number | null): number {
  if (mrp == null || price == null || mrp <= price || mrp <= 0) return 0
  return Math.round(((mrp - price) / mrp) * 100)
}

// Mirror of the PDF's family grouping (src/lib/brochure-pdf.ts) so the preview
// paginates identically. Kept in sync manually.
const SIZE_TOKENS = [
  /\bM\d+(?:\.\d+)?\b/gi,
  /\b\d+\/\d+\s*["'”]?/g,
  /\b\d+(?:\.\d+)?\s*(?:mm|cm|inch|in)\b/gi,
  /\b\d+(?:\.\d+)?\s*["'”]/g,
  /\b\d+(?:\.\d+)?\s*[x×]\s*\d+(?:\.\d+)?\b/gi,
]
function normName(s: string): string { return (s ?? '').toLowerCase().replace(/\s+/g, ' ').trim() }
function familyKey(name: string): string {
  let s = (name ?? '').trim()
  for (const re of SIZE_TOKENS) s = s.replace(re, ' ')
  return normName(s) || normName(name)
}
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length
  if (!m) return n; if (!n) return m
  let prev = Array.from({ length: n + 1 }, (_, j) => j)
  let cur = new Array(n + 1).fill(0)
  for (let i = 1; i <= m; i++) {
    cur[0] = i
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
    }
    ;[prev, cur] = [cur, prev]
  }
  return prev[n]
}
function nameSimilarity(a: string, b: string): number {
  const x = normName(a), y = normName(b)
  const L = Math.max(x.length, y.length)
  return L === 0 ? 1 : 1 - levenshtein(x, y) / L
}
const FAMILY_THRESHOLD = 0.82
function sameFamily(a: string, b: string): boolean {
  if (familyKey(a) !== familyKey(b)) return false
  return nameSimilarity(a, b) >= FAMILY_THRESHOLD
}
function splitFamilies(products: BrochureProduct[]): { representatives: BrochureProduct[]; rest: BrochureProduct[] } {
  const representatives: BrochureProduct[] = []
  const rest: BrochureProduct[] = []
  const byKey = new Map<string, BrochureProduct[]>()
  for (const p of products) {
    const key = familyKey(p.name)
    const bucket = byKey.get(key)
    const match = bucket?.find(r => sameFamily(r.name, p.name))
    if (match) rest.push(p)
    else { representatives.push(p); if (bucket) bucket.push(p); else byKey.set(key, [p]) }
  }
  return { representatives, rest }
}

// A4 aspect ratio for the scaled preview page cards.
const A4_RATIO = 841.89 / 595.28
const MATRIX_PER_PAGE = 9
const LIST_PER_PAGE = 11

type PreviewPage =
  | { kind: 'matrix'; items: BrochureProduct[] }
  | { kind: 'list'; items: BrochureProduct[] }

function paginate(products: BrochureProduct[]): PreviewPage[] {
  const { representatives, rest } = splitFamilies(products)
  const pages: PreviewPage[] = []
  for (let i = 0; i < representatives.length; i += MATRIX_PER_PAGE) {
    pages.push({ kind: 'matrix', items: representatives.slice(i, i + MATRIX_PER_PAGE) })
  }
  for (let i = 0; i < rest.length; i += LIST_PER_PAGE) {
    pages.push({ kind: 'list', items: rest.slice(i, i + LIST_PER_PAGE) })
  }
  return pages
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
  const [promo, setPromo] = useState('')
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
    setPromo('')
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

  // parentId → all descendant ids (recursive), for cascade selection.
  const descendantsOf = useMemo(() => {
    const kids = new Map<string, string[]>()
    for (const c of categories) {
      if (c.parent_category_id) {
        const arr = kids.get(c.parent_category_id) || []
        arr.push(c.id); kids.set(c.parent_category_id, arr)
      }
    }
    const memo = new Map<string, string[]>()
    const collect = (id: string): string[] => {
      if (memo.has(id)) return memo.get(id)!
      const direct = kids.get(id) || []
      const all = [...direct]
      for (const d of direct) all.push(...collect(d))
      memo.set(id, all)
      return all
    }
    const out = new Map<string, string[]>()
    for (const c of categories) out.set(c.id, collect(c.id))
    return out
  }, [categories])

  // Toggling a category cascades to its descendants so the user sees exactly
  // what a parent pulls in. (Brands have no hierarchy — plain toggle.)
  const toggleFilter = useCallback((id: string) => {
    setSelectedFilters(prev => {
      const next = new Set(prev)
      const kids = descendantsOf.get(id) || []
      if (next.has(id)) {
        next.delete(id)
        for (const k of kids) next.delete(k)
      } else {
        next.add(id)
        for (const k of kids) next.add(k)
      }
      return next
    })
  }, [descendantsOf])
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
  const previewPages = useMemo(() => paginate(previewProducts), [previewProducts])
  // Index entries mirror the PDF: each family representative → its page number
  // (cover=1, index=2, matrix pages start at 3).
  const indexFamilies = useMemo(() => {
    const { representatives } = splitFamilies(previewProducts)
    return representatives.map((p, i) => ({ name: p.name, page: 3 + Math.floor(i / MATRIX_PER_PAGE) }))
  }, [previewProducts])

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
          promo: promo.trim() || undefined,
        }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || 'Failed to generate brochure')
      }
      const blob = await res.blob()
      // Prefer the server's unique filename (Content-Disposition); fall back to
      // a locally-unique name so two brochures never collide in Downloads.
      const cd = res.headers.get('Content-Disposition') || ''
      const m = cd.match(/filename="?([^"]+)"?/i)
      const slug = (title.trim() || 'brochure').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'brochure'
      const fallback = `${slug}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.pdf`
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = m ? m[1] : fallback
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
        className="relative bg-surface-elevated w-full sm:rounded-2xl rounded-t-2xl shadow-2xl max-h-[94vh] flex flex-col sm:max-w-7xl"
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
                <p className="text-xs font-semibold text-foreground-secondary uppercase tracking-wide">{filterLabel}</p>
                <div className="flex gap-2">
                  <button onClick={() => setSelectedFilters(new Set(allFilterIds))} className="text-[10px] text-accent-500 hover:text-accent-600">All</button>
                  <span className="text-foreground-muted text-[10px]">·</span>
                  <button onClick={() => setSelectedFilters(new Set())} className="text-[10px] text-foreground-muted hover:text-red-500">None</button>
                </div>
              </div>
              <div className="space-y-0.5 h-[28rem] overflow-y-auto pr-1 border border-border-default rounded-lg p-1.5">
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
                <p className="text-xs font-semibold text-foreground-secondary uppercase tracking-wide">Products</p>
                {products.length > 0 && (
                  <div className="flex gap-2">
                    <button onClick={() => setSelectedProducts(new Set(products.map(p => p.id)))} className="text-[10px] text-accent-500 hover:text-accent-600">All</button>
                    <span className="text-foreground-muted text-[10px]">·</span>
                    <button onClick={() => setSelectedProducts(new Set())} className="text-[10px] text-foreground-muted hover:text-red-500">None</button>
                  </div>
                )}
              </div>
              <div className="space-y-0.5 h-[28rem] overflow-y-auto pr-1 border border-border-default rounded-lg p-1.5">
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
                      <div className="text-xs text-foreground-muted truncate"><span className="inline-flex items-center gap-1">{p.sku}{p.sku && <CopySku sku={p.sku} />}</span></div>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* ── Section 3: paginated A4 preview ── */}
            <div className="min-w-0">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-foreground-secondary uppercase tracking-wide">Preview</p>
                {previewProducts.length > 0 && (
                  <span className="text-[10px] text-foreground-muted">{previewPages.length + 2} pages</span>
                )}
              </div>
              <div className="h-[28rem] overflow-y-auto border border-border-default rounded-lg bg-gray-100 dark:bg-zinc-800 p-3 space-y-3">
                {previewProducts.length === 0 ? (
                  <div className="text-xs text-foreground-muted py-8 text-center px-3">Nothing selected yet</div>
                ) : (
                  <>
                    <CoverPreviewCard title={title.trim() || 'Product Brochure'} promo={promo.trim()} />
                    <IndexPreviewCard families={indexFamilies} />
                    {previewPages.map((page, pi) => (
                      <PreviewPageCard
                        key={pi}
                        page={page}
                        pageNum={pi + 3}
                        totalPages={previewPages.length + 2}
                        title={title.trim() || 'Product Brochure'}
                        showPrices={showPrices}
                      />
                    ))}
                  </>
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
            <div className="flex-1">
              <p className="text-xs font-semibold text-foreground-secondary uppercase tracking-wide mb-2">Cover promo line (optional)</p>
              <input
                type="text"
                value={promo}
                onChange={e => setPromo(e.target.value)}
                maxLength={140}
                placeholder="e.g. Monsoon Sale — up to 20% off fasteners"
                className="w-full px-3 py-2 rounded-lg border border-border-default bg-surface-secondary text-foreground text-sm"
              />
            </div>
            <div className="shrink-0">
              <p className="text-xs font-semibold text-foreground-secondary uppercase tracking-wide mb-2">Prices</p>
              <div className="h-[38px] flex items-center">
                <Toggle checked={showPrices} onChange={setShowPrices} label={showPrices ? 'Show' : 'Hide'} />
              </div>
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

/** Decorative QR glyph used in the preview (the real PDF embeds a scannable QR). */
function QrGlyph({ size }: { size: number }) {
  return (
    <div
      className="shrink-0 grid place-items-center border border-gray-300 dark:border-zinc-600 rounded-sm bg-white"
      style={{ width: size, height: size }}
      title="QR → product page"
    >
      <svg viewBox="0 0 24 24" style={{ width: size * 0.8, height: size * 0.8 }} className="text-gray-800" fill="currentColor">
        <path d="M3 3h8v8H3V3zm2 2v4h4V5H5zm8-2h8v8h-8V3zm2 2v4h4V5h-4zM3 13h8v8H3v-8zm2 2v4h4v-4H5zm13-2h3v2h-3v-2zm0 3h3v5h-5v-3h2v-2zm-5 0h3v3h-3v-3z" />
      </svg>
    </div>
  )
}

function Thumb({ url, size, radius = 4 }: { url: string | null; size: number; radius?: number }) {
  if (url) return <img src={url} alt="" style={{ width: size, height: size, borderRadius: radius }} className="object-cover bg-gray-100 flex-shrink-0" />
  return (
    <div style={{ width: size, height: size, borderRadius: radius }} className="bg-gray-100 dark:bg-zinc-700 flex-shrink-0 grid place-items-center text-[6px] text-gray-400">
      No image
    </div>
  )
}

/** Cover preview card (page 1) — mirrors the PDF's advertising cover. */
function CoverPreviewCard({ title, promo }: { title: string; promo: string }) {
  const storeName = useStoreConfig().identity.name
  return (
    <div
      className="rounded-sm overflow-hidden shadow-sm flex flex-col items-center justify-center text-center px-4"
      style={{ aspectRatio: `1 / ${A4_RATIO}`, background: 'linear-gradient(to bottom, #2c5200, #7cb900)' }}
    >
      <div className="w-10 h-10 rounded-full bg-white/90 grid place-items-center mb-2">
        <span className="text-[#3d6b00] font-black text-sm">JS</span>
      </div>
      <div className="text-white font-extrabold text-sm uppercase leading-tight">{storeName}</div>
      <div className="w-8 border-t border-[#d4edaa] my-1.5" />
      <div className="text-white font-bold text-[11px] leading-tight">{title}</div>
      {promo && <div className="text-[#eaffd0] italic text-[8px] mt-1 leading-tight">{promo}</div>}
      <div className="text-[#dfeecb] text-[7px] mt-auto pt-4">Product Catalogue</div>
    </div>
  )
}

/** Index preview card (page 2) — families → page numbers. */
function IndexPreviewCard({ families }: { families: { name: string; page: number }[] }) {
  const storeName = useStoreConfig().identity.name
  return (
    <div className="bg-white dark:bg-zinc-900 shadow-sm rounded-sm overflow-hidden" style={{ aspectRatio: `1 / ${A4_RATIO}` }}>
      <div className="bg-[#3d6b00] text-white px-3 py-2 flex items-center justify-between">
        <div className="text-[11px] font-bold uppercase truncate">{storeName}</div>
        <div className="text-[8px] opacity-90 uppercase tracking-wide">Index</div>
      </div>
      <div className="p-3">
        <div className="text-[11px] font-bold text-[#3d6b00] dark:text-green-400 mb-1">Index</div>
        <div className="text-[7px] font-semibold text-gray-400 uppercase mb-1">Featured Products</div>
        {families.map((f, i) => (
          <div key={i} className="flex items-baseline gap-1 text-[8px] text-gray-800 dark:text-gray-200 py-0.5">
            <span className="truncate">{f.name}</span>
            <span className="flex-1 border-b border-dotted border-gray-300 dark:border-zinc-600 translate-y-[-2px]" />
            <span className="font-bold text-[#3d6b00] dark:text-green-400">{f.page}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * A scaled A4 page card mirroring the real PDF page — branded header (with the
 * FEATURED/MORE section label), then a 3×3 tile matrix or compact list rows, and
 * a footer with the page number. Purely visual (approximation of the PDF).
 */
function PreviewPageCard({
  page, pageNum, totalPages, title, showPrices,
}: { page: PreviewPage; pageNum: number; totalPages: number; title: string; showPrices: boolean }) {
  const storeName = useStoreConfig().identity.name
  const heading = page.kind === 'matrix' ? 'Featured Products' : (pageNum === 1 ? 'Products' : 'More Products')
  return (
    <div className="bg-white dark:bg-zinc-900 shadow-sm rounded-sm overflow-hidden" style={{ aspectRatio: `1 / ${A4_RATIO}` }}>
      {/* header */}
      <div className="bg-[#3d6b00] text-white px-3 py-2 flex items-start justify-between">
        <div className="min-w-0">
          <div className="text-[11px] font-bold uppercase leading-tight truncate">{storeName}</div>
          <div className="text-[8px] opacity-80 truncate">{title}</div>
        </div>
        <div className="text-[8px] opacity-90 uppercase tracking-wide shrink-0 pl-2 pt-0.5">{heading}</div>
      </div>

      {/* body */}
      {page.kind === 'matrix' ? (
        <div className="grid grid-cols-3 gap-1.5 p-2">
          {page.items.map(p => (
            <div key={p.id} className="border border-gray-200 dark:border-zinc-700 rounded p-1 flex flex-col">
              <div className="w-full aspect-square grid place-items-center overflow-hidden rounded-sm bg-gray-50 dark:bg-zinc-800">
                <Thumb url={p.thumbnail_url} size={44} radius={2} />
              </div>
              <div className="mt-1 text-[7px] font-bold text-gray-900 dark:text-gray-100 leading-tight line-clamp-2">{p.name}</div>
              <div className="text-[6px] text-gray-500 truncate">SKU: {p.sku}</div>
              <div className="mt-auto flex items-end justify-between pt-1">
                {showPrices ? (
                  <div className="leading-tight">
                    {discountPct(p.mrp, p.base_price) > 0 && (
                      <div className="flex items-center gap-1">
                        <span className="text-[6px] text-gray-400 line-through">{rs(p.mrp)}</span>
                        <span className="text-[6px] font-bold text-red-600">{discountPct(p.mrp, p.base_price)}% OFF</span>
                      </div>
                    )}
                    <span className="text-[8px] font-bold text-[#3d6b00] dark:text-green-400">{rs(p.base_price ?? p.mrp)}</span>
                  </div>
                ) : <span />}
                {p.slug && <QrGlyph size={14} />}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="px-2 py-1">
          {page.items.map((p, i) => (
            <div key={p.id} className={`flex items-center gap-1.5 px-1 py-1 border-b border-gray-100 dark:border-zinc-800 ${i % 2 ? 'bg-[#fafcf5] dark:bg-zinc-800/40' : ''}`}>
              <Thumb url={p.thumbnail_url} size={22} />
              <div className="flex-1 min-w-0">
                <div className="text-[8px] font-bold text-gray-900 dark:text-gray-100 truncate">{p.name}</div>
                <div className="text-[6px] text-gray-500 truncate">SKU: {p.sku}{p.brand_name ? `  •  ${p.brand_name}` : ''}</div>
                {p.short_description && <div className="text-[6px] text-gray-600 dark:text-gray-400 truncate">{p.short_description}</div>}
              </div>
              {showPrices && (
                <div className="shrink-0 text-right leading-tight">
                  {discountPct(p.mrp, p.base_price) > 0 && (
                    <div className="text-[6px] text-gray-400 line-through">{rs(p.mrp)}</div>
                  )}
                  <div className="text-[8px] font-bold text-[#3d6b00] dark:text-green-400">{rs(p.base_price ?? p.mrp)}</div>
                  {discountPct(p.mrp, p.base_price) > 0 && (
                    <div className="text-[6px] font-bold text-red-600">{discountPct(p.mrp, p.base_price)}% OFF</div>
                  )}
                </div>
              )}
              {p.slug && <QrGlyph size={16} />}
            </div>
          ))}
        </div>
      )}

      {/* footer */}
      <div className="border-t border-[#7cb900] mx-2 mt-1" />
      <div className="px-2 py-1 flex items-center justify-between text-[6px] text-gray-500">
        <span className="truncate">{storeName}</span>
        <span className="shrink-0">Page {pageNum} of {totalPages}</span>
      </div>
    </div>
  )
}
