'use client'

import { useRouter } from 'next/navigation'
import { useState, useRef } from 'react'
import { ap } from '@/lib/shared/admin-path'
import AdminSelect from '@/components/admin/AdminSelect'
import Toggle from '@/components/ui/Toggle'
import DateTimePicker from '@/components/ui/DateTimePicker'
import AIEnrichButton from '@/components/admin/AIEnrichButton'
import AIFillForm from '@/components/admin/AIFillForm'
import CouponUserSelector from '@/components/admin/CouponUserSelector'
import { useEditSession } from '@/hooks/useEditSession'
import { Badge, FormButton, FormField, FormFooter, FormSection, fieldInputCls } from '@/components/admin/kit'
import { RequireWrite } from '@/contexts/AdminScopesContext'

interface CouponFormProps {
  action: (formData: FormData) => Promise<void>
  submitLabel?: string
  isDraft?: boolean
  showUserSelector?: boolean
  backUrl?: string
  couponId?: string
  /** Server action to discard the draft (receives FormData with intent=discard). */
  discardAction?: (formData: FormData) => Promise<void>
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

const inputClass = fieldInputCls

export default function CouponForm({
  action,
  submitLabel,
  isDraft = false,
  showUserSelector = false,
  backUrl,
  couponId,
  discardAction,
  defaultValues: d = {},
}: CouponFormProps) {
  const router = useRouter()
  const [isActive, setIsActive] = useState<boolean>(d.is_active !== false)
  const [validFrom, setValidFrom] = useState(d.valid_from ?? '')
  const [validUntil, setValidUntil] = useState(d.valid_until ?? '')
  const [couponDescription, setCouponDescription] = useState(d.description ?? '')
  const [discountType, setDiscountType] = useState(d.discount_type || 'percentage')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)
  const edit = useEditSession({ resourceType: 'coupon', resourceId: couponId ?? null })

  function setInput(name: string, value: string) {
    const el = formRef.current?.elements.namedItem(name) as HTMLInputElement | null
    if (el) {
      el.value = value
    }
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

  const listHref = ap(backUrl ?? '/admin/coupons')
  const viewHref = couponId ? ap(`/admin/coupons/${couponId}/view`) : listHref

  // Discard: fire the server action with intent=discard; the action redirects to view.
  async function handleDiscard() {
    if (!discardAction) return
    setIsSubmitting(true)
    try {
      const fd = new FormData()
      fd.set('intent', 'discard')
      if (backUrl) fd.set('_back', backUrl)
      await discardAction(fd)
    } catch (err: any) {
      if (err?.digest?.startsWith('NEXT_REDIRECT')) throw err
      setIsSubmitting(false)
    }
  }

  // Cancel: roll the draft back to the session snapshot, then return to the view page.
  async function handleCancel() {
    const ok = await edit.cancel()
    if (ok) router.push(viewHref)
  }

  return (
    <form ref={formRef} action={action} className="space-y-4">
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
        scope="coupons:write"
        context="Discount coupon for this store"
      />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <FormSection title="Code & Discount">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <FormField label="Coupon Code" required>
                <input
                  name="code"
                  required
                  defaultValue={d.code}
                  className={inputClass}
                  placeholder="e.g. REVIEW10"
                  style={{ textTransform: 'uppercase' }}
                />
              </FormField>
              <AdminSelect
                name="discount_type"
                label="Discount Type *"
                options={DISCOUNT_TYPE_OPTIONS}
                value={discountType}
                onChange={setDiscountType}
                required
              />
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <FormField label="Discount Value" required>
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
              </FormField>
              <FormField label="Max Discount (₹)">
                <input
                  name="max_discount_amount"
                  type="number"
                  step="0.01"
                  min="0"
                  defaultValue={d.max_discount_amount ?? ''}
                  className={inputClass}
                  placeholder="Optional cap"
                />
              </FormField>
            </div>
          </FormSection>

          <FormSection title="Limits">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <FormField label="Min Purchase (₹)">
                <input
                  name="min_purchase_amount"
                  type="number"
                  step="0.01"
                  min="0"
                  defaultValue={d.min_purchase_amount ?? ''}
                  className={inputClass}
                  placeholder="Optional"
                />
              </FormField>
              <FormField label="Total Usage Limit">
                <input
                  name="usage_limit"
                  type="number"
                  min="1"
                  defaultValue={d.usage_limit ?? ''}
                  className={inputClass}
                  placeholder="Unlimited"
                />
              </FormField>
              <FormField label="Per-User Limit">
                <input
                  name="usage_limit_per_user"
                  type="number"
                  min="1"
                  defaultValue={d.usage_limit_per_user ?? ''}
                  className={inputClass}
                  placeholder="Unlimited"
                />
              </FormField>
            </div>
          </FormSection>

          <FormSection title="Description">
            <AIEnrichButton
              fieldLabel="Coupon Description"
              value={couponDescription}
              onChange={setCouponDescription}
              scope="coupons:write"
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
          </FormSection>
        </div>

        <aside className="space-y-4">
          <FormSection title="Status">
            <input type="hidden" name="is_active" value={isActive ? 'true' : 'false'} />
            <Toggle id="is_active" checked={isActive} onChange={setIsActive} label="Active" />
            <p className="text-xs text-foreground-muted mt-2">
              {isActive ? 'Customers can apply this coupon at checkout.' : 'Coupon is paused — cannot be redeemed.'}
            </p>
          </FormSection>

          <FormSection title="Validity">
            <FormField label="Valid From">
              <DateTimePicker name="valid_from" value={validFrom} onChange={setValidFrom} className="w-full" />
            </FormField>
            <FormField label="Valid Until">
              <DateTimePicker name="valid_until" value={validUntil} onChange={setValidUntil} className="w-full" />
            </FormField>
            <p className="text-xs text-foreground-muted">Leave blank for no time limit.</p>
          </FormSection>
        </aside>
      </div>

      {showUserSelector && (
        <FormSection
          title="Eligible Users"
          description="Optional — restrict this coupon to specific customers. Leave empty to allow all users."
        >
          <CouponUserSelector name="eligible_user_ids" />
        </FormSection>
      )}

      {/* Shared editor bottom bar — see docs/plans/EDITOR_SESSION_SEMANTICS.md.
          No top chrome: cancel, discard, save-as-draft, publish all live here. */}
      <FormFooter
        sticky
        draftBadge={isDraft ? <Badge tone="amber">Draft pending</Badge> : null}
        discard={isDraft && discardAction ? handleDiscard : undefined}
        cancel={edit.sessionId ? handleCancel : undefined}
        cancelHref={edit.sessionId ? undefined : listHref}
      >
        {isDraft ? (
          <RequireWrite scope="coupons:write">
            <FormButton
              variant="secondary"
              name="intent"
              value="draft"
              formNoValidate
              disabled={isSubmitting}
              onClick={() => setIsSubmitting(true)}
            >
              {isSubmitting ? 'Saving...' : 'Save as Draft'}
            </FormButton>
            <FormButton
              name="intent"
              value="publish"
              disabled={isSubmitting}
              onClick={() => setIsSubmitting(true)}
            >
              {isSubmitting ? 'Saving...' : 'Update & Publish'}
            </FormButton>
          </RequireWrite>
        ) : (
          <RequireWrite scope="coupons:write">
            <FormButton disabled={isSubmitting} onClick={() => setIsSubmitting(true)}>
              {isSubmitting ? 'Saving...' : submitLabel || 'Save Changes'}
            </FormButton>
          </RequireWrite>
        )}
      </FormFooter>
    </form>
  )
}
