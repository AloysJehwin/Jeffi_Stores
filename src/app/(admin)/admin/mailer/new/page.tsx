'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import AdminSelect from '@/components/admin/AdminSelect'
import DateTimePicker from '@/components/ui/DateTimePicker'
import AIEnrichButton from '@/components/admin/AIEnrichButton'
import RichTextEditor from '@/components/admin/RichTextEditor'
import { ap } from '@/lib/shared/admin-path'
import { formsHostForHost } from '@/lib/tenancy/forms-host'
import { RequireWrite, useCanUseAi } from '@/contexts/AdminScopesContext'
import MobileEditBlock from '@/components/admin/MobileEditBlock'

const TEMPLATES = [
  {
    value: 'review_form_share',
    label: 'Review Form Share',
    description: 'Send customers a link to your review incentive form with a coupon reward',
  },
  { value: 'promotion', label: 'Promotion', description: 'Announce a sale, discount, or special offer' },
  { value: 'event', label: 'Event', description: 'Invite customers to an in-store or online event' },
  { value: 'announcement', label: 'Announcement', description: 'General store news or update' },
  { value: 'custom', label: 'Custom HTML', description: 'Write your own subject and HTML body' },
]

const AUDIENCE_OPTIONS = [
  { value: 'all', label: 'All customers' },
  { value: 'order_history', label: 'By recent order history' },
]

const inputClass =
  'w-full px-4 py-2 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-transparent text-sm'
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

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

const DRAFT_STORAGE_KEY = 'mailer_draft_id'

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
  const autoSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [scenarioPrompt, setScenarioPrompt] = useState('')
  const [scenarioLoading, setScenarioLoading] = useState(false)
  const [scenarioError, setScenarioError] = useState<string | null>(null)
  const canUseAi = useCanUseAi('mailer:write')

  // Draft state
  const [draftId, setDraftId] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [showRestoreBanner, setShowRestoreBanner] = useState(false)
  const draftIdRef = useRef<string | null>(null)

  // Step 1 AI assist — unused (AI assist is on step 2 only)

  useEffect(() => {
    fetch('/api/admin/review-forms?page=1')
      .then(r => r.json())
      .then(data => setReviewForms(data.forms || []))
      .catch(() => {})

    // Check for existing draft in localStorage
    const saved = localStorage.getItem(DRAFT_STORAGE_KEY)
    if (saved) setShowRestoreBanner(true)
  }, [])

  // Keep ref in sync
  useEffect(() => {
    draftIdRef.current = draftId
  }, [draftId])

  // Auto-save on step 2 changes (debounced 1.5s)
  const triggerAutoSave = useCallback(() => {
    if (step !== 2) return
    if (autoSaveRef.current) clearTimeout(autoSaveRef.current)
    setSaveState('saving')
    autoSaveRef.current = setTimeout(async () => {
      try {
        const res = await fetch('/api/admin/mailer/draft', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            draft_id: draftIdRef.current,
            template_key: templateKey,
            title: title || subject || 'Draft',
            subject,
            template_data: templateData,
          }),
        })
        if (!res.ok) throw new Error()
        const data = await res.json()
        if (!draftIdRef.current) {
          setDraftId(data.id)
          localStorage.setItem(DRAFT_STORAGE_KEY, data.id)
        }
        setSaveState('saved')
        setTimeout(() => setSaveState('idle'), 2500)
      } catch {
        setSaveState('error')
      }
    }, 1500)
  }, [step, templateKey, title, subject, templateData])

  useEffect(() => {
    if (step === 2) triggerAutoSave()
  }, [templateKey, templateData, subject, title, step, triggerAutoSave])

  async function restoreDraft() {
    const id = localStorage.getItem(DRAFT_STORAGE_KEY)
    if (!id) return
    try {
      const res = await fetch(`/api/admin/mailer/${id}`, { credentials: 'include' })
      if (!res.ok) {
        localStorage.removeItem(DRAFT_STORAGE_KEY)
        setShowRestoreBanner(false)
        return
      }
      const { campaign } = await res.json()
      if (campaign.status !== 'draft') {
        localStorage.removeItem(DRAFT_STORAGE_KEY)
        setShowRestoreBanner(false)
        return
      }
      setDraftId(id)
      setTemplateKey(campaign.template_key || 'review_form_share')
      setTitle(campaign.title || '')
      setSubject(campaign.subject || '')
      setTemplateData(campaign.template_data || {})
      setStep(2)
    } catch {
      /* ignore */
    }
    setShowRestoreBanner(false)
  }

  function discardDraft() {
    localStorage.removeItem(DRAFT_STORAGE_KEY)
    setShowRestoreBanner(false)
    setDraftId(null)
  }

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
    return () => {
      if (previewDebounceRef.current) clearTimeout(previewDebounceRef.current)
    }
  }, [step, templateKey, templateData, subject, loadPreview])

  const loadAudience = useCallback(async () => {
    setAudienceLoading(true)
    try {
      const audienceFilter = audienceType === 'order_history' ? { daysSinceOrder: parseInt(daysSinceOrder, 10) } : {}
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
    return () => {
      if (audienceDebounceRef.current) clearTimeout(audienceDebounceRef.current)
    }
  }, [step, audienceType, daysSinceOrder, loadAudience])

  function setField(key: string, value: string) {
    setTemplateData(prev => ({ ...prev, [key]: value }))
  }

  async function generateFromScenario() {
    if (scenarioPrompt.trim().length < 10 || scenarioLoading) return
    setScenarioLoading(true)
    setScenarioError(null)
    try {
      const res = await fetch('/api/admin/ai-generate-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenario: scenarioPrompt, subject }),
      })
      const data = (await res.json()) as { html?: string; error?: string }
      if (!res.ok || !data.html) {
        setScenarioError(data.error || 'Generation failed')
        return
      }

      const html = data.html

      // Extract plain text from HTML for non-custom templates
      const stripTags = (h: string) =>
        h
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
      const extractFirstLine = (h: string) =>
        stripTags(h)
          .split(/[.\n!]/)[0]
          .trim()

      if (templateKey === 'custom') {
        setField('htmlBody', html)
      } else if (templateKey === 'promotion' || templateKey === 'announcement') {
        // Extract heading → headline, body paragraphs → body, CTA → ctaText+ctaUrl
        const h2Match = html.match(/<h2[^>]*>(.*?)<\/h2>/i)
        const headline = h2Match ? stripTags(h2Match[1]) : extractFirstLine(html)
        const parasMatches = [...html.matchAll(/<p[^>]*>(.*?)<\/p>/gi)]
        const bodyParas = parasMatches
          .map(m => stripTags(m[1]))
          .filter(t => t && !t.startsWith('Dear') && t.length > 20)
          .slice(0, 3)
          .join('\n\n')
        const ctaMatch = html.match(/href="([^"]+)"[^>]*style="[^"]*background[^"]*"[^>]*>(.*?)<\/a>/i)
        if (!subject) setSubject(headline)
        setTemplateData(prev => ({
          ...prev,
          headline: headline || prev.headline,
          body: bodyParas || prev.body,
          ...(ctaMatch ? { ctaUrl: ctaMatch[1], ctaText: stripTags(ctaMatch[2]) } : {}),
        }))
      } else if (templateKey === 'event') {
        const h2Match = html.match(/<h2[^>]*>(.*?)<\/h2>/i)
        const eventName = h2Match ? stripTags(h2Match[1]) : extractFirstLine(html)
        const parasMatches = [...html.matchAll(/<p[^>]*>(.*?)<\/p>/gi)]
        const details = parasMatches
          .map(m => stripTags(m[1]))
          .filter(t => t && !t.startsWith('Dear') && t.length > 20)
          .slice(0, 3)
          .join('\n\n')
        const ctaMatch = html.match(/href="([^"]+)"[^>]*style="[^"]*background[^"]*"[^>]*>(.*?)<\/a>/i)
        if (!subject) setSubject(eventName)
        setTemplateData(prev => ({
          ...prev,
          eventName: eventName || prev.eventName,
          eventDetails: details || prev.eventDetails,
          ...(ctaMatch ? { ctaUrl: ctaMatch[1] } : {}),
        }))
      } else {
        // Fallback for any other template — switch to custom and put HTML there
        setField('htmlBody', html)
      }
    } catch {
      setScenarioError('Network error')
    } finally {
      setScenarioLoading(false)
    }
  }

  async function handleSubmit(sendNow: boolean) {
    setSubmitting(true)
    setError('')
    try {
      const audienceFilter = audienceType === 'order_history' ? { daysSinceOrder: parseInt(daysSinceOrder, 10) } : {}

      // 1. Create or update campaign record (includes scheduled_at)
      let id = draftId
      if (id) {
        const r = await fetch(`/api/admin/mailer/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            title: title || subject,
            template_key: templateKey,
            subject,
            template_data: templateData,
            audience_type: audienceType,
            audience_filter: audienceFilter,
            scheduled_at: scheduledAt || null,
          }),
        })
        if (!r.ok) throw new Error((await r.json()).error || 'Failed to update campaign')
      } else {
        const createRes = await fetch('/api/admin/mailer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
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
        id = (await createRes.json()).id
        // Persist scheduled_at if set
        if (scheduledAt) {
          await fetch(`/api/admin/mailer/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ scheduled_at: scheduledAt }),
          })
        }
      }

      // 2. Dispatch — pass scheduled_at in body so the send route has it atomically
      if (sendNow) {
        await fetch(`/api/admin/mailer/${id}/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ dispatchNow: true }),
        })
      } else if (scheduledAt) {
        await fetch(`/api/admin/mailer/${id}/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ dispatchNow: false, scheduled_at: scheduledAt }),
        })
      }

      localStorage.removeItem(DRAFT_STORAGE_KEY)
      router.push(ap('/admin/mailer'))
    } catch (err) {
      setError(String(err))
      setSubmitting(false)
    }
  }

  return (
    <MobileEditBlock>
    <div className="p-4 sm:p-6">
      {/* Restore draft banner */}
      {showRestoreBanner && (
        <div className="mb-4 flex items-center justify-between gap-4 px-4 py-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-700 rounded-lg">
          <div className="flex items-center gap-2">
            <svg
              className="w-4 h-4 text-amber-600 shrink-0"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
              />
            </svg>
            <span className="text-sm font-medium text-amber-800 dark:text-amber-300">
              You have an unsaved draft — want to continue where you left off?
            </span>
          </div>
          <div className="flex gap-2 shrink-0">
            <button
              onClick={restoreDraft}
              className="px-3 py-1 text-xs font-semibold bg-amber-500 hover:bg-amber-600 text-white rounded-md transition-colors"
            >
              Restore
            </button>
            <button
              onClick={discardDraft}
              className="px-3 py-1 text-xs font-semibold bg-surface border border-amber-300 dark:border-amber-600 text-amber-800 dark:text-amber-300 rounded-md transition-colors"
            >
              Discard
            </button>
          </div>
        </div>
      )}

      <div className="flex items-center gap-3 mb-6">
        <Link href={ap('/admin/mailer')} className="text-foreground-muted hover:text-foreground transition-colors">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-secondary-500 dark:text-foreground">New Campaign</h1>
          <p className="text-sm text-foreground-secondary mt-0.5">Step {step} of 3</p>
        </div>
        {/* Auto-save indicator — always visible on step 2 */}
        {step === 2 && (
          <div
            className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border transition-all ${
              saveState === 'saving'
                ? 'text-foreground-muted bg-surface-secondary border-border-default'
                : saveState === 'saved'
                  ? 'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
                  : saveState === 'error'
                    ? 'text-red-500 bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
                    : draftId
                      ? 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-700'
                      : 'text-foreground-muted bg-surface-secondary border-border-default'
            }`}
          >
            {saveState === 'saving' && (
              <svg className="w-3 h-3 animate-spin shrink-0" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
            )}
            {saveState === 'saved' && (
              <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
            )}
            {saveState === 'error' && (
              <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
                />
              </svg>
            )}
            {saveState === 'idle' && draftId && (
              <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
                />
              </svg>
            )}
            {saveState === 'saving'
              ? 'Saving draft…'
              : saveState === 'saved'
                ? 'Draft saved'
                : saveState === 'error'
                  ? 'Save failed — retry?'
                  : draftId
                    ? 'Draft'
                    : 'Auto-save enabled'}
          </div>
        )}
      </div>

      <div className="flex gap-1 mb-6 max-w-3xl">
        {[1, 2, 3].map(s => (
          <div
            key={s}
            className={`h-1.5 flex-1 rounded-full transition-colors ${s <= step ? 'bg-accent-500' : 'bg-border-default'}`}
          />
        ))}
      </div>

      {/* ── Step 1 ── */}
      {step === 1 && (
        <div className="max-w-3xl space-y-5">
          <div>
            <p className={labelClass}>Template</p>
            <div className="grid gap-3">
              {TEMPLATES.map(t => (
                <label
                  key={t.value}
                  className={`flex items-start gap-3 p-4 rounded-lg border cursor-pointer transition-colors ${templateKey === t.value ? 'border-accent-500 bg-accent-50 dark:bg-accent-900/20' : 'border-border-default hover:border-border-secondary bg-surface-elevated'}`}
                >
                  <input
                    type="radio"
                    name="template"
                    value={t.value}
                    checked={templateKey === t.value}
                    onChange={() => {
                      setTemplateKey(t.value)
                      setTemplateData({})
                    }}
                    className="mt-0.5 text-accent-500"
                  />
                  <div>
                    <p className="font-medium text-sm text-foreground">{t.label}</p>
                    <p className="text-xs text-foreground-muted mt-0.5">{t.description}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <button
            type="button"
            onClick={() => setStep(2)}
            className="px-6 py-2 bg-accent-500 hover:bg-accent-600 text-white rounded-lg font-semibold text-sm transition-colors"
          >
            Continue
          </button>
        </div>
      )}

      {/* ── Step 2 ── */}
      {step === 2 && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 xl:gap-8 items-start">
          <div className="space-y-5">
            {/* AI Assist — available for all templates */}
            {canUseAi && (
              <div className="bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800 rounded-lg p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <svg
                    className="w-4 h-4 text-violet-500 shrink-0"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={1.8}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z"
                    />
                  </svg>
                  <p className="text-sm font-semibold text-violet-700 dark:text-violet-300">AI Assist</p>
                </div>
                <textarea
                  value={scenarioPrompt}
                  onChange={e => setScenarioPrompt(e.target.value)}
                  rows={2}
                  className={textareaClass}
                  placeholder="Describe your campaign — e.g. 'Diwali sale 20% off power tools, CTA to /products' or 'Re-engage customers who haven't ordered in 60 days'"
                />
                <div className="flex items-center gap-2">
                  <RequireWrite scope="mailer:write">
                    <button
                      type="button"
                      onClick={generateFromScenario}
                      disabled={scenarioLoading || scenarioPrompt.trim().length < 10}
                      className="inline-flex items-center gap-2 px-4 py-1.5 bg-violet-500 hover:bg-violet-600 text-white rounded-lg font-medium text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {scenarioLoading ? (
                        <>
                          <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle
                              className="opacity-25"
                              cx="12"
                              cy="12"
                              r="10"
                              stroke="currentColor"
                              strokeWidth="4"
                            />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                          </svg>
                          Generating…
                        </>
                      ) : (
                        <>
                          <svg
                            className="w-3.5 h-3.5"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={1.8}
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z"
                            />
                          </svg>
                          {templateData.htmlBody ? 'Regenerate' : 'Generate content'}
                        </>
                      )}
                    </button>
                  </RequireWrite>
                  {scenarioError && <span className="text-xs text-red-500">{scenarioError}</span>}
                </div>
              </div>
            )}

            <div>
              <label className={labelClass}>Campaign Title (internal)</label>
              <input
                value={title}
                onChange={e => setTitle(e.target.value)}
                className={inputClass}
                placeholder="e.g. May Google Review Push"
              />
            </div>
            <div>
              <label className={labelClass}>Email Subject *</label>
              <AIEnrichButton
                fieldLabel="Email Subject"
                value={subject}
                onChange={setSubject}
                scope="mailer:write"
                context={`Template: ${templateKey}`}
              >
                <input
                  value={subject}
                  onChange={e => setSubject(e.target.value)}
                  className={`${inputClass} pr-8`}
                  placeholder="Subject line customers will see"
                  required
                />
              </AIEnrichButton>
            </div>

            {templateKey === 'review_form_share' && (
              <>
                <AdminSelect
                  label="Review Form *"
                  placeholder={reviewForms.length === 0 ? 'No active forms found' : 'Select a form…'}
                  options={reviewForms.map(f => ({ value: f.id, label: f.title, group: undefined }))}
                  value={templateData.formId || ''}
                  onChange={formId => {
                    const chosen = reviewForms.find(f => f.id === formId)
                    if (!chosen) return
                    const formsBase = `https://${formsHostForHost(window.location.host)}`
                    setTemplateData(prev => ({
                      ...prev,
                      formId: chosen.id,
                      formTitle: chosen.title,
                      formUrl: `${formsBase}/${chosen.slug}`,
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
                    No review forms found.{' '}
                    <Link href={ap('/admin/review-forms/add')} className="underline">
                      Create one first.
                    </Link>
                  </p>
                )}
              </>
            )}

            {(templateKey === 'promotion' || templateKey === 'announcement') && (
              <>
                <div>
                  <label className={labelClass}>Headline *</label>
                  <AIEnrichButton
                    fieldLabel="Headline"
                    value={templateData.headline || ''}
                    onChange={v => setField('headline', v)}
                    scope="mailer:write"
                    context={`Template: ${templateKey}`}
                  >
                    <input
                      value={templateData.headline || ''}
                      onChange={e => setField('headline', e.target.value)}
                      className={`${inputClass} pr-8`}
                      placeholder="e.g. 20% Off Storewide This Weekend!"
                    />
                  </AIEnrichButton>
                </div>
                <div>
                  <label className={labelClass}>Body *</label>
                  <AIEnrichButton
                    fieldLabel="Body"
                    value={templateData.body || ''}
                    onChange={v => setField('body', v)}
                    scope="mailer:write"
                    context={`Subject: ${subject}; Template: ${templateKey}`}
                    multiline
                  >
                    <textarea
                      value={templateData.body || ''}
                      onChange={e => setField('body', e.target.value)}
                      rows={4}
                      className={`${textareaClass} pr-8`}
                      placeholder="Email body text..."
                    />
                  </AIEnrichButton>
                </div>
                {templateKey === 'promotion' && (
                  <>
                    <div>
                      <label className={labelClass}>CTA Button Text</label>
                      <input
                        value={templateData.ctaText || ''}
                        onChange={e => setField('ctaText', e.target.value)}
                        className={inputClass}
                        placeholder="Shop Now"
                      />
                    </div>
                    <div>
                      <label className={labelClass}>CTA URL</label>
                      <input
                        value={templateData.ctaUrl || ''}
                        onChange={e => setField('ctaUrl', e.target.value)}
                        className={inputClass}
                        placeholder="https://jeffistores.in/products"
                      />
                    </div>
                  </>
                )}
              </>
            )}

            {templateKey === 'event' && (
              <>
                <div>
                  <label className={labelClass}>Event Name *</label>
                  <input
                    value={templateData.eventName || ''}
                    onChange={e => setField('eventName', e.target.value)}
                    className={inputClass}
                    placeholder="e.g. Grand Sale Weekend"
                  />
                </div>
                <div>
                  <label className={labelClass}>Event Date</label>
                  <input
                    value={templateData.eventDate || ''}
                    onChange={e => setField('eventDate', e.target.value)}
                    className={inputClass}
                    placeholder="e.g. Saturday, 10 May 2025, 10am–8pm"
                  />
                </div>
                <div>
                  <label className={labelClass}>Event Details *</label>
                  <AIEnrichButton
                    fieldLabel="Event Details"
                    value={templateData.eventDetails || ''}
                    onChange={v => setField('eventDetails', v)}
                    scope="mailer:write"
                    context={`Event: ${templateData.eventName || ''}; Date: ${templateData.eventDate || ''}`}
                    multiline
                  >
                    <textarea
                      value={templateData.eventDetails || ''}
                      onChange={e => setField('eventDetails', e.target.value)}
                      rows={4}
                      className={`${textareaClass} pr-8`}
                      placeholder="Tell customers what to expect..."
                    />
                  </AIEnrichButton>
                </div>
                <div>
                  <label className={labelClass}>CTA URL</label>
                  <input
                    value={templateData.ctaUrl || ''}
                    onChange={e => setField('ctaUrl', e.target.value)}
                    className={inputClass}
                    placeholder="https://jeffistores.in"
                  />
                </div>
              </>
            )}

            {templateKey === 'custom' && (
              <div>
                <label className={labelClass}>Email Body</label>
                <p className="text-[11px] text-foreground-muted mb-2">
                  {canUseAi ? 'Use the AI Assist above to generate, or write your own. AI uses tags' : 'Use tags'} like{' '}
                  <code className="font-mono bg-surface-secondary px-1 rounded">{'{customer_first_name}'}</code>{' '}
                  replaced per recipient at send time.
                </p>
                <RichTextEditor
                  value={templateData.htmlBody || ''}
                  onChange={v => setField('htmlBody', v)}
                  placeholder={
                    canUseAi ? "Click 'Generate content' above, or write your own here." : 'Write your email here.'
                  }
                  minHeight={360}
                />
              </div>
            )}

            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="px-5 py-2 bg-surface border border-border-secondary hover:bg-surface-secondary text-foreground rounded-lg font-medium transition-colors text-sm"
              >
                Back
              </button>
              <RequireWrite scope="mailer:write">
                <button
                  type="button"
                  onClick={async () => {
                    if (autoSaveRef.current) clearTimeout(autoSaveRef.current)
                    setSaveState('saving')
                    try {
                      const res = await fetch('/api/admin/mailer/draft', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'include',
                        body: JSON.stringify({
                          draft_id: draftIdRef.current,
                          template_key: templateKey,
                          title: title || subject || 'Draft',
                          subject,
                          template_data: templateData,
                        }),
                      })
                      if (!res.ok) throw new Error()
                      const data = await res.json()
                      if (!draftIdRef.current) {
                        setDraftId(data.id)
                        localStorage.setItem(DRAFT_STORAGE_KEY, data.id)
                      }
                      setSaveState('saved')
                      setTimeout(() => setSaveState('idle'), 2500)
                    } catch {
                      setSaveState('error')
                    }
                  }}
                  disabled={saveState === 'saving'}
                  className="px-5 py-2 bg-surface border border-border-secondary hover:bg-surface-secondary text-foreground-secondary rounded-lg font-medium transition-colors text-sm disabled:opacity-50 flex items-center gap-1.5"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
                    />
                  </svg>
                  Save Draft
                </button>
              </RequireWrite>
              <button
                type="button"
                onClick={() => setStep(3)}
                disabled={!subject}
                className="px-6 py-2 bg-accent-500 hover:bg-accent-600 text-white rounded-lg font-semibold text-sm transition-colors disabled:opacity-50"
              >
                Continue
              </button>
            </div>
          </div>

          {/* Right: live email preview */}
          <div className="sticky top-6">
            <p className="text-xs font-medium text-foreground-muted uppercase tracking-wide mb-2">Email Preview</p>
            <div
              className="border border-border-default rounded-lg overflow-hidden bg-surface-elevated"
              style={{ minHeight: '520px' }}
            >
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

      {/* ── Step 3 ── */}
      {step === 3 && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 xl:gap-8 items-start">
          <div className="space-y-5">
            <AdminSelect label="Audience" options={AUDIENCE_OPTIONS} value={audienceType} onChange={setAudienceType} />

            {audienceType === 'order_history' && (
              <div>
                <label className={labelClass}>Ordered within the last N days</label>
                <input
                  type="number"
                  min="1"
                  max="365"
                  value={daysSinceOrder}
                  onChange={e => setDaysSinceOrder(e.target.value)}
                  className={inputClass}
                  style={{ maxWidth: '140px' }}
                />
              </div>
            )}

            <div>
              <label className={labelClass}>Schedule (optional — leave blank to send now or save as draft)</label>
              <DateTimePicker
                value={scheduledAt}
                onChange={setScheduledAt}
                className="w-full"
                placeholder="Leave blank to send now"
              />
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <div className="flex flex-wrap gap-3 pt-2">
              <button
                type="button"
                onClick={() => setStep(2)}
                className="px-5 py-2 bg-surface border border-border-secondary hover:bg-surface-secondary text-foreground rounded-lg font-medium transition-colors text-sm"
              >
                Back
              </button>
              <RequireWrite scope="mailer:write">
                <button
                  type="button"
                  onClick={() => handleSubmit(false)}
                  disabled={submitting}
                  className="px-5 py-2 bg-surface-secondary hover:bg-border-default text-foreground-secondary rounded-lg font-medium transition-colors text-sm disabled:opacity-50"
                >
                  {submitting ? '…' : scheduledAt ? 'Schedule' : 'Save as Draft'}
                </button>
                <button
                  type="button"
                  onClick={() => handleSubmit(true)}
                  disabled={submitting || !!scheduledAt}
                  className="px-6 py-2 bg-accent-500 hover:bg-accent-600 text-white rounded-lg font-semibold text-sm transition-colors disabled:opacity-50"
                >
                  {submitting ? 'Queuing…' : 'Send Now'}
                </button>
              </RequireWrite>
              {scheduledAt && (
                <p className="text-xs text-foreground-muted self-center">
                  Sending at{' '}
                  {new Date(scheduledAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                </p>
              )}
            </div>
          </div>

          {/* Right: recipient preview */}
          <div className="sticky top-6">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium text-foreground-muted uppercase tracking-wide">Recipients</p>
              {audienceCount !== null && !audienceLoading && (
                <span className="text-xs font-semibold text-accent-500">
                  {audienceCount.toLocaleString()} customer{audienceCount !== 1 ? 's' : ''}
                </span>
              )}
            </div>
            <div
              className="border border-border-default rounded-lg overflow-hidden bg-surface-elevated"
              style={{ minHeight: '400px' }}
            >
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
                          {r.first_name && (
                            <p className="text-sm font-medium text-foreground truncate">{r.first_name}</p>
                          )}
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
    </MobileEditBlock>
  )
}
