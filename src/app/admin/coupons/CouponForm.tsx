'use client'

import { useState, useRef } from 'react'
import Link from 'next/link'
import { ap } from '@/lib/admin-path'
import AdminSelect from '@/components/admin/AdminSelect'
import Toggle from '@/components/ui/Toggle'
import DateTimePicker from '@/components/ui/DateTimePicker'
import AIEnrichButton from '@/components/admin/AIEnrichButton'
import AIFillForm from '@/components/admin/AIFillForm'
import CouponUserSelector from '@/components/admin/CouponUserSelector'

interface CouponFormProps {
  action: (formData: FormData) => Promise<void>
  submitLabel?: string
  isDraft?: boolean
  showUserSelector?: boolean
  backUrl?: string
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

export default function CouponForm({ action, submitLabel, isDraft = false, showUserSelector = false, backUrl, defaultValues: d = {} }: CouponFormProps) {
  const [isActive, setIsActive] = useState<boolean>(d.is_active !== false)
  const [validFrom, setValidFrom] = useState(d.valid_from ?? '')
  const [validUntil, setValidUntil] = useState(d.valid_until ?? '')
  const [couponDescription, setCouponDescription] = useState(d.description ?? '')
  const [discountType, setDiscountType] = useState(d.discount_type || 'percentage')
  const formRef = useRef<HTMLFormElement>(null)

  function setInput(name: string, value: string) {
    const el = formRef.current?.elements.namedItem(name) as HTMLInputElement | null
    if (el) { el.value = value }
  }

  function handleAIFill(values: Record<string, unknown>) {
    if (values.code) setInput('code', String(values.code).toUpperCase())
    if (values.discount_type) setDiscountType(String(values.discount_type))
    if (values.discount_value != null) setInput('discount_value', String(values.discount_value))
    if (values.max_discount_amount != null) setInput('max_discount_amount', String(values.max_discount_amount))
    if (values.min_purchase_amount != null) setInput('min_purchase_amount', String(values.min_purchase_amount))
    if (values.usage_limit != null) setInput('usage_limit', String(values.usage_limit))
    if (values.usage_limit_per_user != null) setInput('usage_limit_per_user', String(values.usage_limit_per_user))
    if (values.description) setCouponDescription(String(values.description))
    if (values.is_active != null) setIsActive(Boolean(values.is_active))
  }

  return (
    <form ref={formRef} action={action} className="space-y-5">
      {backUrl && <input type="hidden" name="_back" value={backUrl} />}
      <AIFillForm
        fields={[
          { name: 'code', label: 'Coupon Code', type: 'text' },
          { name: 'discount_type', label: 'Discount Type (percentage or fixed)', type: 'text' },
          { name: 'discount_value', label: 'Discount Value', type: 'number' },
          { name: 'max_discount_amount', label: 'Max Discount Amount (₹)', type: 'number' },
          { name: 'min_purchase_amount', label: 'Min Purchase Amount (₹)', type: 'number' },
          { name: 'usage_limit', label: 'Total Usage Limit', type: 'number' },
          { name: 'usage_limit_per_user', label: 'Per-User Limit', type: 'number' },
          { name: 'description', label: 'Description', type: 'textarea' },
          { name: 'is_active', label: 'Active', type: 'boolean' },
        ]}
        onFill={handleAIFill}
        context="Indian B2B/B2C hardware and tools store coupon"
      />
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
                value={discountType}
                onChange={setDiscountType}
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

      {showUserSelector && (
        <div className="bg-surface-elevated rounded-lg border border-border-default p-6 space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-foreground-secondary uppercase tracking-wide">Eligible Users</h2>
            <p className="text-xs text-foreground-muted mt-1">Optional — restrict this coupon to specific customers. Leave empty to allow all users.</p>
          </div>
          <CouponUserSelector name="eligible_user_ids" />
        </div>
      )}

      <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-border-default">
        <Link href={ap(backUrl ?? '/admin/coupons')} className="px-5 py-2 bg-surface border border-border-secondary hover:bg-surface-secondary text-foreground rounded-lg font-medium transition-colors text-sm">
          Cancel
        </Link>
        {isDraft ? (
          <>
            <button type="submit" name="intent" value="draft" className="px-5 py-2 bg-surface border border-border-secondary hover:bg-surface-secondary text-foreground rounded-lg font-semibold transition-colors text-sm">
              Save Draft
            </button>
            <button type="submit" name="intent" value="publish" className="px-6 py-2 bg-accent-500 hover:bg-accent-600 text-white rounded-lg font-semibold transition-colors text-sm">
              Publish
            </button>
          </>
        ) : (
          <button type="submit" className="px-6 py-2 bg-accent-500 hover:bg-accent-600 text-white rounded-lg font-semibold transition-colors text-sm">
            {submitLabel || 'Save Changes'}
          </button>
        )}
      </div>
    </form>
  )
}
