'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import ProductCard from '@/components/visitor/ProductCard'

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

export default function FeaturedForYou() {
  const [products, setProducts] = useState<CardProps[]>([])

  useEffect(() => {
    fetch('/api/recommendations/for-you', { credentials: 'include' })
      .then(r => (r.ok ? r.json() : null))
      .then((data: ApiResponse | null) => {
        // Only show for genuine personalised results. Logged-out visitors get a
        // best-sellers `fallback` — the homepage already has a Best Sellers
        // section, so hide this one for them to avoid duplication.
        if (data && !data.fallback && Array.isArray(data.products)) {
          setProducts(data.products)
        }
      })
      .catch(() => {})
  }, [])

  if (products.length === 0) return null

  return (
    <section className="py-12 md:py-16">
      <div className="container mx-auto px-4">
        <div className="flex items-end justify-between mb-7">
          <div>
            <p className="text-accent-500 text-[10px] font-black uppercase tracking-[0.2em] mb-1">Picked for you</p>
            <h2 className="text-2xl md:text-3xl font-black text-foreground tracking-tight">Featured For You</h2>
          </div>
          <Link href="/products" className="hidden sm:flex items-center gap-1 text-sm text-accent-500 hover:text-accent-400 font-semibold shrink-0 transition-colors">
            Explore more
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
          </Link>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
          {products.map(p => (
            <ProductCard key={p.id} {...p} />
          ))}
        </div>
      </div>
    </section>
  )
}
