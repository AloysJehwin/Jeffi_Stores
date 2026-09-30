'use client'

import { useEffect, useState } from 'react'
import ProductCard from '@/components/visitor/ProductCard'
import SectionCarousel from '@/components/visitor/SectionCarousel'
import type { CardProps } from '@/lib/catalog/product-cards'

const TITLE = 'Frequently bought with your cart'
const MAX_IDS = 20
const MAX_EXCLUDE = 50

function idKey(ids: string[]): string {
  return Array.from(new Set(ids.filter(Boolean)))
    .sort()
    .join(',')
}

export default function CartUpsellRow({
  cartProductIds,
  savedProductIds,
}: {
  cartProductIds: string[]
  savedProductIds: string[]
}) {
  const [products, setProducts] = useState<CardProps[]>([])
  const idsKey = idKey(cartProductIds)
  const excludeKey = idKey([...cartProductIds, ...savedProductIds])

  useEffect(() => {
    if (!idsKey) return
    const exclude = excludeKey.split(',')
    const skip = new Set(exclude)
    const params = new URLSearchParams({
      kind: 'bought',
      ids: idsKey.split(',').slice(0, MAX_IDS).join(','),
      exclude: exclude.slice(0, MAX_EXCLUDE).join(','),
      limit: '8',
    })
    const controller = new AbortController()
    fetch(`/api/products/affinity?${params}`, { signal: controller.signal })
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        const list: CardProps[] = Array.isArray(data?.products) ? data.products : []
        setProducts(list.filter(p => !skip.has(p.id)))
      })
      .catch(() => {})
    return () => controller.abort()
  }, [idsKey, excludeKey])

  if (!idsKey || products.length === 0) return null

  return (
    <div className="mt-8 bg-surface-elevated rounded-lg shadow-sm border border-border-default p-4 sm:p-6">
      <div className="mb-4">
        <p className="text-accent-500 text-[10px] font-black uppercase tracking-[0.2em]">Customers also bought</p>
        <h3 className="text-lg font-bold text-foreground">{TITLE}</h3>
      </div>
      <SectionCarousel ariaLabel={TITLE} itemClassName="w-[45%] sm:w-[30%] lg:w-[23%]">
        {products.map(p => (
          <ProductCard key={p.id} {...p} />
        ))}
      </SectionCarousel>
    </div>
  )
}
