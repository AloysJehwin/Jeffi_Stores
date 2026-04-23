'use client'

import { useState, useEffect } from 'react'

interface Review {
  id: string
  rating: number
  title: string | null
  comment: string
  is_verified_purchase: boolean
  is_approved: boolean
  created_at: string
  users: {
    first_name: string
    last_name: string
    email: string
  }
  products: {
    name: string
    slug: string
  }
}

export default function AdminReviewsPage() {
  const [reviews, setReviews] = useState<Review[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved'>('pending')

  useEffect(() => {
    fetchReviews()
  }, [filter])

  const fetchReviews = async () => {
    setIsLoading(true)
    try {
      const response = await fetch(`/api/admin/reviews?filter=${filter}`)
      if (response.ok) {
        const data = await response.json()
        setReviews(data.reviews || [])
      }
    } catch {
    } finally {
      setIsLoading(false)
    }
  }

  const handleApprove = async (reviewId: string) => {
    try {
      const response = await fetch('/api/admin/reviews', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewId, action: 'approve' }),
      })

      if (response.ok) {
        fetchReviews()
      } else {
        alert('Failed to approve review')
      }
    } catch (error) {
      alert('Failed to approve review')
    }
  }

  const handleReject = async (reviewId: string) => {
    if (!confirm('Are you sure you want to delete this review?')) return

    try {
      const response = await fetch('/api/admin/reviews', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewId, action: 'reject' }),
      })

      if (response.ok) {
        fetchReviews()
      } else {
        alert('Failed to delete review')
      }
    } catch (error) {
      alert('Failed to delete review')
    }
  }

  const renderStars = (rating: number) => {
    return (
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((star) => (
          <svg
            key={star}
            className={`w-5 h-5 ${star <= rating ? 'text-yellow-400 fill-current' : 'text-gray-300 dark:text-gray-600'}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"
            />
          </svg>
        ))}
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-foreground mb-2">Product Reviews</h1>
        <p className="text-foreground-secondary">Manage customer reviews and ratings</p>
      </div>

      <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default mb-6">
        <div className="flex border-b border-border-default">
          <button
            onClick={() => setFilter('pending')}
            className={`px-3 sm:px-6 py-3 text-sm sm:text-base font-medium transition-colors ${
              filter === 'pending'
                ? 'text-primary-600 dark:text-primary-400 border-b-2 border-primary-600 dark:border-primary-400'
                : 'text-foreground-secondary hover:text-foreground'
            }`}
          >
            Pending Approval
          </button>
          <button
            onClick={() => setFilter('approved')}
            className={`px-3 sm:px-6 py-3 text-sm sm:text-base font-medium transition-colors ${
              filter === 'approved'
                ? 'text-primary-600 dark:text-primary-400 border-b-2 border-primary-600 dark:border-primary-400'
                : 'text-foreground-secondary hover:text-foreground'
            }`}
          >
            Approved
          </button>
          <button
            onClick={() => setFilter('all')}
            className={`px-3 sm:px-6 py-3 text-sm sm:text-base font-medium transition-colors ${
              filter === 'all'
                ? 'text-primary-600 dark:text-primary-400 border-b-2 border-primary-600 dark:border-primary-400'
                : 'text-foreground-secondary hover:text-foreground'
            }`}
          >
            All Reviews
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default p-12 text-center">
          <div className="animate-spin w-8 h-8 border-4 border-primary-600 border-t-transparent rounded-full mx-auto"></div>
          <p className="text-foreground-muted mt-4">Loading reviews...</p>
        </div>
      ) : reviews.length === 0 ? (
        <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default p-12 text-center">
          <svg className="w-16 h-16 text-foreground-muted mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
          <p className="text-foreground-muted text-lg">No reviews found</p>
        </div>
      ) : (
        <div className="space-y-4">
          {reviews.map((review) => (
            <div
              key={review.id}
              className="bg-surface-elevated rounded-lg shadow-sm border border-border-default p-4 sm:p-6"
            >
              <div className="mb-4">
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <span className="font-semibold text-foreground">
                    {review.users.first_name} {review.users.last_name}
                  </span>
                  <span className="text-sm text-foreground-muted hidden sm:inline">({review.users.email})</span>
                  {review.is_verified_purchase && (
                    <span className="bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300 text-xs px-2 py-0.5 rounded-full font-medium">
                      Verified
                    </span>
                  )}
                  {review.is_approved ? (
                    <span className="bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300 text-xs px-2 py-0.5 rounded-full font-medium">
                      Approved
                    </span>
                  ) : (
                    <span className="bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300 text-xs px-2 py-0.5 rounded-full font-medium">
                      Pending
                    </span>
                  )}
                </div>
                <div className="text-sm text-foreground-muted sm:hidden mb-1">{review.users.email}</div>

                <div className="flex items-center gap-3 mb-2">
                  {renderStars(review.rating)}
                  <span className="text-xs sm:text-sm text-foreground-muted">
                    {new Date(review.created_at).toLocaleDateString('en-US', {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                    })}
                  </span>
                </div>

                <div className="mb-3">
                  <a
                    href={`/products/${review.products.slug}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary-600 dark:text-primary-400 hover:text-primary-700 font-medium text-sm"
                  >
                    {review.products.name} →
                  </a>
                </div>

                {review.title && (
                  <h4 className="font-semibold text-foreground mb-2">{review.title}</h4>
                )}

                <p className="text-foreground-secondary whitespace-pre-wrap text-sm">{review.comment}</p>
              </div>

              {!review.is_approved && (
                <div className="flex gap-2 pt-3 border-t border-border-default">
                  <button
                    type="button"
                    onClick={() => handleApprove(review.id)}
                    className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg font-medium transition-colors text-sm"
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    onClick={() => handleReject(review.id)}
                    className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg font-medium transition-colors text-sm"
                  >
                    Delete
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
