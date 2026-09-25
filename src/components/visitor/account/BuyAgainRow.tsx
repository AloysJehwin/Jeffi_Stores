'use client'

import { useEffect, useState, type ComponentProps } from 'react'
import Link from 'next/link'
import ProductCard from '@/components/visitor/ProductCard'
import SectionCarousel from '@/components/visitor/SectionCarousel'

type CardProps = ComponentProps<typeof ProductCard>

export default function BuyAgainRow() {
  const [products, setProducts] = useState<CardProps[]>([])

  useEffect(() => {
    let cancelled = false
    fetch('/api/account/buy-again', { credentials: 'include' })
      .then(r => (r.ok ? r.json() : { products: [] }))
      .then(data => { if (!cancelled) setProducts(Array.isArray(data.products) ? data.products : []) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  if (products.length === 0) return null

  return (
    <div className="bg-surface-elevated rounded-xl border border-border-default p-4 sm:p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-foreground">Buy again</h2>
        <Link href="/account/orders" className="text-xs text-accent-600 hover:text-accent-700 dark:text-accent-400 font-medium">
          Past orders
        </Link>
      </div>
      <SectionCarousel ariaLabel="Buy again">
        {products.map(p => <ProductCard key={p.id} {...p} />)}
      </SectionCarousel>
    </div>
  )
}
