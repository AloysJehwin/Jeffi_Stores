'use client'

import { useState, useEffect, useRef } from 'react'
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
  product_images: Array<{
    image_url: string
    thumbnail_url: string
    is_primary: boolean
  }>
}

export default function SearchBar() {
  const [isOpen, setIsOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [products, setProducts] = useState<Product[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const searchRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus()
    }
  }, [isOpen])

  useEffect(() => {
    if (searchQuery.trim().length < 2) {
      setProducts([])
      return
    }

    const delayDebounce = setTimeout(async () => {
      setIsLoading(true)
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(searchQuery)}`)
        if (response.ok) {
          const data = await response.json()
          setProducts(data.products || [])
        }
      } catch (error) {
        console.error('Search error:', error)
      } finally {
        setIsLoading(false)
      }
    }, 300)

    return () => clearTimeout(delayDebounce)
  }, [searchQuery])

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (searchQuery.trim()) {
      router.push(`/products?search=${encodeURIComponent(searchQuery)}`)
      setIsOpen(false)
      setSearchQuery('')
    }
  }

  const handleProductClick = () => {
    setIsOpen(false)
    setSearchQuery('')
    setProducts([])
  }

  return (
    <div className="relative" ref={searchRef}>
      {/* Search Button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center text-foreground-secondary hover:text-accent-500 transition-colors"
      >
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      </button>

      {/* Search Dropdown */}
      {isOpen && (
        <div className="absolute right-0 top-full mt-2 w-96 max-w-[calc(100vw-2rem)] bg-surface-elevated rounded-lg shadow-xl border border-border-default z-50">
          {/* Search Input */}
          <form onSubmit={handleSearchSubmit} className="p-4 border-b border-border-default">
            <div className="relative">
              <input
                ref={inputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search products..."
                className="w-full px-4 py-2 pr-10 border border-border-secondary rounded-lg bg-surface-secondary text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-accent-500"
              />
              <button
                type="submit"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-foreground-muted hover:text-accent-500"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </button>
            </div>
          </form>

          {/* Search Results */}
          <div className="max-h-96 overflow-y-auto">
            {isLoading ? (
              <div className="p-8 text-center text-foreground-muted">
                <div className="animate-spin w-8 h-8 border-4 border-accent-500 border-t-transparent rounded-full mx-auto"></div>
                <p className="mt-2">Searching...</p>
              </div>
            ) : products.length > 0 ? (
              <div className="py-2">
                {products.map((product) => {
                  const primaryImage = product.product_images?.find(img => img.is_primary) || product.product_images?.[0]
                  const displayPrice = product.has_variants && product.variant_min_price
                    ? product.variant_min_price
                    : (product.sale_price || product.base_price)

                  return (
                    <Link
                      key={product.id}
                      href={`/products/${product.slug}`}
                      onClick={handleProductClick}
                      className="flex items-center gap-3 px-4 py-3 hover:bg-surface-secondary transition-colors"
                    >
                      <div className="w-16 h-16 bg-surface-secondary rounded flex-shrink-0">
                        {primaryImage ? (
                          <img
                            src={primaryImage.thumbnail_url}
                            alt={product.name}
                            className="w-full h-full object-contain p-1"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <svg className="w-8 h-8 text-foreground-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                          </div>
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        <h4 className="text-sm font-medium text-foreground truncate">
                          {product.name}
                        </h4>
                        <p className="text-sm font-semibold text-primary-600 dark:text-primary-400">
                          {product.has_variants ? 'From ' : ''}₹{Number(displayPrice).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </p>
                      </div>

                      <svg className="w-5 h-5 text-foreground-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </Link>
                  )
                })}

                {products.length > 0 && (
                  <div className="border-t border-border-default p-3">
                    <Link
                      href={`/products?search=${encodeURIComponent(searchQuery)}`}
                      onClick={handleProductClick}
                      className="block text-center text-sm text-accent-600 dark:text-accent-400 hover:text-accent-700 dark:hover:text-accent-300 font-medium"
                    >
                      View all results →
                    </Link>
                  </div>
                )}
              </div>
            ) : searchQuery.trim().length >= 2 ? (
              <div className="p-8 text-center text-foreground-muted">
                <svg className="w-16 h-16 mx-auto text-foreground-muted mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <p>No products found</p>
                <p className="text-sm mt-1">Try a different search term</p>
              </div>
            ) : (
              <div className="p-8 text-center text-foreground-muted">
                <p className="text-sm">Start typing to search products...</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
