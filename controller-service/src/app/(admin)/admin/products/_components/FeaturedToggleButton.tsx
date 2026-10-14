'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Star } from 'lucide-react'
import { RequireWrite } from '@/contexts/AdminScopesContext'
import { useToast } from '@/contexts/ToastContext'

interface Props {
  productId: string
  isFeatured: boolean
  featuredCount: number
}

export default function FeaturedToggleButton({ productId, isFeatured, featuredCount }: Props) {
  const [loading, setLoading] = useState(false)
  const [optimistic, setOptimistic] = useState(isFeatured)
  const router = useRouter()
  const { showToast } = useToast()

  const toggle = async () => {
    if (loading) return
    const next = !optimistic

    if (next && featuredCount >= 6) {
      showToast('Max 6 featured products. Unfeature one first.', 'warning')
      return
    }

    setLoading(true)
    setOptimistic(next)

    const res = await fetch(`/api/products/${productId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_featured: next }),
    })

    if (!res.ok) {
      const data = await res.json()
      setOptimistic(!next) // revert
      showToast(data.error || 'Failed to update', 'error')
    } else {
      router.refresh()
    }
    setLoading(false)
  }

  return (
    <RequireWrite scope="products:write">
      <div className="relative inline-flex flex-col items-end">
        <button
          onClick={toggle}
          disabled={loading}
          title={
            optimistic ? 'Remove from featured' : featuredCount >= 6 ? 'Max 6 featured reached' : 'Mark as featured'
          }
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold transition-colors ${
            optimistic
              ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300 hover:bg-yellow-200 dark:hover:bg-yellow-900/50'
              : 'bg-surface-secondary text-foreground-muted hover:bg-yellow-50 hover:text-yellow-700'
          } ${loading ? 'opacity-60 cursor-wait' : ''}`}
        >
          <Star className={`w-3 h-3 ${optimistic ? 'fill-current' : ''}`} />
          <span>{optimistic ? 'Featured' : 'Feature'}</span>
        </button>
      </div>
    </RequireWrite>
  )
}
