'use client'

import { useState } from 'react'
import { useCompare, CompareProduct } from '@/contexts/CompareContext'
import CompareDrawer from '@/components/visitor/CompareDrawer'

interface AddToCompareButtonProps {
  product: CompareProduct
}

export default function AddToCompareButton({ product }: AddToCompareButtonProps) {
  const { isInCompare, addToCompare, removeFromCompare, compareList } = useCompare()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const inCompare = isInCompare(product.id)
  const isFull = compareList.length >= 4 && !inCompare

  function handleClick() {
    if (!inCompare) addToCompare(product)
    setDrawerOpen(true)
  }

  return (
    <>
      <button
        onClick={handleClick}
        disabled={isFull}
        className={`flex items-center gap-2 text-sm font-medium px-4 py-2.5 rounded-xl border transition-all
          ${inCompare
            ? 'border-accent-500 text-accent-600 bg-accent-50 dark:bg-accent-900/20 dark:text-accent-400'
            : 'border-border-default text-foreground-muted hover:border-accent-400 hover:text-accent-500 hover:bg-accent-50 dark:hover:bg-accent-900/10'
          }
          disabled:opacity-40 disabled:cursor-not-allowed`}
      >
        <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
        </svg>
        {inCompare ? 'Compare (Added)' : isFull ? 'Compare (Full)' : 'Add to Compare'}
      </button>

      <CompareDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        currentProduct={product}
      />
    </>
  )
}
