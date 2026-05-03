'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import AdminSelect from '@/components/admin/AdminSelect'
import FormsPreview from '@/components/forms/FormsPreview'

interface Coupon {
  id: string
  code: string
  description: string | null
}

interface CustomField {
  id: string
  label: string
  type: 'text' | 'textarea' | 'image' | 'rating'
  required: boolean
}

interface ReviewFormFormProps {
  submitLabel: string
  coupons: Coupon[]
  formId?: string
  defaultValues?: {
    title?: string
    slug?: string
    google_review_url?: string
    coupon_id?: string | null
    description?: string | null
    is_active?: boolean
    custom_fields?: CustomField[]
  }
}

const FIELD_TYPES = [
  { value: 'text', label: 'Short text' },
  { value: 'textarea', label: 'Long text' },
  { value: 'image', label: 'Image upload' },
  { value: 'rating', label: 'Star rating' },
]

const inputClass = 'w-full px-4 py-2 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-transparent text-sm'
const labelClass = 'block text-sm font-medium text-foreground-secondary mb-1.5'

function randomId() {
  return Math.random().toString(36).slice(2, 10)
}

export default function ReviewFormForm({ submitLabel, coupons, formId, defaultValues: d = {} }: ReviewFormFormProps) {
  const router = useRouter()
  const [title, setTitle] = useState(d.title || '')
  const [slug, setSlug] = useState(d.slug || '')
  const [googleUrl, setGoogleUrl] = useState(d.google_review_url || '')
  const [couponId, setCouponId] = useState(d.coupon_id || '')
  const [description, setDescription] = useState(d.description || '')
  const [isActive, setIsActive] = useState(d.is_active !== false)
  const [customFields, setCustomFields] = useState<CustomField[]>(d.custom_fields || [])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const couponOptions = [
    { value: '', label: '— No coupon —' },
    ...coupons.map(c => ({
      value: c.id,
      label: c.code + (c.description ? ` — ${c.description}` : ''),
    })),
  ]

  function addField() {
    setCustomFields(prev => [...prev, { id: randomId(), label: '', type: 'text', required: false }])
  }

  function updateField(id: string, patch: Partial<CustomField>) {
    setCustomFields(prev => prev.map(f => f.id === id ? { ...f, ...patch } : f))
  }

  function removeField(id: string) {
    setCustomFields(prev => prev.filter(f => f.id !== id))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      const payload = {
        title: title.trim(),
        slug: slug.toLowerCase().trim().replace(/[^a-z0-9-]/g, '-'),
        google_review_url: googleUrl.trim(),
        coupon_id: couponId || null,
        description: description.trim() || null,
        is_active: isActive,
        custom_fields: customFields,
      }

      const url = formId ? `/api/admin/review-forms/${formId}` : '/api/admin/review-forms'
      const method = formId ? 'PATCH' : 'POST'

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const data = await res.json()
        setError(data.error || 'Failed to save form')
        return
      }

      router.push('/admin/review-forms')
      router.refresh()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid grid-cols-1 xl:grid-cols-2 gap-8 items-start">
      <div className="space-y-5">
        <div>
          <label className={labelClass}>Form Title *</label>
          <input value={title} onChange={e => setTitle(e.target.value)} required className={inputClass} placeholder="e.g. Leave Us a Google Review" />
        </div>

        <div>
          <label className={labelClass}>
            Slug * <span className="text-foreground-muted font-normal">— forms.jeffistores.in/<strong>{slug || 'this-slug'}</strong></span>
          </label>
          <input
            value={slug}
            onChange={e => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
            required
            className={`${inputClass} font-mono`}
            placeholder="e.g. google-review"
          />
        </div>

        <div>
          <label className={labelClass}>Google Review URL *</label>
          <input value={googleUrl} onChange={e => setGoogleUrl(e.target.value)} type="url" required className={inputClass} placeholder="https://g.page/r/..." />
          <p className="mt-1 text-xs text-foreground-muted">Customers are sent here first before submitting their screenshot</p>
        </div>

        <AdminSelect
          label="Reward Coupon"
          options={couponOptions}
          value={couponId}
          onChange={setCouponId}
        />
        {coupons.length === 0 && (
          <p className="text-xs text-amber-600">
            No active coupons found. <Link href="/admin/coupons/add" className="underline">Create one first.</Link>
          </p>
        )}

        <div>
          <label className={labelClass}>Description</label>
          <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} className={inputClass} placeholder="Optional — shown to customer on the form page" />
        </div>

        <div className="flex items-center gap-2">
          <input type="checkbox" id="is_active" checked={isActive} onChange={e => setIsActive(e.target.checked)} className="w-4 h-4 text-accent-600 rounded border-border-secondary" />
          <label htmlFor="is_active" className="text-sm text-foreground-secondary">Active (form accepts submissions)</label>
        </div>

        <div>
          <div className="flex items-center justify-between mb-3">
            <p className={labelClass.replace(' mb-1.5', '')}>Custom Fields</p>
            <button type="button" onClick={addField} className="text-xs text-accent-500 hover:text-accent-600 font-medium">+ Add Field</button>
          </div>

          {customFields.length === 0 && (
            <p className="text-xs text-foreground-muted py-3 text-center border border-dashed border-border-default rounded-lg">No custom fields yet — click &quot;Add Field&quot; to add one</p>
          )}

          <div className="space-y-3">
            {customFields.map((field, idx) => (
              <div key={field.id} className="flex items-start gap-3 p-3 bg-surface-secondary rounded-lg border border-border-default">
                <span className="text-xs text-foreground-muted mt-2 shrink-0 w-4">{idx + 1}.</span>
                <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input
                    value={field.label}
                    onChange={e => updateField(field.id, { label: e.target.value })}
                    placeholder="Field label"
                    className="px-3 py-1.5 border border-border-secondary rounded-lg bg-surface text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-accent-500"
                  />
                  <select
                    value={field.type}
                    onChange={e => updateField(field.id, { type: e.target.value as CustomField['type'] })}
                    className="px-3 py-1.5 border border-border-secondary rounded-lg bg-surface text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-accent-500"
                  >
                    {FIELD_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <div className="flex items-center gap-2 mt-1.5 shrink-0">
                  <label className="flex items-center gap-1 text-xs text-foreground-secondary cursor-pointer">
                    <input
                      type="checkbox"
                      checked={field.required}
                      onChange={e => updateField(field.id, { required: e.target.checked })}
                      className="w-3.5 h-3.5 accent-accent-500"
                    />
                    Req
                  </label>
                  <button type="button" onClick={() => removeField(field.id)} className="text-red-400 hover:text-red-500 text-sm leading-none">✕</button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {error && <p className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded-lg">{error}</p>}

        <div className="flex gap-3 pt-2">
          <Link href="/admin/review-forms" className="px-5 py-2 bg-surface-secondary hover:bg-border-default text-foreground-secondary rounded-lg font-medium transition-colors text-sm">
            Cancel
          </Link>
          <button type="submit" disabled={submitting} className="px-6 py-2 bg-accent-500 hover:bg-accent-600 text-white rounded-lg font-semibold transition-colors text-sm disabled:opacity-50">
            {submitting ? 'Saving…' : submitLabel}
          </button>
        </div>
      </div>

      <div className="sticky top-6">
        <p className="text-xs font-medium text-foreground-muted uppercase tracking-wide mb-2">Live Preview</p>
        <FormsPreview
          title={title}
          description={description}
          googleReviewUrl={googleUrl}
          couponId={couponId}
          customFields={customFields}
        />
      </div>
    </form>
  )
}
