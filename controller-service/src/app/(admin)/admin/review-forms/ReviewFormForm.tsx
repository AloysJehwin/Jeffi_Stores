'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Star, MessageSquare, FileText, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import AdminSelect from '@/components/admin/AdminSelect'
import FormsPreview from './FormsPreview'
import Toggle from '@/components/ui/Toggle'
import AIFillForm from '@/components/admin/AIFillForm'
import AIEnrichButton from '@/components/admin/AIEnrichButton'
import AutosaveStatusPill from '@/components/admin/AutosaveStatusPill'
import { Badge, DraftLockBanner, FormFooter, LockedFieldset } from '@/components/admin/kit'
import { ap } from '@/lib/shared/admin-path'
import { formsHostForHost } from '@/lib/tenancy/forms-host'
import { RequireWrite } from '@/contexts/AdminScopesContext'
import { useToast } from '@/contexts/ToastContext'
import { useEditSession } from '@/hooks/useEditSession'
import type { AutosaveStatus } from '@/hooks/useAutosaveDraft'
import { fieldInputCls } from '@/components/admin/kit'
import { useDraftLock } from '@/hooks/useDraftLock'
import { lockHeaders, type DraftLockState } from '@/lib/client/draft-lock-client'
import type { MergeConflict } from '@/lib/admin/draft-merge'
import MergeDialog from '@/components/admin/drafts/MergeDialog'

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

type TemplateType = 'google_review' | 'product_feedback' | 'testimonial'

const TEMPLATES: { value: TemplateType; label: string; Icon: LucideIcon; description: string }[] = [
  {
    value: 'google_review',
    label: 'Google Review',
    Icon: Star,
    description: 'Send customers to Google, then collect their screenshot',
  },
  {
    value: 'product_feedback',
    label: 'Product Feedback',
    Icon: MessageSquare,
    description: 'Collect ratings and written feedback on a purchase',
  },
  {
    value: 'testimonial',
    label: 'Testimonial',
    Icon: FileText,
    description: 'Gather a written testimonial with optional photo',
  },
]

interface ReviewFormFormProps {
  submitLabel?: string
  isDraft?: boolean
  isCreateDraft?: boolean
  coupons: Coupon[]
  formId?: string
  backUrl?: string
  /** Server action to discard the draft (no args). */
  discardAction?: () => Promise<void>
  /** Server action to resnapshot the open session after an explicit Save as Draft. */
  resnapshotAction?: () => Promise<void>
  /** Draft lock state from the server (initialDraftLock), so a non-holder renders read-only. */
  initialLock?: DraftLockState | null
  /** The edit-draft being edited (its lock id); null for a create-draft, locked by the form id. */
  draftId?: string | null
  defaultValues?: {
    title?: string
    slug?: string
    template_type?: TemplateType
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

const inputClass = fieldInputCls
const labelClass = 'block text-xs font-medium text-foreground-secondary mb-1.5'

function randomId() {
  return Math.random().toString(36).slice(2, 10)
}

export default function ReviewFormForm({
  submitLabel,
  isDraft = false,
  isCreateDraft = false,
  coupons,
  formId,
  backUrl,
  discardAction,
  resnapshotAction,
  initialLock,
  draftId,
  defaultValues: d = {},
}: ReviewFormFormProps) {
  const router = useRouter()
  const [templateType, setTemplateType] = useState<TemplateType>(d.template_type || 'google_review')
  const [title, setTitle] = useState(d.title || '')
  const [slug, setSlug] = useState(d.slug || '')
  const [googleUrl, setGoogleUrl] = useState(d.google_review_url || '')
  const [couponId, setCouponId] = useState(d.coupon_id || '')
  const [description, setDescription] = useState(d.description || '')
  const [isActive, setIsActive] = useState(d.is_active !== false)
  const [customFields, setCustomFields] = useState<CustomField[]>(d.custom_fields || [])
  const [submitting, setSubmitting] = useState(false)
  const { showToast } = useToast()
  const lockKey = draftId ?? formId ?? null
  const lock = useDraftLock({ resourceType: 'review_form', resourceId: lockKey, initial: initialLock })
  const edit = useEditSession({ resourceType: 'review_form', resourceId: lockKey, lock })
  const [conflicts, setConflicts] = useState<MergeConflict[] | null>(null)
  const publishPath = `/api/admin/review-forms/${formId}/publish?draft=${draftId}`
  const listHref = backUrl && backUrl.startsWith('/admin/review-forms') ? backUrl : '/admin/review-forms'
  const [autoSaveStatus, setAutoSaveStatus] = useState<AutosaveStatus>('idle')
  const [formsHost, setFormsHost] = useState('forms.jeffistores.in')
  useEffect(() => {
    setFormsHost(formsHostForHost(window.location.host))
  }, [])
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isFirstRender = useRef(true)
  const autosaveBlockedRef = useRef(false)
  const autosaveInFlightRef = useRef(false)

  // Keep a ref to current values so the debounced callback always has fresh data
  const valuesRef = useRef({ title, slug, templateType, googleUrl, couponId, description, isActive, customFields })
  valuesRef.current = { title, slug, templateType, googleUrl, couponId, description, isActive, customFields }

  useEffect(() => {
    if (!isDraft || !formId) return
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)
    autoSaveTimer.current = setTimeout(async () => {
      if (autosaveBlockedRef.current) return
      const v = valuesRef.current
      setAutoSaveStatus('saving')
      autosaveInFlightRef.current = true
      try {
        const res = await fetch(`/api/admin/review-forms/${formId}/draft`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', ...lockHeaders('review_form', lockKey) },
          body: JSON.stringify({ draftId, fields: {
            title: v.title.trim(),
            slug: v.slug
              .toLowerCase()
              .trim()
              .replace(/[^a-z0-9-]/g, '-'),
            template_type: v.templateType,
            google_review_url: v.templateType === 'google_review' ? v.googleUrl.trim() : '',
            coupon_id: v.couponId || null,
            description: v.description.trim() || null,
            is_active: v.isActive,
            custom_fields: v.customFields,
          } }),
        })
        if (res.status === 423) {
          autosaveBlockedRef.current = true
          setAutoSaveStatus('locked')
          lock.markLocked(v)
          return
        }
        setAutoSaveStatus('saved')
        setTimeout(() => setAutoSaveStatus('idle'), 2000)
      } catch {
        setAutoSaveStatus('idle')
      } finally {
        autosaveInFlightRef.current = false
      }
    }, 1500)
    return () => {
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, slug, templateType, googleUrl, couponId, description, isActive, customFields])

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
    setCustomFields(prev => prev.map(f => (f.id === id ? { ...f, ...patch } : f)))
  }

  function removeField(id: string) {
    setCustomFields(prev => prev.filter(f => f.id !== id))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    try {
      const v = valuesRef.current
      const payload = {
        title: v.title.trim(),
        slug: v.slug
          .toLowerCase()
          .trim()
          .replace(/[^a-z0-9-]/g, '-'),
        template_type: v.templateType,
        google_review_url: v.templateType === 'google_review' ? v.googleUrl.trim() : '',
        coupon_id: v.couponId || null,
        description: v.description.trim() || null,
        is_active: v.isActive,
        custom_fields: v.customFields,
      }

      if (isCreateDraft && formId) {
        // Create-draft: edit the row in place. Save keeps is_draft = true; Publish flips
        // is_draft = false + is_active = true, moving it to the live list.
        const intent = (document.activeElement as HTMLButtonElement)?.value || 'draft'
        const publish = intent === 'publish'
        const res = await fetch(`/api/admin/review-forms/${formId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', ...lockHeaders('review_form', formId) },
          body: JSON.stringify({ ...payload, is_active: publish ? true : false, is_draft: publish ? false : true }),
        })
        if (!res.ok) {
          if (res.status === 423) lock.markLocked()
          const dd = await res.json()
          showToast(dd.error || 'Failed to save', 'error')
          return
        }
        if (!publish && resnapshotAction) await resnapshotAction()
        if (publish) {
          autosaveBlockedRef.current = true
          if (edit.sessionId) await edit.save()
        }
        router.push(backUrl && backUrl.startsWith('/admin/review-forms') ? backUrl : '/admin/review-forms')
        router.refresh()
        return
      }

      if (isDraft && formId && draftId) {
        // Determine intent from the clicked button
        const intent = (document.activeElement as HTMLButtonElement)?.value || 'draft'
        if (intent === 'publish') {
          // Save to draft then merge it into live
          await fetch(`/api/admin/review-forms/${formId}/draft`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', ...lockHeaders('review_form', lockKey) },
            body: JSON.stringify({ draftId, fields: payload }),
          })
          const res = await fetch(publishPath, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...lockHeaders('review_form', lockKey) },
            body: JSON.stringify({}),
          })
          if (!res.ok) {
            if (res.status === 423) lock.markLocked()
            const d = await res.json()
            // Someone published overlapping edits since this draft started: resolve them first.
            if (res.status === 409 && d.code === 'DRAFT_CONFLICT') {
              autosaveBlockedRef.current = true
              setConflicts(d.conflicts ?? [])
              return
            }
            showToast(d.error || 'Failed to publish', 'error')
            return
          }
          await afterPublish()
          return
        }
        // Save draft, resnapshot so Cancel reverts to this save, then return to the list.
        const res = await fetch(`/api/admin/review-forms/${formId}/draft`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', ...lockHeaders('review_form', lockKey) },
          body: JSON.stringify({ draftId, fields: payload }),
        })
        if (!res.ok) {
          if (res.status === 423) lock.markLocked()
          const d = await res.json()
          showToast(d.error || 'Failed to save draft', 'error')
          return
        }
        if (resnapshotAction) await resnapshotAction()
        router.push(backUrl && backUrl.startsWith('/admin/review-forms') ? backUrl : '/admin/review-forms')
        router.refresh()
        return
      }

      const url = formId ? `/api/admin/review-forms/${formId}` : '/api/admin/review-forms'
      const method = formId ? 'PATCH' : 'POST'

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', ...lockHeaders('review_form', formId) },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        if (res.status === 423) lock.markLocked()
        const data = await res.json()
        showToast(data.error || 'Failed to save form', 'error')
        return
      }

      // Create-as-draft: the new form is a draft (is_draft = true), so return to the list where
      // it appears in the Drafts section — not to the edit page.
      if (!formId) {
        router.push(ap('/admin/review-forms'))
        router.refresh()
        return
      }
      const destination = backUrl && backUrl.startsWith('/admin/review-forms') ? backUrl : '/admin/review-forms'
      router.push(ap(destination))
      router.refresh()
    } finally {
      setSubmitting(false)
    }
  }

  async function afterPublish() {
    autosaveBlockedRef.current = true
    if (edit.sessionId) await edit.save()
    router.push(listHref)
    router.refresh()
  }

  function handleAIFill(values: Record<string, unknown>) {
    if (values.title) setTitle(String(values.title))
    if (values.slug)
      setSlug(
        String(values.slug)
          .toLowerCase()
          .replace(/[^a-z0-9-]/g, '-')
      )
    if (
      values.template_type &&
      ['google_review', 'product_feedback', 'testimonial'].includes(String(values.template_type))
    ) {
      setTemplateType(values.template_type as TemplateType)
    }
    if (values.google_review_url) setGoogleUrl(String(values.google_review_url))
    if (values.description) setDescription(String(values.description))
    if (values.is_active != null) setIsActive(Boolean(values.is_active))
  }

  async function handleDiscard() {
    if (!discardAction) return
    autosaveBlockedRef.current = true
    for (let i = 0; i < 100 && autosaveInFlightRef.current; i++) await new Promise(r => setTimeout(r, 100))
    await discardAction()
    if (edit.sessionId) await edit.save()
    const destination = backUrl && backUrl.startsWith('/admin/review-forms') ? backUrl : '/admin/review-forms'
    router.push(ap(destination))
    router.refresh()
  }

  async function handleCancel() {
    autosaveBlockedRef.current = true
    for (let i = 0; i < 100 && autosaveInFlightRef.current; i++) await new Promise(r => setTimeout(r, 100))
    const ok = await edit.cancel()
    if (!ok) {
      autosaveBlockedRef.current = false
      return
    }
    const dest = formId
      ? `/admin/review-forms/${formId}/view${backUrl ? `?back=${encodeURIComponent(backUrl)}` : ''}`
      : '/admin/review-forms'
    router.push(ap(dest))
    router.refresh()
  }

  return (
    <>
    <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
      {lock.loaded && (
        <div className="lg:col-span-2">
          <DraftLockBanner lock={lock} scope="review_forms:write" />
        </div>
      )}
      <LockedFieldset readOnly={lock.readOnly} className="contents">
        <div className="lg:col-span-2">
          <AIFillForm
            fields={[
              { name: 'title', label: 'Form Title', type: 'text' },
              { name: 'slug', label: 'URL Slug', type: 'text' },
              {
                name: 'template_type',
                label: 'Template (google_review, product_feedback, or testimonial)',
                type: 'text',
              },
              { name: 'google_review_url', label: 'Google Review URL', type: 'text' },
              { name: 'description', label: 'Description', type: 'textarea' },
              { name: 'is_active', label: 'Active', type: 'boolean' },
            ]}
            onFill={handleAIFill}
            scope="review_forms:write"
            context="Customer review form for this store"
          />
        </div>
        <div className="space-y-5">
          <div>
            <label className={labelClass}>Template *</label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {TEMPLATES.map(t => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setTemplateType(t.value)}
                  className={`flex flex-col gap-1.5 p-3 rounded-xl border-2 text-left transition-colors ${
                    templateType === t.value
                      ? 'border-accent-500 bg-accent-500/5'
                      : 'border-border-default hover:border-accent-500/50'
                  }`}
                >
                  <span className="text-xl">
                    <t.Icon className="w-5 h-5" />
                  </span>
                  <span
                    className={`text-sm font-semibold ${templateType === t.value ? 'text-accent-500' : 'text-foreground'}`}
                  >
                    {t.label}
                  </span>
                  <span className="text-xs text-foreground-muted leading-snug">{t.description}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className={labelClass}>Form Title *</label>
            <AIEnrichButton
              fieldLabel="Review form title"
              value={title}
              onChange={setTitle}
              scope="review_forms:write"
              maxLength={255}
              write
              context={`Heading of a public ${TEMPLATES.find(t => t.value === templateType)?.label ?? 'review'} form customers fill in.`}
            >
              <input
                value={title}
                onChange={e => setTitle(e.target.value)}
                required
                className={`${inputClass} pr-8`}
                placeholder="e.g. Leave Us a Google Review"
              />
            </AIEnrichButton>
          </div>

          <div>
            <label className={labelClass}>
              Slug *{' '}
              <span className="text-foreground-muted font-normal">
                — {formsHost}/<strong>{slug || 'this-slug'}</strong>
              </span>
            </label>
            <input
              value={slug}
              onChange={e => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
              required
              className={`${inputClass} font-mono`}
              placeholder="e.g. google-review"
            />
          </div>

          {templateType === 'google_review' && (
            <div>
              <label className={labelClass}>Google Review URL *</label>
              <input
                value={googleUrl}
                onChange={e => setGoogleUrl(e.target.value)}
                type="url"
                required
                className={inputClass}
                placeholder="https://g.page/r/..."
              />
              <p className="mt-1 text-xs text-foreground-muted">
                Customers are sent here first before submitting their screenshot
              </p>
            </div>
          )}

          <AdminSelect label="Reward Coupon" options={couponOptions} value={couponId} onChange={setCouponId} />
          {coupons.length === 0 && (
            <p className="text-xs text-amber-600">
              No active coupons found.{' '}
              <Link href={ap('/admin/coupons/add')} className="underline">
                Create one first.
              </Link>
            </p>
          )}

          <div>
            <label className={labelClass}>Description</label>
            <AIEnrichButton
              fieldLabel="Review form description"
              value={description}
              onChange={setDescription}
              scope="review_forms:write"
              multiline
              write
              context={`Intro shown under the title "${title}" on a public ${TEMPLATES.find(t => t.value === templateType)?.label ?? 'review'} form; one or two sentences.`}
            >
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                rows={2}
                className={`${inputClass} pr-8`}
                placeholder="Optional — shown to customer on the form page"
              />
            </AIEnrichButton>
          </div>

          <div className="flex items-center gap-2">
            <Toggle id="is_active" checked={isActive} onChange={setIsActive} label="Active (form accepts submissions)" />
          </div>

          <div>
            <div className="flex items-center justify-between mb-3">
              <p className={labelClass.replace(' mb-1.5', '')}>Custom Fields</p>
              <button
                type="button"
                onClick={addField}
                className="text-xs text-accent-500 hover:text-accent-600 font-medium"
              >
                + Add Field
              </button>
            </div>

            {customFields.length === 0 && (
              <p className="text-xs text-foreground-muted py-3 text-center border border-dashed border-border-default rounded-lg">
                No custom fields yet — click &quot;Add Field&quot; to add one
              </p>
            )}

            <div className="space-y-3">
              {customFields.map((field, idx) => (
                <div
                  key={field.id}
                  className="flex items-start gap-3 p-3 bg-surface-secondary rounded-lg border border-border-default"
                >
                  <span className="text-xs text-foreground-muted mt-2 shrink-0 w-4">{idx + 1}.</span>
                  <div className="flex-1 flex flex-col sm:flex-row gap-2">
                    <input
                      value={field.label}
                      onChange={e => updateField(field.id, { label: e.target.value })}
                      placeholder="Field label"
                      className={`${fieldInputCls} flex-1 basis-0 min-w-0`}
                    />
                    <AdminSelect
                      sm
                      className="flex-1 basis-0 min-w-0"
                      value={field.type}
                      onChange={v => updateField(field.id, { type: v as CustomField['type'] })}
                      options={FIELD_TYPES}
                    />
                  </div>
                  <div className="flex items-center gap-2 mt-1.5 shrink-0">
                    <Toggle
                      checked={field.required}
                      onChange={v => updateField(field.id, { required: v })}
                      label="Req"
                      size="sm"
                    />
                    <button
                      type="button"
                      onClick={() => removeField(field.id)}
                      className="control-sm control-icon text-red-500 hover:bg-red-500/10"
                      aria-label="Remove field"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="sticky top-6">
          <p className="text-xs font-medium text-foreground-muted uppercase tracking-wide mb-2">Live Preview</p>
          <FormsPreview
            title={title}
            description={description}
            templateType={templateType}
            googleReviewUrl={googleUrl}
            couponId={couponId}
            customFields={customFields}
          />
        </div>
      </LockedFieldset>

      {/* Shared editor bottom bar. See docs/plans/EDITOR_SESSION_SEMANTICS.md. */}
      <div className="lg:col-span-2">
        <FormFooter
          sticky
          lock={lock}
          autosave={isDraft && autoSaveStatus !== 'idle' ? <AutosaveStatusPill status={autoSaveStatus} /> : null}
          draftBadge={isDraft || isCreateDraft ? <Badge tone="amber">Draft pending</Badge> : null}
          discard={isDraft && discardAction ? handleDiscard : undefined}
          cancel={edit.sessionId ? handleCancel : undefined}
          cancelHref={
            edit.sessionId
              ? undefined
              : ap(backUrl && backUrl.startsWith('/admin/review-forms') ? backUrl : '/admin/review-forms')
          }
        >
          <RequireWrite scope="review_forms:write">
            {isDraft || isCreateDraft ? (
              <>
                <button
                  type="submit"
                  value="draft"
                  disabled={submitting}
                  className="control-md border border-border-secondary bg-surface font-semibold text-foreground hover:bg-surface-secondary disabled:opacity-50"
                >
                  {submitting ? 'Saving…' : 'Save as Draft'}
                </button>
                <button
                  type="submit"
                  value="publish"
                  disabled={submitting}
                  className="control-md bg-accent-500 font-semibold text-white hover:bg-accent-600 disabled:opacity-50"
                >
                  {submitting ? 'Publishing…' : 'Update & Publish'}
                </button>
              </>
            ) : (
              <button
                type="submit"
                disabled={submitting}
                className="control-md bg-accent-500 font-semibold text-white hover:bg-accent-600 disabled:opacity-50"
              >
                {submitting ? 'Saving…' : submitLabel || 'Save Changes'}
              </button>
            )}
          </RequireWrite>
        </FormFooter>
      </div>
    </form>
    {conflicts && (
      <MergeDialog
        open
        conflicts={conflicts}
        publishPath={publishPath}
        onClose={() => {
          setConflicts(null)
          autosaveBlockedRef.current = false
        }}
        onDone={() => {
          setConflicts(null)
          void afterPublish()
        }}
      />
    )}
    </>
  )
}
