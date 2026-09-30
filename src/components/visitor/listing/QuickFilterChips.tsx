'use client'

import { Fragment } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { chipSelected, splitList, toggleChip, type QuickChip } from './quick-filters'

interface QuickFilterChipsProps {
  basePath?: string
  showInStock: boolean
  showOnSale: boolean
  categories: QuickChip[]
  brands: QuickChip[]
}

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`shrink-0 inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-full border whitespace-nowrap transition-colors ${
        active
          ? 'border-accent-500 bg-accent-50 dark:bg-accent-900/20 text-accent-700 dark:text-accent-400 font-medium'
          : 'border-border-default bg-surface-elevated text-foreground-secondary hover:bg-surface-secondary'
      }`}
    >
      {active && (
        <svg
          className="w-3 h-3 shrink-0"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={3}
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      )}
      {label}
    </button>
  )
}

export default function QuickFilterChips({
  basePath = '/products',
  showInStock,
  showOnSale,
  categories,
  brands,
}: QuickFilterChipsProps) {
  const router = useRouter()
  const searchParams = useSearchParams()

  function apply(overrides: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString())
    for (const [key, value] of Object.entries(overrides)) {
      if (value === null || value === '') params.delete(key)
      else params.set(key, value)
    }
    params.delete('page')
    const qs = params.toString()
    router.push(`${basePath}${qs ? `?${qs}` : ''}`)
  }

  const inStock = searchParams.get('inStock') === '1'
  const onSale = searchParams.get('onSale') === '1'
  const categoryParam = searchParams.get('category')
  const brandParam = searchParams.get('brand')
  const selectedCategories = splitList(categoryParam)
  const selectedBrands = splitList(brandParam)

  const groups = [
    [
      ...(showInStock || inStock
        ? [
            <Chip
              key="inStock"
              label="In Stock"
              active={inStock}
              onClick={() => apply({ inStock: inStock ? null : '1' })}
            />,
          ]
        : []),
      ...(showOnSale || onSale
        ? [<Chip key="onSale" label="On Sale" active={onSale} onClick={() => apply({ onSale: onSale ? null : '1' })} />]
        : []),
    ],
    categories.map(c => (
      <Chip
        key={`c-${c.id}`}
        label={c.name}
        active={chipSelected(c, selectedCategories)}
        onClick={() => apply({ category: toggleChip(categoryParam, c) })}
      />
    )),
    brands.map(b => (
      <Chip
        key={`b-${b.id}`}
        label={b.name}
        active={chipSelected(b, selectedBrands)}
        onClick={() => apply({ brand: toggleChip(brandParam, b) })}
      />
    )),
  ].filter(g => g.length > 0)

  if (groups.length === 0) return null

  return (
    <div
      role="group"
      aria-label="Quick filters"
      className="flex items-center gap-2 mb-4 -mx-4 px-4 sm:mx-0 sm:px-0 overflow-x-auto sm:flex-wrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {groups.map((chips, i) => (
        <Fragment key={i}>
          {i > 0 && <span aria-hidden="true" className="shrink-0 w-px h-5 bg-border-default" />}
          {chips}
        </Fragment>
      ))}
    </div>
  )
}
