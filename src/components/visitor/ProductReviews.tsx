'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { useRouter } from 'next/navigation'

interface Review {
  id: string
  rating: number
  title: string | null
  comment: string
  is_verified_purchase: boolean
  created_at: string
  users: {
    first_name: string
    last_name: string
  }
}

interface ProductReviewsProps {
  productId: string
  productName: string
}

function StarRow({ rating, interactive = false, onRate, hoverRating, onHover, size = 'md' }: {
  rating: number
  interactive?: boolean
  onRate?: (n: number) => void
  hoverRating?: number
  onHover?: (n: number) => void
  size?: 'sm' | 'md' | 'lg'
}) {
  const dim = size === 'sm' ? 'w-4 h-4' : size === 'lg' ? 'w-7 h-7' : 'w-5 h-5'
  const active = interactive ? (hoverRating || rating) : rating
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type={interactive ? 'button' : 'button'}
          disabled={!interactive}
          onClick={() => interactive && onRate?.(star)}
          onMouseEnter={() => interactive && onHover?.(star)}
          onMouseLeave={() => interactive && onHover?.(0)}
          className={interactive ? 'cursor-pointer hover:scale-110 transition-transform' : 'cursor-default pointer-events-none'}
          tabIndex={interactive ? 0 : -1}
          aria-label={interactive ? `Rate ${star} star${star > 1 ? 's' : ''}` : undefined}
        >
          <svg className={`${dim} ${star <= active ? 'text-yellow-400' : 'text-gray-300 dark:text-gray-600'}`} viewBox="0 0 24 24" fill={star <= active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={star <= active ? 0 : 1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
          </svg>
        </button>
      ))}
    </div>
  )
}

function RatingBar({ star, count, total }: { star: number; count: number; total: number }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-3 text-right text-foreground-muted">{star}</span>
      <svg className="w-3.5 h-3.5 text-yellow-400 shrink-0" viewBox="0 0 24 24" fill="currentColor">
        <path d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
      </svg>
      <div className="flex-1 h-1.5 bg-border-default rounded-full overflow-hidden">
        <div className="h-full bg-yellow-400 rounded-full transition-all" style={{ width: `${pct}%` }} />
      </div>
      <span className="w-6 text-foreground-muted">{count}</span>
    </div>
  )
}

export default function ProductReviews({ productId, productName }: ProductReviewsProps) {
  const { user } = useAuth()
  const { showToast } = useToast()
  const router = useRouter()
  const [reviews, setReviews] = useState<Review[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showForm, setShowForm] = useState(false)

  const [rating, setRating] = useState(5)
  const [hoverRating, setHoverRating] = useState(0)
  const [title, setTitle] = useState('')
  const [comment, setComment] = useState('')

  useEffect(() => { fetchReviews() }, [productId])

  const fetchReviews = async () => {
    try {
      const res = await fetch(`/api/reviews?productId=${productId}`)
      if (res.ok) {
        const data = await res.json()
        setReviews(data.reviews || [])
      }
    } catch {
    } finally {
      setIsLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!user) {
      showToast('Please login to submit a review', 'warning')
      router.push(`/login?redirect=/products/${productName.toLowerCase().replace(/\s+/g, '-')}`)
      return
    }
    if (!comment.trim()) { showToast('Please write a comment', 'warning'); return }
    setIsSubmitting(true)
    try {
      const res = await fetch('/api/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId, rating, title: title.trim() || null, comment: comment.trim() }),
      })
      const data = await res.json()
      if (res.ok) {
        showToast(data.message || 'Review submitted!', 'success')
        setShowForm(false)
        setRating(5)
        setTitle('')
        setComment('')
        fetchReviews()
      } else {
        showToast(data.error || 'Failed to submit review', 'error')
      }
    } catch {
      showToast('Failed to submit review', 'error')
    } finally {
      setIsSubmitting(false)
    }
  }

  const avg = reviews.length > 0
    ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length
    : 0
  const avgDisplay = avg.toFixed(1)

  const ratingCounts = [5, 4, 3, 2, 1].map(star => ({
    star,
    count: reviews.filter(r => r.rating === star).length,
  }))

  return (
    <div className="mt-10 sm:mt-14">
      {/* Section header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <p className="text-accent-500 text-xs font-bold uppercase tracking-widest mb-0.5">What buyers say</p>
          <h2 className="text-xl sm:text-2xl font-extrabold text-foreground">Customer Reviews</h2>
        </div>
        {!showForm && (
          <button
            onClick={() => {
              if (!user) {
                showToast('Please login to write a review', 'warning')
                router.push(`/login?redirect=/products/${productName.toLowerCase().replace(/\s+/g, '-')}`)
                return
              }
              setShowForm(true)
            }}
            className="self-start sm:self-auto inline-flex items-center gap-2 bg-accent-500 hover:bg-accent-600 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
            Write a Review
          </button>
        )}
      </div>

      {/* Summary bar */}
      {reviews.length > 0 && (
        <div className="bg-surface-elevated border border-border-default rounded-xl p-4 sm:p-5 mb-6 flex flex-col sm:flex-row gap-5 sm:gap-8 items-start sm:items-center">
          <div className="flex items-center gap-4 shrink-0">
            <span className="text-5xl font-black text-foreground">{avgDisplay}</span>
            <div>
              <StarRow rating={Math.round(avg)} size="md" />
              <p className="text-xs text-foreground-muted mt-1">{reviews.length} {reviews.length === 1 ? 'review' : 'reviews'}</p>
            </div>
          </div>
          <div className="flex-1 w-full space-y-1.5">
            {ratingCounts.map(({ star, count }) => (
              <RatingBar key={star} star={star} count={count} total={reviews.length} />
            ))}
          </div>
        </div>
      )}

      {/* Write Review Form */}
      {showForm && (
        <div className="bg-surface-elevated border border-border-default rounded-xl p-4 sm:p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-bold text-foreground">Your Review</h3>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="p-1 text-foreground-muted hover:text-foreground rounded-lg transition-colors"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-foreground-secondary mb-2">Rating</label>
              <StarRow rating={rating} interactive onRate={setRating} hoverRating={hoverRating} onHover={setHoverRating} size="lg" />
              <p className="text-xs text-foreground-muted mt-1">
                {['', 'Poor', 'Fair', 'Good', 'Very good', 'Excellent'][hoverRating || rating]}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground-secondary mb-1.5">
                Title <span className="text-foreground-muted font-normal">(optional)</span>
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Summarise your experience"
                maxLength={255}
                className="w-full px-3 py-2.5 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent text-sm"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground-secondary mb-1.5">Review <span className="text-red-500">*</span></label>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Share details about the product quality, delivery, or any tips for other buyers…"
                rows={4}
                required
                className="w-full px-3 py-2.5 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent resize-none text-sm"
              />
            </div>

            <div className="flex gap-2 pt-1">
              <button
                type="submit"
                disabled={isSubmitting}
                className="bg-accent-500 hover:bg-accent-600 text-white px-5 py-2.5 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {isSubmitting && <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                {isSubmitting ? 'Submitting…' : 'Submit Review'}
              </button>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="px-5 py-2.5 rounded-lg text-sm font-semibold text-foreground-secondary bg-surface-secondary hover:bg-border-default transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Reviews list */}
      {isLoading ? (
        <div className="flex flex-col items-center py-14 gap-3">
          <div className="w-8 h-8 border-3 border-accent-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-foreground-muted">Loading reviews…</p>
        </div>
      ) : reviews.length === 0 ? (
        <div className="bg-surface-elevated border border-border-default rounded-xl py-14 flex flex-col items-center gap-3">
          <svg className="w-12 h-12 text-foreground-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
          <p className="font-semibold text-foreground">No reviews yet</p>
          <p className="text-sm text-foreground-muted">Be the first to share your experience</p>
        </div>
      ) : (
        <div className="space-y-4">
          {reviews.map((review) => {
            const initials = `${review.users.first_name?.[0] || ''}${review.users.last_name?.[0] || ''}`.toUpperCase() || '?'
            return (
              <div key={review.id} className="bg-surface-elevated border border-border-default rounded-xl p-4 sm:p-5">
                <div className="flex items-start gap-3 mb-3">
                  <div className="w-9 h-9 rounded-full bg-accent-100 dark:bg-accent-900/40 flex items-center justify-center text-sm font-bold text-accent-700 dark:text-accent-300 shrink-0">
                    {initials}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-semibold text-sm text-foreground">
                        {review.users.first_name} {review.users.last_name}
                      </span>
                      {review.is_verified_purchase && (
                        <span className="inline-flex items-center gap-1 bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400 text-xs px-2 py-0.5 rounded-full font-medium">
                          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                          Verified
                        </span>
                      )}
                      <span className="text-xs text-foreground-muted ml-auto shrink-0">
                        {new Date(review.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </span>
                    </div>
                    <StarRow rating={review.rating} size="sm" />
                  </div>
                </div>

                {review.title && (
                  <p className="font-semibold text-sm text-foreground mb-1">{review.title}</p>
                )}
                <p className="text-sm text-foreground-secondary leading-relaxed whitespace-pre-wrap">{review.comment}</p>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
