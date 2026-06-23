'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useCompare, CompareProduct } from '@/contexts/CompareContext'
import ImgWithSkeleton from '@/components/ui/ImgWithSkeleton'

interface CompareDrawerProps {
  open: boolean
  onClose: () => void
  currentProduct: CompareProduct
}

interface SearchResult {
  id: string
  name: string
  slug: string
  price: number
  mrp: number | null
  image_url: string | null
  thumbnail_url: string | null
  brand_name: string | null
  category_name: string | null
  category_id: string | null
}

function ProductSlot({
  product,
  categoryId,
  excludeIds,
  onAdd,
  onRemove,
  isPinned,
}: {
  product: CompareProduct | null
  categoryId: string | null
  excludeIds: string[]
  onAdd: (p: CompareProduct) => void
  onRemove: () => void
  isPinned?: boolean
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (product) { setQuery(''); setResults([]) }
  }, [product])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const search = useCallback(async (q: string) => {
    if (q.length < 2) { setResults([]); setOpen(false); return }
    setLoading(true)
    try {
      const params = new URLSearchParams({ q, limit: '6' })
      if (categoryId) params.set('categoryId', categoryId)
      excludeIds.forEach(id => params.append('excludeId', id))
      const res = await fetch(`/api/products/search?${params}`)
      const data: SearchResult[] = await res.json()
      setResults(data)
      setOpen(true)
    } catch {
      setResults([])
    } finally {
      setLoading(false)
    }
  }, [categoryId, excludeIds])

  function handleInput(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value
    setQuery(val)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => search(val), 280)
  }

  function handleSelect(r: SearchResult) {
    onAdd({
      id: r.id,
      name: r.name,
      slug: r.slug,
      price: r.price,
      mrp: r.mrp,
      image: r.thumbnail_url || r.image_url,
      brandName: r.brand_name,
      categoryId: r.category_id,
      categoryName: r.category_name,
    })
    setQuery('')
    setResults([])
    setOpen(false)
  }

  if (product) {
    return (
      <div className="flex items-center gap-3 p-3 bg-surface rounded-lg border border-border-default">
        <div className="w-12 h-12 rounded-lg border border-border-default bg-surface-secondary flex-shrink-0 overflow-hidden">
          {product.image ? (
            <ImgWithSkeleton src={product.image} alt={product.name} className="w-full h-full object-contain p-1" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <svg className="w-6 h-6 text-foreground-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground line-clamp-2 leading-snug">{product.name}</p>
          {product.brandName && <p className="text-xs text-foreground-muted mt-0.5">{product.brandName}</p>}
          <p className="text-xs font-semibold text-primary-600 dark:text-primary-400 mt-0.5">
            ₹{Number(product.price).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
          </p>
        </div>
        {!isPinned && (
          <button
            onClick={onRemove}
            className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-foreground-muted hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
            aria-label="Remove"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
        {isPinned && (
          <span className="flex-shrink-0 text-xs text-accent-600 font-semibold px-2 py-0.5 bg-accent-50 dark:bg-accent-900/20 rounded-full">
            This
          </span>
        )}
      </div>
    )
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <div className="flex items-center gap-2 p-3 bg-surface rounded-lg border border-dashed border-border-default">
        <div className="w-12 h-12 rounded-lg border border-dashed border-border-default bg-surface-secondary flex-shrink-0 flex items-center justify-center">
          <svg className="w-5 h-5 text-foreground-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
        </div>
        <div className="flex-1 relative">
          <input
            ref={inputRef}
            value={query}
            onChange={handleInput}
            onFocus={() => results.length > 0 && setOpen(true)}
            placeholder="Search product to compare..."
            className="w-full text-sm bg-transparent outline-none text-foreground placeholder:text-foreground-muted"
          />
          {loading && (
            <div className="absolute right-0 top-1/2 -translate-y-1/2">
              <div className="w-3.5 h-3.5 border-2 border-accent-500 border-t-transparent rounded-full animate-spin" />
            </div>
          )}
        </div>
      </div>
      {open && results.length > 0 && (
        <div className="absolute left-0 right-0 top-full mt-1 z-50 bg-surface-elevated border border-border-default rounded-lg shadow-xl overflow-hidden max-h-64 overflow-y-auto">
          {results.map(r => (
            <button
              key={r.id}
              onMouseDown={() => handleSelect(r)}
              className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-surface-secondary transition-colors text-left"
            >
              <div className="w-9 h-9 rounded border border-border-default bg-surface-secondary flex-shrink-0 overflow-hidden">
                {r.thumbnail_url || r.image_url ? (
                  <img src={r.thumbnail_url || r.image_url!} alt="" className="w-full h-full object-contain p-0.5" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <svg className="w-4 h-4 text-foreground-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground line-clamp-1">{r.name}</p>
                <p className="text-xs text-foreground-muted">
                  {r.brand_name && <span>{r.brand_name} · </span>}
                  ₹{Number(r.price).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </p>
              </div>
              {r.category_id === categoryId && (
                <span className="text-[10px] text-accent-600 bg-accent-50 dark:bg-accent-900/20 px-1.5 py-0.5 rounded font-medium flex-shrink-0">
                  Same cat
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function CompareDrawer({ open, onClose, currentProduct }: CompareDrawerProps) {
  const router = useRouter()
  const { compareList, addToCompare, removeFromCompare } = useCompare()

  // Slots: slot 0 = current product (pinned), slots 1-3 = chosen products
  const slots = compareList.filter(p => p.id !== currentProduct.id).slice(0, 3)
  const allIds = [currentProduct.id, ...slots.map(p => p.id)]

  function handleAdd(p: CompareProduct) {
    addToCompare(p)
  }

  function handleRemove(id: string) {
    removeFromCompare(id)
  }

  function handleCompare() {
    const ids = [currentProduct.id, ...slots.map(p => p.id)]
    if (ids.length >= 2) {
      router.push(`/compare?ids=${ids.join(',')}`)
    } else {
      router.push(`/compare?seed=${currentProduct.id}`)
    }
    onClose()
  }

  // Ensure current product is always in the list
  useEffect(() => {
    addToCompare(currentProduct)
  }, [currentProduct.id])

  // Lock body scroll when open
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [open])

  const emptySlots = 3 - slots.length

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-40 bg-black/40 transition-opacity duration-300 ${open ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={onClose}
      />

      {/* Drawer */}
      <div className={`fixed top-0 right-0 h-full w-full max-w-sm z-50 bg-surface-elevated shadow-2xl flex flex-col transition-transform duration-300 ease-out ${open ? 'translate-x-0' : 'translate-x-full'}`}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-default">
          <h2 className="text-base font-bold text-foreground">Compare Products</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-foreground-muted hover:text-foreground hover:bg-surface-secondary transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Slots */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          <p className="text-xs text-foreground-muted mb-1">Add up to 3 more products to compare side-by-side.</p>

          {/* Current product — pinned */}
          <ProductSlot
            product={currentProduct}
            categoryId={currentProduct.categoryId}
            excludeIds={allIds}
            onAdd={handleAdd}
            onRemove={() => {}}
            isPinned
          />

          {/* Chosen slots */}
          {slots.map((p, i) => (
            <ProductSlot
              key={p.id}
              product={p}
              categoryId={currentProduct.categoryId}
              excludeIds={allIds}
              onAdd={handleAdd}
              onRemove={() => handleRemove(p.id)}
            />
          ))}

          {/* Empty slots */}
          {Array.from({ length: emptySlots }).map((_, i) => (
            <ProductSlot
              key={`empty-${i}`}
              product={null}
              categoryId={currentProduct.categoryId}
              excludeIds={allIds}
              onAdd={handleAdd}
              onRemove={() => {}}
            />
          ))}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-border-default space-y-2">
          <button
            onClick={handleCompare}
            disabled={slots.length === 0}
            className="w-full py-3 rounded-xl font-semibold text-sm transition-all bg-accent-500 hover:bg-accent-600 text-white disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Compare Now ({slots.length + 1} products)
          </button>
          <button
            onClick={onClose}
            className="w-full py-2.5 rounded-xl font-medium text-sm text-foreground-muted hover:text-foreground hover:bg-surface-secondary transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </>
  )
}
