'use client'

import { useState, useEffect, useRef } from 'react'

const TAGS = [
  'Great quality',
  'Fast delivery',
  'Worth the price',
  'Exactly as described',
  'Well packed',
  'Will buy again',
  'Highly recommend',
]

interface ExistingReview {
  id: string
  rating: number
  title: string | null
  comment: string
  tags: string[]
  image_urls: string[]
  image_thumbnail_urls: string[]
}

interface ReviewItem {
  productId: string
  productName: string
  productImage?: string | null
}

interface Props {
  items: ReviewItem[]
  orderId: string
  reviewMap: Record<string, ExistingReview>
  onClose: () => void
  onSuccess: (productId: string, review: ExistingReview) => void
}

interface ItemState {
  rating: number
  hoverRating: number
  selectedTags: string[]
  title: string
  comment: string
  isGenerating: boolean
  existingImageUrls: string[]
  existingThumbUrls: string[]
  newImages: File[]
  error: string
  submitted: boolean
}

function buildInitialState(existing: ExistingReview | undefined): ItemState {
  return {
    rating: existing?.rating ?? 5,
    hoverRating: 0,
    selectedTags: existing?.tags ?? [],
    title: existing?.title ?? '',
    comment: existing?.comment ?? '',
    isGenerating: false,
    existingImageUrls: existing?.image_urls ?? [],
    existingThumbUrls: existing?.image_thumbnail_urls ?? [],
    newImages: [],
    error: '',
    submitted: false,
  }
}

export default function ReviewModal({ items, orderId, reviewMap, onClose, onSuccess }: Props) {
  const [states, setStates] = useState<ItemState[]>(() =>
    items.map(item => buildInitialState(reviewMap[item.productId]))
  )
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [globalError, setGlobalError] = useState('')
  const fileRefs = useRef<(HTMLInputElement | null)[]>([])

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  function update(i: number, patch: Partial<ItemState>) {
    setStates(prev => prev.map((s, idx) => idx === i ? { ...s, ...patch } : s))
  }

  function toggleTag(i: number, tag: string) {
    setStates(prev => prev.map((s, idx) => {
      if (idx !== i) return s
      const tags = s.selectedTags.includes(tag)
        ? s.selectedTags.filter(t => t !== tag)
        : [...s.selectedTags, tag]
      return { ...s, selectedTags: tags }
    }))
  }

  async function handleGenerate(i: number) {
    const s = states[i]
    if (!s.rating) return
    update(i, { isGenerating: true })
    try {
      const res = await fetch('/api/reviews/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ productName: items[i].productName, rating: s.rating, tags: s.selectedTags }),
      })
      const data = await res.json()
      if (data.review) update(i, { comment: data.review })
    } finally {
      update(i, { isGenerating: false })
    }
  }

  function handleFileChange(i: number, e: React.ChangeEvent<HTMLInputElement>) {
    const s = states[i]
    const files = Array.from(e.target.files ?? [])
    const slots = 3 - s.existingImageUrls.length - s.newImages.length
    update(i, { newImages: [...s.newImages, ...files.slice(0, slots)] })
    e.target.value = ''
  }

  async function handleSubmitAll() {
    let hasError = false
    const nextStates = states.map((s, i) => {
      if (s.submitted) return s
      if (!s.rating) return { ...s, error: 'Please select a star rating' }
      if (!s.comment.trim()) return { ...s, error: 'Please write a comment' }
      return { ...s, error: '' }
    })
    setStates(nextStates)
    hasError = nextStates.some(s => !s.submitted && s.error)
    if (hasError) return

    setIsSubmitting(true)
    setGlobalError('')
    try {
      await Promise.all(items.map(async (item, i) => {
        const s = nextStates[i]
        if (s.submitted) return
        const existing = reviewMap[item.productId]

        const fd = new FormData()
        fd.append('productId', item.productId)
        fd.append('rating', String(s.rating))
        if (s.title.trim()) fd.append('title', s.title.trim())
        fd.append('comment', s.comment.trim())
        s.selectedTags.forEach(t => fd.append('tags[]', t))
        s.newImages.forEach(f => fd.append('images', f))

        let res: Response
        if (existing) {
          fd.append('reviewId', existing.id)
          fd.append('existingImageUrls', JSON.stringify(s.existingImageUrls))
          fd.append('existingImageThumbUrls', JSON.stringify(s.existingThumbUrls))
          res = await fetch('/api/reviews', { method: 'PATCH', body: fd, credentials: 'include' })
        } else {
          res = await fetch('/api/reviews', { method: 'POST', body: fd, credentials: 'include' })
        }

        const data = await res.json()
        if (!res.ok) throw new Error(data.error || `Failed to submit review for ${item.productName}`)
        onSuccess(item.productId, data.review)
        update(i, { submitted: true })
      }))
      onClose()
    } catch (err: any) {
      setGlobalError(err?.message || 'Something went wrong. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const allAlreadyReviewed = items.every(item => !!reviewMap[item.productId])

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full sm:max-w-lg bg-surface-elevated rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-surface-elevated border-b border-border-default px-5 py-4 flex items-center justify-between rounded-t-2xl sm:rounded-t-2xl z-10">
          <h2 className="text-base font-bold text-foreground">
            {allAlreadyReviewed ? 'Edit Your Reviews' : 'Rate Your Order'}
          </h2>
          <button onClick={onClose} className="p-1 rounded-full hover:bg-surface-secondary text-foreground-muted">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-5 space-y-8">
          {items.map((item, i) => {
            const s = states[i]
            const totalImages = s.existingImageUrls.length + s.newImages.length
            const canAddMore = totalImages < 3

            return (
              <div key={item.productId} className={i > 0 ? 'pt-8 border-t border-border-default' : ''}>
                {/* Product header */}
                <div className="flex items-center gap-3 mb-4">
                  {item.productImage && (
                    <img src={item.productImage} alt={item.productName} className="w-12 h-12 rounded-lg object-cover border border-border-default flex-shrink-0" />
                  )}
                  <p className="text-sm font-semibold text-foreground line-clamp-2">{item.productName}</p>
                </div>

                {/* Stars */}
                <div className="mb-4">
                  <p className="text-sm font-medium text-foreground mb-2">Rating <span className="text-red-500">*</span></p>
                  <div className="flex gap-1">
                    {[1, 2, 3, 4, 5].map(n => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => update(i, { rating: n })}
                        onMouseEnter={() => update(i, { hoverRating: n })}
                        onMouseLeave={() => update(i, { hoverRating: 0 })}
                        className="text-3xl leading-none transition-transform hover:scale-110"
                      >
                        <span className={(s.hoverRating || s.rating) >= n ? 'text-yellow-400' : 'text-gray-300'}>★</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Tags */}
                <div className="mb-4">
                  <p className="text-sm font-medium text-foreground mb-2">What did you like?</p>
                  <div className="flex flex-wrap gap-2">
                    {TAGS.map(tag => (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => toggleTag(i, tag)}
                        className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                          s.selectedTags.includes(tag)
                            ? 'bg-accent-500 text-white border-accent-500'
                            : 'bg-surface-secondary text-foreground-secondary border-border-default hover:border-accent-400'
                        }`}
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                </div>

                {/* AI generate */}
                <button
                  type="button"
                  onClick={() => handleGenerate(i)}
                  disabled={!s.rating || s.isGenerating}
                  className="w-full flex items-center justify-center gap-2 py-2 px-4 rounded-lg border border-accent-400 text-accent-600 dark:text-accent-400 text-sm font-medium hover:bg-accent-50 dark:hover:bg-accent-900/20 disabled:opacity-40 transition-colors mb-4"
                >
                  {s.isGenerating ? (
                    <><svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" /></svg> Generating…</>
                  ) : (
                    <><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg> Generate with AI</>
                  )}
                </button>

                {/* Title */}
                <div className="mb-4">
                  <label className="block text-sm font-medium text-foreground mb-1">Title <span className="text-foreground-muted">(optional)</span></label>
                  <input
                    type="text"
                    value={s.title}
                    onChange={e => update(i, { title: e.target.value })}
                    maxLength={120}
                    placeholder="Summarise your experience"
                    className="w-full px-3 py-2 rounded-lg border border-border-default bg-surface text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-accent-400"
                  />
                </div>

                {/* Comment */}
                <div className="mb-4">
                  <label className="block text-sm font-medium text-foreground mb-1">Your review <span className="text-red-500">*</span></label>
                  <textarea
                    value={s.comment}
                    onChange={e => update(i, { comment: e.target.value })}
                    maxLength={2000}
                    rows={3}
                    placeholder="Tell others about your experience…"
                    className="w-full px-3 py-2 rounded-lg border border-border-default bg-surface text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-accent-400 resize-none"
                  />
                </div>

                {/* Photos */}
                <div>
                  <p className="text-sm font-medium text-foreground mb-2">Photos <span className="text-foreground-muted">(up to 3)</span></p>
                  <div className="flex flex-wrap gap-2">
                    {s.existingImageUrls.map((url, j) => (
                      <div key={`ex-${j}`} className="relative w-14 h-14 rounded-lg overflow-hidden border border-border-default">
                        <img src={s.existingThumbUrls[j] || url} alt="" className="w-full h-full object-cover" />
                        <button
                          type="button"
                          onClick={() => update(i, {
                            existingImageUrls: s.existingImageUrls.filter((_, idx) => idx !== j),
                            existingThumbUrls: s.existingThumbUrls.filter((_, idx) => idx !== j),
                          })}
                          className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/60 text-white flex items-center justify-center text-xs leading-none"
                        >×</button>
                      </div>
                    ))}
                    {s.newImages.map((file, j) => (
                      <div key={`new-${j}`} className="relative w-14 h-14 rounded-lg overflow-hidden border border-border-default">
                        <img src={URL.createObjectURL(file)} alt="" className="w-full h-full object-cover" />
                        <button
                          type="button"
                          onClick={() => update(i, { newImages: s.newImages.filter((_, idx) => idx !== j) })}
                          className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/60 text-white flex items-center justify-center text-xs leading-none"
                        >×</button>
                      </div>
                    ))}
                    {canAddMore && (
                      <button
                        type="button"
                        onClick={() => fileRefs.current[i]?.click()}
                        className="w-14 h-14 rounded-lg border-2 border-dashed border-border-default flex items-center justify-center text-foreground-muted hover:border-accent-400 transition-colors"
                      >
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                      </button>
                    )}
                    <input
                      ref={el => { fileRefs.current[i] = el }}
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      onChange={e => handleFileChange(i, e)}
                    />
                  </div>
                </div>

                {s.error && <p className="text-sm text-red-500 mt-2">{s.error}</p>}
              </div>
            )
          })}

          {globalError && <p className="text-sm text-red-500">{globalError}</p>}

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 rounded-lg border border-border-default text-sm font-medium text-foreground-secondary hover:bg-surface-secondary transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmitAll}
              disabled={isSubmitting}
              className="flex-1 py-2.5 rounded-lg bg-accent-500 hover:bg-accent-600 text-white text-sm font-semibold disabled:opacity-50 transition-colors"
            >
              {isSubmitting ? 'Submitting…' : allAlreadyReviewed ? 'Update Reviews' : 'Submit Reviews'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
