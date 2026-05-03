'use client'

import Link from 'next/link'
import AdminSelect from '@/components/admin/AdminSelect'

interface Coupon {
  id: string
  code: string
  description: string | null
}

interface ReviewFormFormProps {
  action: (formData: FormData) => Promise<void>
  submitLabel: string
  coupons: Coupon[]
  defaultValues?: {
    title?: string
    slug?: string
    google_review_url?: string
    coupon_id?: string | null
    description?: string | null
    is_active?: boolean
  }
}

const inputClass = 'w-full px-4 py-2 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-transparent'
const labelClass = 'block text-sm font-medium text-foreground-secondary mb-1.5'

export default function ReviewFormForm({ action, submitLabel, coupons, defaultValues: d = {} }: ReviewFormFormProps) {
  const couponOptions = [
    { value: '', label: '— No coupon —' },
    ...coupons.map(c => ({
      value: c.id,
      label: c.code + (c.description ? ` — ${c.description}` : ''),
    })),
  ]

  return (
    <form action={action} className="bg-surface-elevated rounded-lg border border-border-default p-6 space-y-5">
      <div>
        <label className={labelClass}>Form Title *</label>
        <input
          name="title"
          required
          defaultValue={d.title}
          className={inputClass}
          placeholder="e.g. Leave Us a Google Review"
        />
      </div>

      <div>
        <label className={labelClass}>
          Slug * <span className="text-foreground-muted font-normal">— forms.jeffistores.in/<strong>this-slug</strong></span>
        </label>
        <input
          name="slug"
          required
          defaultValue={d.slug}
          className={`${inputClass} font-mono`}
          placeholder="e.g. google-review"
          pattern="[a-z0-9-]+"
          title="Lowercase letters, numbers, hyphens only"
        />
      </div>

      <div>
        <label className={labelClass}>Google Review URL *</label>
        <input
          name="google_review_url"
          type="url"
          required
          defaultValue={d.google_review_url}
          className={inputClass}
          placeholder="https://g.page/r/..."
        />
        <p className="mt-1 text-xs text-foreground-muted">Paste your Google Maps review link — customers will be sent here first</p>
      </div>

      <div>
        <AdminSelect
          name="coupon_id"
          label="Reward Coupon"
          options={couponOptions}
          defaultValue={d.coupon_id || ''}
        />
        {coupons.length === 0 && (
          <p className="mt-1.5 text-xs text-amber-600">
            No active coupons found. <Link href="/admin/coupons/add" className="underline">Create one first.</Link>
          </p>
        )}
      </div>

      <div>
        <label className={labelClass}>Description</label>
        <textarea
          name="description"
          rows={2}
          defaultValue={d.description ?? ''}
          className={inputClass}
          placeholder="Optional — shown to customer on the form page"
        />
      </div>

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          name="is_active"
          id="is_active"
          defaultChecked={d.is_active !== false}
          className="w-4 h-4 text-accent-600 rounded border-border-secondary"
        />
        <label htmlFor="is_active" className="text-sm text-foreground-secondary">Active (form accepts submissions)</label>
      </div>

      <div className="flex gap-3 pt-2">
        <Link href="/admin/review-forms" className="px-5 py-2 bg-surface-secondary hover:bg-border-default text-foreground-secondary rounded-lg font-medium transition-colors text-sm">
          Cancel
        </Link>
        <button type="submit" className="px-6 py-2 bg-accent-500 hover:bg-accent-600 text-white rounded-lg font-semibold transition-colors text-sm">
          {submitLabel}
        </button>
      </div>
    </form>
  )
}
