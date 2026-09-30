'use client'

import { useEffect, useState, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { useStoreConfig } from '@/contexts/StoreConfigContext'

const TAGS = [
  'Great quality',
  'Fast delivery',
  'Worth the price',
  'Exactly as described',
  'Well packed',
  'Will buy again',
  'Highly recommend',
]

interface ProductInfo {
  productId: string
  productName: string
  productImage: string | null
  alreadyReviewed: boolean
}

export default function ReviewPage() {
  const searchParams = useSearchParams()
  const token = searchParams.get('token')
  const ratingParam = parseInt(searchParams.get('rating') ?? '0', 10)

  const [loading, setLoading] = useState(true)
  const [tokenError, setTokenError] = useState('')
  const [product, setProduct] = useState<ProductInfo | null>(null)

  const [rating, setRating] = useState(ratingParam >= 1 && ratingParam <= 5 ? ratingParam : 5)
  const [hoverRating, setHoverRating] = useState(0)
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [title, setTitle] = useState('')
  const [comment, setComment] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [aiOff, setAiOff] = useState(false)
  const aiEnabled = useStoreConfig().flags.aiStorefrontEnabled && !aiOff
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  const fetchProduct = useCallback(async () => {
    if (!token) {
      setTokenError('Missing review token.')
      setLoading(false)
      return
    }
    try {
      const res = await fetch(`/api/reviews/from-token?token=${encodeURIComponent(token)}`)
      const data = await res.json()
      if (!res.ok) {
        setTokenError(data.error || 'Invalid or expired link.')
        setLoading(false)
        return
      }
      setProduct(data)
    } catch {
      setTokenError('Failed to load review. Please try again.')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    fetchProduct()
  }, [fetchProduct])

  function toggleTag(tag: string) {
    setSelectedTags(prev => (prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]))
  }

  async function handleGenerate() {
    if (!rating || !product) return
    setIsGenerating(true)
    try {
      const res = await fetch('/api/reviews/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productName: product.productName, rating, tags: selectedTags }),
      })
      if (res.status === 403) {
        setAiOff(true)
        return
      }
      const data = await res.json()
      if (data.review) setComment(data.review)
    } finally {
      setIsGenerating(false)
    }
  }

  async function handleSubmit() {
    if (!rating) {
      setError('Please select a star rating')
      return
    }
    if (!comment.trim()) {
      setError('Please write a comment')
      return
    }
    setError('')
    setIsSubmitting(true)
    try {
      const res = await fetch('/api/reviews/from-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          rating,
          title: title.trim() || undefined,
          comment: comment.trim(),
          tags: selectedTags,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to submit review')
        return
      }
      setSuccess(true)
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-surface px-4 py-12">
        <div className="max-w-lg mx-auto animate-pulse space-y-4">
          <div className="h-6 bg-surface-elevated rounded w-48 mx-auto" />
          <div className="h-4 bg-surface-elevated rounded w-64 mx-auto" />
          <div className="h-40 bg-surface-elevated rounded-xl" />
          <div className="h-24 bg-surface-elevated rounded-xl" />
        </div>
      </div>
    )
  }

  if (tokenError) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 max-w-sm w-full text-center">
          <div className="w-14 h-14 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-4">
            <svg className="w-7 h-7 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <h2 className="text-lg font-bold text-gray-800 mb-2">Link expired or invalid</h2>
          <p className="text-sm text-gray-500 mb-6">{tokenError}</p>
          <Link
            href="/"
            className="inline-block px-5 py-2.5 rounded-lg bg-accent-500 text-white text-sm font-semibold hover:bg-accent-600 transition-colors"
          >
            Go to Store
          </Link>
        </div>
      </div>
    )
  }

  if (product?.alreadyReviewed) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 max-w-sm w-full text-center">
          <div className="w-14 h-14 rounded-full bg-yellow-50 flex items-center justify-center mx-auto mb-4">
            <span className="text-3xl">⭐</span>
          </div>
          <h2 className="text-lg font-bold text-gray-800 mb-2">Already reviewed!</h2>
          <p className="text-sm text-gray-500 mb-6">
            You have already left a review for this product. Thank you for your feedback!
          </p>
          <Link
            href="/"
            className="inline-block px-5 py-2.5 rounded-lg bg-accent-500 text-white text-sm font-semibold hover:bg-accent-600 transition-colors"
          >
            Shop More
          </Link>
        </div>
      </div>
    )
  }

  if (success) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 max-w-sm w-full text-center">
          <div className="w-14 h-14 rounded-full bg-green-50 flex items-center justify-center mx-auto mb-4">
            <svg className="w-7 h-7 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-lg font-bold text-gray-800 mb-2">Thank you for your review!</h2>
          <p className="text-sm text-gray-500 mb-6">Your review has been submitted and will appear after approval.</p>
          <Link
            href="/"
            className="inline-block px-5 py-2.5 rounded-lg bg-accent-500 text-white text-sm font-semibold hover:bg-accent-600 transition-colors"
          >
            Continue Shopping
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-lg mx-auto">
        <div className="mb-6 text-center">
          <Link href="/" className="text-xl font-bold text-[#1a3a4a]">
            Jeffi Store&apos;s
          </Link>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-6">
          <div>
            <h1 className="text-xl font-bold text-gray-800">How did we do?</h1>
            <p className="text-sm text-gray-500 mt-1">Share your experience to help other customers</p>
          </div>

          {/* Product */}
          {product && (
            <div className="flex items-center gap-3 py-3 border-y border-gray-100">
              {product.productImage && (
                <img
                  src={product.productImage}
                  alt={product.productName}
                  className="w-14 h-14 rounded-lg object-cover border border-gray-100 flex-shrink-0"
                />
              )}
              <p className="text-sm font-semibold text-gray-800 line-clamp-2">{product.productName}</p>
            </div>
          )}

          {/* Stars */}
          <div>
            <p className="text-sm font-medium text-gray-700 mb-2">
              Your rating <span className="text-red-500">*</span>
            </p>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map(n => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setRating(n)}
                  onMouseEnter={() => setHoverRating(n)}
                  onMouseLeave={() => setHoverRating(0)}
                  className="text-4xl leading-none transition-transform hover:scale-110"
                >
                  <span className={(hoverRating || rating) >= n ? 'text-yellow-400' : 'text-gray-200'}>★</span>
                </button>
              ))}
            </div>
          </div>

          {/* Tags */}
          <div>
            <p className="text-sm font-medium text-gray-700 mb-2">
              What did you like? <span className="text-gray-400">(optional)</span>
            </p>
            <div className="flex flex-wrap gap-2">
              {TAGS.map(tag => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => toggleTag(tag)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                    selectedTags.includes(tag)
                      ? 'bg-[#e07b3f] text-white border-[#e07b3f]'
                      : 'bg-gray-50 text-gray-600 border-gray-200 hover:border-[#e07b3f]'
                  }`}
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>

          {/* AI generate */}
          {aiEnabled && (
            <button
              type="button"
              onClick={handleGenerate}
              disabled={!rating || isGenerating}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg border border-[#e07b3f] text-[#e07b3f] text-sm font-medium hover:bg-orange-50 disabled:opacity-40 transition-colors"
            >
              {isGenerating ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                  </svg>{' '}
                  Generating…
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>{' '}
                  Generate with AI
                </>
              )}
            </button>
          )}

          {/* Title */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Review title <span className="text-gray-400">(optional)</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              maxLength={120}
              placeholder="Summarise your experience"
              className="w-full px-3 py-2.5 rounded-lg border border-gray-200 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#e07b3f]/40 focus:border-[#e07b3f]"
            />
          </div>

          {/* Comment */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Your review <span className="text-red-500">*</span>
            </label>
            <textarea
              value={comment}
              onChange={e => setComment(e.target.value)}
              maxLength={2000}
              rows={4}
              placeholder="Tell others about your experience…"
              className="w-full px-3 py-2.5 rounded-lg border border-gray-200 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#e07b3f]/40 focus:border-[#e07b3f] resize-none"
            />
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}

          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="w-full py-3 rounded-lg bg-[#e07b3f] hover:bg-[#c9692e] text-white text-sm font-bold disabled:opacity-50 transition-colors"
          >
            {isSubmitting ? 'Submitting…' : 'Submit Review'}
          </button>
        </div>
      </div>
    </div>
  )
}
