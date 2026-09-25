'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import ProductCard from '@/components/visitor/ProductCard'
import BusinessProductCard from '@/components/business/ProductCard'
import { SECTION_COPY_DEFAULTS } from '@/lib/homepage-sections'

const COPY = SECTION_COPY_DEFAULTS.featured_for_you

interface CardProps {
  id: string
  name: string
  slug: string
  hasVariants: boolean
  displayPrice: number
  mrp: number | null
  mrpDiscount: number
  effectiveStock: number
  primaryImage: { image_url: string; thumbnail_url?: string } | null
  brandName: string | null
  categoryName: string | null
  discountPct: number
  extraDeliveryDays: number
  handlingDays: number
}

interface ApiResponse {
  products: CardProps[]
  source?: string
  curated?: boolean
  fallback?: boolean
}

export default function FeaturedForYou({
  variant = 'visitor',
  href = '/products',
  compact = false,
  limit,
  title,
}: { variant?: 'visitor' | 'business'; href?: string; compact?: boolean; limit?: number; title?: string | null } = {}) {
  const [products, setProducts] = useState<CardProps[]>([])
  const Card = variant === 'business' ? BusinessProductCard : ProductCard

  useEffect(() => {
    fetch('/api/recommendations/for-you', { credentials: 'include' })
      .then(r => (r.ok ? r.json() : null))
      .then((data: ApiResponse | null) => {
        // Only show for genuine personalised results. Logged-out visitors get a
        // best-sellers `fallback` — hide this row for them to avoid duplication.
        if (data && !data.fallback && Array.isArray(data.products)) {
          setProducts(data.products)
        }
      })
      .catch(() => {})
  }, [])

  if (products.length === 0) return null

  const shown = typeof limit === 'number' ? products.slice(0, limit) : products

  // Compact, boxed layout — matches the old "You Might Also Like" card so it
  // drops into cart/checkout without changing the surrounding page rhythm.
  if (compact) {
    return (
      <div className="mt-8 bg-surface-elevated rounded-lg shadow-sm border border-border-default p-4 sm:p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-accent-500 text-[10px] font-black uppercase tracking-[0.2em]">{COPY.eyebrow}</p>
            <h3 className="text-lg font-bold text-foreground">{title || COPY.title}</h3>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {shown.map(p => (
            <Card key={p.id} {...p} />
          ))}
        </div>
      </div>
    )
  }

  return (
    <section className="py-12 md:py-16">
      <div className="container mx-auto px-4">
        <div className="flex items-end justify-between mb-7">
          <div>
            <p className="text-accent-500 text-[10px] font-black uppercase tracking-[0.2em] mb-1">{COPY.eyebrow}</p>
            <h2 className="text-2xl md:text-3xl font-black text-foreground tracking-tight">{title || COPY.title}</h2>
          </div>
          <Link href={href} className="hidden sm:flex items-center gap-1 text-sm text-accent-500 hover:text-accent-400 font-semibold shrink-0 transition-colors">
            Explore more
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
          </Link>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
          {shown.map(p => (
            <Card key={p.id} {...p} />
          ))}
        </div>
      </div>
    </section>
  )
}
