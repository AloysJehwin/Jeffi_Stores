'use client'

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react'

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

interface CompareContextValue {
  compareList: CompareProduct[]
  addToCompare: (p: CompareProduct) => void
  removeFromCompare: (id: string) => void
  clearCompare: () => void
  isInCompare: (id: string) => boolean
}

const CompareContext = createContext<CompareContextValue | null>(null)

const STORAGE_KEY = 'jeffi-compare'
const MAX_COMPARE = 4

export function CompareProvider({ children }: { children: ReactNode }) {
  const [compareList, setCompareList] = useState<CompareProduct[]>([])

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) setCompareList(JSON.parse(stored))
    } catch {}
  }, [])

  const persist = (list: CompareProduct[]) => {
    setCompareList(list)
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
    } catch {}
  }

  const addToCompare = useCallback((p: CompareProduct) => {
    setCompareList(prev => {
      if (prev.find(x => x.id === p.id)) return prev
      if (prev.length >= MAX_COMPARE) return prev
      const next = [...prev, p]
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      } catch {}
      return next
    })
  }, [])

  const removeFromCompare = useCallback((id: string) => {
    setCompareList(prev => {
      const next = prev.filter(x => x.id !== id)
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      } catch {}
      return next
    })
  }, [])

  const clearCompare = useCallback(() => {
    persist([])
  }, [])

  const isInCompare = useCallback(
    (id: string) => {
      return compareList.some(x => x.id === id)
    },
    [compareList]
  )

  return (
    <CompareContext.Provider value={{ compareList, addToCompare, removeFromCompare, clearCompare, isInCompare }}>
      {children}
    </CompareContext.Provider>
  )
}

export function useCompare() {
  const ctx = useContext(CompareContext)
  if (!ctx) throw new Error('useCompare must be used within CompareProvider')
  return ctx
}
