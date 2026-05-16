'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

interface Product {
  id: string
  name: string
  slug: string
  base_price: number
  sale_price: number | null
  has_variants: boolean
  variant_min_price: number | null
  product_images: Array<{ image_url: string; thumbnail_url: string; is_primary: boolean }>
}

interface Category {
  id: string
  name: string
  slug: string
}

function Highlight({ text, query }: { text: string; query: string }) {
  const trimmed = query.trim()
  if (!trimmed) return <>{text}</>
  const idx = text.toLowerCase().indexOf(trimmed.toLowerCase())
  if (idx === -1) return <>{text}</>
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-accent-100 dark:bg-accent-900/40 text-accent-700 dark:text-accent-300 rounded-sm not-italic font-semibold">
        {text.slice(idx, idx + trimmed.length)}
      </mark>
      {text.slice(idx + trimmed.length)}
    </>
  )
}

export default function SearchBar() {
  const [isOpen, setIsOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [activeIdx, setActiveIdx] = useState(-1)

  const searchRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const router = useRouter()

  const totalItems = categories.length + products.length

  const close = useCallback(() => {
    setIsOpen(false)
    setQuery('')
    setProducts([])
    setCategories([])
    setActiveIdx(-1)
  }, [])

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    if (isOpen) document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [isOpen])

  useEffect(() => {
    if (isOpen && inputRef.current) inputRef.current.focus()
  }, [isOpen])

  useEffect(() => {
    setActiveIdx(-1)
    if (query.trim().length < 2) {
      setProducts([])
      setCategories([])
      return
    }

    const timer = setTimeout(async () => {
      abortRef.current?.abort()
      abortRef.current = new AbortController()
      setIsLoading(true)
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`, {
          signal: abortRef.current.signal,
        })
        if (res.ok) {
          const data = await res.json()
          setProducts(data.products || [])
          setCategories(data.categories || [])
        }
      } catch (err: unknown) {
        if ((err as { name?: string }).name !== 'AbortError') {
          setProducts([])
          setCategories([])
        }
      } finally {
        setIsLoading(false)
      }
    }, 200)

    return () => clearTimeout(timer)
  }, [query])

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!isOpen) return
    if (e.key === 'Escape') { setIsOpen(false); return }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx(i => Math.min(i + 1, totalItems - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx(i => Math.max(i - 1, -1))
    } else if (e.key === 'Enter' && activeIdx >= 0) {
      e.preventDefault()
      const catCount = categories.length
      if (activeIdx < catCount) {
        router.push(`/products?category=${categories[activeIdx].slug}`)
      } else {
        router.push(`/products/${products[activeIdx - catCount].slug}`)
      }
      close()
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (query.trim()) {
      router.push(`/products?search=${encodeURIComponent(query)}`)
      close()
    }
  }

  const hasResults = categories.length > 0 || products.length > 0

  return (
    <div className="relative" ref={searchRef}>
      <button
        type="button"
        onClick={() => setIsOpen(v => !v)}
        className="p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center text-foreground-secondary hover:text-accent-500 transition-colors"
        aria-label="Search"
      >
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      </button>

      {isOpen && (
        <div
          role="combobox"
          aria-expanded={hasResults}
          aria-haspopup="listbox"
          className="fixed inset-x-0 top-16 mx-3 sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:mx-0 w-auto sm:w-[420px] bg-surface-elevated rounded-xl shadow-xl border border-border-default z-50 overflow-hidden"
        >
          <form onSubmit={handleSubmit} className="p-3 border-b border-border-default">
            <div className="relative">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Search products, categories..."
                autoComplete="off"
                className="w-full pl-9 pr-10 py-2.5 border border-border-secondary rounded-lg bg-surface-secondary text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-accent-500 text-sm"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => { setQuery(''); setProducts([]); setCategories([]) }}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-foreground-muted hover:text-foreground transition-colors"
                  aria-label="Clear"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          </form>

          <div className="max-h-[420px] overflow-y-auto" role="listbox">
            {isLoading ? (
              <div className="flex items-center justify-center gap-3 py-8 text-foreground-muted text-sm">
                <div className="w-4 h-4 border-2 border-accent-500 border-t-transparent rounded-full animate-spin" />
                Searching...
              </div>
            ) : hasResults ? (
              <div className="py-1">
                {categories.length > 0 && (
                  <>
                    <p className="px-4 pt-2 pb-1 text-xs font-semibold uppercase tracking-wider text-foreground-muted">Categories</p>
                    {categories.map((cat, idx) => (
                      <Link
                        key={cat.id}
                        href={`/products?category=${cat.slug}`}
                        onClick={close}
                        className={`flex items-center gap-3 px-4 py-2.5 transition-colors ${activeIdx === idx ? 'bg-surface-secondary' : 'hover:bg-surface-secondary'}`}
                      >
                        <span className="flex-shrink-0 w-7 h-7 rounded-md bg-accent-100 dark:bg-accent-900/30 flex items-center justify-center">
                          <svg className="w-3.5 h-3.5 text-accent-600 dark:text-accent-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                          </svg>
                        </span>
                        <span className="text-sm text-foreground">
                          <Highlight text={cat.name} query={query} />
                        </span>
                      </Link>
                    ))}
                  </>
                )}

                {products.length > 0 && (
                  <>
                    <p className="px-4 pt-3 pb-1 text-xs font-semibold uppercase tracking-wider text-foreground-muted">Products</p>
                    {products.map((product, idx) => {
                      const itemIdx = categories.length + idx
                      const primaryImage = product.product_images?.find(img => img.is_primary) || product.product_images?.[0]
                      const displayPrice = product.has_variants && product.variant_min_price
                        ? product.variant_min_price
                        : (product.sale_price || product.base_price)

                      return (
                        <Link
                          key={product.id}
                          href={`/products/${product.slug}`}
                          onClick={close}
                          className={`flex items-center gap-3 px-4 py-2.5 transition-colors ${activeIdx === itemIdx ? 'bg-surface-secondary' : 'hover:bg-surface-secondary'}`}
                        >
                          <div className="w-10 h-10 bg-surface-secondary rounded-lg flex-shrink-0 overflow-hidden border border-border-default">
                            {primaryImage ? (
                              <img src={primaryImage.thumbnail_url} alt={product.name} className="w-full h-full object-contain p-0.5" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center">
                                <svg className="w-5 h-5 text-foreground-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                </svg>
                              </div>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-foreground truncate">
                              <Highlight text={product.name} query={query} />
                            </p>
                            <p className="text-xs text-accent-600 dark:text-accent-400 font-semibold mt-0.5">
                              {product.has_variants ? 'From ' : ''}₹{Number(displayPrice).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                            </p>
                          </div>
                          <svg className="w-4 h-4 text-foreground-muted flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        </Link>
                      )
                    })}
                  </>
                )}

                <div className="border-t border-border-default p-3">
                  <Link
                    href={`/products?search=${encodeURIComponent(query)}`}
                    onClick={close}
                    className="flex items-center justify-center gap-1.5 text-sm text-accent-600 dark:text-accent-400 hover:text-accent-700 dark:hover:text-accent-300 font-medium"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    See all results for &quot;{query}&quot;
                  </Link>
                </div>
              </div>
            ) : query.trim().length >= 2 ? (
              <div className="py-10 text-center text-foreground-muted">
                <svg className="w-10 h-10 mx-auto mb-3 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <p className="text-sm font-medium">No results for &quot;{query}&quot;</p>
                <p className="text-xs mt-1 opacity-70">Try a different term</p>
              </div>
            ) : (
              <div className="py-8 text-center text-foreground-muted text-sm">
                Type at least 2 characters to search
              </div>
            )}
          </div>

          {totalItems > 0 && (
            <div className="px-4 py-2 border-t border-border-default bg-surface-secondary/50">
              <p className="text-xs text-foreground-muted flex items-center gap-2">
                <span className="inline-flex items-center gap-0.5">
                  <kbd className="px-1 py-0.5 text-xs bg-surface-elevated border border-border-default rounded">↑↓</kbd> navigate
                </span>
                <span className="inline-flex items-center gap-0.5">
                  <kbd className="px-1 py-0.5 text-xs bg-surface-elevated border border-border-default rounded">↵</kbd> select
                </span>
                <span className="inline-flex items-center gap-0.5">
                  <kbd className="px-1 py-0.5 text-xs bg-surface-elevated border border-border-default rounded">Esc</kbd> close
                </span>
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
