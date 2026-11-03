'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Bell, Mail, MessageSquare, MessageCircle, Sparkles, Loader2, Pencil } from 'lucide-react'
import AdminSelect from '@/components/admin/AdminSelect'
import { InfiniteFooter, fetchJson, useInfiniteList } from '@/components/admin/kit/infinite'
import DateTimePicker from '@/components/ui/DateTimePicker'
import LibraryTemplatePicker from '@/components/admin/messaging-templates/LibraryTemplatePicker'
import LinkedTemplateEditor from '@/components/admin/messaging-templates/LinkedTemplateEditor'
import PhonePreview from '@/components/admin/messaging-templates/PhonePreview'
import { WhatsAppPreview, waSlots } from '@/components/admin/campaigns/WhatsAppTemplateEditor'
import WaParamsForm, { waParams, VarInput, usageContext } from '@/components/admin/campaigns/WaParamsForm'
import { PushFields, PushPreview } from '@/components/admin/campaigns/PushEditor'
import { pushCopyProblem, type PushChannel } from '@/lib/push/copy'
import { ap } from '@/lib/shared/admin-path'
import { formsHostForHost } from '@/lib/tenancy/forms-host'
import { RequireWrite, useCanUseAi } from '@/contexts/AdminScopesContext'
import AIEnrichButton from '@/components/admin/AIEnrichButton'
import { useToast } from '@/contexts/ToastContext'
import MobileEditBlock from '@/components/admin/MobileEditBlock'
import { useEditSession } from '@/hooks/useEditSession'
import { useMessagingChannels } from '@/hooks/useStoreFlags'
import { useDraftLock } from '@/hooks/useDraftLock'
import type { AutosaveStatus } from '@/hooks/useAutosaveDraft'
import { BackLink, DraftLockBanner, FormButton, FormFooter, LockedFieldset, fieldInputCls } from '@/components/admin/kit'
import { assertDraftResponse, isDraftLockedError, lockHeaders } from '@/lib/client/draft-lock-client'

type Channel = 'email' | 'sms' | 'whatsapp'
// Push has no library template: its copy is written here and stored as channels.push.
type Tab = Channel | 'push'
type Channels = Partial<
  Record<
    Channel,
    { slug: string; vars?: Record<string, string>; subject?: string; media_url?: string; button_url?: string }
  >
>
type Payload = Channels & { push?: PushChannel }
const TEMPLATE_CHANNELS: Channel[] = ['email', 'sms', 'whatsapp']
type Loaded = { slug: string; subject: string | null; body: string; approval_status: string | null; blocks?: any }

const CHANNELS: Array<{ key: Tab; label: string; icon: typeof Mail; note: string }> = [
  { key: 'email', label: 'Email', icon: Mail, note: 'Customers with an email address' },
  { key: 'sms', label: 'SMS', icon: MessageSquare, note: 'Customers with a phone number' },
  { key: 'whatsapp', label: 'WhatsApp', icon: MessageCircle, note: 'Meta-approved templates only' },
  {
    key: 'push',
    label: 'App push',
    icon: Bell,
    note: 'Android app installs that allow offers. Quiet hours (00:00–09:00 on the phone) delay it; at most 2 a day per person.',
  },
]

// Legacy Mailer drafts → the library templates they were imported as.
const LEGACY_SLUG: Record<string, string> = {
  promotion: 'messaging/promotion',
  announcement: 'messaging/announcement',
  event: 'messaging/event',
  review_form_share: 'messaging/review-form-share',
}

const AUDIENCE_OPTIONS = [
  { value: 'all', label: 'All customers' },
  { value: 'order_history', label: 'By recent order history' },
  { value: 'segment', label: 'By customer segment' },
  { value: 'tag', label: 'By CRM tag' },
  { value: 'specific_user', label: 'A specific customer' },
  { value: 'app_users', label: 'All signed-in app users' },
  { value: 'app_installs', label: 'All app installs, including signed out' },
]

const SEGMENT_OPTIONS = [
  { value: 'vip', label: 'VIP (₹50k+ lifetime)' },
  { value: 'loyal', label: 'Loyal (5+ paid, ₹25k+)' },
  { value: 'repeat', label: 'Repeat buyers (3+ orders)' },
  { value: 'one_time', label: 'One-time buyers' },
  { value: 'new', label: 'New (joined in last 30 days)' },
  { value: 'at_risk', label: 'At risk (90–180 days quiet)' },
  { value: 'dormant', label: 'Dormant (180+ days quiet)' },
  { value: 'b2b', label: 'B2B / business' },
  { value: 'lead', label: 'Leads (no orders yet)' },
]

// Filled per recipient at send time — never asked for in the form.
const AUTO = /^(customer_|store_)|^(firstName|current_year|date)$/
const VAR_RE = /\{\{?\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}?\}/g
const namedVars = (...texts: Array<string | null | undefined>) =>
  [...new Set(texts.flatMap(t => [...(t ?? '').matchAll(VAR_RE)].map(m => m[1])))].filter(
    v => !AUTO.test(v) && !/^\d+$/.test(v)
  )
const humanize = (v: string) =>
  v
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^\w/, c => c.toUpperCase())

const inputClass = fieldInputCls
const labelClass = 'block text-xs font-medium text-foreground-secondary mb-1.5'

interface ReviewFormOption {
  id: string
  title: string
  slug: string
}
interface Recipient {
  email: string | null
  phone: string | null
  first_name: string | null
}
type SaveState = 'idle' | 'saving' | 'saved' | 'error' | 'locked'

const DRAFT_STORAGE_KEY = 'mailer_draft_id'

export default function NewMessagePage() {
  const router = useRouter()
  const { showToast, showConfirm } = useToast()
  const [step, setStep] = useState(1)
  const [picked, setChannels] = useState<Channels>({})
  const [push, setPush] = useState<PushChannel | null>(null)
  const [vars, setVars] = useState<Record<string, string>>({})
  const [waVars, setWaVars] = useState<Record<string, string>>({})
  // _action WhatsApp templates: the header image and the button's destination for this send.
  const [waMedia, setWaMedia] = useState('')
  const [waLink, setWaLink] = useState('')
  const [loaded, setLoaded] = useState<Partial<Record<Channel, Loaded>>>({})
  const [editing, setEditing] = useState<Channel | null>(null)
  const [previewTab, setPreviewTab] = useState<Tab>('email')
  const [subject, setSubject] = useState('')
  const [title, setTitle] = useState('')
  const [audienceType, setAudienceType] = useState('all')
  const [daysSinceOrder, setDaysSinceOrder] = useState('30')
  const [segment, setSegment] = useState('vip')
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [tagDefs, setTagDefs] = useState<string[]>([])
  const [specificUser, setSpecificUser] = useState<{ id: string; label: string } | null>(null)
  const [customerQuery, setCustomerQuery] = useState('')
  const [customerResults, setCustomerResults] = useState<{ id: string; full_name: string; email: string }[]>([])
  const [scheduledAt, setScheduledAt] = useState('')
  const [previewHtml, setPreviewHtml] = useState('')
  const [previewLoading, setPreviewLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const setError = (text: string) => void (text && showToast(text, 'error'))
  const [reviewForms, setReviewForms] = useState<ReviewFormOption[]>([])
  const [audienceCount, setAudienceCount] = useState<number | null>(null)
  const [withPhone, setWithPhone] = useState(0)
  const [withEmail, setWithEmail] = useState(0)
  const [pushReach, setPushReach] = useState<{ devices: number; people: number; signedOut: number } | null>(null)
  const [audienceKey, setAudienceKey] = useState<string | null>(null)
  const previewDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const audienceDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const autoSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [scenarioPrompt, setScenarioPrompt] = useState('')
  const [scenarioLoading, setScenarioLoading] = useState(false)
  const setScenarioError = (text: string | null) => void (text && showToast(text, 'error'))
  const canUseAi = useCanUseAi('mailer:write')

  const [draftId, setDraftId] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  // Per-admin draft lock: a non-holder sees the draft read-only and nothing autosaves.
  const lock = useDraftLock({ resourceType: 'mailer', resourceId: draftId })
  const lockRef = useRef(lock)
  lockRef.current = lock
  const edit = useEditSession({ resourceType: 'mailer', resourceId: draftId, lock })
  const [showRestoreBanner, setShowRestoreBanner] = useState(false)
  const draftIdRef = useRef<string | null>(null)

  // Site Controls' SMS/WhatsApp switches: an off channel is hidden and left out of what's saved/sent.
  const { sms: smsOn, whatsapp: waOn } = useMessagingChannels()
  const shown = (k: Tab) => (k === 'sms' ? smsOn : k === 'whatsapp' ? waOn : true)
  const channels = useMemo<Channels>(() => {
    const { sms, whatsapp, ...rest } = picked
    return { ...rest, ...(smsOn && sms ? { sms } : {}), ...(waOn && whatsapp ? { whatsapp } : {}) }
  }, [picked, smsOn, waOn])

  const tplActive = TEMPLATE_CHANNELS.filter(k => channels[k])
  const active: Tab[] = [...tplActive, ...(push ? (['push'] as const) : [])]
  const isOn = (k: Tab) => (k === 'push' ? !!push : !!channels[k])
  const pushProblem = push ? pushCopyProblem(push) : null
  const ready = active.length > 0 && tplActive.every(k => channels[k]!.slug) && !pushProblem
  // Email can be left empty in step 1 — step 2's AI Assist writes it.
  const step1Ready = active.length > 0 && tplActive.every(k => k === 'email' || channels[k]!.slug)

  // What the send stores: shared named vars for email/SMS, numbered slots for WhatsApp, push copy.
  const payloadChannels = useMemo<Payload>(() => {
    const out: Payload = {}
    if (channels.email?.slug) out.email = { slug: channels.email.slug, vars, ...(subject ? { subject } : {}) }
    if (channels.sms?.slug) out.sms = { slug: channels.sms.slug, vars }
    if (channels.whatsapp?.slug)
      out.whatsapp = {
        slug: channels.whatsapp.slug,
        vars: waVars,
        ...(waMedia ? { media_url: waMedia } : {}),
        ...(waLink ? { button_url: waLink } : {}),
      }
    if (push) out.push = push
    return out
  }, [channels, vars, waVars, waMedia, waLink, subject, push])

  useEffect(() => {
    fetch('/api/admin/review-forms?page=1')
      .then(r => r.json())
      .then(d => setReviewForms(d.forms || []))
      .catch(() => {})
    fetch('/api/admin/customer-tag-definitions', { credentials: 'include' })
      .then(r => (r.ok ? r.json() : null))
      .then(d => setTagDefs((d?.definitions || []).map((x: { tag: string }) => x.tag)))
      .catch(() => {})
    const fromUrl = new URLSearchParams(window.location.search).get('draftId')
    if (fromUrl) {
      localStorage.setItem(DRAFT_STORAGE_KEY, fromUrl)
      void restoreDraftFromId(fromUrl)
      return
    }
    if (localStorage.getItem(DRAFT_STORAGE_KEY)) setShowRestoreBanner(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    draftIdRef.current = draftId
  }, [draftId])

  const buildAudienceFilter = useCallback((): Record<string, unknown> => {
    if (audienceType === 'order_history') return { daysSinceOrder: parseInt(daysSinceOrder, 10) || 30 }
    if (audienceType === 'segment') return { segment }
    if (audienceType === 'tag') return { tags: selectedTags }
    if (audienceType === 'specific_user') return { userId: specificUser?.id }
    return {}
  }, [audienceType, daysSinceOrder, segment, selectedTags, specificUser])

  // Picked templates' current content (drives the variable inputs and previews).
  const slugKey = tplActive.map(k => `${k}:${channels[k]?.slug ?? ''}`).join('|')
  useEffect(() => {
    let live = true
    for (const k of tplActive) {
      const slug = channels[k]?.slug
      if (!slug || loaded[k]?.slug === slug) continue
      fetch(`/api/admin/messaging-templates/${k}/${encodeURIComponent(slug)}`)
        .then(r => (r.ok ? r.json() : null))
        .then(a => {
          if (!live || !a) return
          const v = a.current_version ?? {}
          setLoaded(p => ({
            ...p,
            [k]: {
              slug,
              subject: v.subject ?? null,
              body: v.body ?? '',
              approval_status: a.approval_status ?? null,
              blocks: v.blocks ?? null,
            },
          }))
        })
        .catch(() => {})
    }
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slugKey])

  const fields = useMemo(
    () =>
      namedVars(
        channels.email ? loaded.email?.subject : '',
        channels.email ? loaded.email?.body : '',
        channels.sms ? loaded.sms?.body : ''
      ),
    [channels.email, channels.sms, loaded]
  )
  const slots = channels.whatsapp && loaded.whatsapp ? waSlots(loaded.whatsapp.body) : []
  const waP = useMemo(
    () => (channels.whatsapp && loaded.whatsapp ? waParams(loaded.whatsapp.body, loaded.whatsapp.blocks) : null),
    [channels.whatsapp, loaded.whatsapp]
  )

  const triggerAutoSave = useCallback(() => {
    if (lockRef.current.readOnly) return
    if (autoSaveRef.current) clearTimeout(autoSaveRef.current)
    setSaveState('saving')
    autoSaveRef.current = setTimeout(async () => {
      if (lockRef.current.readOnly) return setSaveState('idle')
      try {
        const payload = {
          draft_id: draftIdRef.current,
          template_key: 'library',
          title: title || subject || 'Draft',
          subject,
          channels: payloadChannels,
          audience_type: audienceType,
          audience_filter: buildAudienceFilter(),
          scheduled_at: scheduledAt || null,
          wizard_step: step,
        }
        const res = await fetch('/api/admin/mailer/draft', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...lockHeaders('mailer', draftIdRef.current) },
          credentials: 'include',
          body: JSON.stringify(payload),
        })
        if (res.status === 423) {
          // Someone else holds the draft: stop autosaving; offer the edits only if this tab held it.
          setSaveState('locked')
          lockRef.current.markLocked(lockRef.current.isMine ? payload : undefined)
          return
        }
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
  }, [step, title, subject, payloadChannels, audienceType, buildAudienceFilter, scheduledAt])

  useEffect(() => {
    triggerAutoSave()
  }, [triggerAutoSave])

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
      const { push: savedPush, ...ch }: Payload = campaign.channels ?? {}
      if (campaign.template_key !== 'library' && LEGACY_SLUG[campaign.template_key]) {
        setChannels({ email: { slug: LEGACY_SLUG[campaign.template_key] } })
        setVars(campaign.template_data || {})
      } else {
        setChannels(ch)
        setPush(savedPush ?? null)
        setVars(ch.email?.vars ?? ch.sms?.vars ?? {})
        setWaVars(ch.whatsapp?.vars ?? {})
        setWaMedia(ch.whatsapp?.media_url ?? '')
        setWaLink(ch.whatsapp?.button_url ?? '')
      }
      setAudienceType(campaign.audience_type || 'all')
      const dso = campaign.audience_filter?.daysSinceOrder
      if (dso != null) setDaysSinceOrder(String(dso))
      if (campaign.audience_filter?.segment) setSegment(campaign.audience_filter.segment)
      if (Array.isArray(campaign.audience_filter?.tags)) setSelectedTags(campaign.audience_filter.tags)
      if (campaign.audience_filter?.userId)
        setSpecificUser({ id: campaign.audience_filter.userId, label: 'Selected customer' })
      if (campaign.scheduled_at) {
        const d = new Date(campaign.scheduled_at)
        const pad = (n: number) => String(n).padStart(2, '0')
        setScheduledAt(
          `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
        )
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

  // Read-only footer: owner roles may discard another admin's draft (audited server-side).
  async function discardLockedDraft() {
    if (!draftId) return
    const ok = await showConfirm({
      title: 'Discard this draft?',
      message: `${lock.lock?.ownerName ?? 'Another admin'} is editing it. It is deleted for everyone.`,
      confirmText: 'Discard',
      type: 'danger',
    })
    if (!ok) return
    const res = await fetch(`/api/admin/mailer/${draftId}`, { method: 'DELETE', credentials: 'include' })
    if (!res.ok) return setError((await res.json().catch(() => ({}))).error || 'Failed to discard the draft')
    localStorage.removeItem(DRAFT_STORAGE_KEY)
    router.push(ap('/admin/marketing/messaging'))
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
    return () => {
      if (previewDebounceRef.current) clearTimeout(previewDebounceRef.current)
    }
  }, [step, loadPreview, loaded])

  const audienceQuery = useCallback(
    () => JSON.stringify({ audience_type: audienceType, audience_filter: buildAudienceFilter(), push: !!push }),
    [audienceType, buildAudienceFilter, push]
  )
  // Recipients load 25 at a time; count/withPhone come with the first page.
  const audience = useInfiniteList<Recipient>({
    key: step === 3 ? audienceKey : null,
    pageSize: 25,
    fetchPage: async (p, signal) => {
      const body = { ...JSON.parse(audienceKey || '{}'), offset: (p - 1) * 25, limit: 25 }
      const data = await fetchJson('/api/admin/mailer/audience-preview', signal, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (p === 1) {
        setAudienceCount(data.count ?? 0)
        setWithPhone(data.withPhone ?? 0)
        setWithEmail(data.withEmail ?? data.count ?? 0)
        setPushReach(data.push ?? null)
      }
      return { rows: data.recipients || [], total: data.count ?? 0 }
    },
  })
  const audienceRecipients = audience.rows
  const audienceLoading = audience.loading
  const loadAudience = useCallback(() => setAudienceKey(audienceQuery()), [audienceQuery])

  useEffect(() => {
    if (step !== 3) return
    if (audienceDebounceRef.current) clearTimeout(audienceDebounceRef.current)
    audienceDebounceRef.current = setTimeout(loadAudience, 400)
    return () => {
      if (audienceDebounceRef.current) clearTimeout(audienceDebounceRef.current)
    }
  }, [step, loadAudience])

  // Live customer search for the "specific customer" audience.
  useEffect(() => {
    if (audienceType !== 'specific_user' || customerQuery.trim().length < 2) {
      setCustomerResults([])
      return
    }
    const t = setTimeout(() => {
      fetch(`/api/admin/customers/search?q=${encodeURIComponent(customerQuery.trim())}`, { credentials: 'include' })
        .then(r => (r.ok ? r.json() : null))
        .then(d => setCustomerResults(d?.results || []))
        .catch(() => {})
    }, 300)
    return () => clearTimeout(t)
  }, [audienceType, customerQuery])

  function toggleChannel(k: Tab) {
    if (k === 'push') return setPush(p => (p ? null : { title: '', body: '', link: '/' }))
    setChannels(p => {
      const n = { ...p }
      if (n[k]) delete n[k]
      else n[k] = { slug: '' }
      return n
    })
  }

  function pickTemplate(k: Channel, slug: string | null) {
    setChannels(p => ({ ...p, [k]: { slug: slug ?? '' } }))
    if (k === 'whatsapp') {
      setWaVars({})
      setWaMedia('')
      setWaLink('')
    }
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
        body: JSON.stringify({ scenario: scenarioPrompt, subject, variables: fields, campaign: true }),
      })
      const data = (await res.json()) as { html?: string; error?: string }
      if (!res.ok || !data.html) return setScenarioError(data.error || 'Generation failed')
      const h2 = data.html
        .match(/<h2[^>]*>(.*?)<\/h2>/i)?.[1]
        ?.replace(/<[^>]+>/g, '')
        .trim()
      const name = subject || h2 || scenarioPrompt.slice(0, 60)
      const slug = `messaging/ai-${Date.now().toString(36)}`
      const created = await fetch('/api/admin/messaging-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug,
          channel: 'email',
          name,
          category: 'messaging',
          subject: subject || h2 || name,
          body: data.html,
          blocks_format: 'tiptap-html',
          publish: true,
        }),
      })
      if (!created.ok) return setScenarioError('Generated, but saving it as a template failed')
      setChannels(p => ({ ...p, email: { slug } }))
      setLoaded(p => ({
        ...p,
        email: { slug, subject: subject || h2 || name, body: data.html!, approval_status: null },
      }))
      showToast('Saved as a new email template in your library.', 'success')
    } catch {
      setScenarioError('Network error')
    } finally {
      setScenarioLoading(false)
    }
  }

  // draftOnly: save and leave without scheduling (Save as Draft before the last step).
  async function handleSubmit(sendNow: boolean, draftOnly = false) {
    setSubmitting(true)
    setError('')
    try {
      const audienceFilter = buildAudienceFilter()
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
          headers: { 'Content-Type': 'application/json', ...lockHeaders('mailer', id) },
          credentials: 'include',
          body: JSON.stringify({ ...fields, scheduled_at: scheduledAt || null }),
        })
        await assertDraftResponse(r, 'Failed to update message')
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
      if (!draftOnly && (sendNow || scheduledAt)) {
        // Only the draft's holder may send it (423 otherwise).
        const sent = await fetch(`/api/admin/mailer/${id}/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...lockHeaders('mailer', id) },
          credentials: 'include',
          body: JSON.stringify(sendNow ? { dispatchNow: true } : { dispatchNow: false, scheduled_at: scheduledAt }),
        })
        await assertDraftResponse(sent, 'Failed to send message')
      }
      localStorage.removeItem(DRAFT_STORAGE_KEY)
      // Done editing: close the session so Cancel no longer reverts it.
      if (edit.sessionId) await edit.save().catch(() => false)
      router.push(ap('/admin/marketing/messaging'))
    } catch (err) {
      if (isDraftLockedError(err)) lock.markLocked()
      setError(isDraftLockedError(err) ? err.message : String(err))
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
        <div className="flex flex-wrap items-end gap-3 mb-6">
          <div className="flex-1 min-w-0 space-y-1.5">
            <BackLink href={ap('/admin/marketing/messaging')} label="Messaging" />
            <h1 className="text-2xl font-bold text-foreground">New message</h1>
            <p className="text-sm text-foreground-muted mt-0.5">
              Step {step} of 3 · {['Channels & templates', 'Content', 'Audience & schedule'][step - 1]}
            </p>
          </div>
        </div>

        <DraftLockBanner lock={lock} scope="mailer:write" className="mb-4" />

        {/* Read-only viewers step through the draft here; the step buttons are disabled for them. */}
        <div className="flex gap-1 mb-6 max-w-3xl">
          {[1, 2, 3].map(s => (
            <button
              key={s}
              type="button"
              aria-label={`Step ${s}`}
              disabled={!lock.readOnly}
              onClick={() => setStep(s)}
              className={`h-1.5 flex-1 rounded-full transition-colors ${s <= step ? 'bg-accent-500' : 'bg-border-default'}`}
            />
          ))}
        </div>

        {/* ── Step 1: channels + a library template per channel ── */}
        {step === 1 && (
          <LockedFieldset readOnly={lock.readOnly} className="max-w-3xl space-y-4">
            <p className="text-sm text-foreground-secondary">
              Pick one or more channels and a template for each from your{' '}
              <Link href={ap('/admin/marketing/messaging-templates')} className="text-accent-500 hover:underline">
                Templates
              </Link>{' '}
              library.
            </p>
            {CHANNELS.filter(c => shown(c.key)).map(c => {
              const on = isOn(c.key)
              const Icon = c.icon
              return (
                <div
                  key={c.key}
                  className={`rounded-lg border p-4 transition-colors ${on ? 'border-accent-500 bg-accent-50/40 dark:bg-accent-900/10' : 'border-border-default bg-surface-elevated'}`}
                >
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => toggleChannel(c.key)}
                      className="mt-1 text-accent-500"
                    />
                    <Icon className="w-4 h-4 mt-0.5 text-foreground-muted" />
                    <div>
                      <p className="font-medium text-sm text-foreground">{c.label}</p>
                      <p className="text-xs text-foreground-muted mt-0.5">{c.note}</p>
                    </div>
                  </label>
                  {on && c.key === 'push' && (
                    <p className="mt-2 pl-7 text-[11px] text-foreground-muted">Write the title, text and link in the next step.</p>
                  )}
                  {on && c.key !== 'push' && (
                    <div className="mt-3 pl-7">
                      <LibraryTemplatePicker
                        channel={c.key}
                        kind="messaging"
                        value={channels[c.key]!.slug || null}
                        onChange={slug => pickTemplate(c.key as Channel, slug)}
                        allowNone={false}
                      />
                      {c.key === 'email' && canUseAi && !channels.email?.slug && (
                        <p className="mt-1.5 text-[11px] text-foreground-muted">
                          Or leave it empty and write one with AI in the next step.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )
            })}

          </LockedFieldset>
        )}

        {/* ── Step 2: fill the templates' variables, edit them, preview ── */}
        {step === 2 && (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 xl:gap-8 items-start">
            <LockedFieldset readOnly={lock.readOnly} className="space-y-5">
              {canUseAi && channels.email && (
                <div className="bg-violet-500/5 border border-violet-500/40 rounded-lg p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-violet-500 shrink-0" />
                    <p className="text-sm font-semibold text-violet-700 dark:text-violet-400">
                      Write a new email with AI
                    </p>
                  </div>
                  <textarea
                    value={scenarioPrompt}
                    onChange={e => setScenarioPrompt(e.target.value)}
                    rows={2}
                    className={`${inputClass} resize-none`}
                    placeholder="e.g. 'Diwali sale 20% off power tools, CTA to /products' — saved as a new email template and used for this message"
                  />
                  <div className="flex items-center gap-2">
                    <RequireWrite scope="mailer:write">
                      <button
                        type="button"
                        onClick={generateFromScenario}
                        disabled={scenarioLoading || scenarioPrompt.trim().length < 10}
                        className="inline-flex items-center gap-2 px-4 h-control-sm bg-violet-500 hover:bg-violet-600 text-white rounded-lg font-medium text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {scenarioLoading ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Sparkles className="w-3.5 h-3.5" />
                        )}
                        {scenarioLoading ? 'Generating…' : 'Generate email'}
                      </button>
                    </RequireWrite>
                  </div>
                </div>
              )}
              <div>
                <label className={labelClass}>Title (internal)</label>
                <AIEnrichButton
                  fieldLabel="Internal title"
                  value={title}
                  onChange={setTitle}
                  scope="mailer:write"
                  write
                  context={`A short internal name for this message (channels: ${active.join(', ')}${channels.email?.slug ? `; email template ${channels.email.slug}` : ''}${subject ? `; subject "${subject}"` : ''}).`}
                >
                  <input
                    value={title}
                    onChange={e => setTitle(e.target.value)}
                    className={inputClass}
                    placeholder="e.g. May review push"
                  />
                </AIEnrichButton>
              </div>
              {channels.email && (
                <div>
                  <label className={labelClass}>Email subject</label>
                  <AIEnrichButton
                    fieldLabel="Email subject"
                    value={subject}
                    onChange={setSubject}
                    scope="mailer:write"
                    format="subject"
                    write
                    broadcast
                    variables={fields}
                    context={`Subject line for a broadcast email to customers.${loaded.email?.subject ? ` Template's default subject: "${loaded.email.subject}".` : ''}${
                      loaded.email?.body
                        ? ` Email text starts: "${loaded.email.body
                            .replace(/<[^>]+>/g, ' ')
                            .replace(/\s+/g, ' ')
                            .slice(0, 300)}"`
                        : ''
                    }`}
                  >
                    <input
                      value={subject}
                      onChange={e => setSubject(e.target.value)}
                      className={inputClass}
                      placeholder={
                        loaded.email?.subject ? `Template: ${loaded.email.subject}` : 'Subject line customers will see'
                      }
                    />
                  </AIEnrichButton>
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
                    setVars(p => ({
                      ...p,
                      formId: f.id,
                      formTitle: f.title,
                      formUrl: `https://${formsHostForHost(window.location.host)}/${f.slug}`,
                    }))
                  }}
                  disabled={reviewForms.length === 0}
                />
              )}

              {fields
                .filter(f => !(fields.includes('formUrl') && (f === 'formUrl' || f === 'formTitle')))
                .map(f => {
                  // Where the variable sits in each chosen message, so the value reads right in context.
                  const where = [
                    channels.email && usageContext(f, loaded.email?.subject, loaded.email?.body)
                      ? { ch: 'Email', ctx: usageContext(f, loaded.email?.subject, loaded.email?.body)! }
                      : null,
                    channels.sms && usageContext(f, loaded.sms?.body)
                      ? { ch: 'SMS', ctx: usageContext(f, loaded.sms?.body)! }
                      : null,
                  ].filter(Boolean) as Array<{ ch: string; ctx: string }>
                  return (
                    <div key={f}>
                      <label className={labelClass}>{humanize(f)}</label>
                      {where.map(w => (
                        <p key={w.ch} className="-mt-1 mb-1.5 text-[11px] text-foreground-muted">
                          {w.ch}: “{w.ctx}”
                        </p>
                      ))}
                      <VarInput
                        value={vars[f] ?? ''}
                        onChange={v => setVars(p => ({ ...p, [f]: v }))}
                        className={inputClass}
                        rows={/body|details|message/i.test(f) ? 4 : undefined}
                        ai={{
                          label: humanize(f),
                          variables: fields,
                          context: `Value for the {${f}} variable of a broadcast message.${where.length ? ` It appears here: ${where.map(w => `${w.ch}: "${w.ctx}"`).join('; ')}` : ''}`,
                        }}
                      />
                    </div>
                  )
                })}
              {fields.length > 0 && (
                <p className="text-[11px] text-foreground-muted">
                  Shared by email and SMS. The customer&apos;s name and your store details fill in automatically.
                </p>
              )}

              {channels.whatsapp && waP && (
                <WaParamsForm
                  params={waP}
                  vars={waVars}
                  setVars={setWaVars}
                  mediaUrl={waMedia}
                  setMediaUrl={setWaMedia}
                  linkUrl={waLink}
                  setLinkUrl={setWaLink}
                  inputClass={inputClass}
                />
              )}
              {waProblem && <p className="text-xs text-amber-700 dark:text-amber-400">{waProblem}</p>}

              {push && (
                <PushFields
                  value={push}
                  onChange={setPush}
                  inputClass={inputClass}
                  labelClass={labelClass}
                  context={title || subject || undefined}
                />
              )}
              {pushProblem && <p className="text-xs text-amber-700 dark:text-amber-400">{pushProblem}</p>}

              <div className="flex flex-wrap gap-2">
                {tplActive
                  .filter(k => k !== 'whatsapp')
                  .map(k => (
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
                  variableNames={fields}
                  channel={editing}
                  slug={channels[editing]!.slug}
                  onMirror={t =>
                    setLoaded(p => ({
                      ...p,
                      [editing]: {
                        slug: channels[editing]!.slug,
                        subject: t.subject ?? null,
                        body: t.body ?? '',
                        approval_status: null,
                      },
                    }))
                  }
                />
              )}

            </LockedFieldset>

            <div className="sticky top-6">
              <div className="flex gap-1 mb-2">
                {active.map(k => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setPreviewTab(k)}
                    className={`px-3 h-control-sm rounded-md text-xs font-medium ${previewTab === k || (!isOn(previewTab) && k === active[0]) ? 'bg-accent-500 text-white' : 'text-foreground-muted hover:bg-surface-secondary'}`}
                  >
                    {CHANNELS.find(c => c.key === k)!.label}
                  </button>
                ))}
              </div>
              {(isOn(previewTab) ? previewTab : active[0]) === 'email' && (
                <div
                  className="border border-border-default rounded-lg overflow-hidden bg-surface-elevated"
                  style={{ minHeight: '520px' }}
                >
                  {previewLoading ? (
                    <div className="flex items-center justify-center h-[520px] text-foreground-muted text-sm gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" /> Rendering…
                    </div>
                  ) : previewHtml ? (
                    <iframe
                      srcDoc={previewHtml}
                      className="w-full h-[600px] bg-surface-elevated"
                      title="Email preview"
                    />
                  ) : (
                    <div className="flex items-center justify-center h-[520px] text-foreground-muted text-sm">
                      Pick an email template to preview
                    </div>
                  )}
                </div>
              )}
              {(isOn(previewTab) ? previewTab : active[0]) === 'sms' && (
                <PhonePreview channel="sms" body={loaded.sms?.body ?? ''} vars={previewVars} />
              )}
              {(isOn(previewTab) ? previewTab : active[0]) === 'whatsapp' && (
                <WhatsAppPreview
                  value={{ slug: channels.whatsapp?.slug || null, variables: waVars }}
                  vars={previewVars}
                  mediaUrl={waMedia || null}
                />
              )}
              {(isOn(previewTab) ? previewTab : active[0]) === 'push' && push && (
                <PushPreview title={push.title} body={push.body} image={push.image_url} vars={previewVars} />
              )}
            </div>
          </div>
        )}

        {/* ── Step 3: audience + schedule ── */}
        {step === 3 && (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 xl:gap-8 items-start">
            <LockedFieldset readOnly={lock.readOnly} className="space-y-5">
              <AdminSelect
                label="Audience"
                options={AUDIENCE_OPTIONS}
                value={audienceType}
                onChange={setAudienceType}
              />
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
              {audienceType === 'segment' && (
                <AdminSelect label="Segment" options={SEGMENT_OPTIONS} value={segment} onChange={setSegment} />
              )}
              {audienceType === 'tag' && (
                <div>
                  <label className={labelClass}>
                    CRM tags {selectedTags.length > 0 && `(${selectedTags.length} selected)`}
                  </label>
                  {tagDefs.length === 0 ? (
                    <p className="text-xs text-foreground-muted">
                      No customer tags defined yet — add them in Customers → settings.
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {tagDefs.map(t => {
                        const on = selectedTags.includes(t)
                        return (
                          <button
                            key={t}
                            type="button"
                            onClick={() => setSelectedTags(p => (on ? p.filter(x => x !== t) : [...p, t]))}
                            className={`px-2.5 h-control-sm rounded-full text-xs font-semibold border transition-colors ${on ? 'bg-accent-500 border-accent-500 text-white' : 'border-border-default text-foreground hover:bg-surface-secondary'}`}
                          >
                            {t}
                          </button>
                        )
                      })}
                    </div>
                  )}
                  <p className="mt-1.5 text-[11px] text-foreground-muted">
                    Customers carrying any selected tag are included.
                  </p>
                </div>
              )}
              {audienceType === 'specific_user' && (
                <div>
                  <label className={labelClass}>Find a customer</label>
                  {specificUser ? (
                    <div className="flex items-center gap-2">
                      <span className="px-3 h-control inline-flex items-center rounded-lg border border-border-default bg-surface-secondary text-sm">
                        {specificUser.label}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setSpecificUser(null)
                          setCustomerQuery('')
                        }}
                        className="text-xs text-accent-500 hover:underline"
                      >
                        Change
                      </button>
                    </div>
                  ) : (
                    <div className="relative">
                      <input
                        value={customerQuery}
                        onChange={e => setCustomerQuery(e.target.value)}
                        placeholder="Name, email or phone"
                        className={inputClass}
                      />
                      {customerResults.length > 0 && (
                        <div className="absolute z-20 mt-1 w-full max-h-56 overflow-y-auto rounded-lg border border-border-default bg-surface-elevated shadow-lg">
                          {customerResults.map(c => (
                            <button
                              key={c.id}
                              type="button"
                              onClick={() => {
                                setSpecificUser({ id: c.id, label: `${c.full_name || c.email} · ${c.email}` })
                                setCustomerResults([])
                              }}
                              className="flex w-full flex-col items-start px-3 py-2 text-left hover:bg-surface-secondary"
                            >
                              <span className="text-sm text-foreground">{c.full_name || c.email}</span>
                              <span className="text-xs text-foreground-muted">{c.email}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
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
              <p className="text-xs text-foreground-muted">Customers who opted out of marketing are never messaged.</p>
              {push && (
                <p className="text-xs text-foreground-muted">
                  App pushes go to installs that allow offers. A phone in quiet hours (00:00–09:00 its time) gets it when they
                  end, and nobody gets more than 2 offer pushes a day across messages and campaigns.
                </p>
              )}
              {scheduledAt && (
                <p className="text-xs text-foreground-muted">
                  Sending at{' '}
                  {new Date(scheduledAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                </p>
              )}
            </LockedFieldset>

            <div className="sticky top-6">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-medium text-foreground-muted uppercase tracking-wide">Recipients</p>
                {audienceCount !== null && !audienceLoading && (
                  <span className="text-xs font-semibold text-accent-500">
                    {[
                      channels.email && `${withEmail.toLocaleString()} email`,
                      (channels.sms || channels.whatsapp) && `${withPhone.toLocaleString()} with a phone`,
                      push &&
                        pushReach &&
                        `${pushReach.devices.toLocaleString()} app devices${pushReach.signedOut ? ` (${pushReach.signedOut.toLocaleString()} signed out)` : ''}`,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                )}
              </div>
              <div
                className="border border-border-default rounded-lg overflow-hidden bg-surface-elevated"
                style={{ minHeight: '400px' }}
              >
                {audienceLoading && (
                  <div className="flex items-center justify-center h-[400px] text-foreground-muted text-sm gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" /> Loading…
                  </div>
                )}
                {!audienceLoading && audienceRecipients.length === 0 && audienceCount !== null && (
                  <div className="flex items-center justify-center h-[400px] text-foreground-muted text-sm">
                    No customers match this filter
                  </div>
                )}
                {!audienceLoading && audienceRecipients.length > 0 && (
                  <div className="overflow-y-auto divide-y divide-border-default" style={{ maxHeight: '520px' }}>
                    {audienceRecipients.map((r, i) => (
                      <div key={i} className="flex items-center gap-3 px-4 py-2.5">
                        <div className="w-7 h-7 rounded-full bg-accent-100 dark:bg-accent-900/30 flex items-center justify-center shrink-0">
                          <span className="text-xs font-semibold text-accent-500">
                            {(r.first_name?.[0] || r.email?.[0] || '?').toUpperCase()}
                          </span>
                        </div>
                        <div className="min-w-0 flex-1">
                          {r.first_name && (
                            <p className="text-sm font-medium text-foreground truncate">{r.first_name}</p>
                          )}
                          <p className="text-xs text-foreground-muted truncate">{r.email || r.phone || 'No email or phone'}</p>
                        </div>
                        {(channels.sms || channels.whatsapp) && (
                          <span
                            className={`text-[10px] ${r.phone ? 'text-foreground-muted' : 'text-amber-700 dark:text-amber-400'}`}
                          >
                            {r.phone || 'no phone'}
                          </span>
                        )}
                      </div>
                    ))}
                    <InfiniteFooter shown={audienceRecipients.length} control={audience} noun="recipients" className="pb-3" />
                  </div>
                )}
                {!audienceLoading && !audienceRecipients.length && audience.error && (
                  <div className="p-4">
                    <InfiniteFooter shown={0} control={audience} />
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* The composer's only action bar: every step's Back / Save as Draft / Continue / Send. */}
        <FormFooter
          lock={lock}
          autosave={draftId ? (saveState as AutosaveStatus) : undefined}
          banner={showRestoreBanner ? 'You have an unsaved message from before.' : undefined}
          restore={
            showRestoreBanner
              ? () => {
                  const id = localStorage.getItem(DRAFT_STORAGE_KEY)
                  if (id) void restoreDraftFromId(id)
                }
              : undefined
          }
          secondary={
            showRestoreBanner ? (
              <button type="button" onClick={discardDraft} className="text-xs font-medium text-foreground-muted hover:text-foreground">
                Dismiss
              </button>
            ) : undefined
          }
          discard={lock.readOnly ? discardLockedDraft : undefined}
          cancel={
            edit.sessionId
              ? async () => {
                  if (await edit.cancel()) router.push(ap('/admin/marketing/messaging'))
                }
              : undefined
          }
          cancelHref={ap('/admin/marketing/messaging')}
        >
          {step > 1 && (
            <FormButton type="button" variant="secondary" onClick={() => setStep(step - 1)}>
              Back
            </FormButton>
          )}
          <RequireWrite scope="mailer:write">
            {step < 3 ? (
              <>
                <FormButton type="button" variant="secondary" onClick={() => handleSubmit(false, true)} disabled={submitting}>
                  {submitting ? 'Saving…' : 'Save as Draft'}
                </FormButton>
                <FormButton type="button" onClick={() => setStep(step + 1)} disabled={step === 1 ? !step1Ready : !ready}>
                  Continue
                </FormButton>
              </>
            ) : (
              <>
                <FormButton type="button" variant="secondary" onClick={() => handleSubmit(false)} disabled={submitting}>
                  {submitting ? '…' : scheduledAt ? 'Schedule' : 'Save as Draft'}
                </FormButton>
                <FormButton type="button" onClick={() => handleSubmit(true)} disabled={submitting || !!scheduledAt || !ready}>
                  {submitting ? 'Queuing…' : 'Send now'}
                </FormButton>
              </>
            )}
          </RequireWrite>
        </FormFooter>
      </div>
    </MobileEditBlock>
  )
}
