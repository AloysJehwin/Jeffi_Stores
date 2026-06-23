'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'

interface CompareChangeButtonProps {
  productId: string
  currentIds: string[]
  categoryId: string | null
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

export default function CompareChangeButton({ productId, currentIds, categoryId }: CompareChangeButtonProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50)
  }, [open])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const search = useCallback(async (q: string) => {
    if (q.length < 2) { setResults([]); return }
    setLoading(true)
    try {
      const params = new URLSearchParams({ q, limit: '8' })
      if (categoryId) params.set('categoryId', categoryId)
      // Exclude all currently displayed products except the one being replaced
      currentIds.filter(id => id !== productId).forEach(id => params.append('excludeId', id))
      const res = await fetch(`/api/products/search?${params}`)
      setResults(await res.json())
    } catch {
      setResults([])
    } finally {
      setLoading(false)
    }
  }, [categoryId, currentIds, productId])

  function handleInput(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value
    setQuery(val)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => search(val), 280)
  }

  function handleSelect(r: SearchResult) {
    const newIds = currentIds.map(id => id === productId ? r.id : id)
    router.push(`/compare?ids=${newIds.join(',')}`)
    setOpen(false)
    setQuery('')
    setResults([])
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setOpen(v => !v)}
        className="text-xs text-accent-500 hover:text-accent-600 hover:underline font-medium"
      >
        Change
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1.5 z-50 w-72 bg-surface-elevated border border-border-default rounded-xl shadow-2xl overflow-hidden">
          {/* Search input */}
          <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border-default">
            <svg className="w-3.5 h-3.5 text-foreground-muted flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
            </svg>
            <input
              ref={inputRef}
              value={query}
              onChange={handleInput}
              placeholder="Search product…"
              className="flex-1 text-sm bg-transparent outline-none text-foreground placeholder:text-foreground-muted"
            />
            {loading && (
              <div className="w-3.5 h-3.5 border-2 border-accent-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
            )}
          </div>

          {/* Results */}
          {results.length > 0 ? (
            <div className="max-h-64 overflow-y-auto">
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
          ) : query.length >= 2 && !loading ? (
            <p className="px-4 py-3 text-sm text-foreground-muted">No products found.</p>
          ) : query.length < 2 ? (
            <p className="px-4 py-3 text-xs text-foreground-muted">Type at least 2 characters to search.</p>
          ) : null}
        </div>
      )}
    </div>
  )
}
