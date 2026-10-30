'use client'

import { useState } from 'react'
import Link from 'next/link'
import CategoryIcon from '@/components/visitor/CategoryIcon'

export interface OfferCategory {
  id: string
  name: string
  slug: string | null
  icon_name: string | null
  subcategories: Array<{ id: string; name: string; slug: string | null }>
}

function CategoryCard({ cat }: { cat: OfferCategory }) {
  const [open, setOpen] = useState(false)
  const hasSubs = cat.subcategories.length > 0

  return (
    <div className="border border-border-default rounded-xl bg-surface hover:border-accent-400 hover:shadow-sm transition-all">
      <div className="group flex items-center gap-4 p-4">
        <div className="w-11 h-11 rounded-lg flex items-center justify-center flex-shrink-0 bg-accent-100 dark:bg-accent-900/30 text-accent-600 dark:text-accent-400">
          <CategoryIcon iconName={cat.icon_name} categoryName={cat.name} className="w-6 h-6" />
        </div>
        <Link href={cat.slug ? `/categories/${cat.slug}` : '/categories'} className="min-w-0 flex-1">
          <h3 className="font-semibold text-foreground group-hover:text-accent-600 transition-colors truncate">
            {cat.name}
          </h3>
          {hasSubs && <p className="text-xs text-foreground-muted">{cat.subcategories.length} subcategories</p>}
        </Link>
        {hasSubs && (
          <button
            type="button"
            aria-label={open ? `Collapse ${cat.name}` : `Expand ${cat.name}`}
            aria-expanded={open}
            onClick={() => setOpen(o => !o)}
            className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-foreground-muted hover:bg-surface-secondary hover:text-accent-600 transition-colors"
          >
            <svg
              className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`}
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

      {hasSubs && open && (
        <div className="px-4 pb-4 pt-1 border-t border-border-default">
          <div className="flex flex-wrap gap-2 pt-3">
            {cat.subcategories.map(sub => (
              <Link
                key={sub.id}
                href={sub.slug ? `/categories/${sub.slug}` : '/categories'}
                className="inline-flex items-center text-xs px-2.5 py-1 rounded-full border border-border-default text-foreground-secondary hover:border-accent-400 hover:text-accent-600 hover:bg-surface-secondary transition-colors"
              >
                {sub.name}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default function CategoryOffer({ categories }: { categories: OfferCategory[] }) {
  // Clean 3-per-row grid (2 on md, 1 on mobile). auto-rows-min so an expanded card grows on
  // its own without stretching its row-mates.
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 auto-rows-min">
      {categories.map(cat => (
        <CategoryCard key={cat.id} cat={cat} />
      ))}
    </div>
  )
}
