'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { humanizeLabel } from '@/lib/format'

type FacetValue = { value: string; count: number }

type CategoryItem = { id: string; name: string; slug: string; parent_category_id: string | null }
type ColorFacet = { value: string; hex: string | null; count: number }
type BrandFacet = { id: string; name: string; count: number }

interface FilterSidebarProps {
  basePath?: string
  categories?: CategoryItem[]
  offers?: { slug: string; title: string }[]
  facets: {
    brands: BrandFacet[]
    colors: ColorFacet[]
    grades: FacetValue[]
    materials: FacetValue[]
    finishes: FacetValue[]
    compliances: FacetValue[]
    origins: FacetValue[]
    inStockCount: number
    onSaleCount: number
    priceMin: number
    priceMax: number
    variantTypes: FacetValue[]
    variantValues: FacetValue[]
    specFacets: { key: string; values: FacetValue[] }[]
  }
}

// brand is now a filter param, not just a preserved param
const PRESERVED_PARAMS = ['search', 'sort', 'order', 'category'] as const

const PRICE_PRESETS: { label: string; min: number | null; max: number | null }[] = [
  { label: 'Under ₹500', min: null, max: 500 },
  { label: '₹500 – ₹2,000', min: 500, max: 2000 },
  { label: '₹2,000 – ₹10,000', min: 2000, max: 10000 },
  { label: '₹10,000+', min: 10000, max: null },
]

const CheckIcon = () => (
  <svg className="w-4 h-4 text-accent-500 shrink-0" fill="currentColor" viewBox="0 0 20 20">
    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
  </svg>
)

function Section({
  title,
  children,
  open,
  onToggle,
}: {
  title: string
  children: React.ReactNode
  open: boolean
  onToggle: () => void
}) {
  return (
    <div className="border-b border-border-default pb-4 mb-4 last:border-0 last:mb-0 last:pb-0">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between mb-3 text-left"
      >
        <span className="font-semibold text-foreground text-sm">{title}</span>
        <svg
          className={`w-4 h-4 text-foreground-muted transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && <div>{children}</div>}
    </div>
  )
}

function CheckboxRow({
  label,
  count,
  active,
  onToggle,
}: {
  label: string
  count?: number
  active: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="w-full flex items-center gap-2 py-1.5 text-left group"
    >
      <span
        className={`shrink-0 w-4 h-4 rounded border flex items-center justify-center transition-colors ${
          active
            ? 'bg-accent-500 border-accent-500'
            : 'border-border-secondary group-hover:border-accent-300'
        }`}
      >
        {active && (
          <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        )}
      </span>
      <span className={`flex-1 text-sm ${active ? 'text-accent-700 dark:text-accent-400 font-medium' : 'text-foreground-secondary'}`}>
        {label}
      </span>
      {typeof count === 'number' && (
        <span className="text-xs text-foreground-muted shrink-0">{count}</span>
      )}
    </button>
  )
}

const STORAGE_KEY = 'filter_sidebar_sections_v2'
const DEFAULT_OPEN_SECTIONS = ['Categories', 'Price Range', 'Availability', 'Offers', 'Brand', 'Color']

export default function FilterSidebar({ basePath = '/products', categories = [], facets, offers = [] }: FilterSidebarProps) {
  const router = useRouter()
  const searchParams = useSearchParams()

  // Price inputs
  const currentMinPrice = searchParams.get('minPrice') || ''
  const currentMaxPrice = searchParams.get('maxPrice') || ''
  const [minInput, setMinInput] = useState(currentMinPrice)
  const [maxInput, setMaxInput] = useState(currentMaxPrice)

  // Section open/closed — persisted in localStorage so filter changes don't reset them
  const [sections, setSections] = useState<Record<string, boolean>>(() => {
    const defaults = Object.fromEntries(DEFAULT_OPEN_SECTIONS.map(k => [k, true]))
    if (typeof window === 'undefined') return defaults
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
      return { ...defaults, ...saved }
    } catch {
      return defaults
    }
  })

  function toggleSection(title: string) {
    setSections(prev => {
      const next = { ...prev, [title]: !prev[title] }
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)) } catch {}
      return next
    })
  }

  function sectionOpen(title: string): boolean {
    // Only open if explicitly true — unknown sections are closed by default
    return sections[title] === true
  }

  // "show more" expanders for long lists (brands, grades, etc.)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  function buildUrl(overrides: Record<string, string | null>): string {
    const params = new URLSearchParams()

    // Preserve the always-kept params from the current URL first
    for (const key of PRESERVED_PARAMS) {
      const v = searchParams.get(key)
      if (v) params.set(key, v)
    }

    // Carry over any existing filter params not in the preserved set
    searchParams.forEach((value, key) => {
      if ((PRESERVED_PARAMS as readonly string[]).includes(key)) return
      if (key === 'page') return
      if (value) params.set(key, value)
    })

    // Apply overrides (null deletes)
    for (const [key, value] of Object.entries(overrides)) {
      if (value === null || value === '') params.delete(key)
      else params.set(key, value)
    }

    // Any filter change resets pagination
    params.delete('page')

    const qs = params.toString()
    return `${basePath}${qs ? `?${qs}` : ''}`
  }

  function apply(overrides: Record<string, string | null>) {
    router.push(buildUrl(overrides))
  }

  // ---- Multi-select comma param helpers ----
  function selectedList(param: string): string[] {
    const raw = searchParams.get(param)
    return raw ? raw.split(',').filter(Boolean) : []
  }

  function toggleInList(param: string, value: string) {
    const current = selectedList(param)
    const next = current.includes(value)
      ? current.filter(v => v !== value)
      : [...current, value]
    apply({ [param]: next.length ? next.join(',') : null })
  }

  function toggleExpand(key: string) {
    setExpanded(prev => ({ ...prev, [key]: !prev[key] }))
  }

  // ---- Current state reads ----
  const inStockOnly = searchParams.get('inStock') === '1'
  const onSaleActive = searchParams.get('onSale') === '1'
  const currentOffer = searchParams.get('offer') || ''
  const currentRating = searchParams.get('minRating') || ''
  const currentVariantType = searchParams.get('variantType') || ''
  const currentVariantValue = searchParams.get('variantValue') || ''
  const currentSpecKey = searchParams.get('specKey') || ''
  const currentSpecValue = searchParams.get('specValue') || ''

  const FILTER_PARAMS = [
    'brand', 'color',
    'minPrice', 'maxPrice', 'inStock', 'onSale', 'offer', 'minRating',
    'grade', 'material', 'finish', 'compliance', 'origin',
    'variantType', 'variantValue', 'specKey', 'specValue',
  ]
  const anyFilterActive = FILTER_PARAMS.some(p => searchParams.get(p))

  function clearAll() {
    setMinInput('')
    setMaxInput('')
    const params = new URLSearchParams()
    for (const key of PRESERVED_PARAMS) {
      const v = searchParams.get(key)
      if (v) params.set(key, v)
    }
    const qs = params.toString()
    router.push(`${basePath}${qs ? `?${qs}` : ''}`)
  }

  function applyPriceInputs() {
    apply({
      minPrice: minInput.trim() ? minInput.trim() : null,
      maxPrice: maxInput.trim() ? maxInput.trim() : null,
    })
  }

  // Reusable multi-select facet section with show-more
  function FacetCheckboxSection({
    title,
    param,
    values,
  }: {
    title: string
    param: string
    values: FacetValue[]
  }) {
    if (values.length === 0) return null
    const selected = selectedList(param)
    const isExpanded = expanded[param]
    const visible = isExpanded ? values : values.slice(0, 6)
    return (
      <Section title={title} open={sectionOpen(title)} onToggle={() => toggleSection(title)}>
        <div>
          {visible.map(v => (
            <CheckboxRow
              key={v.value}
              label={v.value}
              count={v.count}
              active={selected.includes(v.value)}
              onToggle={() => toggleInList(param, v.value)}
            />
          ))}
          {values.length > 6 && (
            <button
              type="button"
              onClick={() => toggleExpand(param)}
              className="mt-1 text-xs font-medium text-accent-500 hover:text-accent-600"
            >
              {isExpanded ? 'Show less' : `Show ${values.length - 6} more`}
            </button>
          )}
        </div>
      </Section>
    )
  }

  return (
    <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default p-4 sm:p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-bold text-lg text-foreground">Filters</h2>
        {anyFilterActive && (
          <button
            type="button"
            onClick={clearAll}
            className="text-sm text-accent-500 hover:text-accent-600 font-medium"
          >
            Clear all
          </button>
        )}
      </div>

      {/* 0. Categories */}
      {categories.length > 0 && (() => {
        const mainCats = categories.filter(c => !c.parent_category_id)
        const subCats = categories.filter(c => c.parent_category_id)
        const activeCats = selectedList('category')
        return (
          <Section title="Categories" open={sectionOpen('Categories')} onToggle={() => toggleSection('Categories')}>
            <div className="space-y-0.5">
              <button type="button"
                onClick={() => apply({ category: null })}
                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm transition-colors ${activeCats.length === 0 ? 'text-accent-700 dark:text-accent-400 font-medium bg-accent-50 dark:bg-accent-900/20' : 'text-foreground-secondary hover:bg-surface-secondary'}`}>
                All Categories
              </button>
              {mainCats.map(cat => {
                const subs = subCats.filter(s => s.parent_category_id === cat.id)
                const isActive = activeCats.includes(cat.id) || activeCats.includes(cat.slug)
                const hasActiveChild = subs.some(s => activeCats.includes(s.id) || activeCats.includes(s.slug))
                return (
                  <div key={cat.id}>
                    <button type="button"
                      onClick={() => {
                        const next = isActive
                          ? activeCats.filter(v => v !== cat.id && v !== cat.slug)
                          : [...activeCats.filter(v => v !== cat.id && v !== cat.slug), cat.id]
                        apply({ category: next.length ? next.join(',') : null })
                      }}
                      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm font-medium transition-colors ${isActive || hasActiveChild ? 'text-accent-700 dark:text-accent-400 bg-accent-50 dark:bg-accent-900/20' : 'text-foreground hover:bg-surface-secondary'}`}>
                      {(isActive || hasActiveChild) && <CheckIcon />}
                      {cat.name}
                    </button>
                    {/* Show sub-categories only when this parent is active */}
                    {(isActive || hasActiveChild) && subs.map(sub => {
                      const isSubActive = activeCats.includes(sub.id) || activeCats.includes(sub.slug)
                      return (
                        <button key={sub.id} type="button"
                          onClick={() => {
                            const next = isSubActive
                              ? activeCats.filter(v => v !== sub.id && v !== sub.slug)
                              : [...activeCats.filter(v => v !== sub.id && v !== sub.slug), sub.id]
                            apply({ category: next.length ? next.join(',') : null })
                          }}
                          className={`w-full flex items-center gap-2 pl-5 pr-2 py-1.5 rounded-lg text-sm transition-colors ${isSubActive ? 'text-accent-700 dark:text-accent-400 font-medium bg-accent-50 dark:bg-accent-900/20' : 'text-foreground-secondary hover:bg-surface-secondary'}`}>
                          {isSubActive && <CheckIcon />}
                          {sub.name}
                        </button>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          </Section>
        )
      })()}

      {/* 1. Price Range */}
      <Section title="Price Range" open={sectionOpen("Price Range")} onToggle={() => toggleSection("Price Range")}>
        <p className="text-sm text-foreground-secondary mb-3">
          ₹{facets.priceMin.toLocaleString('en-IN')} – ₹{facets.priceMax.toLocaleString('en-IN')}
        </p>
        <div className="flex items-center gap-2 mb-3">
          <input
            type="number"
            inputMode="numeric"
            placeholder="Min"
            value={minInput}
            onChange={e => setMinInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') applyPriceInputs() }}
            className="w-full min-w-0 px-2 py-1.5 text-sm rounded-lg border border-border-default bg-surface text-foreground focus:outline-none focus:ring-1 focus:ring-accent-500"
          />
          <span className="text-foreground-muted text-sm">–</span>
          <input
            type="number"
            inputMode="numeric"
            placeholder="Max"
            value={maxInput}
            onChange={e => setMaxInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') applyPriceInputs() }}
            className="w-full min-w-0 px-2 py-1.5 text-sm rounded-lg border border-border-default bg-surface text-foreground focus:outline-none focus:ring-1 focus:ring-accent-500"
          />
          <button
            type="button"
            onClick={applyPriceInputs}
            className="shrink-0 px-3 py-1.5 text-sm font-medium bg-accent-500 hover:bg-accent-600 text-white rounded-lg transition-colors"
          >
            Go
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {PRICE_PRESETS.map(preset => {
            const active =
              (preset.min === null ? !currentMinPrice : currentMinPrice === String(preset.min)) &&
              (preset.max === null ? !currentMaxPrice : currentMaxPrice === String(preset.max))
            return (
              <button
                key={preset.label}
                type="button"
                onClick={() => {
                  setMinInput(preset.min === null ? '' : String(preset.min))
                  setMaxInput(preset.max === null ? '' : String(preset.max))
                  apply({
                    minPrice: preset.min === null ? null : String(preset.min),
                    maxPrice: preset.max === null ? null : String(preset.max),
                  })
                }}
                className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                  active
                    ? 'border-accent-500 bg-accent-50 dark:bg-accent-900/20 text-accent-700 dark:text-accent-400 font-medium'
                    : 'border-border-default text-foreground-secondary hover:bg-surface-secondary'
                }`}
              >
                {preset.label}
              </button>
            )
          })}
        </div>
      </Section>

      {/* 2. Availability */}
      <Section title="Availability" open={sectionOpen("Availability")} onToggle={() => toggleSection("Availability")}>
        <CheckboxRow
          label="In Stock"
          count={facets.inStockCount}
          active={inStockOnly}
          onToggle={() => apply({ inStock: inStockOnly ? null : '1' })}
        />
        <CheckboxRow
          label="Include Out of Stock"
          active={!inStockOnly}
          onToggle={() => apply({ inStock: inStockOnly ? null : '1' })}
        />
      </Section>

      {/* 3. On Sale */}
      <Section title="Offers" open={sectionOpen("Offers")} onToggle={() => toggleSection("Offers")}>
        <button
          type="button"
          onClick={() => apply({ onSale: onSaleActive ? null : '1' })}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-full border transition-colors ${
            onSaleActive
              ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 font-medium'
              : 'border-border-default text-foreground-secondary hover:bg-surface-secondary'
          }`}
        >
          <svg viewBox="0 0 14 14" className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 1h5.5l6 6a1.5 1.5 0 0 1 0 2.1l-3.4 3.4a1.5 1.5 0 0 1-2.1 0L1 6.5V1Z" />
              <circle cx="4" cy="4" r="0.75" fill="currentColor" stroke="none" />
            </svg>
            On Sale
          {facets.onSaleCount > 0 && (
            <span className="text-xs text-foreground-muted">({facets.onSaleCount})</span>
          )}
        </button>
        {offers.length > 0 && (
          <div className="mt-3 space-y-0.5">
            {offers.map(o => (
              <CheckboxRow
                key={o.slug}
                label={o.title}
                active={currentOffer === o.slug}
                onToggle={() => apply({ offer: currentOffer === o.slug ? null : o.slug })}
              />
            ))}
          </div>
        )}
      </Section>

      {/* 4. Brand */}
      {facets.brands.length > 0 && (
        <Section title="Brand" open={sectionOpen("Brand")} onToggle={() => toggleSection("Brand")}>
          <div className="space-y-1">
            {(expanded['brand'] ? facets.brands : facets.brands.slice(0, 6)).map(b => {
              const selected = selectedList('brand')
              const active = selected.includes(b.id)
              return (
                <button key={b.id} type="button"
                  onClick={() => {
                    const next = active ? selected.filter(v => v !== b.id) : [...selected, b.id]
                    apply({ brand: next.length ? next.join(',') : null })
                  }}
                  className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-sm transition-colors hover:bg-surface-secondary text-left"
                >
                  <div className={`shrink-0 w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${active ? 'border-accent-500 bg-accent-500' : 'border-border-strong'}`}>
                    {active && <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth={2}><path d="M1.5 5L4 7.5 8.5 2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                  </div>
                  <span className={`flex-1 truncate ${active ? 'text-accent-700 dark:text-accent-400 font-medium' : 'text-foreground'}`}>{b.name}</span>
                  <span className="text-xs text-foreground-muted shrink-0">({b.count})</span>
                </button>
              )
            })}
            {facets.brands.length > 6 && (
              <button type="button" onClick={() => toggleExpand('brand')}
                className="text-xs text-accent-500 hover:text-accent-600 font-medium px-2 pt-1">
                {expanded['brand'] ? 'Show less' : `+${facets.brands.length - 6} more`}
              </button>
            )}
          </div>
        </Section>
      )}

      {/* 5. Color */}
      {facets.colors.length > 0 && (
        <Section title="Color" open={sectionOpen("Color")} onToggle={() => toggleSection("Color")}>
          <div className="flex flex-wrap gap-2">
            {facets.colors.map(c => {
              const selectedColors = selectedList('color')
              const active = selectedColors.includes(c.value)
              return (
                <button key={c.value} type="button"
                  onClick={() => {
                    const next = active ? selectedColors.filter(v => v !== c.value) : [...selectedColors, c.value]
                    apply({ color: next.length ? next.join(',') : null })
                  }}
                  title={`${c.value} (${c.count})`}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border transition-all ${active ? 'border-accent-500 ring-2 ring-accent-300 dark:ring-accent-700 font-medium text-accent-700 dark:text-accent-400' : 'border-border-default text-foreground-secondary hover:border-border-strong'}`}
                >
                  {c.hex && (
                    <span className="w-3 h-3 rounded-full border border-white/20 shrink-0" style={{ background: c.hex }} />
                  )}
                  {c.value}
                </button>
              )
            })}
          </div>
        </Section>
      )}

      {/* Rating section omitted — avg_rating column not yet in schema */}

      {/* 5–9. Multi-select facets */}
      <FacetCheckboxSection title="Grade" param="grade" values={facets.grades} />
      <FacetCheckboxSection title="Material" param="material" values={facets.materials} />
      <FacetCheckboxSection title="Finish" param="finish" values={facets.finishes} />
      <FacetCheckboxSection title="Compliance Standard" param="compliance" values={facets.compliances} />
      <FacetCheckboxSection title="Country of Origin" param="origin" values={facets.origins} />

      {/* 10. Variant Dimensions */}
      {facets.variantTypes.length > 0 && (
        <Section title="Variant Dimensions" open={sectionOpen("Variant Dimensions")} onToggle={() => toggleSection("Variant Dimensions")}>
          <div className="flex flex-wrap gap-2 mb-3">
            {facets.variantTypes.map(vt => {
              const active = currentVariantType === vt.value
              return (
                <button
                  key={vt.value}
                  type="button"
                  onClick={() =>
                    apply({
                      variantType: active ? null : vt.value,
                      // switching type clears any previously chosen value
                      variantValue: null,
                    })
                  }
                  className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                    active
                      ? 'border-accent-500 bg-accent-50 dark:bg-accent-900/20 text-accent-700 dark:text-accent-400 font-medium'
                      : 'border-border-default text-foreground-secondary hover:bg-surface-secondary'
                  }`}
                >
                  {humanizeLabel(vt.value)}
                  {typeof vt.count === 'number' && (
                    <span className="ml-1 text-foreground-muted">{vt.count}</span>
                  )}
                </button>
              )
            })}
          </div>
          {currentVariantType && facets.variantValues.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {facets.variantValues.map(vv => {
                const active = currentVariantValue === vv.value
                return (
                  <button
                    key={vv.value}
                    type="button"
                    onClick={() => apply({ variantValue: active ? null : vv.value })}
                    className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                      active
                        ? 'border-accent-500 bg-accent-50 dark:bg-accent-900/20 text-accent-700 dark:text-accent-400 font-medium'
                        : 'border-border-default text-foreground-secondary hover:bg-surface-secondary'
                    }`}
                  >
                    {humanizeLabel(vv.value)}
                    {typeof vv.count === 'number' && (
                      <span className="ml-1 text-foreground-muted">{vv.count}</span>
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </Section>
      )}

      {/* 11. Specifications */}
      {facets.specFacets.length > 0 && (
        <>
          {facets.specFacets.map(spec => {
            const active = currentSpecKey === spec.key
            return (
              <Section key={spec.key} title={humanizeLabel(spec.key)} open={sectionOpen(spec.key)} onToggle={() => toggleSection(spec.key)}>
                <div className="flex flex-wrap gap-2">
                  {spec.values.map(sv => {
                    const isActive = active && currentSpecValue === sv.value
                    return (
                      <button
                        key={sv.value}
                        type="button"
                        onClick={() =>
                          apply({
                            specKey: isActive ? null : spec.key,
                            specValue: isActive ? null : sv.value,
                          })
                        }
                        className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                          isActive
                            ? 'border-accent-500 bg-accent-50 dark:bg-accent-900/20 text-accent-700 dark:text-accent-400 font-medium'
                            : 'border-border-default text-foreground-secondary hover:bg-surface-secondary'
                        }`}
                      >
                        {humanizeLabel(sv.value)}
                        {typeof sv.count === 'number' && (
                          <span className="ml-1 text-foreground-muted">{sv.count}</span>
                        )}
                      </button>
                    )
                  })}
                </div>
              </Section>
            )
          })}
        </>
      )}
    </div>
  )
}
