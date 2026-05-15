'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

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

export default function ProductsSearch({ defaultValue }: { defaultValue?: string }) {
  const [query, setQuery] = useState(defaultValue || '')
  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [activeIdx, setActiveIdx] = useState(-1)

  const containerRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const router = useRouter()

  const totalItems = categories.length + products.length

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  useEffect(() => {
    setActiveIdx(-1)
    if (query.trim().length < 2) {
      setProducts([])
      setCategories([])
      setOpen(false)
      return
    }

    const timer = setTimeout(async () => {
      abortRef.current?.abort()
      abortRef.current = new AbortController()
      setLoading(true)
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`, {
          signal: abortRef.current.signal,
        })
        if (res.ok) {
          const data = await res.json()
          setProducts(data.products || [])
          setCategories(data.categories || [])
          setOpen(true)
        }
      } catch (err: unknown) {
        if ((err as { name?: string }).name !== 'AbortError') {
          setProducts([])
          setCategories([])
        }
      } finally {
        setLoading(false)
      }
    }, 200)

    return () => clearTimeout(timer)
  }, [query])

  function navigate(href: string) {
    setOpen(false)
    router.push(href)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') { setOpen(false); return }
    if (!open) {
      if (e.key === 'Enter') {
        e.preventDefault()
        if (query.trim()) navigate(`/products?search=${encodeURIComponent(query.trim())}`)
      }
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx(i => Math.min(i + 1, totalItems - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx(i => Math.max(i - 1, -1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (activeIdx >= 0) {
        if (activeIdx < categories.length) {
          navigate(`/products?category=${categories[activeIdx].slug}`)
        } else {
          navigate(`/products/${products[activeIdx - categories.length].slug}`)
        }
      } else if (query.trim()) {
        navigate(`/products?search=${encodeURIComponent(query.trim())}`)
      }
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (query.trim()) navigate(`/products?search=${encodeURIComponent(query.trim())}`)
  }

  const hasResults = categories.length > 0 || products.length > 0

  return (
    <div ref={containerRef} className="relative">
      <form onSubmit={handleSubmit}>
        <div className="relative">
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => { if (query.trim().length >= 2 && hasResults) setOpen(true) }}
            placeholder="Search products..."
            autoComplete="off"
            className="w-full px-4 py-2 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent"
          />
          {loading && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2">
              <div className="w-4 h-4 border-2 border-accent-500 border-t-transparent rounded-full animate-spin" />
            </div>
          )}
        </div>
        <button
          type="submit"
          className="mt-2 w-full bg-accent-500 hover:bg-accent-600 text-white px-4 py-2 rounded-lg font-medium transition-colors"
        >
          Search
        </button>
      </form>

      {open && (
        <div className="absolute left-0 right-0 top-full mt-1 bg-surface-elevated rounded-xl shadow-xl border border-border-default z-50 overflow-hidden">
          <div className="max-h-72 overflow-y-auto" role="listbox">
            {hasResults ? (
              <div className="py-1">
                {categories.length > 0 && (
                  <>
                    <p className="px-3 pt-2 pb-1 text-xs font-semibold uppercase tracking-wider text-foreground-muted">Categories</p>
                    {categories.map((cat, idx) => (
                      <Link
                        key={cat.id}
                        href={`/products?category=${cat.slug}`}
                        onClick={() => setOpen(false)}
                        className={`flex items-center gap-2 px-3 py-2 transition-colors text-sm ${activeIdx === idx ? 'bg-surface-secondary' : 'hover:bg-surface-secondary'}`}
                      >
                        <span className="flex-shrink-0 w-6 h-6 rounded bg-accent-100 dark:bg-accent-900/30 flex items-center justify-center">
                          <svg className="w-3 h-3 text-accent-600 dark:text-accent-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                          </svg>
                        </span>
                        <span className="text-foreground"><Highlight text={cat.name} query={query} /></span>
                      </Link>
                    ))}
                  </>
                )}

                {products.length > 0 && (
                  <>
                    <p className="px-3 pt-2 pb-1 text-xs font-semibold uppercase tracking-wider text-foreground-muted">Products</p>
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
                          onClick={() => setOpen(false)}
                          className={`flex items-center gap-2.5 px-3 py-2 transition-colors ${activeIdx === itemIdx ? 'bg-surface-secondary' : 'hover:bg-surface-secondary'}`}
                        >
                          <div className="w-9 h-9 bg-surface-secondary rounded flex-shrink-0 overflow-hidden border border-border-default">
                            {primaryImage ? (
                              <img src={primaryImage.thumbnail_url} alt={product.name} className="w-full h-full object-contain p-0.5" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center">
                                <svg className="w-4 h-4 text-foreground-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                </svg>
                              </div>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-foreground truncate">
                              <Highlight text={product.name} query={query} />
                            </p>
                            <p className="text-xs text-accent-600 dark:text-accent-400 font-semibold">
                              {product.has_variants ? 'From ' : ''}₹{Number(displayPrice).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                            </p>
                          </div>
                        </Link>
                      )
                    })}
                  </>
                )}

                <div className="border-t border-border-default p-2.5">
                  <Link
                    href={`/products?search=${encodeURIComponent(query)}`}
                    onClick={() => setOpen(false)}
                    className="flex items-center justify-center gap-1.5 text-sm text-accent-600 dark:text-accent-400 hover:text-accent-700 dark:hover:text-accent-300 font-medium"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    See all results for &quot;{query}&quot;
                  </Link>
                </div>
              </div>
            ) : query.trim().length >= 2 ? (
              <div className="py-6 text-center text-foreground-muted text-sm">No results for &quot;{query}&quot;</div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  )
}
