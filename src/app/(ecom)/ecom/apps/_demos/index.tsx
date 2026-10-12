'use client'

import dynamic from 'next/dynamic'
import type { ComponentType } from 'react'

const lazy = (load: () => Promise<{ default: ComponentType }>) => dynamic(load, { ssr: false })

// slug → demo. Add a file in this folder + one line here to give an app its walkthrough.
const DEMOS: Record<string, ComponentType> = {
  products: lazy(() => import('./ProductsDemo')),
  categories: lazy(() => import('./CategoriesDemo')),
  inventory: lazy(() => import('./InventoryDemo')),
  suppliers: lazy(() => import('./SuppliersDemo')),
  enrichment: lazy(() => import('./EnrichmentDemo')),
  orders: lazy(() => import('./OrdersDemo')),
  'cash-sale': lazy(() => import('./CashSaleDemo')),
  quotations: lazy(() => import('./QuotationsDemo')),
  coupons: lazy(() => import('./CouponsDemo')),
  reviews: lazy(() => import('./ReviewsDemo')),
}

export function hasDemo(slug: string) {
  return slug in DEMOS
}

export default function AppDemo({ slug }: { slug: string }) {
  const Demo = DEMOS[slug]
  if (!Demo) return <p className="text-sm text-foreground-secondary py-20 text-center">Walkthrough coming soon.</p>
  return <Demo />
}
