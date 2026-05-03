'use client'

import Link from 'next/link'
import AdminSelect from '@/components/admin/AdminSelect'

interface CouponFormProps {
  action: (formData: FormData) => Promise<void>
  submitLabel: string
  defaultValues?: {
    code?: string
    discount_type?: string
    discount_value?: number
    min_purchase_amount?: number | null
    max_discount_amount?: number | null
    usage_limit?: number | null
    usage_limit_per_user?: number | null
    valid_from?: string
    valid_until?: string
    description?: string | null
    is_active?: boolean
  }
}

const DISCOUNT_TYPE_OPTIONS = [
  { value: 'percentage', label: 'Percentage (%)' },
  { value: 'fixed', label: 'Fixed Amount (₹)' },
]

const inputClass = 'w-full px-4 py-2 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-transparent'
const labelClass = 'block text-sm font-medium text-foreground-secondary mb-1.5'

export default function CouponForm({ action, submitLabel, defaultValues: d = {} }: CouponFormProps) {
  return (
    <form action={action} className="bg-surface-elevated rounded-lg border border-border-default p-6 space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <div>
          <label className={labelClass}>Coupon Code *</label>
          <input
            name="code"
            required
            defaultValue={d.code}
            className={inputClass}
            placeholder="e.g. REVIEW10"
            style={{ textTransform: 'uppercase' }}
          />
        </div>
        <AdminSelect
          name="discount_type"
          label="Discount Type *"
          options={DISCOUNT_TYPE_OPTIONS}
          defaultValue={d.discount_type || 'percentage'}
          required
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <div>
          <label className={labelClass}>Discount Value *</label>
          <input
            name="discount_value"
            type="number"
            step="0.01"
            min="0"
            required
            defaultValue={d.discount_value}
            className={inputClass}
            placeholder="e.g. 10"
          />
        </div>
        <div>
          <label className={labelClass}>Min Purchase Amount (₹)</label>
          <input
            name="min_purchase_amount"
            type="number"
            step="0.01"
            min="0"
            defaultValue={d.min_purchase_amount ?? ''}
            className={inputClass}
            placeholder="Optional"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <div>
          <label className={labelClass}>Max Discount (₹)</label>
          <input
            name="max_discount_amount"
            type="number"
            step="0.01"
            min="0"
            defaultValue={d.max_discount_amount ?? ''}
            className={inputClass}
            placeholder="Optional cap"
          />
        </div>
        <div>
          <label className={labelClass}>Total Usage Limit</label>
          <input
            name="usage_limit"
            type="number"
            min="1"
            defaultValue={d.usage_limit ?? ''}
            className={inputClass}
            placeholder="Unlimited if blank"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <div>
          <label className={labelClass}>Valid From</label>
          <input
            name="valid_from"
            type="datetime-local"
            defaultValue={d.valid_from}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>Valid Until</label>
          <input
            name="valid_until"
            type="datetime-local"
            defaultValue={d.valid_until}
            className={inputClass}
          />
        </div>
      </div>

      <div>
        <label className={labelClass}>Description</label>
        <textarea
          name="description"
          rows={2}
          defaultValue={d.description ?? ''}
          className={inputClass}
          placeholder="e.g. 10% off for Google review submission"
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
        <label htmlFor="is_active" className="text-sm text-foreground-secondary">Active</label>
      </div>

      <div className="flex gap-3 pt-2">
        <Link href="/admin/coupons" className="px-5 py-2 bg-surface-secondary hover:bg-border-default text-foreground-secondary rounded-lg font-medium transition-colors text-sm">
          Cancel
        </Link>
        <button type="submit" className="px-6 py-2 bg-accent-500 hover:bg-accent-600 text-white rounded-lg font-semibold transition-colors text-sm">
          {submitLabel}
        </button>
      </div>
    </form>
  )
}
