'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { useRouter } from 'next/navigation'
import ImgWithSkeleton from '@/components/ui/ImgWithSkeleton'
import AdminSelect from '@/components/admin/AdminSelect'

interface Review {
  id: string
  user_id: string
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
    <div className="flex gap-0.5" onMouseLeave={() => interactive && onHover?.(0)}>
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type={interactive ? 'button' : 'button'}
          disabled={!interactive}
          onClick={() => interactive && onRate?.(star)}
          onMouseEnter={() => interactive && onHover?.(star)}
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

function RatingBar({ star, count, total, isActive, onClick }: { star: number; count: number; total: number; isActive: boolean; onClick: () => void }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0
  return (
    <button type="button" onClick={onClick} className={`w-full flex items-center gap-2 text-xs px-1 py-0.5 rounded transition-colors ${isActive ? 'bg-accent-50 dark:bg-accent-900/20' : 'hover:bg-surface-secondary'} ${count === 0 ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`} disabled={count === 0}>
      <span className={`w-3 text-right ${isActive ? 'text-accent-600 dark:text-accent-400 font-semibold' : 'text-foreground-muted'}`}>{star}</span>
      <svg className="w-3.5 h-3.5 text-yellow-400 shrink-0" viewBox="0 0 24 24" fill="currentColor">
        <path d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
      </svg>
      <div className="flex-1 h-1.5 bg-border-default rounded-full overflow-hidden">
        <div className="h-full bg-yellow-400 rounded-full transition-all" style={{ width: `${pct}%` }} />
      </div>
      <span className="w-6 text-foreground-muted">{count}</span>
    </button>
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
  const [images, setImages] = useState<File[]>([])
  const [imagePreviews, setImagePreviews] = useState<string[]>([])
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)
  const [expandedReview, setExpandedReview] = useState<Review | null>(null)
  const [editingReview, setEditingReview] = useState<Review | null>(null)
  const [editRating, setEditRating] = useState(5)
  const [editHoverRating, setEditHoverRating] = useState(0)
  const [editTitle, setEditTitle] = useState('')
  const [editComment, setEditComment] = useState('')
  const [editImages, setEditImages] = useState<File[]>([])
  const [editImagePreviews, setEditImagePreviews] = useState<string[]>([])
  const [editExistingUrls, setEditExistingUrls] = useState<string[]>([])
  const [editExistingThumbUrls, setEditExistingThumbUrls] = useState<string[]>([])
  const [isEditSubmitting, setIsEditSubmitting] = useState(false)
  const [filterStar, setFilterStar] = useState<number | null>(null)
  const [sortBy, setSortBy] = useState<'recent' | 'highest' | 'lowest' | 'helpful'>('recent')
  const [visibleCount, setVisibleCount] = useState(5)

  useEffect(() => {
    if (!lightboxUrl) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setLightboxUrl(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightboxUrl])

  useEffect(() => {
    if (!expandedReview) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setExpandedReview(null) }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [expandedReview])

  useEffect(() => {
    if (!editingReview) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setEditingReview(null) }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [editingReview])

  useEffect(() => {
    if (!showForm) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowForm(false) }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [showForm])

  useEffect(() => { fetchReviews() }, [productId])

  function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []).slice(0, 3)
    setImages(files)
    setImagePreviews(files.map(f => URL.createObjectURL(f)))
  }

  function removeImage(idx: number) {
    setImages(prev => prev.filter((_, i) => i !== idx))
    setImagePreviews(prev => {
      URL.revokeObjectURL(prev[idx])
      return prev.filter((_, i) => i !== idx)
    })
  }

  function openEdit(review: Review) {
    setEditingReview(review)
    setEditRating(review.rating)
    setEditTitle(review.title || '')
    setEditComment(review.comment)
    setEditHoverRating(0)
    setEditImages([])
    setEditImagePreviews([])
    setEditExistingUrls(review.image_urls || [])
    setEditExistingThumbUrls(review.image_thumbnail_urls || [])
  }

  function handleEditImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const totalExisting = editExistingUrls.length
    const slots = Math.max(0, 3 - totalExisting)
    const files = Array.from(e.target.files || []).slice(0, slots)
    setEditImages(files)
    setEditImagePreviews(files.map(f => URL.createObjectURL(f)))
  }

  function removeEditExistingImage(idx: number) {
    setEditExistingUrls(prev => prev.filter((_, i) => i !== idx))
    setEditExistingThumbUrls(prev => prev.filter((_, i) => i !== idx))
  }

  function removeEditNewImage(idx: number) {
    setEditImages(prev => prev.filter((_, i) => i !== idx))
    setEditImagePreviews(prev => {
      URL.revokeObjectURL(prev[idx])
      return prev.filter((_, i) => i !== idx)
    })
  }

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingReview) return
    if (!editComment.trim()) { showToast('Please write a comment', 'warning'); return }
    setIsEditSubmitting(true)
    try {
      const fd = new FormData()
      fd.append('reviewId', editingReview.id)
      fd.append('rating', String(editRating))
      fd.append('comment', editComment.trim())
      if (editTitle.trim()) fd.append('title', editTitle.trim())
      fd.append('existingImageUrls', JSON.stringify(editExistingUrls))
      fd.append('existingImageThumbUrls', JSON.stringify(editExistingThumbUrls))
      for (const img of editImages) fd.append('images', img)
      const res = await fetch('/api/reviews', { method: 'PATCH', body: fd })
      const data = await res.json()
      if (res.ok) {
        showToast(data.message || 'Review updated!', 'success')
        setEditingReview(null)
        setEditImages([])
        setEditImagePreviews([])
        fetchReviews()
      } else {
        showToast(data.error || 'Failed to update review', 'error')
      }
    } catch {
      showToast('Failed to update review', 'error')
    } finally {
      setIsEditSubmitting(false)
    }
  }

  const fetchReviews = async () => {    try {
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
      const fd = new FormData()
      fd.append('productId', productId)
      fd.append('rating', String(rating))
      fd.append('comment', comment.trim())
      if (title.trim()) fd.append('title', title.trim())
      for (const img of images) fd.append('images', img)

      const res = await fetch('/api/reviews', { method: 'POST', body: fd })
      const data = await res.json()
      if (res.ok) {
        showToast(data.message || 'Review submitted!', 'success')
        setShowForm(false)
        setRating(5)
        setTitle('')
        setComment('')
        setImages([])
        setImagePreviews([])
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

  const filteredReviews = filterStar
    ? reviews.filter(r => r.rating === filterStar)
    : reviews
  const sortedReviews = [...filteredReviews].sort((a, b) => {
    const aOwn = user && a.user_id === user.id ? 1 : 0
    const bOwn = user && b.user_id === user.id ? 1 : 0
    if (bOwn !== aOwn) return bOwn - aOwn
    if (sortBy === 'highest') return b.rating - a.rating || (new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    if (sortBy === 'lowest') return a.rating - b.rating || (new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    const aScore = (a.image_urls?.length > 0 ? 2 : 0) + (a.rating >= 4 ? 1 : 0)
    const bScore = (b.image_urls?.length > 0 ? 2 : 0) + (b.rating >= 4 ? 1 : 0)
    if (bScore !== aScore) return bScore - aScore
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  })
  const visibleReviews = sortedReviews.slice(0, visibleCount)
  const hasMore = sortedReviews.length > visibleCount

  return (
    <div className="mt-10 sm:mt-14">

      {/* Section title — always on top, sticky */}
      <div className="sticky top-16 lg:top-[80px] z-10 bg-surface py-3 mb-4 flex items-center justify-between gap-4">
        <div>
          <p className="text-accent-500 text-xs font-bold uppercase tracking-widest mb-0.5">What buyers say</p>
          <h2 className="text-xl sm:text-2xl font-extrabold text-foreground">Customer Reviews</h2>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {reviews.length > 0 && (
            <label className="flex items-center gap-2 text-sm">
              <span className="text-foreground-muted hidden sm:inline">Sort by</span>
              <div className="w-36 sm:w-40">
                <AdminSelect
                  value={sortBy}
                  onChange={(val) => { setSortBy(val as any); setVisibleCount(5) }}
                  options={[
                    { value: 'recent', label: 'Most recent' },
                    { value: 'highest', label: 'Highest rated' },
                    { value: 'lowest', label: 'Lowest rated' },
                  ]}
                  sm
                />
              </div>
            </label>
          )}
          {!showForm && (() => {
            const ownReview = user ? reviews.find(r => r.user_id === user.id) : null
            if (ownReview) {
              return (
                <button
                  onClick={() => openEdit(ownReview)}
                  className="inline-flex items-center gap-2 bg-surface-elevated hover:bg-surface-secondary border border-border-secondary text-foreground px-4 py-2 rounded-lg text-sm font-semibold transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                  <span className="hidden sm:inline">Edit your review</span>
                  <span className="sm:hidden">Edit</span>
                </button>
              )
            }
            return (
              <button
                onClick={() => {
                  if (!user) {
                    showToast('Please login to write a review', 'warning')
                    router.push(`/login?redirect=/products/${productName.toLowerCase().replace(/\s+/g, '-')}`)
                    return
                  }
                  setShowForm(true)
                }}
                className="inline-flex items-center gap-2 bg-accent-500 hover:bg-accent-600 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
                <span className="hidden sm:inline">Write a Review</span>
                <span className="sm:hidden">Review</span>
              </button>
            )
          })()}
        </div>
      </div>

      {/* Two-column layout: left = rating summary (sticky), right = sort/write + review list */}
      {!isLoading && reviews.length === 0 ? (
        <div className="bg-surface-elevated border border-border-default rounded-xl p-8 sm:p-12 flex flex-col items-center gap-4 text-center">
          <div className="w-16 h-16 rounded-full bg-surface-secondary flex items-center justify-center">
            <svg className="w-8 h-8 text-foreground-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
            </svg>
          </div>
          <div>
            <p className="text-base font-semibold text-foreground">No reviews yet</p>
            <p className="text-sm text-foreground-muted mt-1">Be the first to share your experience with this product.</p>
          </div>
          <div className="flex gap-0.5 opacity-30">
            {[1,2,3,4,5].map(s => (
              <svg key={s} className="w-6 h-6 text-yellow-400" viewBox="0 0 24 24" fill="currentColor">
                <path d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
              </svg>
            ))}
          </div>
        </div>
      ) : (
      <div className="flex flex-col lg:flex-row gap-6 items-start">

        {/* Left column — rating summary only (sticky) */}
        <div className="w-full lg:w-64 lg:shrink-0 lg:sticky lg:top-[160px] lg:self-start space-y-4">
          {isLoading ? (
            <div className="bg-surface-elevated border border-border-default rounded-xl p-5 shadow-sm animate-pulse">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-12 h-12 bg-surface-secondary rounded" />
                <div className="flex-1">
                  <div className="h-3 bg-surface-secondary rounded w-24 mb-2" />
                  <div className="h-2 bg-surface-secondary rounded w-16" />
                </div>
              </div>
              <div className="space-y-2">
                {[1,2,3,4,5].map(i => <div key={i} className="h-2 bg-surface-secondary rounded" />)}
              </div>
            </div>
          ) : reviews.length > 0 ? (
            <div className="bg-surface-elevated border border-border-default rounded-xl p-4 sm:p-5 shadow-sm">
              <div className="flex items-center gap-3 mb-4">
                <span className="text-5xl font-black text-foreground leading-none">{avgDisplay}</span>
                <div>
                  <StarRow rating={Math.round(avg)} size="md" />
                  <p className="text-xs text-foreground-muted mt-1">{reviews.length} {reviews.length === 1 ? 'review' : 'reviews'}</p>
                </div>
              </div>
              <div className="space-y-1.5">
                {ratingCounts.map(({ star, count }) => (
                  <RatingBar
                    key={star}
                    star={star}
                    count={count}
                    total={reviews.length}
                    isActive={filterStar === star}
                    onClick={() => { setFilterStar(filterStar === star ? null : star); setVisibleCount(5) }}
                  />
                ))}
              </div>
              {filterStar && (
                <button
                  type="button"
                  onClick={() => { setFilterStar(null); setVisibleCount(5) }}
                  className="text-xs text-accent-600 dark:text-accent-400 hover:underline mt-2"
                >
                  Clear filter
                </button>
              )}
            </div>
          ) : (
            <div className="bg-surface-elevated border border-border-default rounded-xl p-5 shadow-sm flex flex-col items-center gap-3 text-center">
              <div className="w-12 h-12 rounded-full bg-surface-secondary flex items-center justify-center">
                <svg className="w-6 h-6 text-foreground-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">No ratings yet</p>
                <p className="text-xs text-foreground-muted mt-0.5">Be the first to rate</p>
              </div>
              <div className="flex gap-0.5 opacity-30">
                {[1,2,3,4,5].map(s => (
                  <svg key={s} className="w-5 h-5 text-yellow-400" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                  </svg>
                ))}
              </div>
            </div>
          )}

          {/* Write Review Form moved to modal overlay below */}
        </div>

        {/* Right column — reviews list */}
        <div className="flex-1 min-w-0">
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
              {filterStar && (
                <div className="flex items-center justify-between gap-3 flex-wrap text-xs text-foreground-muted bg-accent-50 dark:bg-accent-900/20 px-3 py-2 rounded-lg">
                  <span>Showing {sortedReviews.length} {sortedReviews.length === 1 ? 'review' : 'reviews'} with {filterStar} star{filterStar > 1 ? 's' : ''}</span>
                  <button
                    type="button"
                    onClick={() => { setFilterStar(null); setVisibleCount(5) }}
                    className="text-accent-600 dark:text-accent-400 hover:underline font-medium"
                  >
                    Clear filter
                  </button>
                </div>
              )}
              {visibleReviews.map((review) => {
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
                          <StarRow rating={review.rating} size="sm" />
                          {review.is_verified_purchase && (
                            <span className="inline-flex items-center gap-1 bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400 text-xs px-2 py-0.5 rounded-full font-medium">
                              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                              </svg>
                              Verified Purchase
                            </span>
                          )}
                          {review.is_approved && (
                            <span className="inline-flex items-center gap-1 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 text-xs px-2 py-0.5 rounded-full font-medium">
                              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                              Verified
                            </span>
                          )}
                          <span className="text-xs text-foreground-muted ml-auto shrink-0">
                            {new Date(review.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                          </span>
                          {user && review.user_id === user.id && (
                            <button
                              type="button"
                              onClick={() => openEdit(review)}
                              className="inline-flex items-center gap-1 text-xs text-accent-600 dark:text-accent-400 hover:underline font-medium shrink-0"
                            >
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                              </svg>
                              Edit
                            </button>
                          )}
                        </div>
                      </div>
                    </div>

                    {review.title && (
                      <p className="font-semibold text-sm text-foreground mb-1">{review.title}</p>
                    )}
                    <div className="flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-foreground-secondary leading-relaxed line-clamp-2 whitespace-pre-wrap">{review.comment}</p>
                        {review.comment.length > 120 && (
                          <button
                            type="button"
                            onClick={() => setExpandedReview(review)}
                            className="text-xs text-accent-600 dark:text-accent-400 hover:underline mt-0.5 font-medium"
                          >
                            Read more
                          </button>
                        )}
                      </div>
                      {review.image_urls?.length > 0 && (
                        <div className="flex gap-1.5 shrink-0">
                          {review.image_urls.slice(0, 3).map((url, idx) => (
                            <button
                              key={idx}
                              type="button"
                              onClick={() => setLightboxUrl(url)}
                              className="w-16 h-16 sm:w-20 sm:h-20 rounded-lg overflow-hidden border border-border-secondary hover:border-accent-500 transition-colors"
                            >
                              <ImgWithSkeleton src={review.image_thumbnail_urls?.[idx] || url} alt="" className="w-full h-full object-cover" />
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
              {visibleReviews.length === 0 && (
                <div className="bg-surface-elevated border border-border-default rounded-xl py-10 flex flex-col items-center gap-2">
                  <p className="text-sm text-foreground-muted">No {filterStar}-star reviews</p>
                  <button
                    type="button"
                    onClick={() => { setFilterStar(null); setVisibleCount(5) }}
                    className="text-sm text-accent-600 dark:text-accent-400 hover:underline"
                  >
                    Clear filter
                  </button>
                </div>
              )}
              {hasMore && (
                <button
                  type="button"
                  onClick={() => setVisibleCount(c => c + 5)}
                  className="w-full py-3 rounded-xl border border-border-secondary text-sm font-semibold text-foreground hover:bg-surface-secondary transition-colors"
                >
                  Show more reviews ({sortedReviews.length - visibleCount} remaining)
                </button>
              )}
            </div>
          )}
        </div>

      </div>
      )}

      {/* Write / Edit Review Modal */}
      {(showForm || editingReview) && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 overflow-y-auto"
          onClick={() => { setShowForm(false); setEditingReview(null) }}
        >
          <div
            className="bg-surface-elevated rounded-xl border border-border-default shadow-2xl w-full max-w-lg my-8 max-h-[90vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-border-default sticky top-0 bg-surface-elevated z-10">
              <h3 className="text-base font-bold text-foreground">{editingReview ? 'Edit Your Review' : 'Write a Review'}</h3>
              <button
                type="button"
                onClick={() => { setShowForm(false); setEditingReview(null) }}
                className="p-1 text-foreground-muted hover:text-foreground rounded-lg transition-colors"
                aria-label="Close"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <form onSubmit={editingReview ? handleEditSubmit : handleSubmit} className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-foreground-secondary mb-2">Rating</label>
                <StarRow
                  rating={editingReview ? editRating : rating}
                  interactive
                  onRate={editingReview ? setEditRating : setRating}
                  hoverRating={editingReview ? editHoverRating : hoverRating}
                  onHover={editingReview ? setEditHoverRating : setHoverRating}
                  size="lg"
                />
                <p className="text-xs text-foreground-muted mt-1">
                  {['', 'Poor', 'Fair', 'Good', 'Very good', 'Excellent'][(editingReview ? editHoverRating || editRating : hoverRating || rating)]}
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground-secondary mb-1.5">
                  Title <span className="text-foreground-muted font-normal">(optional)</span>
                </label>
                <input
                  type="text"
                  value={editingReview ? editTitle : title}
                  onChange={(e) => editingReview ? setEditTitle(e.target.value) : setTitle(e.target.value)}
                  placeholder="Summarise your experience"
                  maxLength={255}
                  className="w-full px-3 py-2.5 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent text-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground-secondary mb-1.5">Review <span className="text-red-500">*</span></label>
                <textarea
                  value={editingReview ? editComment : comment}
                  onChange={(e) => editingReview ? setEditComment(e.target.value) : setComment(e.target.value)}
                  placeholder="Share details about the product quality, delivery, or any tips for other buyers…"
                  rows={5}
                  required
                  className="w-full px-3 py-2.5 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent resize-none text-sm"
                />
              </div>

              {editingReview ? (
                <div>
                  <label className="block text-sm font-medium text-foreground-secondary mb-1.5">
                    Photos <span className="text-foreground-muted font-normal">(optional, up to 3)</span>
                  </label>
                  {(editExistingUrls.length > 0 || editImagePreviews.length > 0) && (
                    <div className="flex gap-2 mb-2 flex-wrap">
                      {editExistingUrls.map((url, idx) => (
                        <div key={`ex-${idx}`} className="relative w-20 h-20 rounded-lg overflow-hidden border border-border-secondary">
                          <ImgWithSkeleton src={editExistingThumbUrls[idx] || url} alt="" className="w-full h-full object-cover" />
                          <button
                            type="button"
                            onClick={() => removeEditExistingImage(idx)}
                            className="absolute top-0.5 right-0.5 w-5 h-5 bg-black/60 text-white rounded-full flex items-center justify-center text-xs leading-none hover:bg-black/80"
                            aria-label="Remove"
                          >×</button>
                        </div>
                      ))}
                      {editImagePreviews.map((src, idx) => (
                        <div key={`new-${idx}`} className="relative w-20 h-20 rounded-lg overflow-hidden border border-border-secondary">
                          <img src={src} alt="" className="w-full h-full object-cover" />
                          <button
                            type="button"
                            onClick={() => removeEditNewImage(idx)}
                            className="absolute top-0.5 right-0.5 w-5 h-5 bg-black/60 text-white rounded-full flex items-center justify-center text-xs leading-none hover:bg-black/80"
                            aria-label="Remove"
                          >×</button>
                        </div>
                      ))}
                    </div>
                  )}
                  {(editExistingUrls.length + editImages.length) < 3 && (
                    <label className="inline-flex items-center gap-2 cursor-pointer px-3 py-2 border border-dashed border-border-secondary rounded-lg text-sm text-foreground-secondary hover:border-accent-500 hover:text-accent-500 transition-colors">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3 12V5.25A2.25 2.25 0 015.25 3h13.5A2.25 2.25 0 0121 5.25v13.5A2.25 2.25 0 0118.75 21H5.25A2.25 2.25 0 013 18.75V12zm10.5-1.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z" />
                      </svg>
                      Add photos
                      <input type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" onChange={handleEditImageChange} />
                    </label>
                  )}
                </div>
              ) : (
                <div>
                  <label className="block text-sm font-medium text-foreground-secondary mb-1.5">
                    Photos <span className="text-foreground-muted font-normal">(optional, up to 3)</span>
                  </label>
                  <label className="inline-flex items-center gap-2 cursor-pointer px-3 py-2 border border-dashed border-border-secondary rounded-lg text-sm text-foreground-secondary hover:border-accent-500 hover:text-accent-500 transition-colors">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3 12V5.25A2.25 2.25 0 015.25 3h13.5A2.25 2.25 0 0121 5.25v13.5A2.25 2.25 0 0118.75 21H5.25A2.25 2.25 0 013 18.75V12zm10.5-1.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z" />
                    </svg>
                    Add photos
                    <input type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" onChange={handleImageChange} />
                  </label>
                  {imagePreviews.length > 0 && (
                    <div className="flex gap-2 mt-2 flex-wrap">
                      {imagePreviews.map((src, idx) => (
                        <div key={idx} className="relative w-20 h-20 rounded-lg overflow-hidden border border-border-secondary">
                          <img src={src} alt="" className="w-full h-full object-cover" />
                          <button
                            type="button"
                            onClick={() => removeImage(idx)}
                            className="absolute top-0.5 right-0.5 w-5 h-5 bg-black/60 text-white rounded-full flex items-center justify-center text-xs leading-none hover:bg-black/80"
                            aria-label="Remove"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="flex gap-2 pt-2 sticky bottom-0 bg-surface-elevated">
                <button
                  type="submit"
                  disabled={editingReview ? isEditSubmitting : isSubmitting}
                  className="bg-accent-500 hover:bg-accent-600 text-white px-5 py-2.5 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {(editingReview ? isEditSubmitting : isSubmitting) && <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                  {editingReview
                    ? (isEditSubmitting ? 'Saving…' : 'Save Changes')
                    : (isSubmitting ? 'Submitting…' : 'Submit Review')}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowForm(false); setEditingReview(null) }}
                  className="px-5 py-2.5 rounded-lg text-sm font-semibold text-foreground-secondary bg-surface-secondary hover:bg-border-default transition-colors"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {expandedReview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 overflow-y-auto"
          onClick={() => setExpandedReview(null)}
        >
          <div
            className="bg-surface-elevated rounded-xl border border-border-default shadow-2xl w-full max-w-lg my-8 max-h-[90vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-border-default sticky top-0 bg-surface-elevated z-10">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-8 h-8 rounded-full bg-accent-100 dark:bg-accent-900/40 flex items-center justify-center text-sm font-bold text-accent-700 dark:text-accent-300 shrink-0">
                  {`${expandedReview.users.first_name?.[0] || ''}${expandedReview.users.last_name?.[0] || ''}`.toUpperCase() || '?'}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground truncate">{expandedReview.users.first_name} {expandedReview.users.last_name}</p>
                  <div className="flex items-center gap-2">
                    <StarRow rating={expandedReview.rating} size="sm" />
                    {expandedReview.is_verified_purchase && (
                      <span className="text-xs text-green-600 dark:text-green-400 font-medium">Verified</span>
                    )}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setExpandedReview(null)}
                className="p-1 text-foreground-muted hover:text-foreground rounded-lg transition-colors shrink-0 ml-3"
                aria-label="Close"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-5 space-y-4">
              {expandedReview.title && (
                <p className="font-semibold text-foreground">{expandedReview.title}</p>
              )}
              <p className="text-sm text-foreground-secondary leading-relaxed whitespace-pre-wrap">{expandedReview.comment}</p>
              {expandedReview.image_urls?.length > 0 && (
                <div className="flex gap-2 flex-wrap pt-1">
                  {expandedReview.image_urls.map((url, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => { setExpandedReview(null); setLightboxUrl(url) }}
                      className="w-20 h-20 rounded-lg overflow-hidden border border-border-secondary hover:border-accent-500 transition-colors"
                    >
                      <ImgWithSkeleton src={expandedReview.image_thumbnail_urls?.[idx] || url} alt="" className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              )}
              <p className="text-xs text-foreground-muted">
                {new Date(expandedReview.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}
              </p>
            </div>
          </div>
        </div>
      )}

      {lightboxUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
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
        </div>
      )}
    </div>
  )
}
