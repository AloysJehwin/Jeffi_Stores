'use client'

import { useState, useEffect, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { humanizeLabel } from '@/lib/shared/format'

type Category = { id: string; name: string; parent_category_id: string | null }
type Brand = { id: string; name: string }
type FacetValue = { value: string; count: number }

interface FilterFacets {
  brands?: { id: string; name: string; count: number }[]
  colors?: { value: string; hex: string | null; count: number }[]
  grades: FacetValue[]
  materials: FacetValue[]
  finishes: FacetValue[]
  compliances: FacetValue[]
  origins: FacetValue[]
  inStockCount: number
  onSaleCount: number
  priceMin: number
  priceMax: number
  hasRatings?: boolean
  variantTypes: FacetValue[]
  variantValues: FacetValue[]
  specFacets: { key: string; values: FacetValue[] }[]
}

const SORT_OPTIONS = [
  { label: 'Default', sort: '', order: '' },
  { label: 'Newest First', sort: 'created_at', order: 'desc' },
  { label: 'Name A–Z', sort: 'name', order: 'asc' },
  { label: 'Price: Low → High', sort: 'price', order: 'asc' },
  { label: 'Price: High → Low', sort: 'price', order: 'desc' },
]

function CheckboxFilterSection({
  title,
  items,
  selected,
  onToggle,
}: {
  title: string
  items: FacetValue[]
  selected: string[]
  onToggle: (v: string) => void
}) {
  const [showAll, setShowAll] = useState(false)
  if (items.length === 0) return null
  const visible = showAll ? items : items.slice(0, 6)
  return (
    <div>
      <h3 className="text-sm font-semibold text-foreground mb-3">{title}</h3>
      <div className="space-y-2">
        {visible.map(item => {
          const isSelected = selected.includes(item.value)
          return (
            <button
              key={item.value}
              onClick={() => onToggle(item.value)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border text-sm font-medium transition-colors ${isSelected ? 'border-accent-500 bg-accent-50 dark:bg-accent-900/20 text-accent-700 dark:text-accent-400' : 'border-border-default bg-surface text-foreground hover:bg-surface-secondary'}`}
            >
              <div
                className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 ${isSelected ? 'border-accent-500 bg-accent-500' : 'border-border-strong'}`}
              >
                {isSelected && (
                  <svg
                    className="w-2.5 h-2.5 text-white"
                    viewBox="0 0 10 10"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path d="M1.5 5L4 7.5 8.5 2.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </div>
              <span className="flex-1 text-left">{item.value}</span>
              <span className="text-xs text-foreground-muted">({item.count})</span>
            </button>
          )
        })}
        {items.length > 6 && (
          <button
            onClick={() => setShowAll(v => !v)}
            className="text-sm text-accent-500 hover:text-accent-600 font-medium px-4"
          >
            {showAll ? 'Show less' : `+${items.length - 6} more`}
          </button>
        )}
      </div>
    </div>
  )
}

const EMPTY_FACETS: FilterFacets = {
  grades: [],
  materials: [],
  finishes: [],
  compliances: [],
  origins: [],
  inStockCount: 0,
  onSaleCount: 0,
  priceMin: 0,
  priceMax: 0,
  variantTypes: [],
  variantValues: [],
  specFacets: [],
}

export default function MobileFilterSheet({
  categories,
  brands,
  facets = EMPTY_FACETS,
  basePath = '/products',
  offers = [],
}: {
  categories: Category[]
  brands: Brand[]
  facets?: FilterFacets
  basePath?: string
  offers?: { slug: string; title: string }[]
}) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const mainCats = categories.filter(c => !c.parent_category_id)
  const subCats = categories.filter(c => c.parent_category_id)

  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<'filters' | 'sort'>('filters')
  const [expandedCats, setExpandedCats] = useState<Record<string, boolean>>({})
  const [isPending, startTransition] = useTransition()

  const currentCategory = searchParams.get('category') || ''
  const currentBrand = searchParams.get('brand') || ''
  const currentSort = searchParams.get('sort') || ''
  const currentOrder = searchParams.get('order') || ''

  const [pendingCategories, setPendingCategories] = useState<string[]>(
    currentCategory ? currentCategory.split(',') : []
  )
  const [pendingBrands, setPendingBrands] = useState<string[]>(currentBrand ? currentBrand.split(',') : [])
  const [pendingSort, setPendingSort] = useState(currentSort)
  const [pendingOrder, setPendingOrder] = useState(currentOrder)
  const [pendingMinPrice, setPendingMinPrice] = useState(searchParams.get('minPrice') || '')
  const [pendingMaxPrice, setPendingMaxPrice] = useState(searchParams.get('maxPrice') || '')
  const [pendingInStock, setPendingInStock] = useState(searchParams.get('inStock') === '1')
  const [pendingOnSale, setPendingOnSale] = useState(searchParams.get('onSale') === '1')
  const [pendingOffer, setPendingOffer] = useState(searchParams.get('offer') || '')
  const [pendingMinRating, setPendingMinRating] = useState(searchParams.get('minRating') || '')
  const [pendingColors, setPendingColors] = useState<string[]>(
    searchParams.get('color')?.split(',').filter(Boolean) || []
  )
  const [pendingGrades, setPendingGrades] = useState<string[]>(
    searchParams.get('grade')?.split(',').filter(Boolean) || []
  )
  const [pendingMaterials, setPendingMaterials] = useState<string[]>(
    searchParams.get('material')?.split(',').filter(Boolean) || []
  )
  const [pendingFinishes, setPendingFinishes] = useState<string[]>(
    searchParams.get('finish')?.split(',').filter(Boolean) || []
  )
  const [pendingCompliances, setPendingCompliances] = useState<string[]>(
    searchParams.get('compliance')?.split(',').filter(Boolean) || []
  )
  const [pendingOrigins, setPendingOrigins] = useState<string[]>(
    searchParams.get('origin')?.split(',').filter(Boolean) || []
  )
  const [pendingVariantType, setPendingVariantType] = useState(searchParams.get('variantType') || '')
  const [pendingVariantValue, setPendingVariantValue] = useState(searchParams.get('variantValue') || '')
  const [pendingSpecKey, setPendingSpecKey] = useState(searchParams.get('specKey') || '')
  const [pendingSpecValue, setPendingSpecValue] = useState(searchParams.get('specValue') || '')

  useEffect(() => {
    if (open) {
      setTab('filters')
      setPendingCategories(currentCategory ? currentCategory.split(',') : [])
      setPendingBrands(currentBrand ? currentBrand.split(',') : [])
      setPendingSort(currentSort)
      setPendingOrder(currentOrder)
      setPendingMinPrice(searchParams.get('minPrice') || '')
      setPendingMaxPrice(searchParams.get('maxPrice') || '')
      setPendingInStock(searchParams.get('inStock') === '1')
      setPendingOnSale(searchParams.get('onSale') === '1')
      setPendingOffer(searchParams.get('offer') || '')
      setPendingMinRating(searchParams.get('minRating') || '')
      setPendingColors(searchParams.get('color')?.split(',').filter(Boolean) || [])
      setPendingGrades(searchParams.get('grade')?.split(',').filter(Boolean) || [])
      setPendingMaterials(searchParams.get('material')?.split(',').filter(Boolean) || [])
      setPendingFinishes(searchParams.get('finish')?.split(',').filter(Boolean) || [])
      setPendingCompliances(searchParams.get('compliance')?.split(',').filter(Boolean) || [])
      setPendingOrigins(searchParams.get('origin')?.split(',').filter(Boolean) || [])
      setPendingVariantType(searchParams.get('variantType') || '')
      setPendingVariantValue(searchParams.get('variantValue') || '')
      setPendingSpecKey(searchParams.get('specKey') || '')
      setPendingSpecValue(searchParams.get('specValue') || '')
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [open])

  const activeFilterCount = [
    currentCategory,
    currentBrand,
    currentSort,
    searchParams.get('minPrice'),
    searchParams.get('maxPrice'),
    searchParams.get('inStock'),
    searchParams.get('onSale'),
    searchParams.get('offer'),
    searchParams.get('minRating'),
    searchParams.get('grade'),
    searchParams.get('color'),
    searchParams.get('material'),
    searchParams.get('finish'),
    searchParams.get('compliance'),
    searchParams.get('origin'),
    searchParams.get('variantType'),
    searchParams.get('specKey'),
  ].filter(Boolean).length

  function applyFilters() {
    const params = new URLSearchParams()
    if (pendingCategories.length) params.set('category', pendingCategories.join(','))
    if (pendingBrands.length) params.set('brand', pendingBrands.join(','))
    if (pendingSort) params.set('sort', pendingSort)
    if (pendingOrder) params.set('order', pendingOrder)
    if (pendingMinPrice) params.set('minPrice', pendingMinPrice)
    if (pendingMaxPrice) params.set('maxPrice', pendingMaxPrice)
    if (pendingInStock) params.set('inStock', '1')
    if (pendingOnSale) params.set('onSale', '1')
    if (pendingOffer) params.set('offer', pendingOffer)
    if (pendingMinRating) params.set('minRating', pendingMinRating)
    if (pendingColors.length) params.set('color', pendingColors.join(','))
    if (pendingGrades.length) params.set('grade', pendingGrades.join(','))
    if (pendingMaterials.length) params.set('material', pendingMaterials.join(','))
    if (pendingFinishes.length) params.set('finish', pendingFinishes.join(','))
    if (pendingCompliances.length) params.set('compliance', pendingCompliances.join(','))
    if (pendingOrigins.length) params.set('origin', pendingOrigins.join(','))
    if (pendingVariantType) params.set('variantType', pendingVariantType)
    if (pendingVariantValue) params.set('variantValue', pendingVariantValue)
    if (pendingSpecKey && pendingSpecValue) {
      params.set('specKey', pendingSpecKey)
      params.set('specValue', pendingSpecValue)
    }
    const search = searchParams.get('search')
    if (search) params.set('search', search)
    startTransition(() => {
      router.push(basePath + (params.toString() ? `?${params.toString()}` : ''))
    })
    setOpen(false)
  }

  function clearAll() {
    setPendingCategories([])
    setPendingBrands([])
    setPendingSort('')
    setPendingOrder('')
    setPendingMinPrice('')
    setPendingMaxPrice('')
    setPendingInStock(false)
    setPendingOnSale(false)
    setPendingOffer('')
    setPendingMinRating('')
    setPendingColors([])
    setPendingGrades([])
    setPendingMaterials([])
    setPendingFinishes([])
    setPendingCompliances([])
    setPendingOrigins([])
    setPendingVariantType('')
    setPendingVariantValue('')
    setPendingSpecKey('')
    setPendingSpecValue('')
  }

  function toggleCategory(id: string) {
    setPendingCategories(prev => (prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]))
  }
  function toggleBrand(id: string) {
    setPendingBrands(prev => (prev.includes(id) ? prev.filter(b => b !== id) : [...prev, id]))
  }
  function selectSort(sort: string, order: string) {
    setPendingSort(sort)
    setPendingOrder(order)
  }
  function toggleExpandCat(id: string) {
    setExpandedCats(prev => ({ ...prev, [id]: !prev[id] }))
  }
  function toggleList(val: string, list: string[], setter: (v: string[]) => void) {
    setter(list.includes(val) ? list.filter(x => x !== val) : [...list, val])
  }

  const hasAnyPending =
    pendingCategories.length > 0 ||
    pendingBrands.length > 0 ||
    !!pendingSort ||
    !!pendingMinPrice ||
    !!pendingMaxPrice ||
    pendingInStock ||
    pendingOnSale ||
    !!pendingMinRating ||
    pendingGrades.length > 0 ||
    pendingMaterials.length > 0 ||
    pendingFinishes.length > 0 ||
    pendingCompliances.length > 0 ||
    pendingOrigins.length > 0 ||
    !!pendingVariantType ||
    !!pendingSpecKey

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="lg:hidden flex items-center gap-1.5 px-3 h-9 rounded-lg text-xs font-medium border transition-colors border-border-default text-foreground-secondary hover:bg-surface-secondary"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5h18l-7 8v5l-4 2v-7L3 5z" />
        </svg>
        Filters
        {activeFilterCount > 0 && (
          <span className="bg-accent-500 text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
            {activeFilterCount}
          </span>
        )}
      </button>

      {open && (
        <div className="lg:hidden fixed inset-0 z-50 flex flex-col justify-end">
          <div className="absolute inset-0 bg-black/50 animate-fade-in" onClick={() => setOpen(false)} />
          <div className="relative bg-surface-elevated rounded-t-2xl shadow-2xl flex flex-col max-h-[90vh] animate-slide-up">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border-default shrink-0">
              <span className="font-semibold text-foreground text-base">{tab === 'sort' ? 'Sort By' : 'Filters'}</span>
              <div className="flex items-center gap-3">
                {hasAnyPending && (
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

            <div className="flex items-center px-5 pt-2 border-b border-border-default shrink-0">
              <button
                type="button"
                onClick={() => setTab('filters')}
                className={`flex-1 py-3 text-sm font-semibold border-b-2 -mb-px transition-colors ${tab === 'filters' ? 'border-accent-500 text-accent-600 dark:text-accent-400' : 'border-transparent text-foreground-muted hover:text-foreground'}`}
              >
                Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
              </button>
              <button
                type="button"
                onClick={() => setTab('sort')}
                className={`flex-1 py-3 text-sm font-semibold border-b-2 -mb-px transition-colors ${tab === 'sort' ? 'border-accent-500 text-accent-600 dark:text-accent-400' : 'border-transparent text-foreground-muted hover:text-foreground'}`}
              >
                Sort
              </button>
            </div>

            <div className={`overflow-y-auto flex-1 px-5 py-4 space-y-6 ${tab === 'filters' ? '' : 'hidden'}`}>
              {/* Price Range */}
              <div>
                <h3 className="text-sm font-semibold text-foreground mb-3">Price Range</h3>
                <div className="flex flex-wrap gap-2 mb-3">
                  {[
                    { label: 'Under ₹500', min: '', max: '500' },
                    { label: '₹500–₹2k', min: '500', max: '2000' },
                    { label: '₹2k–₹10k', min: '2000', max: '10000' },
                    { label: '₹10k+', min: '10000', max: '' },
                  ].map(p => {
                    const isActive =
                      pendingMinPrice === p.min && pendingMaxPrice === p.max && (p.min !== '' || p.max !== '')
                    return (
                      <button
                        key={p.label}
                        onClick={() => {
                          setPendingMinPrice(isActive ? '' : p.min)
                          setPendingMaxPrice(isActive ? '' : p.max)
                        }}
                        className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${isActive ? 'border-accent-500 bg-accent-50 dark:bg-accent-900/20 text-accent-700 dark:text-accent-400' : 'border-border-default bg-surface text-foreground-secondary hover:bg-surface-secondary'}`}
                      >
                        {p.label}
                      </button>
                    )
                  })}
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    placeholder="Min ₹"
                    value={pendingMinPrice}
                    onChange={e => setPendingMinPrice(e.target.value)}
                    className="flex-1 min-w-0 px-3 py-2 rounded-xl border border-border-default bg-surface text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-accent-400"
                  />
                  <span className="text-foreground-muted text-sm shrink-0">–</span>
                  <input
                    type="number"
                    placeholder="Max ₹"
                    value={pendingMaxPrice}
                    onChange={e => setPendingMaxPrice(e.target.value)}
                    className="flex-1 min-w-0 px-3 py-2 rounded-xl border border-border-default bg-surface text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-accent-400"
                  />
                </div>
              </div>

              {/* Availability + On Sale */}
              <div>
                <h3 className="text-sm font-semibold text-foreground mb-3">Availability</h3>
                <div className="space-y-2">
                  <button
                    onClick={() => setPendingInStock(v => !v)}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border text-sm font-medium transition-colors ${pendingInStock ? 'border-accent-500 bg-accent-50 dark:bg-accent-900/20 text-accent-700 dark:text-accent-400' : 'border-border-default bg-surface text-foreground hover:bg-surface-secondary'}`}
                  >
                    <div
                      className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 ${pendingInStock ? 'border-accent-500 bg-accent-500' : 'border-border-strong'}`}
                    >
                      {pendingInStock && (
                        <svg
                          className="w-2.5 h-2.5 text-white"
                          viewBox="0 0 10 10"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={2}
                        >
                          <path d="M1.5 5L4 7.5 8.5 2.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </div>
                    In Stock only
                    <span className="ml-auto text-xs text-foreground-muted">({facets.inStockCount})</span>
                  </button>
                  <button
                    onClick={() => setPendingOnSale(v => !v)}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border text-sm font-medium transition-colors ${pendingOnSale ? 'border-accent-500 bg-accent-50 dark:bg-accent-900/20 text-accent-700 dark:text-accent-400' : 'border-border-default bg-surface text-foreground hover:bg-surface-secondary'}`}
                  >
                    <div
                      className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 ${pendingOnSale ? 'border-accent-500 bg-accent-500' : 'border-border-strong'}`}
                    >
                      {pendingOnSale && (
                        <svg
                          className="w-2.5 h-2.5 text-white"
                          viewBox="0 0 10 10"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={2}
                        >
                          <path d="M1.5 5L4 7.5 8.5 2.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </div>
                    On Sale
                    <span className="ml-auto text-xs text-foreground-muted">({facets.onSaleCount})</span>
                  </button>
                </div>
              </div>

              {offers.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-foreground mb-3">Offers</h3>
                  <div className="space-y-2">
                    {offers.map(o => {
                      const active = pendingOffer === o.slug
                      return (
                        <button
                          key={o.slug}
                          onClick={() => setPendingOffer(active ? '' : o.slug)}
                          className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border text-sm font-medium transition-colors ${active ? 'border-accent-500 bg-accent-50 dark:bg-accent-900/20 text-accent-700 dark:text-accent-400' : 'border-border-default bg-surface text-foreground hover:bg-surface-secondary'}`}
                        >
                          <div
                            className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 ${active ? 'border-accent-500 bg-accent-500' : 'border-border-strong'}`}
                          >
                            {active && (
                              <svg
                                className="w-2.5 h-2.5 text-white"
                                viewBox="0 0 10 10"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth={2}
                              >
                                <path d="M1.5 5L4 7.5 8.5 2.5" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            )}
                          </div>
                          {o.title}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Rating */}
              {facets.hasRatings && (
                <div>
                  <h3 className="text-sm font-semibold text-foreground mb-3">Rating</h3>
                  <div className="space-y-2">
                    {(['4', '3'] as const).map(r => (
                      <button
                        key={r}
                        onClick={() => setPendingMinRating(pendingMinRating === r ? '' : r)}
                        className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border text-sm font-medium transition-colors ${pendingMinRating === r ? 'border-accent-500 bg-accent-50 dark:bg-accent-900/20 text-accent-700 dark:text-accent-400' : 'border-border-default bg-surface text-foreground hover:bg-surface-secondary'}`}
                      >
                        {'★'.repeat(Number(r))}
                        {'☆'.repeat(5 - Number(r))} & above
                        {pendingMinRating === r && (
                          <svg className="w-4 h-4 text-accent-500 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                            <path
                              fillRule="evenodd"
                              d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                              clipRule="evenodd"
                            />
                          </svg>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Color */}
              {(facets.colors?.length ?? 0) > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-foreground mb-3">Color</h3>
                  <div className="flex flex-wrap gap-2">
                    {facets.colors!.map(c => {
                      const isSelected = pendingColors.includes(c.value)
                      return (
                        <button
                          key={c.value}
                          onClick={() => toggleList(c.value, pendingColors, setPendingColors)}
                          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-medium border transition-colors ${isSelected ? 'border-accent-500 bg-accent-50 dark:bg-accent-900/20 text-accent-700 dark:text-accent-400' : 'border-border-default bg-surface text-foreground-secondary hover:bg-surface-secondary'}`}
                        >
                          {c.hex && (
                            <span
                              className="w-3 h-3 rounded-full border border-white/20 shrink-0"
                              style={{ background: c.hex }}
                            />
                          )}
                          {c.value}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              <CheckboxFilterSection
                title="Grade"
                items={facets.grades}
                selected={pendingGrades}
                onToggle={v => toggleList(v, pendingGrades, setPendingGrades)}
              />
              <CheckboxFilterSection
                title="Material"
                items={facets.materials}
                selected={pendingMaterials}
                onToggle={v => toggleList(v, pendingMaterials, setPendingMaterials)}
              />
              <CheckboxFilterSection
                title="Finish"
                items={facets.finishes}
                selected={pendingFinishes}
                onToggle={v => toggleList(v, pendingFinishes, setPendingFinishes)}
              />
              <CheckboxFilterSection
                title="Compliance Standard"
                items={facets.compliances}
                selected={pendingCompliances}
                onToggle={v => toggleList(v, pendingCompliances, setPendingCompliances)}
              />
              <CheckboxFilterSection
                title="Country of Origin"
                items={facets.origins}
                selected={pendingOrigins}
                onToggle={v => toggleList(v, pendingOrigins, setPendingOrigins)}
              />

              {/* Variant Dimensions */}
              {facets.variantTypes.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-foreground mb-3">Variant Type</h3>
                  <div className="flex flex-wrap gap-2">
                    {facets.variantTypes.map(vt => {
                      const isActive = pendingVariantType === vt.value
                      return (
                        <button
                          key={vt.value}
                          onClick={() => {
                            setPendingVariantType(isActive ? '' : vt.value)
                            if (isActive) setPendingVariantValue('')
                          }}
                          className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${isActive ? 'border-accent-500 bg-accent-50 dark:bg-accent-900/20 text-accent-700 dark:text-accent-400' : 'border-border-default bg-surface text-foreground-secondary hover:bg-surface-secondary'}`}
                        >
                          {humanizeLabel(vt.value)} <span className="text-foreground-muted">({vt.count})</span>
                        </button>
                      )
                    })}
                  </div>
                  {pendingVariantType && facets.variantValues.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {facets.variantValues.map(vv => {
                        const isActive = pendingVariantValue === vv.value
                        return (
                          <button
                            key={vv.value}
                            onClick={() => setPendingVariantValue(isActive ? '' : vv.value)}
                            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${isActive ? 'border-accent-500 bg-accent-50 dark:bg-accent-900/20 text-accent-700 dark:text-accent-400' : 'border-border-default bg-surface text-foreground-secondary hover:bg-surface-secondary'}`}
                          >
                            {humanizeLabel(vv.value)}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Specifications */}
              {facets.specFacets.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-foreground mb-3">Specifications</h3>
                  {facets.specFacets.slice(0, 4).map(spec => (
                    <div key={spec.key} className="mb-4">
                      <p className="text-xs text-foreground-muted mb-2 font-medium">{humanizeLabel(spec.key)}</p>
                      <div className="flex flex-wrap gap-1.5">
                        {spec.values.slice(0, 8).map(sv => {
                          const isActive = pendingSpecKey === spec.key && pendingSpecValue === sv.value
                          return (
                            <button
                              key={sv.value}
                              onClick={() => {
                                if (isActive) {
                                  setPendingSpecKey('')
                                  setPendingSpecValue('')
                                } else {
                                  setPendingSpecKey(spec.key)
                                  setPendingSpecValue(sv.value)
                                }
                              }}
                              className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${isActive ? 'border-accent-500 bg-accent-50 dark:bg-accent-900/20 text-accent-700 dark:text-accent-400' : 'border-border-default bg-surface text-foreground-secondary hover:bg-surface-secondary'}`}
                            >
                              {humanizeLabel(sv.value)} <span className="text-foreground-muted">({sv.count})</span>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Categories */}
              <div>
                <h3 className="text-sm font-semibold text-foreground mb-3">Categories</h3>
                <div className="space-y-2">
                  <button
                    onClick={() => setPendingCategories([])}
                    className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border text-sm font-medium transition-colors ${pendingCategories.length === 0 ? 'border-accent-500 bg-accent-50 dark:bg-accent-900/20 text-accent-700 dark:text-accent-400' : 'border-border-default bg-surface text-foreground hover:bg-surface-secondary'}`}
                  >
                    All Categories
                    {pendingCategories.length === 0 && (
                      <svg className="w-4 h-4 text-accent-500 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                        <path
                          fillRule="evenodd"
                          d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                          clipRule="evenodd"
                        />
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
                        <div
                          className={`flex items-center rounded-xl border transition-colors ${isSelected ? 'border-accent-500 bg-accent-50 dark:bg-accent-900/20' : hasSelectedChild ? 'border-accent-300 dark:border-accent-700 bg-accent-50/50 dark:bg-accent-900/10' : 'border-border-default bg-surface hover:bg-surface-secondary'}`}
                        >
                          <button
                            onClick={() => toggleCategory(cat.id)}
                            className={`flex-1 text-left px-4 py-3 text-sm font-medium ${isSelected ? 'text-accent-700 dark:text-accent-400' : 'text-foreground'}`}
                          >
                            {cat.name}
                          </button>
                          <div className="flex items-center gap-1 pr-3">
                            {isSelected && (
                              <svg className="w-4 h-4 text-accent-500 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                                <path
                                  fillRule="evenodd"
                                  d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                                  clipRule="evenodd"
                                />
                              </svg>
                            )}
                            {subs.length > 0 && (
                              <button onClick={() => toggleExpandCat(cat.id)} className="p-1 text-foreground-muted">
                                <svg
                                  className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                                  fill="none"
                                  viewBox="0 0 24 24"
                                  stroke="currentColor"
                                  strokeWidth={2}
                                >
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
                                  className={`w-full flex items-center justify-between px-4 py-2.5 rounded-xl border text-sm transition-colors ${isSubSelected ? 'border-accent-500 bg-accent-50 dark:bg-accent-900/20 text-accent-700 dark:text-accent-400 font-medium' : 'border-border-default bg-surface text-foreground-secondary hover:bg-surface-secondary'}`}
                                >
                                  {sub.name}
                                  {isSubSelected && (
                                    <svg
                                      className="w-4 h-4 text-accent-500 shrink-0"
                                      fill="currentColor"
                                      viewBox="0 0 20 20"
                                    >
                                      <path
                                        fillRule="evenodd"
                                        d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                                        clipRule="evenodd"
                                      />
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
                    className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border text-sm font-medium transition-colors ${pendingBrands.length === 0 ? 'border-accent-500 bg-accent-50 dark:bg-accent-900/20 text-accent-700 dark:text-accent-400' : 'border-border-default bg-surface text-foreground hover:bg-surface-secondary'}`}
                  >
                    All Brands
                    {pendingBrands.length === 0 && (
                      <svg className="w-4 h-4 text-accent-500 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                        <path
                          fillRule="evenodd"
                          d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                          clipRule="evenodd"
                        />
                      </svg>
                    )}
                  </button>
                  {brands.map(brand => {
                    const isSelected = pendingBrands.includes(brand.id)
                    return (
                      <button
                        key={brand.id}
                        onClick={() => toggleBrand(brand.id)}
                        className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border text-sm font-medium transition-colors ${isSelected ? 'border-accent-500 bg-accent-50 dark:bg-accent-900/20 text-accent-700 dark:text-accent-400' : 'border-border-default bg-surface text-foreground hover:bg-surface-secondary'}`}
                      >
                        {brand.name}
                        {isSelected && (
                          <svg className="w-4 h-4 text-accent-500 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                            <path
                              fillRule="evenodd"
                              d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                              clipRule="evenodd"
                            />
                          </svg>
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>

            <div className={`overflow-y-auto flex-1 px-5 py-4 space-y-2 ${tab === 'sort' ? '' : 'hidden'}`}>
              {SORT_OPTIONS.map(opt => {
                const isSelected = pendingSort === opt.sort && pendingOrder === opt.order
                return (
                  <button
                    key={opt.label}
                    onClick={() => selectSort(opt.sort, opt.order)}
                    className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border text-sm font-medium transition-colors ${isSelected ? 'border-accent-500 bg-accent-50 dark:bg-accent-900/20 text-accent-700 dark:text-accent-400' : 'border-border-default bg-surface text-foreground hover:bg-surface-secondary'}`}
                  >
                    {opt.label}
                    {isSelected && (
                      <svg className="w-4 h-4 text-accent-500 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                        <path
                          fillRule="evenodd"
                          d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                          clipRule="evenodd"
                        />
                      </svg>
                    )}
                  </button>
                )
              })}
            </div>

            <div className="px-5 py-4 border-t border-border-default shrink-0">
              <button
                onClick={applyFilters}
                disabled={isPending}
                className="w-full py-3 bg-accent-500 hover:bg-accent-600 text-white rounded-xl font-semibold text-sm transition-colors disabled:opacity-60"
              >
                {isPending ? 'Applying…' : 'Apply Filters'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
