'use client'

import { useState, useRef } from 'react'
import Image from 'next/image'
import { Star, X, Paperclip, Lock, PartyPopper, Camera } from 'lucide-react'
import { useStoreConfig } from '@/contexts/StoreConfigContext'

interface CustomField {
  id: string
  label: string
  type: 'text' | 'textarea' | 'image' | 'rating'
  required: boolean
}

interface ReviewForm {
  id: string
  title: string
  description: string | null
  template_type: 'google_review' | 'product_feedback' | 'testimonial'
  google_review_url: string
  slug: string
  is_active: boolean
  coupon_id: string | null
  custom_fields: CustomField[]
}

interface SuccessData {
  couponCode: string | null
  couponDescription: string | null
  validUntil: string | null
  discountType: string | null
  discountValue: number | null
}

function StarRating({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map(star => (
        <button
          key={star}
          type="button"
          onClick={() => onChange(star)}
          className={`transition-colors ${star <= value ? 'text-yellow-400' : 'text-gray-300'}`}
          aria-label={`${star} star`}
        >
          <Star className={`w-7 h-7 ${star <= value ? 'fill-current' : ''}`} />
        </button>
      ))}
    </div>
  )
}

function ImageFieldUpload({ fieldId, label, required }: { fieldId: string; label: string; required: boolean }) {
  const [preview, setPreview] = useState<string | null>(null)
  const ref = useRef<HTMLInputElement>(null)

  const handleFile = (f: File) => {
    const reader = new FileReader()
    reader.onload = e => setPreview(e.target?.result as string)
    reader.readAsDataURL(f)
  }

  return (
    <div>
      <label className="block text-sm font-medium text-gray-600 mb-1.5">
        {label}
        {required ? ' *' : ''}
      </label>
      <div
        onClick={() => ref.current?.click()}
        className="border-2 border-dashed border-gray-200 rounded-xl p-4 cursor-pointer hover:border-blue-400 hover:bg-blue-50/50 transition-colors"
      >
        {preview ? (
          <div className="relative">
            <Image
              src={preview}
              alt="Preview"
              width={400}
              height={200}
              className="w-full max-h-40 object-contain rounded-lg"
              unoptimized
            />
            <button
              type="button"
              onClick={e => {
                e.stopPropagation()
                setPreview(null)
                if (ref.current) ref.current.value = ''
              }}
              aria-label="Remove file"
              className="absolute top-2 right-2 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <div className="text-center py-3">
            <Paperclip className="w-7 h-7 mx-auto mb-1 text-foreground-muted" />
            <p className="text-sm text-gray-500">Tap to upload</p>
            <p className="text-xs text-gray-400">JPEG, PNG · max 5MB</p>
          </div>
        )}
      </div>
      <input
        ref={ref}
        name={`field_${fieldId}`}
        type="file"
        accept="image/*"
        required={required}
        className="hidden"
        onChange={e => {
          const f = e.target.files?.[0]
          if (f) handleFile(f)
        }}
      />
    </div>
  )
}

export default function FormClient({ form }: { form: ReviewForm }) {
  const config = useStoreConfig()
  const [email, setEmail] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [ratings, setRatings] = useState<Record<string, number>>({})
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState<SuccessData | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const formRef = useRef<HTMLFormElement>(null)

  const isGoogleReview = form.template_type === 'google_review'
  const isProductFeedback = form.template_type === 'product_feedback'
  const isTestimonial = form.template_type === 'testimonial'
  const screenshotRequired = isGoogleReview

  const handleFile = (f: File) => {
    setFile(f)
    const reader = new FileReader()
    reader.onload = e => setPreview(e.target?.result as string)
    reader.readAsDataURL(f)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const f = e.dataTransfer.files[0]
    if (f?.type.startsWith('image/')) handleFile(f)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('Enter a valid email address')
      return
    }
    if (screenshotRequired && !file) {
      setError('Please upload a screenshot of your Google review')
      return
    }

    setSubmitting(true)
    try {
      const fd = new FormData(formRef.current!)
      fd.set('email', email)
      if (file) fd.set('screenshot', file)
      for (const [fieldId, val] of Object.entries(ratings)) {
        fd.set(`field_${fieldId}`, String(val))
      }

      const res = await fetch(`/api/forms/${form.slug}/submit`, { method: 'POST', body: fd })
      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Something went wrong, please try again')
        return
      }
      setSuccess(data)
    } finally {
      setSubmitting(false)
    }
  }

  if (!form.is_active) {
    return (
      <div className="min-h-[calc(100vh-48px)] bg-gradient-to-br from-slate-50 to-blue-50 flex items-center justify-center p-4">
        <div className="text-center max-w-md">
          <Lock className="w-10 h-10 mx-auto mb-4 text-foreground-muted" />
          <h1 className="text-xl font-bold text-gray-800 mb-2">Form Closed</h1>
          <p className="text-gray-500">This form is no longer accepting submissions.</p>
        </div>
      </div>
    )
  }

  if (success) {
    const discountText =
      success.discountType === 'percentage'
        ? `${success.discountValue}% off`
        : success.discountValue
          ? `₹${success.discountValue} off`
          : null

    return (
      <div className="min-h-[calc(100vh-48px)] bg-gradient-to-br from-green-50 to-emerald-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-8 text-center space-y-5">
          <PartyPopper className="w-12 h-12 mx-auto text-emerald-500" />
          <h2 className="text-2xl font-bold text-gray-800">Thank You!</h2>
          <p className="text-gray-500">Your review screenshot has been received. Here&apos;s your reward:</p>

          {success.couponCode ? (
            <>
              <div className="bg-gradient-to-r from-orange-500 to-orange-600 rounded-xl p-5 text-white space-y-1">
                {discountText && <p className="text-sm font-medium opacity-90">{discountText} on your next order</p>}
                <p className="text-3xl font-black tracking-widest">{success.couponCode}</p>
                {success.couponDescription && <p className="text-sm opacity-80">{success.couponDescription}</p>}
                {success.validUntil && (
                  <p className="text-xs opacity-70 mt-1">
                    Valid until{' '}
                    {new Date(success.validUntil).toLocaleDateString('en-IN', {
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric',
                    })}
                  </p>
                )}
              </div>
              <p className="text-xs text-gray-400">We&apos;ve also sent the coupon to your email</p>
            </>
          ) : (
            <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-green-700 font-medium">
              Your submission has been received! We&apos;ll be in touch.
            </div>
          )}

          <a
            href={config.identity.web || '/'}
            className="block w-full py-3 bg-gray-800 hover:bg-gray-900 text-white rounded-xl font-semibold transition-colors"
          >
            Shop Now at {config.identity.name}
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-[calc(100vh-48px)] bg-gradient-to-br from-slate-50 to-blue-50">
      <div className="max-w-lg mx-auto px-4 py-8 space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold text-gray-800">{form.title}</h1>
          {form.description && <p className="text-gray-500 text-sm">{form.description}</p>}
        </div>

        {isGoogleReview && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 space-y-3">
            <div className="flex items-center gap-3">
              <span className="w-7 h-7 rounded-full bg-blue-500 text-white text-sm font-bold flex items-center justify-center shrink-0">
                1
              </span>
              <div>
                <p className="font-semibold text-gray-800">Leave us a Google review</p>
                <p className="text-xs text-gray-400">It takes less than a minute!</p>
              </div>
            </div>
            <a
              href={form.google_review_url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 w-full py-3 bg-blue-500 hover:bg-blue-600 text-white rounded-xl font-semibold transition-colors"
            >
              Open Google Review Page
            </a>
          </div>
        )}

        {isProductFeedback && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 space-y-3">
            <div className="flex items-center gap-3">
              <span className="w-7 h-7 rounded-full bg-purple-500 text-white text-sm font-bold flex items-center justify-center shrink-0">
                1
              </span>
              <div>
                <p className="font-semibold text-gray-800">Rate your experience</p>
                <p className="text-xs text-gray-400">How was your recent purchase?</p>
              </div>
            </div>
            <StarRating
              value={ratings['__overall'] || 0}
              onChange={v => setRatings(prev => ({ ...prev, __overall: v }))}
            />
          </div>
        )}

        {isTestimonial && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 space-y-3">
            <div className="flex items-center gap-3">
              <span className="w-7 h-7 rounded-full bg-indigo-500 text-white text-sm font-bold flex items-center justify-center shrink-0">
                1
              </span>
              <div>
                <p className="font-semibold text-gray-800">Share your story</p>
                <p className="text-xs text-gray-400">Tell us about your experience with {config.identity.name}</p>
              </div>
            </div>
            <textarea
              name="testimonial_text"
              rows={4}
              required
              placeholder="Write your testimonial here…"
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-400 text-sm resize-none"
            />
          </div>
        )}

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <div className="flex items-center gap-3 mb-4">
            <span className="w-7 h-7 rounded-full bg-green-500 text-white text-sm font-bold flex items-center justify-center shrink-0">
              {isGoogleReview ? '2' : '2'}
            </span>
            <div>
              <p className="font-semibold text-gray-800">
                {isGoogleReview ? 'Submit your review screenshot' : 'Submit your details'}
              </p>
              <p className="text-xs text-gray-400">
                {form.coupon_id ? 'Get your discount coupon instantly' : "We'll verify your submission"}
              </p>
            </div>
          </div>

          <form ref={formRef} onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1.5">Email Address *</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent text-sm"
                placeholder="you@example.com"
                required
              />
            </div>

            {isGoogleReview && (
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1.5">Screenshot of your review *</label>
                <div
                  onDrop={handleDrop}
                  onDragOver={e => e.preventDefault()}
                  onClick={() => fileRef.current?.click()}
                  className="border-2 border-dashed border-gray-200 rounded-xl p-4 cursor-pointer hover:border-blue-400 hover:bg-blue-50/50 transition-colors"
                >
                  {preview ? (
                    <div className="relative">
                      <Image
                        src={preview}
                        alt="Preview"
                        width={400}
                        height={200}
                        className="w-full max-h-48 object-contain rounded-lg"
                        unoptimized
                      />
                      <button
                        type="button"
                        onClick={e => {
                          e.stopPropagation()
                          setFile(null)
                          setPreview(null)
                        }}
                        aria-label="Remove file"
                        className="absolute top-2 right-2 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center hover:bg-red-600"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <div className="text-center py-4">
                      <Camera className="w-9 h-9 mx-auto mb-2 text-foreground-muted" />
                      <p className="text-sm text-gray-500">Tap to upload screenshot</p>
                      <p className="text-xs text-gray-400 mt-0.5">JPEG, PNG · max 5MB</p>
                    </div>
                  )}
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={e => {
                    const f = e.target.files?.[0]
                    if (f) handleFile(f)
                  }}
                />
              </div>
            )}

            {(isProductFeedback || isTestimonial) && (
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1.5">Photo (optional)</label>
                <div
                  onDrop={handleDrop}
                  onDragOver={e => e.preventDefault()}
                  onClick={() => fileRef.current?.click()}
                  className="border-2 border-dashed border-gray-200 rounded-xl p-4 cursor-pointer hover:border-blue-400 hover:bg-blue-50/50 transition-colors"
                >
                  {preview ? (
                    <div className="relative">
                      <Image
                        src={preview}
                        alt="Preview"
                        width={400}
                        height={200}
                        className="w-full max-h-48 object-contain rounded-lg"
                        unoptimized
                      />
                      <button
                        type="button"
                        onClick={e => {
                          e.stopPropagation()
                          setFile(null)
                          setPreview(null)
                        }}
                        aria-label="Remove file"
                        className="absolute top-2 right-2 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center hover:bg-red-600"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <div className="text-center py-4">
                      <Paperclip className="w-9 h-9 mx-auto mb-2 text-foreground-muted" />
                      <p className="text-sm text-gray-500">Tap to attach a photo</p>
                      <p className="text-xs text-gray-400 mt-0.5">JPEG, PNG · max 5MB</p>
                    </div>
                  )}
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={e => {
                    const f = e.target.files?.[0]
                    if (f) handleFile(f)
                  }}
                />
              </div>
            )}

            {form.custom_fields.map(field => (
              <div key={field.id}>
                {field.type === 'text' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-600 mb-1.5">
                      {field.label}
                      {field.required ? ' *' : ''}
                    </label>
                    <input
                      name={`field_${field.id}`}
                      type="text"
                      required={field.required}
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-400 text-sm"
                    />
                  </div>
                )}
                {field.type === 'textarea' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-600 mb-1.5">
                      {field.label}
                      {field.required ? ' *' : ''}
                    </label>
                    <textarea
                      name={`field_${field.id}`}
                      rows={3}
                      required={field.required}
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-400 text-sm resize-none"
                    />
                  </div>
                )}
                {field.type === 'image' && (
                  <ImageFieldUpload fieldId={field.id} label={field.label} required={field.required} />
                )}
                {field.type === 'rating' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-600 mb-1.5">
                      {field.label}
                      {field.required ? ' *' : ''}
                    </label>
                    <StarRating
                      value={ratings[field.id] || 0}
                      onChange={v => setRatings(prev => ({ ...prev, [field.id]: v }))}
                    />
                  </div>
                )}
              </div>
            ))}

            {error && <p className="text-sm text-red-500 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

            <button
              type="submit"
              disabled={submitting || (screenshotRequired && !file) || !email}
              className="w-full py-3.5 bg-green-500 hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl font-bold transition-colors flex items-center justify-center gap-2"
            >
              {submitting ? (
                <>
                  <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                  Submitting…
                </>
              ) : (
                `Submit${form.coupon_id ? ' & Get Coupon' : ''}`
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
