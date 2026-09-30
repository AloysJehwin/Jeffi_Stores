'use client'

import { useState } from 'react'
import Link from 'next/link'
import ProductCard from '@/components/visitor/ProductCard'
import type { CardProps } from '@/lib/catalog/product-card-props'
import { SECTION_COPY_DEFAULTS } from '@/lib/catalog/homepage-sections'

const COPY = SECTION_COPY_DEFAULTS.category_tabs

export interface CategoryTabData {
  id: string
  name: string
  slug: string
  products: CardProps[]
}

interface CategoryTabsProps {
  tabs: CategoryTabData[]
  eyebrow?: string | null
  title?: string | null
}

export default function CategoryTabs({ tabs, eyebrow, title }: CategoryTabsProps) {
  const [active, setActive] = useState(0)
  const current = tabs[Math.min(active, tabs.length - 1)]

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    e.preventDefault()
    const next = (active + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
    setActive(next)
    document.getElementById(`category-tab-${tabs[next].id}`)?.focus()
  }

  return (
    <section className="py-12 md:py-16 bg-surface">
      <div className="container mx-auto px-4">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-6">
          <div>
            <p className="text-accent-500 text-[10px] font-black uppercase tracking-[0.2em] mb-1">
              {eyebrow ?? COPY.eyebrow}
            </p>
            <h2 className="text-2xl md:text-4xl font-black text-foreground tracking-tight">{title ?? COPY.title}</h2>
          </div>
          <div
            role="tablist"
            aria-label={title ?? COPY.title}
            onKeyDown={onKeyDown}
            className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1"
          >
            {tabs.map((tab, i) => {
              const selected = tab.id === current.id
              return (
                <button
                  key={tab.id}
                  id={`category-tab-${tab.id}`}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  aria-controls={`category-panel-${tab.id}`}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => setActive(i)}
                  className={`shrink-0 px-4 py-2 rounded-full text-sm font-semibold border transition-colors ${
                    selected
                      ? 'bg-accent-500 border-accent-500 text-white'
                      : 'bg-surface-elevated border-border-default text-foreground hover:border-accent-400'
                  }`}
                >
                  {tab.name}
                </button>
              )
            })}
          </div>
        </div>

        <div id={`category-panel-${current.id}`} role="tabpanel" aria-labelledby={`category-tab-${current.id}`}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-5">
            {current.products.map(p => (
              <ProductCard key={p.id} {...p} />
            ))}
          </div>
          <div className="text-center mt-7">
            <Link
              href={`/products?category=${encodeURIComponent(current.slug)}`}
              className="inline-flex items-center gap-1 text-sm text-accent-500 hover:text-accent-400 font-semibold"
            >
              View all {current.name}
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          </div>
        </div>
      </div>
    </section>
  )
}
