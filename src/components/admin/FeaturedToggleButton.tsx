'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface Props {
  productId: string
  isFeatured: boolean
  featuredCount: number
}

export default function FeaturedToggleButton({ productId, isFeatured, featuredCount }: Props) {
  const [loading, setLoading] = useState(false)
  const [optimistic, setOptimistic] = useState(isFeatured)
  const [error, setError] = useState('')
  const router = useRouter()

  const toggle = async () => {
    if (loading) return
    const next = !optimistic

    if (next && featuredCount >= 6) {
      setError('Max 6 featured products. Unfeature one first.')
      setTimeout(() => setError(''), 3000)
      return
    }

    setLoading(true)
    setOptimistic(next)
    setError('')

    const res = await fetch(`/api/products/${productId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_featured: next }),
    })

    if (!res.ok) {
      const data = await res.json()
      setOptimistic(!next) // revert
      setError(data.error || 'Failed to update')
      setTimeout(() => setError(''), 3000)
    } else {
      router.refresh()
    }
    setLoading(false)
  }

  return (
    <div className="relative inline-flex flex-col items-end">
      <button
        onClick={toggle}
        disabled={loading}
        title={optimistic ? 'Remove from featured' : featuredCount >= 6 ? 'Max 6 featured reached' : 'Mark as featured'}
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold transition-colors ${
          optimistic
            ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300 hover:bg-yellow-200 dark:hover:bg-yellow-900/50'
            : 'bg-surface-secondary text-foreground-muted hover:bg-yellow-50 hover:text-yellow-700'
        } ${loading ? 'opacity-60 cursor-wait' : ''}`}
      >
        <span>{optimistic ? '★' : '☆'}</span>
        <span>{optimistic ? 'Featured' : 'Feature'}</span>
      </button>
      {error && (
        <div className="absolute top-full mt-1 right-0 z-50 bg-red-600 text-white text-xs px-2 py-1 rounded whitespace-nowrap shadow-lg">
          {error}
        </div>
      )}
    </div>
  )
}
