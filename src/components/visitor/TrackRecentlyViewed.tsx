'use client'

import { useEffect } from 'react'
import { trackRecentlyViewed } from './RecentlyViewed'

interface Props {
  id: string
  name: string
  slug: string
  price: number
  mrp?: number | null
  brand?: string | null
  inStock?: boolean
  image: string | null
  categoryId?: string | null
}

export default function TrackRecentlyViewed({ id, name, slug, price, mrp, brand, inStock, image, categoryId }: Props) {
  useEffect(() => {
    trackRecentlyViewed({ id, name, slug, price, mrp: mrp ?? null, brand: brand ?? null, inStock: inStock ?? true, image, categoryId: categoryId ?? null })
  }, [id, name, slug, price, mrp, brand, inStock, image, categoryId])

  return null
}
