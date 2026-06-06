'use client'

import { useState } from 'react'
import Link from 'next/link'
import AdminSelect from '@/components/admin/AdminSelect'
import Toggle from '@/components/ui/Toggle'
import DateTimePicker from '@/components/ui/DateTimePicker'
import AIEnrichButton from '@/components/admin/AIEnrichButton'

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
  const [isActive, setIsActive] = useState<boolean>(d.is_active !== false)
  const [validFrom, setValidFrom] = useState(d.valid_from ?? '')
  const [validUntil, setValidUntil] = useState(d.valid_until ?? '')
  const [couponDescription, setCouponDescription] = useState(d.description ?? '')

  return (
    <form action={action} className="space-y-5">
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <div className="xl:col-span-2 space-y-5">
          <div className="bg-surface-elevated rounded-lg border border-border-default p-6 space-y-5">
            <h2 className="text-sm font-semibold text-foreground-secondary uppercase tracking-wide">Code & Discount</h2>
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
            </div>
          </div>

          <div className="bg-surface-elevated rounded-lg border border-border-default p-6 space-y-5">
            <h2 className="text-sm font-semibold text-foreground-secondary uppercase tracking-wide">Limits</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
              <div>
                <label className={labelClass}>Min Purchase (₹)</label>
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
              <div>
                <label className={labelClass}>Total Usage Limit</label>
                <input
                  name="usage_limit"
                  type="number"
                  min="1"
                  defaultValue={d.usage_limit ?? ''}
                  className={inputClass}
                  placeholder="Unlimited"
                />
              </div>
              <div>
                <label className={labelClass}>Per-User Limit</label>
                <input
                  name="usage_limit_per_user"
                  type="number"
                  min="1"
                  defaultValue={d.usage_limit_per_user ?? ''}
                  className={inputClass}
                  placeholder="Unlimited"
                />
              </div>
            </div>
          </div>

          <div className="bg-surface-elevated rounded-lg border border-border-default p-6 space-y-3">
            <h2 className="text-sm font-semibold text-foreground-secondary uppercase tracking-wide">Description</h2>
            <AIEnrichButton
              fieldLabel="Coupon Description"
              value={couponDescription}
              onChange={setCouponDescription}
              context={`Coupon code: ${d.code ?? 'new coupon'}`}
              multiline
            >
              <textarea
                name="description"
                rows={3}
                value={couponDescription}
                onChange={e => setCouponDescription(e.target.value)}
                className={`${inputClass} pr-8`}
                placeholder="e.g. 10% off for Google review submission"
              />
            </AIEnrichButton>
          </div>
        </div>

        <aside className="space-y-5">
          <div className="bg-surface-elevated rounded-lg border border-border-default p-6">
            <h2 className="text-sm font-semibold text-foreground-secondary uppercase tracking-wide mb-4">Status</h2>
            <input type="hidden" name="is_active" value={isActive ? 'true' : 'false'} />
            <Toggle id="is_active" checked={isActive} onChange={setIsActive} label="Active" />
            <p className="text-xs text-foreground-muted mt-2">
              {isActive ? 'Customers can apply this coupon at checkout.' : 'Coupon is paused — cannot be redeemed.'}
            </p>
          </div>

          <div className="bg-surface-elevated rounded-lg border border-border-default p-6 space-y-4">
            <h2 className="text-sm font-semibold text-foreground-secondary uppercase tracking-wide">Validity</h2>
            <div>
              <label className={labelClass}>Valid From</label>
              <DateTimePicker name="valid_from" value={validFrom} onChange={setValidFrom} className="w-full" />
            </div>
            <div>
              <label className={labelClass}>Valid Until</label>
              <DateTimePicker name="valid_until" value={validUntil} onChange={setValidUntil} className="w-full" />
            </div>
            <p className="text-xs text-foreground-muted">Leave blank for no time limit.</p>
          </div>
        </aside>
      </div>

      <div className="flex gap-3 pt-2 sticky bottom-0 bg-surface/90 backdrop-blur py-3 -mx-4 sm:-mx-6 px-4 sm:px-6 border-t border-border-default">
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
