'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface Product {
  id: string
  name: string
  category_id: string
  category_name: string
}

interface Category {
  id: string
  name: string
  parent_category_id: string | null
}

export default function MisassignedProductsBanner({
  products,
  categories,
}: {
  products: Product[]
  categories: Category[]
}) {
  const router = useRouter()
  const [selections, setSelections] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<Record<string, boolean>>({})
  const [done, setDone] = useState<Record<string, boolean>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [dismissed, setDismissed] = useState(false)

  const remaining = products.filter(p => !done[p.id])

  if (dismissed || remaining.length === 0) return null

  function subcatsFor(mainCategoryId: string) {
    return categories.filter(c => c.parent_category_id === mainCategoryId)
  }

  async function reassign(product: Product) {
    const newCatId = selections[product.id]
    if (!newCatId) return
    setSaving(s => ({ ...s, [product.id]: true }))
    setErrors(e => ({ ...e, [product.id]: '' }))
    try {
      const res = await fetch(`/api/admin/products/${product.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category_id: newCatId }),
      })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Failed') }
      setDone(d => ({ ...d, [product.id]: true }))
      router.refresh()
    } catch (e: any) {
      setErrors(err => ({ ...err, [product.id]: e.message || 'Error' }))
    } finally {
      setSaving(s => ({ ...s, [product.id]: false }))
    }
  }

  return (
    <div className="mb-6 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 p-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <svg className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
          <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
            {remaining.length} product{remaining.length !== 1 ? 's' : ''} assigned to a main category
          </p>
        </div>
        <button
          onClick={() => setDismissed(true)}
          className="text-amber-600 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-200 transition-colors"
          aria-label="Dismiss"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <p className="text-xs text-amber-700 dark:text-amber-400 mb-4">
        Products should be assigned to subcategories, not main categories. Reassign each product below.
      </p>
      <div className="space-y-2">
        {remaining.map(product => {
          const subs = subcatsFor(product.category_id)
          return (
            <div key={product.id} className="flex flex-wrap items-center gap-2 text-sm bg-white dark:bg-surface-elevated rounded-lg border border-amber-200 dark:border-amber-800 px-3 py-2">
              <span className="font-medium text-foreground flex-1 min-w-0 truncate">{product.name}</span>
              <span className="text-xs text-amber-700 dark:text-amber-400 whitespace-nowrap">{product.category_name}</span>
              <span className="text-foreground-muted">→</span>
              <select
                value={selections[product.id] || ''}
                onChange={e => setSelections(s => ({ ...s, [product.id]: e.target.value }))}
                className="text-xs border border-border-secondary rounded px-2 py-1 bg-surface text-foreground focus:ring-2 focus:ring-accent-500 focus:border-transparent"
              >
                <option value="">Select subcategory…</option>
                {subs.map(sub => (
                  <option key={sub.id} value={sub.id}>{sub.name}</option>
                ))}
              </select>
              <button
                onClick={() => reassign(product)}
                disabled={!selections[product.id] || saving[product.id]}
                className="text-xs bg-accent-500 hover:bg-accent-600 text-white px-2.5 py-1 rounded font-semibold transition-colors disabled:opacity-40"
              >
                {saving[product.id] ? 'Moving…' : 'Move'}
              </button>
              {errors[product.id] && (
                <span className="text-xs text-red-600 dark:text-red-400">{errors[product.id]}</span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
