import { create } from 'zustand'

// Mirror of the web's CompareContext (contexts/CompareContext.tsx): up to 4 products, de-duplicated.
export interface CompareProduct {
  id: string
  name: string
  slug: string
  price: number
  mrp: number | null
  image: string | null
  brandName: string | null
  categoryId: string | null
  categoryName: string | null
}

export const MAX_COMPARE = 4

interface CompareState {
  compareList: CompareProduct[]
  addToCompare: (p: CompareProduct) => void
  removeFromCompare: (id: string) => void
  clearCompare: () => void
  isInCompare: (id: string) => boolean
}

export const useCompareStore = create<CompareState>((set, get) => ({
  compareList: [],
  addToCompare: p =>
    set(s =>
      s.compareList.some(x => x.id === p.id) || s.compareList.length >= MAX_COMPARE
        ? s
        : { compareList: [...s.compareList, p] }
    ),
  removeFromCompare: id => set(s => ({ compareList: s.compareList.filter(x => x.id !== id) })),
  clearCompare: () => set({ compareList: [] }),
  isInCompare: id => get().compareList.some(x => x.id === id),
}))
