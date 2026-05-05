'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

type Category = {
  id: string
  name: string
  parent_category_id: string | null
}

type Brand = {
  id: string
  name: string
}

const SORT_OPTIONS = [
  { label: 'Default',            sort: '',            order: '' },
  { label: 'Newest First',       sort: 'created_at',  order: 'desc' },
  { label: 'Name A–Z',           sort: 'name',        order: 'asc' },
  { label: 'Price: Low → High',  sort: 'price',       order: 'asc' },
  { label: 'Price: High → Low',  sort: 'price',       order: 'desc' },
]

export default function MobileFilterSheet({
  categories,
  brands,
}: {
  categories: Category[]
  brands: Brand[]
}) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const mainCats = categories.filter(c => !c.parent_category_id)
  const subCats  = categories.filter(c =>  c.parent_category_id)

  const [open, setOpen] = useState(false)
  const [expandedCats, setExpandedCats] = useState<Record<string, boolean>>({})

  const currentCategory = searchParams.get('category') || ''
  const currentBrand    = searchParams.get('brand') || ''
  const currentSort     = searchParams.get('sort') || ''
  const currentOrder    = searchParams.get('order') || ''

  const [pendingCategories, setPendingCategories] = useState<string[]>(currentCategory ? currentCategory.split(',') : [])
  const [pendingBrands,     setPendingBrands]     = useState<string[]>(currentBrand ? currentBrand.split(',') : [])
  const [pendingSort,       setPendingSort]       = useState(currentSort)
  const [pendingOrder,      setPendingOrder]      = useState(currentOrder)

  useEffect(() => {
    if (open) {
      setPendingCategories(currentCategory ? currentCategory.split(',') : [])
      setPendingBrands(currentBrand ? currentBrand.split(',') : [])
      setPendingSort(currentSort)
      setPendingOrder(currentOrder)
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [open])

  const activeFilterCount = [currentCategory, currentBrand, currentSort].filter(Boolean).length

  function applyFilters() {
    const params = new URLSearchParams()
    if (pendingCategories.length) params.set('category', pendingCategories.join(','))
    if (pendingBrands.length)     params.set('brand',    pendingBrands.join(','))
    if (pendingSort)              params.set('sort',     pendingSort)
    if (pendingOrder)             params.set('order',    pendingOrder)
    const search = searchParams.get('search')
    if (search) params.set('search', search)
    router.push(`/products${params.toString() ? `?${params.toString()}` : ''}`)
    setOpen(false)
  }

  function clearAll() {
    setPendingCategories([])
    setPendingBrands([])
    setPendingSort('')
    setPendingOrder('')
  }

  function toggleCategory(id: string) {
    setPendingCategories(prev =>
      prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]
    )
  }

  function toggleBrand(id: string) {
    setPendingBrands(prev =>
      prev.includes(id) ? prev.filter(b => b !== id) : [...prev, id]
    )
  }

  function selectSort(sort: string, order: string) {
    setPendingSort(sort)
    setPendingOrder(order)
  }

  function toggleExpandCat(id: string) {
    setExpandedCats(prev => ({ ...prev, [id]: !prev[id] }))
  }

  return (
    <>
      {/* Trigger button — mobile only */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="lg:hidden flex items-center gap-2 px-4 py-2 bg-surface-elevated border border-border-default rounded-lg text-foreground font-medium shadow-sm hover:bg-surface-secondary transition-colors mb-4"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 010 2H4a1 1 0 01-1-1zm3 6a1 1 0 011-1h10a1 1 0 010 2H7a1 1 0 01-1-1zm4 6a1 1 0 011-1h4a1 1 0 010 2h-4a1 1 0 01-1-1z" />
        </svg>
        Filters
        {activeFilterCount > 0 && (
          <span className="bg-accent-500 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
            {activeFilterCount}
          </span>
        )}
      </button>

      {/* Bottom sheet */}
      {open && (
        <div className="lg:hidden fixed inset-0 z-50 flex flex-col justify-end">
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />

          {/* Sheet */}
          <div className="relative bg-surface-elevated rounded-t-2xl shadow-2xl flex flex-col max-h-[85vh]">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-border-default shrink-0">
              <h2 className="font-semibold text-foreground text-base">Filters</h2>
              <div className="flex items-center gap-3">
        {(pendingCategories.length > 0 || pendingBrands.length > 0 || pendingSort) && (
                  <button onClick={clearAll} className="text-sm text-accent-500 hover:text-accent-600 font-medium">
                    Clear all
                  </button>
                )}
                <button
                  onClick={() => setOpen(false)}
                  className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-surface transition-colors text-foreground-muted"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Scrollable content */}
            <div className="overflow-y-auto flex-1 px-5 py-4 space-y-6">

              {/* Sort */}
              <div>
                <h3 className="text-sm font-semibold text-foreground mb-3">Sort By</h3>
                <div className="space-y-2">
                  {SORT_OPTIONS.map(opt => {
                    const isSelected = pendingSort === opt.sort && pendingOrder === opt.order
                    return (
                      <button
                        key={opt.label}
                        onClick={() => selectSort(opt.sort, opt.order)}
                        className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border text-sm font-medium transition-colors ${
                          isSelected
                            ? 'border-accent-500 bg-accent-50 dark:bg-accent-900/20 text-accent-700 dark:text-accent-400'
                            : 'border-border-default bg-surface text-foreground hover:bg-surface-secondary'
                        }`}
                      >
                        {opt.label}
                        {isSelected && (
                          <svg className="w-4 h-4 text-accent-500 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                          </svg>
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Categories */}
              <div>
                <h3 className="text-sm font-semibold text-foreground mb-3">Categories</h3>
                <div className="space-y-2">
                  <button
                    onClick={() => setPendingCategories([])}
                    className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border text-sm font-medium transition-colors ${
                      pendingCategories.length === 0
                        ? 'border-accent-500 bg-accent-50 dark:bg-accent-900/20 text-accent-700 dark:text-accent-400'
                        : 'border-border-default bg-surface text-foreground hover:bg-surface-secondary'
                    }`}
                  >
                    All Categories
                    {pendingCategories.length === 0 && (
                      <svg className="w-4 h-4 text-accent-500 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                      </svg>
                    )}
                  </button>
                  {mainCats.map(cat => {
                    const subs = subCats.filter(s => s.parent_category_id === cat.id)
                    const isSelected = pendingCategories.includes(cat.id)
                    const hasSelectedChild = subs.some(s => pendingCategories.includes(s.id))
                    const isExpanded = expandedCats[cat.id]

                    return (
                      <div key={cat.id}>
                        <div className={`flex items-center rounded-xl border transition-colors ${
                          isSelected
                            ? 'border-accent-500 bg-accent-50 dark:bg-accent-900/20'
                            : hasSelectedChild
                            ? 'border-accent-300 dark:border-accent-700 bg-accent-50/50 dark:bg-accent-900/10'
                            : 'border-border-default bg-surface hover:bg-surface-secondary'
                        }`}>
                          <button
                            onClick={() => toggleCategory(cat.id)}
                            className={`flex-1 text-left px-4 py-3 text-sm font-medium ${
                              isSelected ? 'text-accent-700 dark:text-accent-400' : 'text-foreground'
                            }`}
                          >
                            {cat.name}
                          </button>
                          <div className="flex items-center gap-1 pr-3">
                            {isSelected && (
                              <svg className="w-4 h-4 text-accent-500 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                              </svg>
                            )}
                            {subs.length > 0 && (
                              <button
                                onClick={() => toggleExpandCat(cat.id)}
                                className="p-1 text-foreground-muted"
                              >
                                <svg className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                                </svg>
                              </button>
                            )}
                          </div>
                        </div>
                        {subs.length > 0 && isExpanded && (
                          <div className="ml-4 mt-1 space-y-1">
                            {subs.map(sub => {
                              const isSubSelected = pendingCategories.includes(sub.id)
                              return (
                                <button
                                  key={sub.id}
                                  onClick={() => toggleCategory(sub.id)}
                                  className={`w-full flex items-center justify-between px-4 py-2.5 rounded-xl border text-sm transition-colors ${
                                    isSubSelected
                                      ? 'border-accent-500 bg-accent-50 dark:bg-accent-900/20 text-accent-700 dark:text-accent-400 font-medium'
                                      : 'border-border-default bg-surface text-foreground-secondary hover:bg-surface-secondary'
                                  }`}
                                >
                                  {sub.name}
                                  {isSubSelected && (
                                    <svg className="w-4 h-4 text-accent-500 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                                    </svg>
                                  )}
                                </button>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Brands */}
              <div>
                <h3 className="text-sm font-semibold text-foreground mb-3">Brands</h3>
                <div className="space-y-2">
                  <button
                    onClick={() => setPendingBrands([])}
                    className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border text-sm font-medium transition-colors ${
                      pendingBrands.length === 0
                        ? 'border-accent-500 bg-accent-50 dark:bg-accent-900/20 text-accent-700 dark:text-accent-400'
                        : 'border-border-default bg-surface text-foreground hover:bg-surface-secondary'
                    }`}
                  >
                    All Brands
                    {pendingBrands.length === 0 && (
                      <svg className="w-4 h-4 text-accent-500 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                      </svg>
                    )}
                  </button>
                  {brands.map(brand => {
                    const isSelected = pendingBrands.includes(brand.id)
                    return (
                      <button
                        key={brand.id}
                        onClick={() => toggleBrand(brand.id)}
                        className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border text-sm font-medium transition-colors ${
                          isSelected
                            ? 'border-accent-500 bg-accent-50 dark:bg-accent-900/20 text-accent-700 dark:text-accent-400'
                            : 'border-border-default bg-surface text-foreground hover:bg-surface-secondary'
                        }`}
                      >
                        {brand.name}
                        {isSelected && (
                          <svg className="w-4 h-4 text-accent-500 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                          </svg>
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>

            {/* Footer — Apply button */}
            <div className="px-5 py-4 border-t border-border-default shrink-0">
              <button
                onClick={applyFilters}
                className="w-full py-3 bg-accent-500 hover:bg-accent-600 text-white rounded-xl font-semibold text-sm transition-colors"
              >
                Apply Filters
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
