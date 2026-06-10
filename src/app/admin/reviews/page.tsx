'use client'

import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useSearchParams, useRouter } from 'next/navigation'
import { useToast } from '@/contexts/ToastContext'
import ImgWithSkeleton from '@/components/ui/ImgWithSkeleton'
import { ap } from '@/lib/admin-path'

interface Review {
  id: string
  rating: number
  title: string | null
  comment: string
  is_verified_purchase: boolean
  is_approved: boolean
  image_urls: string[]
  image_thumbnail_urls: string[]
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

function Stars({ rating }: { rating: number }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <svg key={star} className={`w-4 h-4 ${star <= rating ? 'text-yellow-400' : 'text-gray-300 dark:text-gray-600'}`} viewBox="0 0 24 24" fill={star <= rating ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={star <= rating ? 0 : 1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
        </svg>
      ))}
    </div>
  )
}

export default function AdminReviewsPage() {
  const searchParams = useSearchParams()
  const router = useRouter()

  const [reviews, setReviews] = useState<Review[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved'>(
    (searchParams.get('filter') as 'all' | 'pending' | 'approved') || 'pending'
  )
  const [search, setSearch] = useState(searchParams.get('q') || '')
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const { showToast } = useToast()
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!lightboxUrl) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setLightboxUrl(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightboxUrl])

  function syncUrl(patch: Record<string, string>) {
    const p = new URLSearchParams(window.location.search)
    for (const [k, v] of Object.entries(patch)) {
      if (v) p.set(k, v); else p.delete(k)
    }
    router.replace(ap(`/admin/reviews?${p.toString()}`), { scroll: false })
  }

  useEffect(() => { fetchReviews() }, [filter])

  const fetchReviews = async (q = search) => {
    setIsLoading(true)
    try {
      const params = new URLSearchParams({ filter })
      if (q.trim()) params.set('q', q.trim())
      const response = await fetch(`/api/admin/reviews?${params}`)
      if (response.ok) {
        const data = await response.json()
        setReviews(data.reviews || [])
      }
    } catch {
    } finally {
      setIsLoading(false)
    }
  }

  function handleSearchChange(val: string) {
    setSearch(val)
    syncUrl({ q: val })
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => fetchReviews(val), 300)
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
        showToast('Review approved', 'success')
      } else {
        showToast('Failed to approve review', 'error')
      }
    } catch {
      showToast('Failed to approve review', 'error')
    }
  }

  const handleReject = async (reviewId: string) => {
    setConfirmDeleteId(null)
    try {
      const response = await fetch('/api/admin/reviews', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewId, action: 'reject' }),
      })
      if (response.ok) {
        fetchReviews()
        showToast('Review deleted', 'success')
      } else {
        showToast('Failed to delete review', 'error')
      }
    } catch {
      showToast('Failed to delete review', 'error')
    }
  }

  const TABS = [
    { key: 'pending', label: 'Pending' },
    { key: 'approved', label: 'Approved' },
    { key: 'all', label: 'All' },
  ] as const

  const pendingCount = reviews.filter(r => !r.is_approved).length

  return (
    <div className="p-4 sm:p-6">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Reviews</h1>
          <p className="text-sm text-foreground-muted mt-0.5">Moderate customer reviews before they appear on product pages</p>
        </div>
        {filter === 'pending' && !isLoading && pendingCount > 0 && (
          <span className="inline-flex items-center gap-1.5 bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300 text-sm font-semibold px-3 py-1.5 rounded-full">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M5.07 19H19a2 2 0 001.75-2.96L13.75 4a2 2 0 00-3.5 0L3.25 16.04A2 2 0 005.07 19z" />
            </svg>
            {pendingCount} awaiting approval
          </span>
        )}
      </div>

      {/* Toolbar */}
      <div className="bg-surface-elevated rounded-xl border border-border-default mb-5 overflow-hidden">
        <div className="flex items-center border-b border-border-default px-1">
          {TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => { setFilter(tab.key); syncUrl({ filter: tab.key }) }}
              className={`relative px-4 py-3 text-sm font-medium transition-colors ${
                filter === tab.key
                  ? 'text-accent-600 dark:text-accent-400'
                  : 'text-foreground-muted hover:text-foreground'
              }`}
            >
              {tab.label}
              {filter === tab.key && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent-500 rounded-t-full" />
              )}
            </button>
          ))}
        </div>
        <div className="px-4 py-3">
          <div className="relative max-w-sm">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground-muted pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0z" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={e => handleSearchChange(e.target.value)}
              placeholder="Search by product or reviewer…"
              className="w-full pl-9 pr-3 py-2 bg-surface border border-border-secondary rounded-lg text-sm text-foreground focus:ring-2 focus:ring-accent-500 focus:border-transparent transition-colors placeholder:text-foreground-muted"
            />
          </div>
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex flex-col items-center py-16 gap-3">
          <div className="w-8 h-8 border-[3px] border-accent-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-foreground-muted">Loading reviews…</p>
        </div>
      ) : reviews.length === 0 ? (
        <div className="bg-surface-elevated rounded-xl border border-border-default py-16 flex flex-col items-center gap-3">
          <svg className="w-14 h-14 text-foreground-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
          <p className="font-semibold text-foreground">No reviews found</p>
          <p className="text-sm text-foreground-muted">
            {filter === 'pending' ? 'All caught up — no reviews awaiting approval.' : 'No reviews match your filters.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {reviews.map((review) => {
            const initials = `${review.users.first_name?.[0] || ''}${review.users.last_name?.[0] || ''}`.toUpperCase() || '?'
            const isExpanded = expandedId === review.id
            return (
              <div key={review.id} className="bg-surface-elevated rounded-xl border border-border-default overflow-hidden">
                {/* Card header row */}
                <div className="px-4 pt-4 pb-3">
                  <div className="flex items-start gap-3">
                    {/* Avatar */}
                    <div className="w-9 h-9 rounded-full bg-accent-100 dark:bg-accent-900/40 flex items-center justify-center text-sm font-bold text-accent-700 dark:text-accent-300 shrink-0 mt-0.5">
                      {initials}
                    </div>

                    {/* Main content */}
                    <div className="flex-1 min-w-0">
                      {/* Top row: name + badges + date */}
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-1">
                        <span className="font-semibold text-sm text-foreground">
                          {review.users.first_name} {review.users.last_name}
                        </span>
                        <span className="text-xs text-foreground-muted hidden sm:inline">{review.users.email}</span>
                        {review.is_verified_purchase && (
                          <span className="inline-flex items-center gap-1 bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400 text-xs px-1.5 py-0.5 rounded-full font-medium">
                            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                            Verified
                          </span>
                        )}
                        {review.is_approved ? (
                          <span className="inline-flex items-center gap-1 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 text-xs px-1.5 py-0.5 rounded-full font-medium">
                            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                            Approved
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 bg-yellow-50 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400 text-xs px-1.5 py-0.5 rounded-full font-medium">
                            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
                              <circle cx="12" cy="12" r="2" />
                              <circle cx="6" cy="12" r="2" />
                              <circle cx="18" cy="12" r="2" />
                            </svg>
                            Pending
                          </span>
                        )}
                        <span className="text-xs text-foreground-muted ml-auto">
                          {new Date(review.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </span>
                      </div>

                      {/* Stars + product link */}
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-2">
                        <Stars rating={review.rating} />
                        <a
                          href={`/products/${review.products.slug}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-accent-600 dark:text-accent-400 hover:underline font-medium truncate max-w-[200px]"
                        >
                          <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                          </svg>
                          {review.products.name}
                        </a>
                      </div>

                      {/* Review text */}
                      {review.title && (
                        <p className="font-semibold text-sm text-foreground mb-0.5">{review.title}</p>
                      )}
                      <p className={`text-sm text-foreground-secondary leading-relaxed whitespace-pre-wrap ${!isExpanded ? 'line-clamp-3' : ''}`}>
                        {review.comment}
                      </p>
                      {review.comment.length > 160 && (
                        <button
                          type="button"
                          onClick={() => setExpandedId(isExpanded ? null : review.id)}
                          className="text-xs text-accent-600 dark:text-accent-400 hover:underline mt-0.5"
                        >
                          {isExpanded ? 'Show less' : 'Read more'}
                        </button>
                      )}

                      {/* Images */}
                      {review.image_urls?.length > 0 && (
                        <div className="flex gap-2 mt-2.5 flex-wrap">
                          {review.image_urls.map((url, idx) => (
                            <button
                              key={idx}
                              type="button"
                              onClick={() => setLightboxUrl(url)}
                              className="w-16 h-16 rounded-lg overflow-hidden border border-border-secondary hover:border-accent-500 transition-colors shrink-0"
                            >
                              <ImgWithSkeleton src={review.image_thumbnail_urls?.[idx] || url} alt="" className="w-full h-full object-cover" />
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Action bar */}
                {!review.is_approved && (
                  <div className="flex items-center gap-2 px-4 py-2.5 bg-surface border-t border-border-default">
                    <button
                      type="button"
                      onClick={() => handleApprove(review.id)}
                      className="inline-flex items-center gap-1.5 bg-green-600 hover:bg-green-700 text-white px-3.5 py-1.5 rounded-lg font-medium text-sm transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                      Approve
                    </button>
                    {confirmDeleteId === review.id ? (
                      <>
                        <button
                          type="button"
                          onClick={() => handleReject(review.id)}
                          className="inline-flex items-center gap-1.5 bg-red-600 hover:bg-red-700 text-white px-3.5 py-1.5 rounded-lg font-medium text-sm transition-colors"
                        >
                          Confirm delete
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(null)}
                          className="px-3 py-1.5 text-sm text-foreground-muted hover:text-foreground transition-colors"
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(review.id)}
                        className="inline-flex items-center gap-1.5 text-sm text-red-600 dark:text-red-400 hover:text-red-700 px-3 py-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors font-medium"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                        Delete
                      </button>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Lightbox */}
      {lightboxUrl && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed inset-0 z-[300] flex items-center justify-center bg-black/80 p-4"
          onClick={() => setLightboxUrl(null)}
        >
          <img
            src={lightboxUrl}
            alt=""
            className="max-w-full max-h-[90vh] rounded-lg object-contain shadow-2xl"
            onClick={e => e.stopPropagation()}
          />
          <button
            type="button"
            onClick={() => setLightboxUrl(null)}
            className="absolute top-4 right-4 w-9 h-9 flex items-center justify-center bg-black/60 text-white rounded-full hover:bg-black/80 text-xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>,
        document.body
      )}
    </div>
  )
}
