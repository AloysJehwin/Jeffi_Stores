'use client'

import { useEffect, useState, type ComponentProps } from 'react'
import ProductCard from '@/components/visitor/ProductCard'
import SectionCarousel from '@/components/visitor/SectionCarousel'

type CardProps = ComponentProps<typeof ProductCard>

const TITLE = 'Customers also viewed'

/** Products viewed in the same sessions as this one (product_views co-views); hidden when there are none. */
export default function CustomersAlsoViewed({ productId }: { productId: string }) {
  const [products, setProducts] = useState<CardProps[]>([])

  useEffect(() => {
    const ctrl = new AbortController()
    fetch(`/api/products/affinity?kind=viewed&ids=${encodeURIComponent(productId)}&limit=8`, { signal: ctrl.signal })
      .then(res => (res.ok ? res.json() : null))
      .then(data => setProducts(Array.isArray(data?.products) ? data.products : []))
      .catch(() => {})
    return () => ctrl.abort()
  }, [productId])

  if (products.length === 0) return null

  return (
    <section className="mt-10" aria-labelledby="also-viewed-heading">
      <h2 id="also-viewed-heading" className="text-2xl font-bold text-foreground mb-6">
        {TITLE}
      </h2>
      <SectionCarousel ariaLabel={TITLE}>
        {products.map(p => (
          <ProductCard key={p.id} {...p} />
        ))}
      </SectionCarousel>
    </section>
  )
}
