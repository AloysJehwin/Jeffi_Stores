import { create } from 'zustand'

// In-memory mirror of the web's localStorage 'jeffi_recently_viewed' list (components/visitor/RecentlyViewed.tsx).

export interface RecentProduct {
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

const MAX_ITEMS = 7

interface RecentlyViewedState {
  items: RecentProduct[]
  push: (product: RecentProduct) => void
}

export const useRecentlyViewedStore = create<RecentlyViewedState>(set => ({
  items: [],
  push: product => set(s => ({ items: [product, ...s.items.filter(p => p.id !== product.id)].slice(0, MAX_ITEMS) })),
}))

/** The web's trackRecentlyViewed: newest first, de-duplicated, capped at 7. */
export const pushRecentlyViewed = (product: RecentProduct) => useRecentlyViewedStore.getState().push(product)
