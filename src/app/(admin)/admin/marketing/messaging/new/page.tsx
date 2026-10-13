'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, AlertTriangle, Mail, MessageSquare, MessageCircle, Sparkles, Loader2, Pencil, Save } from 'lucide-react'
import AdminSelect from '@/components/admin/AdminSelect'
import Pagination from '@/components/admin/Pagination'
import DateTimePicker from '@/components/ui/DateTimePicker'
import LibraryTemplatePicker from '@/components/admin/messaging-templates/LibraryTemplatePicker'
import LinkedTemplateEditor from '@/components/admin/messaging-templates/LinkedTemplateEditor'
import PhonePreview from '@/components/admin/messaging-templates/PhonePreview'
import { WhatsAppPreview, waSlots } from '@/components/admin/campaigns/WhatsAppTemplateEditor'
import { ap } from '@/lib/shared/admin-path'
import { formsHostForHost } from '@/lib/tenancy/forms-host'
import { RequireWrite, useCanUseAi } from '@/contexts/AdminScopesContext'
import { useToast } from '@/contexts/ToastContext'
import MobileEditBlock from '@/components/admin/MobileEditBlock'
import EditorToolbar from '@/components/admin/EditorToolbar'
import { useEditSession } from '@/hooks/useEditSession'
import type { AutosaveStatus } from '@/hooks/useAutosaveDraft'

type Channel = 'email' | 'sms' | 'whatsapp'
type Channels = Partial<Record<Channel, { slug: string; vars?: Record<string, string>; subject?: string }>>
type Loaded = { slug: string; subject: string | null; body: string; approval_status: string | null }

const CHANNELS: Array<{ key: Channel; label: string; icon: typeof Mail; note: string }> = [
  { key: 'email', label: 'Email', icon: Mail, note: 'Sent to every customer in the audience' },
  { key: 'sms', label: 'SMS', icon: MessageSquare, note: 'Customers with a phone number' },
  { key: 'whatsapp', label: 'WhatsApp', icon: MessageCircle, note: 'Meta-approved templates only' },
]

// Legacy Mailer drafts → the library templates they were imported as.
const LEGACY_SLUG: Record<string, string> = {
  promotion: 'messaging/promotion', announcement: 'messaging/announcement', event: 'messaging/event',
  review_form_share: 'messaging/review-form-share',
}

const AUDIENCE_OPTIONS = [
  { value: 'all', label: 'All customers' },
  { value: 'order_history', label: 'By recent order history' },
]

// Filled per recipient at send time — never asked for in the form.
const AUTO = /^(customer_|store_)|^(firstName|current_year|date)$/
const VAR_RE = /\{\{?\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}?\}/g
const namedVars = (...texts: Array<string | null | undefined>) =>
  [...new Set(texts.flatMap(t => [...(t ?? '').matchAll(VAR_RE)].map(m => m[1])))].filter(v => !AUTO.test(v) && !/^\d+$/.test(v))
const humanize = (v: string) => v.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^\w/, c => c.toUpperCase())

const inputClass =
  'w-full px-4 py-2 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-transparent text-sm'
const labelClass = 'block text-sm font-medium text-foreground-secondary mb-1.5'
const btnSecondary =
  'px-5 h-control bg-surface border border-border-secondary hover:bg-surface-secondary text-foreground rounded-lg font-medium transition-colors text-sm disabled:opacity-50'
const btnPrimary =
  'px-6 h-control bg-accent-500 hover:bg-accent-600 text-white rounded-lg font-semibold text-sm transition-colors disabled:opacity-50'

interface ReviewFormOption { id: string; title: string; slug: string }
interface Recipient { email: string; phone: string | null; first_name: string | null }
type SaveState = 'idle' | 'saving' | 'saved' | 'error'

const DRAFT_STORAGE_KEY = 'mailer_draft_id'

export default function NewMessagePage() {
  const router = useRouter()
  const { showToast } = useToast()
  const [step, setStep] = useState(1)
  const [channels, setChannels] = useState<Channels>({})
  const [vars, setVars] = useState<Record<string, string>>({})
  const [waVars, setWaVars] = useState<Record<string, string>>({})
  const [loaded, setLoaded] = useState<Partial<Record<Channel, Loaded>>>({})
  const [editing, setEditing] = useState<Channel | null>(null)
  const [previewTab, setPreviewTab] = useState<Channel>('email')
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
  const [withPhone, setWithPhone] = useState(0)
  const [recipientPage, setRecipientPage] = useState(1)
  const [audienceLoading, setAudienceLoading] = useState(false)
  const previewDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const audienceDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const autoSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [scenarioPrompt, setScenarioPrompt] = useState('')
  const [scenarioLoading, setScenarioLoading] = useState(false)
  const [scenarioError, setScenarioError] = useState<string | null>(null)
  const canUseAi = useCanUseAi('mailer:write')

  const [draftId, setDraftId] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const edit = useEditSession({ resourceType: 'mailer', resourceId: draftId })
  const [showRestoreBanner, setShowRestoreBanner] = useState(false)
  const draftIdRef = useRef<string | null>(null)

  const active = CHANNELS.map(c => c.key).filter(k => channels[k])
  const ready = active.length > 0 && active.every(k => channels[k]!.slug)

  // What the send stores: shared named vars for email/SMS, numbered slots for WhatsApp.
  const payloadChannels = useMemo<Channels>(() => {
    const out: Channels = {}
    if (channels.email?.slug) out.email = { slug: channels.email.slug, vars, ...(subject ? { subject } : {}) }
    if (channels.sms?.slug) out.sms = { slug: channels.sms.slug, vars }
    if (channels.whatsapp?.slug) out.whatsapp = { slug: channels.whatsapp.slug, vars: waVars }
    return out
  }, [channels, vars, waVars, subject])

  useEffect(() => {
    fetch('/api/admin/review-forms?page=1').then(r => r.json()).then(d => setReviewForms(d.forms || [])).catch(() => {})
    const fromUrl = new URLSearchParams(window.location.search).get('draftId')
    if (fromUrl) {
      localStorage.setItem(DRAFT_STORAGE_KEY, fromUrl)
      void restoreDraftFromId(fromUrl)
      return
    }
    if (localStorage.getItem(DRAFT_STORAGE_KEY)) setShowRestoreBanner(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { draftIdRef.current = draftId }, [draftId])

  // Picked templates' current content (drives the variable inputs and previews).
  const slugKey = active.map(k => `${k}:${channels[k]?.slug ?? ''}`).join('|')
  useEffect(() => {
    let live = true
    for (const k of active) {
      const slug = channels[k]?.slug
      if (!slug || loaded[k]?.slug === slug) continue
      fetch(`/api/admin/messaging-templates/${k}/${encodeURIComponent(slug)}`).then(r => (r.ok ? r.json() : null)).then(a => {
        if (!live || !a) return
        const v = a.current_version ?? {}
        setLoaded(p => ({ ...p, [k]: { slug, subject: v.subject ?? null, body: v.body ?? '', approval_status: a.approval_status ?? null } }))
      }).catch(() => {})
    }
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slugKey])

  const fields = useMemo(
    () => namedVars(channels.email ? loaded.email?.subject : '', channels.email ? loaded.email?.body : '', channels.sms ? loaded.sms?.body : ''),
    [channels.email, channels.sms, loaded]
  )
  const slots = channels.whatsapp && loaded.whatsapp ? waSlots(loaded.whatsapp.body) : []

  const triggerAutoSave = useCallback(() => {
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
            template_key: 'library',
            title: title || subject || 'Draft',
            subject,
            channels: payloadChannels,
            audience_type: audienceType,
            audience_filter: audienceType === 'order_history' ? { daysSinceOrder } : {},
            scheduled_at: scheduledAt || null,
            wizard_step: step,
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
  }, [step, title, subject, payloadChannels, audienceType, daysSinceOrder, scheduledAt])

  useEffect(() => { triggerAutoSave() }, [triggerAutoSave])

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (saveState === 'saving' || saveState === 'error') {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [saveState])

  async function restoreDraftFromId(id: string) {
    try {
      const res = await fetch(`/api/admin/mailer/${id}`, { credentials: 'include' })
      const campaign = res.ok ? (await res.json()).campaign : null
      if (!campaign || campaign.status !== 'draft') {
        localStorage.removeItem(DRAFT_STORAGE_KEY)
        setShowRestoreBanner(false)
        return
      }
      setDraftId(id)
      setTitle(campaign.title || '')
      setSubject(campaign.subject || '')
      const ch: Channels = campaign.channels ?? {}
      if (campaign.template_key !== 'library' && LEGACY_SLUG[campaign.template_key]) {
        setChannels({ email: { slug: LEGACY_SLUG[campaign.template_key] } })
        setVars(campaign.template_data || {})
      } else {
        setChannels(ch)
        setVars(ch.email?.vars ?? ch.sms?.vars ?? {})
        setWaVars(ch.whatsapp?.vars ?? {})
      }
      setAudienceType(campaign.audience_type || 'all')
      const dso = campaign.audience_filter?.daysSinceOrder
      if (dso != null) setDaysSinceOrder(String(dso))
      if (campaign.scheduled_at) {
        const d = new Date(campaign.scheduled_at)
        const pad = (n: number) => String(n).padStart(2, '0')
        setScheduledAt(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`)
      }
      const savedStep = Number(campaign.wizard_step)
      setStep(Number.isFinite(savedStep) ? Math.min(3, Math.max(1, savedStep)) : 2)
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
    if (!payloadChannels.email) return setPreviewHtml('')
    setPreviewLoading(true)
    try {
      const res = await fetch('/api/admin/mailer/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template_key: 'library', channels: payloadChannels, subject }),
      })
      setPreviewHtml((await res.json()).html || '')
    } finally {
      setPreviewLoading(false)
    }
  }, [payloadChannels, subject])

  useEffect(() => {
    if (step !== 2) return
    if (previewDebounceRef.current) clearTimeout(previewDebounceRef.current)
    previewDebounceRef.current = setTimeout(loadPreview, 600)
    return () => { if (previewDebounceRef.current) clearTimeout(previewDebounceRef.current) }
  }, [step, loadPreview, loaded])

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
      setRecipientPage(1)
      setAudienceCount(data.count ?? 0)
      setWithPhone(data.withPhone ?? 0)
    } finally {
      setAudienceLoading(false)
    }
  }, [audienceType, daysSinceOrder])

  useEffect(() => {
    if (step !== 3) return
    if (audienceDebounceRef.current) clearTimeout(audienceDebounceRef.current)
    audienceDebounceRef.current = setTimeout(loadAudience, 400)
    return () => { if (audienceDebounceRef.current) clearTimeout(audienceDebounceRef.current) }
  }, [step, loadAudience])

  function toggleChannel(k: Channel) {
    setChannels(p => {
      const n = { ...p }
      if (n[k]) delete n[k]
      else n[k] = { slug: '' }
      return n
    })
  }

  function pickTemplate(k: Channel, slug: string | null) {
    setChannels(p => ({ ...p, [k]: { slug: slug ?? '' } }))
    if (k === 'whatsapp') setWaVars({})
    if (k === 'email') setSubject('')
    setEditing(null)
  }

  // AI writes an email, which is saved as a new template in this store's library and picked.
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
      if (!res.ok || !data.html) return setScenarioError(data.error || 'Generation failed')
      const h2 = data.html.match(/<h2[^>]*>(.*?)<\/h2>/i)?.[1]?.replace(/<[^>]+>/g, '').trim()
      const name = subject || h2 || scenarioPrompt.slice(0, 60)
      const slug = `messaging/ai-${Date.now().toString(36)}`
      const created = await fetch('/api/admin/messaging-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, channel: 'email', name, category: 'messaging', subject: subject || h2 || name, body: data.html, blocks_format: 'tiptap-html', publish: true }),
      })
      if (!created.ok) return setScenarioError('Generated, but saving it as a template failed')
      setChannels(p => ({ ...p, email: { slug } }))
      setLoaded(p => ({ ...p, email: { slug, subject: subject || h2 || name, body: data.html!, approval_status: null } }))
      showToast('Saved as a new email template in your library.', 'success')
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
      const emailSubject = subject || loaded.email?.subject || title || 'Message'
      const fields = {
        title: title || emailSubject,
        template_key: 'library',
        subject: emailSubject,
        template_data: {},
        channels: payloadChannels,
        audience_type: audienceType,
        audience_filter: audienceFilter,
      }
      let id = draftId
      if (id) {
        const r = await fetch(`/api/admin/mailer/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ ...fields, scheduled_at: scheduledAt || null }),
        })
        if (!r.ok) throw new Error((await r.json()).error || 'Failed to update message')
      } else {
        const createRes = await fetch('/api/admin/mailer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(fields),
        })
        if (!createRes.ok) throw new Error((await createRes.json()).error || 'Failed to create message')
        id = (await createRes.json()).id
      }
      if (sendNow || scheduledAt) {
        await fetch(`/api/admin/mailer/${id}/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(sendNow ? { dispatchNow: true } : { dispatchNow: false, scheduled_at: scheduledAt }),
        })
      }
      localStorage.removeItem(DRAFT_STORAGE_KEY)
      router.push(ap('/admin/marketing/messaging'))
    } catch (err) {
      setError(String(err))
      setSubmitting(false)
    }
  }

  const waProblem =
    channels.whatsapp?.slug && loaded.whatsapp && loaded.whatsapp.approval_status !== 'approved'
      ? 'This WhatsApp template is not approved by Meta yet — it will not be sent.'
      : channels.whatsapp && slots.some(n => !waVars[n]?.trim())
        ? 'Fill every WhatsApp slot — otherwise WhatsApp is skipped.'
        : null
  const previewVars = { firstName: 'Priya', ...vars }

  return (
    <MobileEditBlock>
    <div className="p-4 sm:p-6">
      {showRestoreBanner && (
        <div className="mb-4 flex items-center justify-between gap-4 px-4 py-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-700 rounded-lg">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
            <span className="text-sm font-medium text-amber-800 dark:text-amber-300">
              You have an unsaved draft — want to continue where you left off?
            </span>
          </div>
          <div className="flex gap-2 shrink-0">
            <button
              onClick={() => { const id = localStorage.getItem(DRAFT_STORAGE_KEY); if (id) void restoreDraftFromId(id) }}
              className="px-3 h-control-sm text-xs font-semibold bg-amber-500 hover:bg-amber-600 text-white rounded-md transition-colors"
            >
              Restore
            </button>
            <button
              onClick={discardDraft}
              className="px-3 h-control-sm text-xs font-semibold bg-surface border border-amber-300 dark:border-amber-600 text-amber-800 dark:text-amber-300 rounded-md transition-colors"
            >
              Discard
            </button>
          </div>
        </div>
      )}

      <div className="flex items-center gap-3 mb-6">
        <Link href={ap('/admin/marketing/messaging')} className="text-foreground-muted hover:text-foreground transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-secondary-500 dark:text-foreground">New message</h1>
          <p className="text-sm text-foreground-secondary mt-0.5">
            Step {step} of 3 · {['Channels & templates', 'Content', 'Audience & schedule'][step - 1]}
          </p>
        </div>
        {draftId && edit.sessionId && (
          <EditorToolbar
            autosaveStatus={saveState as AutosaveStatus}
            sessionStatus={edit.status}
            onSave={async () => { if (await edit.save()) router.push(ap('/admin/marketing/messaging')) }}
            onCancel={edit.cancel}
            cancelHref={ap('/admin/marketing/messaging')}
            saveLabel="Save draft"
          />
        )}
      </div>

      <div className="flex gap-1 mb-6 max-w-3xl">
        {[1, 2, 3].map(s => (
          <div key={s} className={`h-1.5 flex-1 rounded-full transition-colors ${s <= step ? 'bg-accent-500' : 'bg-border-default'}`} />
        ))}
      </div>

      {/* ── Step 1: channels + a library template per channel ── */}
      {step === 1 && (
        <div className="max-w-3xl space-y-4">
          <p className="text-sm text-foreground-secondary">
            Pick one or more channels and a template for each from your{' '}
            <Link href={ap('/admin/marketing/messaging-templates')} className="text-accent-600 hover:underline">Templates</Link> library.
          </p>
          {CHANNELS.map(c => {
            const on = !!channels[c.key]
            const Icon = c.icon
            return (
              <div key={c.key} className={`rounded-lg border p-4 transition-colors ${on ? 'border-accent-500 bg-accent-50/40 dark:bg-accent-900/10' : 'border-border-default bg-surface-elevated'}`}>
                <label className="flex items-start gap-3 cursor-pointer">
                  <input type="checkbox" checked={on} onChange={() => toggleChannel(c.key)} className="mt-1 text-accent-500" />
                  <Icon className="w-4 h-4 mt-0.5 text-foreground-muted" />
                  <div>
                    <p className="font-medium text-sm text-foreground">{c.label}</p>
                    <p className="text-xs text-foreground-muted mt-0.5">{c.note}</p>
                  </div>
                </label>
                {on && (
                  <div className="mt-3 pl-7">
                    <LibraryTemplatePicker
                      channel={c.key}
                      kind="messaging"
                      value={channels[c.key]!.slug || null}
                      onChange={slug => pickTemplate(c.key, slug)}
                      allowNone={false}
                    />
                  </div>
                )}
              </div>
            )
          })}

          {canUseAi && (
            <div className="bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800 rounded-lg p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-violet-500 shrink-0" />
                <p className="text-sm font-semibold text-violet-700 dark:text-violet-300">Write a new email with AI</p>
              </div>
              <textarea
                value={scenarioPrompt}
                onChange={e => setScenarioPrompt(e.target.value)}
                rows={2}
                className={`${inputClass} resize-none`}
                placeholder="e.g. 'Diwali sale 20% off power tools, CTA to /products' — saved as a new template and picked for Email"
              />
              <div className="flex items-center gap-2">
                <RequireWrite scope="mailer:write">
                  <button
                    type="button"
                    onClick={generateFromScenario}
                    disabled={scenarioLoading || scenarioPrompt.trim().length < 10}
                    className="inline-flex items-center gap-2 px-4 h-control-sm bg-violet-500 hover:bg-violet-600 text-white rounded-lg font-medium text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {scenarioLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                    {scenarioLoading ? 'Generating…' : 'Generate email'}
                  </button>
                </RequireWrite>
                {scenarioError && <span className="text-xs text-red-500">{scenarioError}</span>}
              </div>
            </div>
          )}

          <button type="button" onClick={() => setStep(2)} disabled={!ready} className={btnPrimary}>Continue</button>
        </div>
      )}

      {/* ── Step 2: fill the templates' variables, edit them, preview ── */}
      {step === 2 && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 xl:gap-8 items-start">
          <div className="space-y-5">
            <div>
              <label className={labelClass}>Title (internal)</label>
              <input value={title} onChange={e => setTitle(e.target.value)} className={inputClass} placeholder="e.g. May review push" />
            </div>
            {channels.email && (
              <div>
                <label className={labelClass}>Email subject</label>
                <input
                  value={subject}
                  onChange={e => setSubject(e.target.value)}
                  className={inputClass}
                  placeholder={loaded.email?.subject ? `Template: ${loaded.email.subject}` : 'Subject line customers will see'}
                />
              </div>
            )}

            {fields.includes('formUrl') && (
              <AdminSelect
                label="Review form"
                placeholder={reviewForms.length === 0 ? 'No active forms found' : 'Select a form…'}
                options={reviewForms.map(f => ({ value: f.id, label: f.title }))}
                value={vars.formId || ''}
                onChange={formId => {
                  const f = reviewForms.find(x => x.id === formId)
                  if (!f) return
                  setVars(p => ({ ...p, formId: f.id, formTitle: f.title, formUrl: `https://${formsHostForHost(window.location.host)}/${f.slug}` }))
                }}
                disabled={reviewForms.length === 0}
              />
            )}

            {fields.filter(f => !(fields.includes('formUrl') && (f === 'formUrl' || f === 'formTitle'))).map(f => (
              <div key={f}>
                <label className={labelClass}>{humanize(f)}</label>
                {/body|details|message/i.test(f) ? (
                  <textarea value={vars[f] ?? ''} onChange={e => setVars(p => ({ ...p, [f]: e.target.value }))} rows={4} className={`${inputClass} resize-none`} />
                ) : (
                  <input value={vars[f] ?? ''} onChange={e => setVars(p => ({ ...p, [f]: e.target.value }))} className={inputClass} />
                )}
              </div>
            ))}
            {fields.length > 0 && (
              <p className="text-[11px] text-foreground-muted">
                Shared by email and SMS. The customer&apos;s name and your store details fill in automatically.
              </p>
            )}

            {channels.whatsapp && slots.length > 0 && (
              <div className="space-y-3 rounded-lg border border-border-default p-3">
                <p className="text-xs font-semibold text-foreground-secondary flex items-center gap-1.5"><MessageCircle className="w-3.5 h-3.5" /> WhatsApp slots</p>
                {slots.map(n => (
                  <div key={n}>
                    <label className="block text-[11px] font-medium text-foreground-muted mb-1">{`{{${n}}}`}</label>
                    <input
                      className={inputClass}
                      value={waVars[n] ?? ''}
                      onChange={e => setWaVars(p => ({ ...p, [n]: e.target.value }))}
                      placeholder="Fixed text, or a variable like {firstName}"
                    />
                  </div>
                ))}
              </div>
            )}
            {waProblem && <p className="text-xs text-yellow-700 dark:text-yellow-300">{waProblem}</p>}

            <div className="flex flex-wrap gap-2">
              {active.filter(k => k !== 'whatsapp').map(k => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setEditing(editing === k ? null : k)}
                  className={`inline-flex items-center gap-1.5 px-3 h-control-sm rounded-lg border text-xs font-medium transition-colors ${editing === k ? 'border-accent-500 text-accent-600' : 'border-border-secondary text-foreground-secondary hover:bg-surface-secondary'}`}
                >
                  <Pencil className="w-3 h-3" /> Edit {k === 'email' ? 'email' : 'SMS'} template
                </button>
              ))}
            </div>
            {editing && channels[editing]?.slug && (
              <LinkedTemplateEditor
                channel={editing}
                slug={channels[editing]!.slug}
                onMirror={t => setLoaded(p => ({ ...p, [editing]: { slug: channels[editing]!.slug, subject: t.subject ?? null, body: t.body ?? '', approval_status: null } }))}
              />
            )}

            <div className="flex items-center gap-3 pt-2">
              <button type="button" onClick={() => setStep(1)} className={btnSecondary}>Back</button>
              <RequireWrite scope="mailer:write">
                <button type="button" onClick={triggerAutoSave} disabled={saveState === 'saving'} className={`${btnSecondary} flex items-center gap-1.5`}>
                  <Save className="w-3.5 h-3.5" /> Save draft
                </button>
              </RequireWrite>
              <button type="button" onClick={() => setStep(3)} disabled={!ready} className={btnPrimary}>Continue</button>
            </div>
          </div>

          <div className="sticky top-6">
            <div className="flex gap-1 mb-2">
              {active.map(k => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setPreviewTab(k)}
                  className={`px-3 h-control-sm rounded-md text-xs font-medium ${previewTab === k || (!channels[previewTab] && k === active[0]) ? 'bg-accent-500 text-white' : 'text-foreground-muted hover:bg-surface-secondary'}`}
                >
                  {CHANNELS.find(c => c.key === k)!.label}
                </button>
              ))}
            </div>
            {(channels[previewTab] ? previewTab : active[0]) === 'email' && (
              <div className="border border-border-default rounded-lg overflow-hidden bg-surface-elevated" style={{ minHeight: '520px' }}>
                {previewLoading ? (
                  <div className="flex items-center justify-center h-[520px] text-foreground-muted text-sm gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" /> Rendering…
                  </div>
                ) : previewHtml ? (
                  <iframe srcDoc={previewHtml} className="w-full h-[600px] bg-white" title="Email preview" />
                ) : (
                  <div className="flex items-center justify-center h-[520px] text-foreground-muted text-sm">Pick an email template to preview</div>
                )}
              </div>
            )}
            {(channels[previewTab] ? previewTab : active[0]) === 'sms' && (
              <PhonePreview channel="sms" body={loaded.sms?.body ?? ''} vars={previewVars} />
            )}
            {(channels[previewTab] ? previewTab : active[0]) === 'whatsapp' && (
              <WhatsAppPreview value={{ slug: channels.whatsapp?.slug || null, variables: waVars }} vars={previewVars} />
            )}
          </div>
        </div>
      )}

      {/* ── Step 3: audience + schedule ── */}
      {step === 3 && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 xl:gap-8 items-start">
          <div className="space-y-5">
            <AdminSelect label="Audience" options={AUDIENCE_OPTIONS} value={audienceType} onChange={setAudienceType} />
            {audienceType === 'order_history' && (
              <div>
                <label className={labelClass}>Ordered within the last N days</label>
                <input type="number" min="1" max="365" value={daysSinceOrder} onChange={e => setDaysSinceOrder(e.target.value)} className={inputClass} style={{ maxWidth: '140px' }} />
              </div>
            )}
            <div>
              <label className={labelClass}>Schedule (optional — leave blank to send now or save as draft)</label>
              <DateTimePicker value={scheduledAt} onChange={setScheduledAt} className="w-full" placeholder="Leave blank to send now" />
            </div>
            <p className="text-xs text-foreground-muted">Customers who opted out of marketing are never messaged.</p>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex flex-wrap gap-3 pt-2">
              <button type="button" onClick={() => setStep(2)} className={btnSecondary}>Back</button>
              <RequireWrite scope="mailer:write">
                <button type="button" onClick={() => handleSubmit(false)} disabled={submitting} className={btnSecondary}>
                  {submitting ? '…' : scheduledAt ? 'Schedule' : 'Save as draft'}
                </button>
                <button type="button" onClick={() => handleSubmit(true)} disabled={submitting || !!scheduledAt || !ready} className={btnPrimary}>
                  {submitting ? 'Queuing…' : 'Send now'}
                </button>
              </RequireWrite>
              {scheduledAt && (
                <p className="text-xs text-foreground-muted self-center">
                  Sending at {new Date(scheduledAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                </p>
              )}
            </div>
          </div>

          <div className="sticky top-6">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium text-foreground-muted uppercase tracking-wide">Recipients</p>
              {audienceCount !== null && !audienceLoading && (
                <span className="text-xs font-semibold text-accent-500">
                  {channels.email && `${audienceCount.toLocaleString()} email`}
                  {channels.email && (channels.sms || channels.whatsapp) && ' · '}
                  {(channels.sms || channels.whatsapp) && `${withPhone.toLocaleString()} with a phone`}
                </span>
              )}
            </div>
            <div className="border border-border-default rounded-lg overflow-hidden bg-surface-elevated" style={{ minHeight: '400px' }}>
              {audienceLoading && (
                <div className="flex items-center justify-center h-[400px] text-foreground-muted text-sm gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" /> Loading…
                </div>
              )}
              {!audienceLoading && audienceRecipients.length === 0 && audienceCount !== null && (
                <div className="flex items-center justify-center h-[400px] text-foreground-muted text-sm">No customers match this filter</div>
              )}
              {!audienceLoading && audienceRecipients.length > 0 && (
                <div className="overflow-y-auto divide-y divide-border-default" style={{ maxHeight: '520px' }}>
                  {audienceRecipients.slice((recipientPage - 1) * 25, recipientPage * 25).map((r, i) => (
                    <div key={i} className="flex items-center gap-3 px-4 py-2.5">
                      <div className="w-7 h-7 rounded-full bg-accent-100 dark:bg-accent-900/30 flex items-center justify-center shrink-0">
                        <span className="text-xs font-semibold text-accent-600 dark:text-accent-400">{(r.first_name?.[0] || r.email[0]).toUpperCase()}</span>
                      </div>
                      <div className="min-w-0 flex-1">
                        {r.first_name && <p className="text-sm font-medium text-foreground truncate">{r.first_name}</p>}
                        <p className="text-xs text-foreground-muted truncate">{r.email}</p>
                      </div>
                      {(channels.sms || channels.whatsapp) && (
                        <span className={`text-[10px] ${r.phone ? 'text-foreground-muted' : 'text-yellow-700 dark:text-yellow-300'}`}>
                          {r.phone || 'no phone'}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <Pagination page={recipientPage} total={audienceRecipients.length} pageSize={25} onPageChange={setRecipientPage} />
          </div>
        </div>
      )}
    </div>
    </MobileEditBlock>
  )
}
