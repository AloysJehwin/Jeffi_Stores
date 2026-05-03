'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import AdminSelect from '@/components/admin/AdminSelect'

const TEMPLATES = [
  { value: 'review_form_share', label: 'Review Form Share', description: 'Send customers a link to your review incentive form with a coupon reward' },
  { value: 'promotion', label: 'Promotion', description: 'Announce a sale, discount, or special offer' },
  { value: 'event', label: 'Event', description: 'Invite customers to an in-store or online event' },
  { value: 'announcement', label: 'Announcement', description: 'General store news or update' },
  { value: 'custom', label: 'Custom HTML', description: 'Write your own subject and HTML body' },
]

const AUDIENCE_OPTIONS = [
  { value: 'all', label: 'All customers' },
  { value: 'order_history', label: 'By recent order history' },
]

const inputClass = 'w-full px-4 py-2 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-transparent text-sm'
const labelClass = 'block text-sm font-medium text-foreground-secondary mb-1.5'
const textareaClass = `${inputClass} resize-none`

type TemplateData = Record<string, string>

interface ReviewFormOption {
  id: string
  title: string
  slug: string
  coupon_code: string | null
}

interface Recipient {
  email: string
  first_name: string | null
}

export default function NewCampaignPage() {
  const router = useRouter()
  const [step, setStep] = useState(1)
  const [templateKey, setTemplateKey] = useState('review_form_share')
  const [templateData, setTemplateData] = useState<TemplateData>({})
  const [subject, setSubject] = useState('')
  const [title, setTitle] = useState('')
  const [audienceType, setAudienceType] = useState('all')
  const [daysSinceOrder, setDaysSinceOrder] = useState('30')
  const [scheduledAt, setScheduledAt] = useState('')
  const [previewHtml, setPreviewHtml] = useState('')
  const [previewLoading, setPreviewLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [reviewForms, setReviewForms] = useState<ReviewFormOption[]>([])
  const [audienceRecipients, setAudienceRecipients] = useState<Recipient[]>([])
  const [audienceCount, setAudienceCount] = useState<number | null>(null)
  const [audienceLoading, setAudienceLoading] = useState(false)
  const previewDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const audienceDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    fetch('/api/admin/review-forms?page=1')
      .then(r => r.json())
      .then(data => setReviewForms(data.forms || []))
      .catch(() => {})
  }, [])

  const loadPreview = useCallback(async () => {
    setPreviewLoading(true)
    try {
      const res = await fetch('/api/admin/mailer/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template_key: templateKey, template_data: templateData, subject }),
      })
      const data = await res.json()
      setPreviewHtml(data.html || '')
    } finally {
      setPreviewLoading(false)
    }
  }, [templateKey, templateData, subject])

  useEffect(() => {
    if (step !== 2) return
    if (previewDebounceRef.current) clearTimeout(previewDebounceRef.current)
    previewDebounceRef.current = setTimeout(loadPreview, 600)
    return () => { if (previewDebounceRef.current) clearTimeout(previewDebounceRef.current) }
  }, [step, templateKey, templateData, subject, loadPreview])

  const loadAudience = useCallback(async () => {
    setAudienceLoading(true)
    try {
      const audienceFilter = audienceType === 'order_history'
        ? { daysSinceOrder: parseInt(daysSinceOrder, 10) }
        : {}
      const res = await fetch('/api/admin/mailer/audience-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audience_type: audienceType, audience_filter: audienceFilter }),
      })
      const data = await res.json()
      setAudienceRecipients(data.recipients || [])
      setAudienceCount(data.count ?? 0)
    } finally {
      setAudienceLoading(false)
    }
  }, [audienceType, daysSinceOrder])

  useEffect(() => {
    if (step !== 3) return
    if (audienceDebounceRef.current) clearTimeout(audienceDebounceRef.current)
    audienceDebounceRef.current = setTimeout(loadAudience, 400)
    return () => { if (audienceDebounceRef.current) clearTimeout(audienceDebounceRef.current) }
  }, [step, audienceType, daysSinceOrder, loadAudience])

  function setField(key: string, value: string) {
    setTemplateData(prev => ({ ...prev, [key]: value }))
  }

  async function handleSubmit(sendNow: boolean) {
    setSubmitting(true)
    setError('')
    try {
      const audienceFilter = audienceType === 'order_history'
        ? { daysSinceOrder: parseInt(daysSinceOrder, 10) }
        : {}

      const createRes = await fetch('/api/admin/mailer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title || subject,
          template_key: templateKey,
          subject,
          template_data: templateData,
          audience_type: audienceType,
          audience_filter: audienceFilter,
        }),
      })
      if (!createRes.ok) throw new Error((await createRes.json()).error || 'Failed to create campaign')
      const { id } = await createRes.json()

      if (scheduledAt) {
        await fetch(`/api/admin/mailer/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scheduled_at: scheduledAt }),
        })
      }

      if (sendNow) {
        await fetch(`/api/admin/mailer/${id}/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dispatchNow: true }),
        })
      } else if (scheduledAt) {
        await fetch(`/api/admin/mailer/${id}/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dispatchNow: false }),
        })
      }

      router.push('/admin/mailer')
    } catch (err) {
      setError(String(err))
      setSubmitting(false)
    }
  }

  return (
    <div className="p-4 sm:p-6">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/admin/mailer" className="text-foreground-muted hover:text-foreground transition-colors">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7"/></svg>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-secondary-500 dark:text-foreground">New Campaign</h1>
          <p className="text-sm text-foreground-secondary mt-0.5">Step {step} of 3</p>
        </div>
      </div>

      <div className="flex gap-1 mb-6 max-w-3xl">
        {[1, 2, 3].map(s => (
          <div key={s} className={`h-1.5 flex-1 rounded-full transition-colors ${s <= step ? 'bg-accent-500' : 'bg-border-default'}`} />
        ))}
      </div>

      {step === 1 && (
        <div className="max-w-3xl space-y-5">
          <div>
            <p className={labelClass}>Template</p>
            <div className="grid gap-3">
              {TEMPLATES.map(t => (
                <label key={t.value} className={`flex items-start gap-3 p-4 rounded-lg border cursor-pointer transition-colors ${templateKey === t.value ? 'border-accent-500 bg-accent-50 dark:bg-accent-900/20' : 'border-border-default hover:border-border-secondary bg-surface-elevated'}`}>
                  <input type="radio" name="template" value={t.value} checked={templateKey === t.value} onChange={() => { setTemplateKey(t.value); setTemplateData({}) }} className="mt-0.5 text-accent-500" />
                  <div>
                    <p className="font-medium text-sm text-foreground">{t.label}</p>
                    <p className="text-xs text-foreground-muted mt-0.5">{t.description}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>
          <button type="button" onClick={() => setStep(2)} className="px-6 py-2.5 bg-accent-500 hover:bg-accent-600 text-white rounded-lg font-semibold text-sm transition-colors">
            Continue
          </button>
        </div>
      )}

      {step === 2 && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 xl:gap-8 items-start">
          {/* Left: form fields */}
          <div className="space-y-5">
            <div>
              <label className={labelClass}>Campaign Title (internal)</label>
              <input value={title} onChange={e => setTitle(e.target.value)} className={inputClass} placeholder="e.g. May Google Review Push" />
            </div>
            <div>
              <label className={labelClass}>Email Subject *</label>
              <input value={subject} onChange={e => setSubject(e.target.value)} className={inputClass} placeholder="Subject line customers will see" required />
            </div>

            {templateKey === 'review_form_share' && (
              <>
                <AdminSelect
                  label="Review Form *"
                  placeholder={reviewForms.length === 0 ? 'No active forms found' : 'Select a form…'}
                  options={reviewForms.map(f => ({
                    value: f.id,
                    label: f.title,
                    group: undefined,
                  }))}
                  value={templateData.formId || ''}
                  onChange={formId => {
                    const chosen = reviewForms.find(f => f.id === formId)
                    if (!chosen) return
                    setTemplateData(prev => ({
                      ...prev,
                      formId: chosen.id,
                      formTitle: chosen.title,
                      formUrl: `https://forms.jeffistores.in/${chosen.slug}`,
                    }))
                  }}
                  disabled={reviewForms.length === 0}
                />
                {templateData.formUrl && (
                  <div className="flex items-center gap-2 px-3 py-2 bg-surface-secondary rounded-lg border border-border-default text-xs text-foreground-muted font-mono">
                    <span className="truncate">{templateData.formUrl}</span>
                  </div>
                )}
                {reviewForms.length === 0 && (
                  <p className="text-xs text-amber-600">
                    No review forms found. <Link href="/admin/review-forms/add" className="underline">Create one first.</Link>
                  </p>
                )}
              </>
            )}

            {(templateKey === 'promotion' || templateKey === 'announcement') && (
              <>
                <div><label className={labelClass}>Headline *</label><input value={templateData.headline || ''} onChange={e => setField('headline', e.target.value)} className={inputClass} placeholder="e.g. 20% Off Storewide This Weekend!" /></div>
                <div><label className={labelClass}>Body *</label><textarea value={templateData.body || ''} onChange={e => setField('body', e.target.value)} rows={4} className={textareaClass} placeholder="Email body text..." /></div>
                {templateKey === 'promotion' && (
                  <>
                    <div><label className={labelClass}>CTA Button Text</label><input value={templateData.ctaText || ''} onChange={e => setField('ctaText', e.target.value)} className={inputClass} placeholder="Shop Now" /></div>
                    <div><label className={labelClass}>CTA URL</label><input value={templateData.ctaUrl || ''} onChange={e => setField('ctaUrl', e.target.value)} className={inputClass} placeholder="https://jeffistores.in/products" /></div>
                  </>
                )}
              </>
            )}

            {templateKey === 'event' && (
              <>
                <div><label className={labelClass}>Event Name *</label><input value={templateData.eventName || ''} onChange={e => setField('eventName', e.target.value)} className={inputClass} placeholder="e.g. Grand Sale Weekend" /></div>
                <div><label className={labelClass}>Event Date</label><input value={templateData.eventDate || ''} onChange={e => setField('eventDate', e.target.value)} className={inputClass} placeholder="e.g. Saturday, 10 May 2025, 10am–8pm" /></div>
                <div><label className={labelClass}>Event Details *</label><textarea value={templateData.eventDetails || ''} onChange={e => setField('eventDetails', e.target.value)} rows={4} className={textareaClass} placeholder="Tell customers what to expect..." /></div>
                <div><label className={labelClass}>CTA URL</label><input value={templateData.ctaUrl || ''} onChange={e => setField('ctaUrl', e.target.value)} className={inputClass} placeholder="https://jeffistores.in" /></div>
              </>
            )}

            {templateKey === 'custom' && (
              <div><label className={labelClass}>HTML Body *</label><textarea value={templateData.htmlBody || ''} onChange={e => setField('htmlBody', e.target.value)} rows={10} className={`${textareaClass} font-mono text-xs`} placeholder="<!DOCTYPE html>..." /></div>
            )}

            <div className="flex gap-3 pt-2">
              <button type="button" onClick={() => setStep(1)} className="px-5 py-2 bg-surface-secondary hover:bg-border-default text-foreground-secondary rounded-lg font-medium transition-colors text-sm">Back</button>
              <button type="button" onClick={() => setStep(3)} disabled={!subject} className="px-6 py-2.5 bg-accent-500 hover:bg-accent-600 text-white rounded-lg font-semibold text-sm transition-colors disabled:opacity-50">Continue</button>
            </div>
          </div>

          {/* Right: live email preview */}
          <div className="sticky top-6">
            <p className="text-xs font-medium text-foreground-muted uppercase tracking-wide mb-2">Email Preview</p>
            <div className="border border-border-default rounded-lg overflow-hidden bg-surface-elevated" style={{ minHeight: '520px' }}>
              {previewLoading && (
                <div className="flex items-center justify-center h-[520px] text-foreground-muted text-sm">
                  <div className="flex items-center gap-2">
                    <div className="animate-spin w-4 h-4 border-2 border-accent-500 border-t-transparent rounded-full" />
                    Rendering…
                  </div>
                </div>
              )}
              {!previewLoading && previewHtml && (
                <iframe srcDoc={previewHtml} className="w-full h-[600px] bg-white" title="Email preview" />
              )}
              {!previewLoading && !previewHtml && (
                <div className="flex items-center justify-center h-[520px] text-foreground-muted text-sm text-center px-6">
                  Fill in the fields on the left to see a live preview
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 xl:gap-8 items-start">
          {/* Left: audience + schedule */}
          <div className="space-y-5">
            <AdminSelect
              label="Audience"
              options={AUDIENCE_OPTIONS}
              value={audienceType}
              onChange={setAudienceType}
            />

            {audienceType === 'order_history' && (
              <div>
                <label className={labelClass}>Ordered within the last N days</label>
                <input type="number" min="1" max="365" value={daysSinceOrder} onChange={e => setDaysSinceOrder(e.target.value)} className={inputClass} style={{ maxWidth: '140px' }} />
              </div>
            )}

            <div>
              <label className={labelClass}>Schedule (optional — leave blank to send now or save as draft)</label>
              <input type="datetime-local" value={scheduledAt} onChange={e => setScheduledAt(e.target.value)} className={inputClass} />
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <div className="flex flex-wrap gap-3 pt-2">
              <button type="button" onClick={() => setStep(2)} className="px-5 py-2 bg-surface-secondary hover:bg-border-default text-foreground-secondary rounded-lg font-medium transition-colors text-sm">Back</button>
              <button type="button" onClick={() => handleSubmit(false)} disabled={submitting} className="px-5 py-2 bg-surface-secondary hover:bg-border-default text-foreground-secondary rounded-lg font-medium transition-colors text-sm disabled:opacity-50">
                {scheduledAt ? 'Schedule' : 'Save as Draft'}
              </button>
              <button type="button" onClick={() => handleSubmit(true)} disabled={submitting} className="px-6 py-2.5 bg-accent-500 hover:bg-accent-600 text-white rounded-lg font-semibold text-sm transition-colors disabled:opacity-50">
                {submitting ? 'Sending…' : 'Send Now'}
              </button>
            </div>
          </div>

          {/* Right: recipient preview */}
          <div className="sticky top-6">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium text-foreground-muted uppercase tracking-wide">Recipients</p>
              {audienceCount !== null && !audienceLoading && (
                <span className="text-xs font-semibold text-accent-500">{audienceCount.toLocaleString()} customer{audienceCount !== 1 ? 's' : ''}</span>
              )}
            </div>
            <div className="border border-border-default rounded-lg overflow-hidden bg-surface-elevated" style={{ minHeight: '400px' }}>
              {audienceLoading && (
                <div className="flex items-center justify-center h-[400px] text-foreground-muted text-sm">
                  <div className="flex items-center gap-2">
                    <div className="animate-spin w-4 h-4 border-2 border-accent-500 border-t-transparent rounded-full" />
                    Loading…
                  </div>
                </div>
              )}
              {!audienceLoading && audienceRecipients.length === 0 && audienceCount !== null && (
                <div className="flex items-center justify-center h-[400px] text-foreground-muted text-sm">
                  No customers match this filter
                </div>
              )}
              {!audienceLoading && audienceRecipients.length > 0 && (
                <div className="overflow-y-auto" style={{ maxHeight: '520px' }}>
                  <div className="divide-y divide-border-default">
                    {audienceRecipients.map((r, i) => (
                      <div key={i} className="flex items-center gap-3 px-4 py-2.5">
                        <div className="w-7 h-7 rounded-full bg-accent-100 dark:bg-accent-900/30 flex items-center justify-center shrink-0">
                          <span className="text-xs font-semibold text-accent-600 dark:text-accent-400">
                            {(r.first_name?.[0] || r.email[0]).toUpperCase()}
                          </span>
                        </div>
                        <div className="min-w-0">
                          {r.first_name && <p className="text-sm font-medium text-foreground truncate">{r.first_name}</p>}
                          <p className="text-xs text-foreground-muted truncate">{r.email}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
