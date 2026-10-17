'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Star } from 'lucide-react'
import { RequireWrite } from '@/contexts/AdminScopesContext'
import { useToast } from '@/contexts/ToastContext'
import { badgeCls } from '@/components/admin/kit'

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
          className={`${badgeCls(optimistic ? 'amber' : 'muted')} inline-flex items-center gap-1 transition-opacity hover:opacity-75 ${loading ? 'opacity-60 cursor-wait' : ''}`}
        >
          <Star className={`w-3 h-3 ${optimistic ? 'fill-current' : ''}`} />
          <span>{optimistic ? 'Featured' : 'Feature'}</span>
        </button>
      </div>
    </RequireWrite>
  )
}
