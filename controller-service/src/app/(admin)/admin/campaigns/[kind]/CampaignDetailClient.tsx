'use client'

import {
  CAMPAIGN_SAMPLE_VARS as SAMPLE_VARS,
  renderPreviewTemplate as renderTemplate,
} from '@/lib/templates/email-preview'
import { useCallback, useEffect, useState } from 'react'
import { CampaignDetailSkeleton } from '@/components/admin/campaigns/CampaignSkeletons'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ap } from '@/lib/shared/admin-path'
import { useToast } from '@/contexts/ToastContext'
import { useConfirm } from '@/contexts/ConfirmContext'
import EmailComposer from '@/components/admin/email-composer/EmailComposer'
import EmailBlockBuilder from '@/components/admin/email-composer/EmailBlockBuilder'
import { EMAIL_LAYOUT_OPTIONS, layoutStarterBody, renderLayoutPreview } from '@/lib/templates/email-layouts'
import type { EmailBlock } from '@/lib/templates/blocks'
import { renderBlocks } from '@/lib/templates/blocks'
import CampaignVariables from '@/components/admin/campaigns/CampaignVariables'
import { campaignVariables } from '@/lib/campaigns/kind-variables'
import AdminSelect, { type SelectOption } from '@/components/admin/AdminSelect'
import Toggle from '@/components/ui/Toggle'
import AIEnrichButton from '@/components/admin/AIEnrichButton'
import { campaignSupportsWhatsApp } from '@/lib/campaigns/whatsapp-kinds'
import WhatsAppTemplateEditor, { WhatsAppPreview } from '@/components/admin/campaigns/WhatsAppTemplateEditor'
import { PushFields, PushPreview } from '@/components/admin/campaigns/PushEditor'
import { campaignSupportsPush, defaultPushCopy, scenarioPushCopy } from '@/lib/campaigns/push-kinds'
import { pushCopyProblem } from '@/lib/push/copy'
import DurationField from '@/components/admin/campaigns/DurationField'
import type { DurationUnit } from '@/lib/campaigns/duration'
import { RequireWrite, RequireAi } from '@/contexts/AdminScopesContext'
import { useEditSession } from '@/hooks/useEditSession'
import LibraryTemplatePicker from '@/components/admin/messaging-templates/LibraryTemplatePicker'
import LinkedTemplateEditor from '@/components/admin/messaging-templates/LinkedTemplateEditor'
import type { EditorTemplate } from '@/components/admin/messaging-templates/TemplateEditor'
import { bridgeVars, campaignCanFill } from '@/lib/templates/var-bridge'
import { Badge, DraftLockBanner, FormFooter, LockedFieldset } from '@/components/admin/kit'
import { resnapshotCampaignSession } from './edit/actions'
import { useDraftLock } from '@/hooks/useDraftLock'
import { assertDraftResponse, isDraftLockedError, lockHeaders } from '@/lib/client/draft-lock-client'

interface Campaign {
  kind: string
  name: string
  description: string | null
  enabled: boolean
  delay_hours: number
  discount_percent: number
  coupon_id: string | null
  scenario_kind: string | null
  subject_template: string
  body_template: string
  last_run_at: string | null
  parameters: Record<string, number | boolean | string> | null
  draft_campaign_id?: string | null
  draft_fields?: Record<string, unknown> | null
}

interface ParamDef {
  type: 'integer' | 'float' | 'number' | 'boolean' | 'duration'
  min?: number
  max?: number
  label: string
  description?: string
  recommendedUnit?: DurationUnit
  allowedUnits?: DurationUnit[]
}

interface ScenarioOption {
  kind: string
  name: string
  description: string
  default_parameters?: Record<string, number | boolean | string>
  param_schema?: Record<string, ParamDef>
}

interface CouponOption {
  id: string
  code: string
  discount_type: string
  discount_value: number
  description: string | null
}

export default function CampaignDetailClient({ kind }: { kind: string }) {
  const router = useRouter()
  const { showToast } = useToast()
  const confirm = useConfirm()
  const [campaign, setCampaign] = useState<Campaign | null>(null)
  const [draftCampaignId, setDraftCampaignId] = useState<string | null>(null)
  const lock = useDraftLock({ resourceType: 'campaign', resourceId: draftCampaignId })
  const edit = useEditSession({ resourceType: 'campaign', resourceId: draftCampaignId, lock })
  const [loading, setLoading] = useState(true)
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiGenerating, setAiGenerating] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [hasDraft, setHasDraft] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [testEmail, setTestEmail] = useState('')
  const [testBusy, setTestBusy] = useState(false)
  const [coupons, setCoupons] = useState<CouponOption[]>([])
  const [scenarios, setScenarios] = useState<ScenarioOption[]>([])
  // The linked library email as edited (the preview and checks read it instead of the inline fields).
  const [linkedEmail, setLinkedEmail] = useState<EditorTemplate | null>(null)
  const [form, setForm] = useState<{
    enabled: boolean
    delay_hours: number
    discount_percent: number
    coupon_id: string | null
    scenario_kind: string | null
    subject_template: string
    body_template: string
    template_layout: string
    template_mode: 'richtext' | 'blocks'
    blocks: EmailBlock[]
    sms_template: string
    wa_template_sid: string | null
    wa_variables: Record<string, string>
    wa_header_image_url: string
    email_template_slug: string | null
    sms_template_slug: string | null
    wa_template_slug: string | null
    parameters: Record<string, number | boolean | string>
  } | null>(null)

  async function load() {
    setLoading(true)
    try {
      const [campaignRes, couponsRes, scenariosRes] = await Promise.all([
        fetch(`/api/admin/campaigns/${kind}`, { credentials: 'include' }),
        fetch('/api/admin/campaigns/coupons', { credentials: 'include' }),
        fetch('/api/admin/campaigns/scenarios', { credentials: 'include' }),
      ])
      if (campaignRes.ok) {
        const data = await campaignRes.json()
        setCampaign(data.campaign)
        setDraftCampaignId(data.campaign.draft_campaign_id || null)
        const draft = data.campaign.draft_fields
        setHasDraft(!!draft)
        const src = draft || data.campaign
        setForm({
          enabled: src.enabled ?? data.campaign.enabled,
          delay_hours: src.delay_hours ?? data.campaign.delay_hours,
          discount_percent: src.discount_percent ?? data.campaign.discount_percent,
          coupon_id: src.coupon_id || null,
          scenario_kind: src.scenario_kind || null,
          subject_template: src.subject_template ?? data.campaign.subject_template,
          body_template: src.body_template ?? data.campaign.body_template,
          template_layout: src.template_layout ?? data.campaign.template_layout ?? 'classic',
          template_mode: (src.template_mode ?? data.campaign.template_mode ?? 'richtext') as 'richtext' | 'blocks',
          blocks: (src.blocks ?? data.campaign.blocks ?? []) as EmailBlock[],
          sms_template: src.sms_template ?? data.campaign.sms_template ?? '',
          wa_template_sid: src.wa_template_sid ?? data.campaign.wa_template_sid ?? null,
          wa_variables: (src.wa_variables ?? data.campaign.wa_variables ?? {}) as Record<string, string>,
          wa_header_image_url: src.wa_header_image_url ?? data.campaign.wa_header_image_url ?? '',
          // A draft can unlink (null), so 'in' — not ?? — decides whether the draft set it.
          email_template_slug:
            ('email_template_slug' in src ? src.email_template_slug : data.campaign.email_template_slug) ?? null,
          sms_template_slug:
            ('sms_template_slug' in src ? src.sms_template_slug : data.campaign.sms_template_slug) ?? null,
          wa_template_slug: ('wa_template_slug' in src ? src.wa_template_slug : data.campaign.wa_template_slug) ?? null,
          parameters: (src.parameters || {}) as Record<string, number | boolean | string>,
        })
      }
      if (couponsRes.ok) {
        const cd = await couponsRes.json()
        setCoupons(cd.coupons || [])
      }
      if (scenariosRes.ok) {
        const sd = await scenariosRes.json()
        setScenarios(sd.scenarios || [])
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind])

  const [autoSaveStatus, setAutoSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error' | 'locked'>('idle')
  const [baseline, setBaseline] = useState<string | null>(null)

  const writeDraft = useCallback(
    async (f: NonNullable<typeof form>) => {
      const res = await fetch(`/api/admin/campaigns/${kind}/draft`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...lockHeaders('campaign', draftCampaignId) },
        credentials: 'include',
        body: JSON.stringify(f),
      })
      await assertDraftResponse(res, 'Failed to save draft')
      setHasDraft(true)
    },
    [kind, draftCampaignId]
  )

  // Opening the editor starts a draft (from the live values if there is none); every change autosaves it.
  useEffect(() => {
    if (!form || !campaign || lock.readOnly || autoSaveStatus === 'locked') return
    const cur = JSON.stringify(form)
    if (baseline === null) {
      setBaseline(cur)
      if (!hasDraft && !lock.readOnly) writeDraft(form).catch(e => isDraftLockedError(e) && lock.markLocked())
      return
    }
    if (cur === baseline) return
    const t = setTimeout(async () => {
      setAutoSaveStatus('saving')
      try {
        await writeDraft(form)
        setBaseline(cur)
        setAutoSaveStatus('saved')
        setTimeout(() => setAutoSaveStatus('idle'), 1500)
      } catch (e: any) {
        if (isDraftLockedError(e)) {
          // Someone else holds the draft: stop autosaving and go read-only.
          setAutoSaveStatus('locked')
          lock.markLocked(form)
          return
        }
        setAutoSaveStatus('error')
        showToast(e.message || 'Auto-save failed', 'error')
      }
    }, 700)
    return () => clearTimeout(t)
  }, [form, baseline, campaign, hasDraft, writeDraft, showToast, lock, autoSaveStatus])

  async function save() {
    if (!form) return
    setSaving(true)
    try {
      await writeDraft(form)
      // Session stays OPEN on Save as Draft; resnapshot so a later Cancel reverts to this
      // just-saved A2 state, not the pre-session A1 snapshot.
      await resnapshotCampaignSession(kind)
      showToast('Draft saved', 'success')
      router.push(ap('/admin/campaigns'))
    } catch (e: any) {
      if (isDraftLockedError(e)) lock.markLocked(form)
      showToast(e.message || 'Failed to save draft', 'error')
    } finally {
      setSaving(false)
    }
  }

  // Publishes exactly what is on screen.
  async function publish() {
    if (!form) return
    setPublishing(true)
    try {
      await writeDraft(form)
      const res = await fetch(`/api/admin/campaigns/${kind}/publish`, {
        method: 'POST',
        credentials: 'include',
        headers: lockHeaders('campaign', draftCampaignId),
      })
      if (res.status === 423) lock.markLocked()
      if (res.ok) {
        setHasDraft(false)
        if (edit.sessionId) await edit.save()
        showToast('Campaign published', 'success')
        router.push(ap(`/admin/campaigns/${kind}/view`))
      } else {
        const data = await res.json().catch(() => ({}))
        showToast(data.error || 'Failed to publish', 'error')
      }
    } catch (e: any) {
      if (isDraftLockedError(e)) lock.markLocked(form)
      showToast(e.message || 'Failed to publish', 'error')
    } finally {
      setPublishing(false)
    }
  }

  async function discardDraft() {
    const ok = await confirm({
      title: 'Discard draft?',
      message: 'All unpublished changes to this campaign are removed. The live campaign stays as-is.',
      confirmLabel: 'Discard',
      variant: 'danger',
    })
    if (!ok) return
    const res = await fetch(`/api/admin/campaigns/${kind}/draft`, { method: 'DELETE', credentials: 'include' })
    if (res.status === 423) {
      showToast((await res.json().catch(() => ({}))).error || 'Someone else is editing this draft', 'error')
      lock.markLocked()
      return
    }
    if (res.ok) {
      if (edit.sessionId) await edit.save()
      showToast('Draft discarded', 'success')
      router.push(ap('/admin/campaigns'))
    }
  }

  async function sendTest() {
    if (!testEmail.trim()) return
    setTestBusy(true)
    try {
      const res = await fetch(`/api/admin/campaigns/${kind}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: testEmail.trim() }),
      })
      const data = await res.json()
      showToast(
        res.ok ? `Test email sent to ${testEmail}` : data.error || 'Failed to send',
        res.ok ? 'success' : 'error'
      )
    } finally {
      setTestBusy(false)
    }
  }

  async function generateWithAI() {
    if (!aiPrompt.trim() || !form) return
    setAiGenerating(true)
    setAiError(null)
    try {
      const sk = form.scenario_kind || campaign?.kind
      const sc = scenarios.find(s => s.kind === sk)
      const res = await fetch('/api/admin/campaigns/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          prompt: aiPrompt.trim(),
          campaignName: campaign?.name,
          scenarioKind: sk || null,
          scenarioName: sc?.name || null,
          scenarioDescription: sc?.description || null,
          scenarioTrigger: (sc as any)?.trigger || null,
          discountPercent: form.discount_percent || 0,
        }),
      })
      const data = await res.json()
      if (res.ok) {
        setForm(f => (f ? { ...f, subject_template: data.subject_template, body_template: data.body_template } : f))
        showToast('Template updated', 'success')
      } else {
        setAiError(data.error || 'Generation failed')
      }
    } catch {
      setAiError('Generation failed — please try again')
    } finally {
      setAiGenerating(false)
    }
  }

  // Skeleton only on first load; refetches after save keep the page rendered.
  if (!campaign || !form)
    return loading ? <CampaignDetailSkeleton /> : <p className="text-sm text-foreground-muted">Campaign not found.</p>

  const couponOptions: SelectOption[] = [
    { value: '', label: 'None — use discount % to auto-generate' },
    ...coupons.map(c => ({
      value: c.id,
      label: `${c.code} — ${c.discount_type === 'percentage' ? `${c.discount_value}% off` : `₹${c.discount_value} off`}${c.description ? ` (${c.description})` : ''}`,
    })),
  ]

  const isSeededCampaign = scenarios.some(s => s.kind === campaign.kind)
  const currentScenario = scenarios.find(s => s.kind === form.scenario_kind)
  const scenarioOptions: SelectOption[] = [
    { value: '', label: 'None — manual / no automated trigger' },
    ...scenarios.map(s => ({ value: s.kind, label: `${s.name} — ${s.description}` })),
  ]

  const selectedCoupon = coupons.find(c => c.id === form.coupon_id)
  const previewVars = selectedCoupon
    ? {
        ...SAMPLE_VARS,
        couponCode: selectedCoupon.code,
        discountPercent: selectedCoupon.discount_type === 'percentage' ? selectedCoupon.discount_value : 0,
      }
    : SAMPLE_VARS
  const linked = form.email_template_slug && linkedEmail ? linkedEmail : null
  const varsKind = form.scenario_kind || kind
  // Editing a preset's body makes it a Custom template (so edits aren't mislabeled).
  const setBody = (v: string) =>
    setForm(f =>
      f
        ? {
            ...f,
            body_template: v,
            template_layout:
              v !== layoutStarterBody(f.template_layout) && f.template_layout !== 'custom' ? 'custom' : f.template_layout,
          }
        : f
    )
  const composerVars = campaignVariables(varsKind, 'email').map(v => ({
    key: v.key,
    label: v.label,
    description: v.description,
    sample: v.sample,
    group: 'order' as const,
    builtIn: true,
    section: 'Campaign',
  }))
  const linkedBlocks =
    linked?.blocks_format === 'email-blocks' ? ((linked.blocks as any)?.blocks as EmailBlock[] | undefined) : undefined
  const bridgedPreview = bridgeVars(previewVars as Record<string, string | number>)
  const previewSubject = renderTemplate(linked ? (linked.subject ?? '') : form.subject_template, bridgedPreview)
  const previewBodySource = linked
    ? linkedBlocks?.length
      ? renderBlocks(linkedBlocks)
      : linked.body
    : form.template_mode === 'blocks' && form.blocks?.length
      ? renderBlocks(form.blocks)
      : form.body_template
  const previewBody = renderTemplate(previewBodySource, bridgedPreview)
  const pushOn = campaignSupportsPush(varsKind) && !!form.parameters?.pushEnabled
  const pushDefault = defaultPushCopy(varsKind)
  const pushParam = (k: string) => (typeof form.parameters?.[k] === 'string' ? String(form.parameters[k]) : undefined)
  const pushSent = scenarioPushCopy(varsKind, form.parameters)
  const pushProblem = pushOn ? pushCopyProblem({ ...pushSent, link: pushSent.link || undefined }) : null
  const pushLinkDefault =
    varsKind === 'review_request' ? 'the order page' : pushDefault.link || 'the product page'
  const pushVars = {
    ...previewVars,
    items: 'Sample Product and 1 more',
    headline: `${SAMPLE_VARS.productName} is now ₹${SAMPLE_VARS.newPrice}`,
  }
  // Full themed document for the preview iframe, so the selected layout (Fresh vs Promo…) renders
  // with its own shell + CSS. renderLayoutPreview also fills {store_name}/{store_web} via previewVars.
  const previewDoc = renderTemplate(renderLayoutPreview(form.template_layout, previewBody), bridgedPreview)

  const SINGLE_PRODUCT_KINDS = new Set(['restock', 'price_drop'])
  const MULTI_PRODUCT_KINDS = new Set([
    'abandoned_cart',
    'abandoned_checkout',
    'post_purchase',
    'review_reminder',
    'winback_90',
    'winback_180',
  ])
  const refKind = (form.scenario_kind || campaign?.kind || '').toLowerCase()
  const tplWarning = (() => {
    const b = previewBodySource || ''
    const hasCard = /\{productCard\}/.test(b)
    const hasItems = /\{itemsHtml\}/.test(b) || /\{cartItems\}/.test(b)
    const usesProductTokens = /\{(productName|productImageUrl|oldPrice|newPrice|itemCount)\}/i.test(b)
    if (SINGLE_PRODUCT_KINDS.has(refKind) && !hasCard)
      return 'This is a single-product scenario — body MUST include {productCard} so an image renders.'
    if (MULTI_PRODUCT_KINDS.has(refKind) && !hasItems)
      return 'This is a multi-product scenario — body MUST include {itemsHtml} so the gallery renders.'
    if (usesProductTokens && !hasCard && !hasItems)
      return 'Body uses product tokens but has no {productCard} or {itemsHtml} — the email will render without an image.'
    return null
  })()

  return (
    <div className="space-y-5">
      <DraftLockBanner lock={lock} scope="campaigns:write" />
      <LockedFieldset readOnly={lock.readOnly} className="space-y-5">
        <RequireWrite scope="campaigns:write">
          <RequireAi scope="mailer:write">
            <div className="bg-surface-elevated rounded-xl border border-border-default p-5 space-y-3">
              <p className="text-xs font-semibold text-foreground-muted uppercase tracking-wide">
                Regenerate template with AI
              </p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={aiPrompt}
                  onChange={e => setAiPrompt(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && generateWithAI()}
                  placeholder="Describe changes you want to the email…"
                  className="field-normal flex-1 border border-border-secondary bg-surface text-foreground focus:outline-none focus:ring-2 focus:ring-accent-500"
                />
                <button
                  type="button"
                  onClick={generateWithAI}
                  disabled={aiGenerating || !aiPrompt.trim()}
                  className="px-4 h-control-sm bg-secondary-500 hover:bg-secondary-600 text-white rounded-lg text-sm font-semibold transition-all active:scale-95 disabled:opacity-50 shrink-0"
                >
                  {aiGenerating ? 'Generating…' : 'Generate'}
                </button>
              </div>
              {aiError && <p className="text-xs text-red-600 dark:text-red-400">{aiError}</p>}
              <p className="text-[10px] text-foreground-muted">
                AI will rewrite the subject and body. Your other settings are untouched.
              </p>
            </div>
          </RequireAi>
        </RequireWrite>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="bg-surface-elevated rounded-xl border border-border-default p-5">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <h2 className="text-xl font-bold text-foreground">{campaign.name}</h2>
                {campaign.description && (
                  <p className="text-sm text-foreground-secondary mt-1">{campaign.description}</p>
                )}
              </div>
              <Toggle
                checked={form.enabled}
                onChange={v => setForm({ ...form, enabled: v })}
                label={form.enabled ? 'Active' : 'Paused'}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-5">
              <div>
                <label className="block text-xs font-semibold text-foreground-muted uppercase tracking-wide mb-1">
                  Delay (hours)
                </label>
                <input
                  type="number"
                  min={0}
                  max={720}
                  value={form.delay_hours}
                  onChange={e => setForm({ ...form, delay_hours: parseInt(e.target.value || '0', 10) })}
                  className="field-normal w-full border border-border-secondary bg-surface text-foreground focus:outline-none focus:ring-2 focus:ring-accent-500"
                />
                <p className="text-[10px] text-foreground-muted mt-1">Hours after the trigger before sending</p>
              </div>
              <div>
                <label className="block text-xs font-semibold text-foreground-muted uppercase tracking-wide mb-1">
                  Discount %
                </label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={form.discount_percent}
                  onChange={e => setForm({ ...form, discount_percent: parseInt(e.target.value || '0', 10) })}
                  className="field-normal w-full border border-border-secondary bg-surface text-foreground focus:outline-none focus:ring-2 focus:ring-accent-500"
                />
                <p className="text-[10px] text-foreground-muted mt-1">
                  Auto-generates a unique per-user coupon if no coupon is assigned below
                </p>
              </div>
            </div>

            <div className="mt-4">
              <label className="block text-xs font-semibold text-foreground-muted uppercase tracking-wide mb-1">
                Assign coupon
              </label>
              <AdminSelect
                value={form.coupon_id || ''}
                options={couponOptions}
                onChange={v => setForm({ ...form, coupon_id: v || null })}
                sm
              />
              {selectedCoupon && (
                <p className="text-[10px] text-accent-500 mt-1">
                  This coupon will be injected as {'{couponCode}'} in the template for all recipients.
                </p>
              )}
            </div>

            <div className="mt-4">
              <label className="block text-xs font-semibold text-foreground-muted uppercase tracking-wide mb-1">
                Email template
              </label>
              <LibraryTemplatePicker
                channel="email"
                kind={form.scenario_kind || kind}
                value={form.email_template_slug}
                onChange={slug => {
                  setLinkedEmail(null)
                  setForm(f => (f ? { ...f, email_template_slug: slug } : f))
                }}
                noneLabel="Inline email (written only for this campaign)"
                supplied={campaignCanFill}
              />
            </div>

            {form.email_template_slug ? (
              <>
                <div className="mt-4">
                  <LinkedTemplateEditor
                    channel="email"
                    slug={form.email_template_slug}
                    currentKind={kind}
                    campaignKind={varsKind}
                    onMirror={setLinkedEmail}
                  />
                </div>
                <div className="mt-4">
                  <label className="block text-xs font-semibold text-foreground-muted uppercase tracking-wide mb-1">
                    Theme
                  </label>
                  <AdminSelect
                    value={form.template_layout}
                    onChange={key => setForm(f => (f ? { ...f, template_layout: key } : f))}
                    options={EMAIL_LAYOUT_OPTIONS.map(l => ({ value: l.key, label: l.label }))}
                  />
                  <p className="text-[10px] text-foreground-muted mt-1">
                    {EMAIL_LAYOUT_OPTIONS.find(l => l.key === form.template_layout)?.description} The theme wraps the
                    template; the wording lives in the template.
                  </p>
                </div>
              </>
            ) : (
              <>
                <div className="mt-4">
                  <label className="block text-xs font-semibold text-foreground-muted uppercase tracking-wide mb-1">
                    Subject line
                  </label>
                  <AIEnrichButton
                    fieldLabel="Subject line"
                    value={form.subject_template}
                    onChange={v => setForm({ ...form, subject_template: v })}
                    scope="campaigns:write"
                    context={`Campaign: ${campaign.name ?? ''}`}
                  >
                    <input
                      type="text"
                      value={form.subject_template}
                      onChange={e => setForm({ ...form, subject_template: e.target.value })}
                      className="field-normal w-full pr-8 border border-border-secondary bg-surface text-foreground focus:outline-none focus:ring-2 focus:ring-accent-500"
                    />
                  </AIEnrichButton>
                </div>

                <div className="mt-4">
                  <label className="block text-xs font-semibold text-foreground-muted uppercase tracking-wide mb-1">
                    Email template
                  </label>
                  <AdminSelect
                    value={form.template_layout}
                    onChange={async key => {
                      const opt = EMAIL_LAYOUT_OPTIONS.find(o => o.key === key)
                      const starter = opt?.starterBody ?? ''
                      // Custom (or no starter): just switch the theme, keep the body.
                      if (key === 'custom' || !starter) {
                        setForm(f => (f ? { ...f, template_layout: key } : f))
                        return
                      }
                      // A preset with starter content: confirm before clobbering a non-empty body.
                      const current = (form.body_template || '').trim()
                      const loadStarter =
                        !current ||
                        (await confirm({
                          title: 'Load template content?',
                          message:
                            "Replace the current email body with this template's starter content? Your current body will be lost.",
                          confirmLabel: 'Load template',
                        }))
                      setForm(f =>
                        f
                          ? loadStarter
                            ? { ...f, template_layout: key, template_mode: 'richtext', body_template: starter }
                            : { ...f, template_layout: key }
                          : f
                      )
                    }}
                    options={EMAIL_LAYOUT_OPTIONS.map(l => ({ value: l.key, label: l.label }))}
                  />
                  <p className="text-[10px] text-foreground-muted mt-1">
                    {EMAIL_LAYOUT_OPTIONS.find(l => l.key === form.template_layout)?.description}
                  </p>
                </div>

                <div className="mt-4 flex items-center justify-between gap-3">
                  <label className="block text-xs font-semibold text-foreground-muted uppercase tracking-wide">
                    Email body
                  </label>
                  <div className="inline-flex items-center gap-1 bg-surface-secondary rounded-lg p-0.5">
                    {(['richtext', 'blocks'] as const).map(m => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setForm(f => (f ? { ...f, template_mode: m } : f))}
                        className={`h-full px-3 rounded-md text-xs font-semibold transition-colors ${
                          form.template_mode === m
                            ? 'bg-accent-500 text-white'
                            : 'text-foreground-muted hover:text-foreground'
                        }`}
                      >
                        {m === 'richtext' ? 'Rich text' : 'Block builder'}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="mt-2">
                  {form.template_mode === 'blocks' ? (
                    <EmailBlockBuilder
                      extraVariables={composerVars}
                      blocks={form.blocks}
                      onChange={b =>
                        setForm(f =>
                          f
                            ? {
                                ...f,
                                blocks: b,
                                template_layout: f.template_layout === 'custom' ? 'custom' : f.template_layout,
                              }
                            : f
                        )
                      }
                    />
                  ) : (
                    <div className="relative">
                      <EmailComposer
                        value={form.body_template}
                        onChange={setBody}
                        extraVariables={composerVars}
                        ctaHref="{ctaUrl}"
                        minHeight={260}
                      />
                      <AIEnrichButton
                        placement="in-field"
                        anchorClassName="absolute right-3 bottom-3 z-10"
                        fieldLabel="Email body (HTML)"
                        value={form.body_template}
                        onChange={setBody}
                        scope="campaigns:write"
                        format="html"
                        variables={composerVars.map(v => v.key)}
                        write
                        broadcast
                        context={`Campaign: ${campaign.name ?? ''}. Subject: "${form.subject_template}". One call-to-action button linking to {ctaUrl}.`}
                      />
                    </div>
                  )}
                  <div className="mt-2">
                    <CampaignVariables
                      kind={varsKind}
                      channel="email"
                      text={`${form.subject_template}\n${form.template_mode === 'blocks' ? renderBlocks(form.blocks ?? []) : form.body_template}`}
                    />
                  </div>
                </div>
              </>
            )}

            {campaignSupportsWhatsApp(kind) && !!form.parameters?.smsEnabled && (
              <div className="mt-4">
                <label className="block text-xs font-semibold text-foreground-muted uppercase tracking-wide mb-1">
                  SMS message
                </label>
                <LibraryTemplatePicker
                  channel="sms"
                  kind={form.scenario_kind || kind}
                  value={form.sms_template_slug}
                  onChange={slug => setForm(f => (f ? { ...f, sms_template_slug: slug } : f))}
                  noneLabel="Inline SMS (written only for this campaign)"
                  supplied={campaignCanFill}
                />
                <div className="mt-2">
                  {form.sms_template_slug ? (
                    <LinkedTemplateEditor
                      channel="sms"
                      slug={form.sms_template_slug}
                      currentKind={kind}
                      campaignKind={varsKind}
                    />
                  ) : (
                    <>
                      <AIEnrichButton
                        fieldLabel="SMS message"
                        value={form.sms_template}
                        onChange={v => setForm(f => (f ? { ...f, sms_template: v } : f))}
                        scope="campaigns:write"
                        format="sms"
                        maxLength={480}
                        variables={campaignVariables(varsKind, 'sms').map(v => v.key)}
                        multiline
                        write
                        broadcast
                        context={`SMS for the "${campaign.name ?? kind}" campaign, sent alongside WhatsApp.`}
                      >
                        <textarea
                          value={form.sms_template}
                          onChange={e => setForm(f => (f ? { ...f, sms_template: e.target.value } : f))}
                          rows={3}
                          maxLength={480}
                          placeholder="Short text sent alongside WhatsApp when a phone is on file. Leave blank to use the built-in line. Variables like {firstName} and {couponCode} are filled per recipient."
                          className="field-normal w-full pr-8 border border-border-secondary bg-surface text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-accent-500"
                        />
                      </AIEnrichButton>
                      <p className="text-[10px] text-foreground-muted mt-1">
                        {form.sms_template.length} chars ·{' '}
                        {form.sms_template.length === 0 ? 0 : Math.ceil(form.sms_template.length / 160)} segment
                        {Math.ceil((form.sms_template.length || 0) / 160) === 1 ? '' : 's'} · plain text only, no images.
                      </p>
                    </>
                  )}
                </div>
                <p className="text-[10px] text-foreground-muted mt-1">
                  Sent to customers with a phone on file — independently of WhatsApp.
                </p>
              </div>
            )}

            {campaignSupportsWhatsApp(kind) && !!form.parameters?.whatsappEnabled && (
              <div className="mt-4">
                <label className="block text-xs font-semibold text-foreground-muted uppercase tracking-wide mb-2">
                  WhatsApp message
                </label>
                <WhatsAppTemplateEditor
                  kind={form.scenario_kind || kind}
                  value={{ slug: form.wa_template_slug, variables: form.wa_variables }}
                  // Picking a library template retires the old registry choice for this campaign.
                  onChange={v =>
                    setForm(f =>
                      f ? { ...f, wa_template_slug: v.slug, wa_variables: v.variables, wa_template_sid: null } : f
                    )
                  }
                  needsReview={!!form.parameters?.waNeedsReview}
                  onReviewed={() =>
                    setForm(f => (f ? { ...f, parameters: { ...f.parameters, waNeedsReview: false } } : f))
                  }
                />
              </div>
            )}

            {pushOn && (
              <div className="mt-4">
                <PushFields
                  value={{
                    title: pushParam('pushTitle') ?? pushDefault.title,
                    body: pushParam('pushBody') ?? pushDefault.body,
                    link: pushParam('pushLink') ?? '',
                  }}
                  onChange={v =>
                    setForm(f =>
                      f
                        ? {
                            ...f,
                            parameters: {
                              ...f.parameters,
                              pushTitle: v.title,
                              pushBody: v.body,
                              pushLink: v.link ?? '',
                            },
                          }
                        : f
                    )
                  }
                  image={false}
                  linkDefault={pushLinkDefault}
                  context={currentScenario?.name ?? varsKind}
                  inputClass="field-normal w-full border border-border-secondary bg-surface text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-accent-500"
                  labelClass="block text-xs font-semibold text-foreground-muted uppercase tracking-wide mb-1"
                />
                {pushProblem && <p className="mt-1 text-xs text-red-600">{pushProblem}</p>}
                <p className="text-[10px] text-foreground-muted mt-1">
                  Empty fields use the default copy. The product photo is attached when there is one. Pushes wait out quiet
                  hours on the customer&apos;s phone and count toward the 2-a-day push limit.
                </p>
              </div>
            )}
          </div>

          <div className="bg-surface-elevated rounded-xl border border-border-default p-5">
            <h3 className="text-sm font-semibold text-foreground-muted uppercase tracking-widest mb-3">Preview</h3>
            {tplWarning && (
              <div className="mb-3 p-2.5 rounded-lg border border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-400 text-xs flex items-start gap-2">
                <span className="font-semibold">Warning:</span>
                <span>{tplWarning}</span>
              </div>
            )}
            <div className="border border-border-default rounded-lg overflow-hidden">
              <div className="px-4 py-2 bg-surface-secondary border-b border-border-default text-xs">
                <span className="text-foreground-muted">Subject:</span>{' '}
                <span className="font-semibold text-foreground">{previewSubject}</span>
              </div>
              <iframe
                title="Email preview"
                srcDoc={previewDoc}
                className="w-full rounded-b-lg border-0 bg-white h-[380px] md:h-[520px]"
                sandbox=""
              />
            </div>

            {campaignSupportsWhatsApp(kind) && !!form.parameters?.whatsappEnabled && form.wa_template_slug && (
              <div className="mt-5">
                <p className="text-sm font-semibold uppercase tracking-wide text-foreground mb-2">WhatsApp preview</p>
                <WhatsAppPreview
                  value={{ slug: form.wa_template_slug, variables: form.wa_variables }}
                  vars={previewVars}
                />
              </div>
            )}

            {pushOn && (
              <div className="mt-5">
                <p className="text-sm font-semibold uppercase tracking-wide text-foreground mb-2">App push preview</p>
                <PushPreview
                  title={pushSent.title}
                  body={pushSent.body}
                  image={varsKind === 'birthday' ? null : String(SAMPLE_VARS.productImageUrl)}
                  vars={pushVars}
                />
              </div>
            )}
          </div>
        </div>

        <div className="bg-surface-elevated rounded-xl border border-border-default p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-foreground-muted uppercase tracking-widest">
              Scenario &amp; parameters
            </h3>
          </div>
          <div>
            <label className="block text-xs font-semibold text-foreground-muted uppercase tracking-wide mb-1">
              Scenario (trigger)
            </label>
            {isSeededCampaign ? (
              <div className="px-3 py-2 text-sm bg-surface-secondary rounded-lg border border-border-default text-foreground-secondary">
                {currentScenario
                  ? `${currentScenario.name} — ${currentScenario.description}`
                  : form.scenario_kind || 'Built-in'}
                <span className="ml-2 px-2 py-0.5 text-[10px] font-semibold rounded-full bg-surface-secondary text-foreground align-middle">
                  Locked
                </span>
              </div>
            ) : (
              <AdminSelect
                value={form.scenario_kind || ''}
                options={scenarioOptions}
                onChange={v => setForm({ ...form, scenario_kind: v || null })}
                sm
              />
            )}
            <p className="text-[10px] text-foreground-muted mt-1">
              {isSeededCampaign
                ? 'Built-in campaigns keep their original scenario. Create a new campaign to use this scenario with a different template.'
                : 'Picks which behavioral trigger feeds this campaign. Defaults from the scenario apply unless overridden.'}
            </p>
          </div>

          {(() => {
            const sk = form.scenario_kind || campaign.kind
            const sc = scenarios.find(s => s.kind === sk)
            const schema = sc?.param_schema
            const defaults = sc?.default_parameters || {}
            if (!schema || Object.keys(schema).length === 0) return null
            return (
              <div className="mt-5 pt-5 border-t border-border-default">
                <p className="text-xs font-semibold text-foreground-muted uppercase tracking-wide mb-1">
                  Scenario parameters
                </p>
                <p className="text-[10px] text-foreground-muted mb-3">
                  Leave blank to use the scenario default. Only set values that should differ from the default.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {Object.entries(schema).map(([key, def]) => {
                    const defaultVal = defaults[key]
                    const overrideVal = form.parameters[key]
                    const isOverridden = overrideVal !== undefined && overrideVal !== null
                    return (
                      <div key={key}>
                        <label className="block text-xs font-semibold text-foreground-muted mb-1">
                          {def.label}
                          {isOverridden && (
                            <span className="ml-2 px-1.5 py-0.5 text-[9px] font-bold rounded bg-accent-100 text-accent-700 dark:bg-accent-900/30 dark:text-accent-300">
                              OVERRIDDEN
                            </span>
                          )}
                        </label>
                        {def.type === 'boolean' ? (
                          <Toggle
                            checked={isOverridden ? overrideVal === true : defaultVal === true}
                            onChange={v => {
                              const next = { ...form.parameters }
                              // Toggling always sets an explicit override; matching the default again
                              // simply stores that same value (no hidden "default" state to confuse).
                              next[key] = v
                              setForm({ ...form, parameters: next })
                            }}
                            label={(isOverridden ? overrideVal === true : defaultVal === true) ? 'On' : 'Off'}
                          />
                        ) : def.type === 'duration' ? (
                          <DurationField
                            canonicalMinutes={typeof overrideVal === 'number' ? overrideVal : undefined}
                            defaultMinutes={typeof defaultVal === 'number' ? defaultVal : undefined}
                            recommendedUnit={(def as any).recommendedUnit}
                            allowedUnits={(def as any).allowedUnits}
                            min={def.min}
                            max={def.max}
                            onChange={m => {
                              const next = { ...form.parameters }
                              if (m === undefined) delete next[key]
                              else next[key] = m
                              setForm({ ...form, parameters: next })
                            }}
                          />
                        ) : (
                          <input
                            type="number"
                            value={isOverridden ? String(overrideVal) : ''}
                            placeholder={`Default: ${String(defaultVal)}`}
                            min={def.min}
                            max={def.max}
                            onChange={e => {
                              const raw = e.target.value
                              const next = { ...form.parameters }
                              if (raw === '') {
                                delete next[key]
                              } else {
                                const parsed = def.type === 'integer' ? parseInt(raw, 10) : parseFloat(raw)
                                // treat 0 as blank for fields with min >= 1
                                if (parsed === 0 && (def.min ?? 0) >= 1) delete next[key]
                                else next[key] = parsed
                              }
                              setForm({ ...form, parameters: next })
                            }}
                            className="field-normal w-full border border-border-secondary bg-surface text-foreground focus:outline-none focus:ring-2 focus:ring-accent-500"
                          />
                        )}
                        {def.description && <p className="text-[10px] text-foreground-muted mt-1">{def.description}</p>}
                        {def.type !== 'duration' && (def.min !== undefined || def.max !== undefined) && (
                          <p className="text-[10px] text-foreground-muted mt-0.5">
                            Range: {def.min ?? '-∞'} to {def.max ?? '∞'}
                          </p>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })()}
        </div>
      </LockedFieldset>

      {/* Send test — preserved from the old sticky bar, now its own card so the FormFooter stays
          focused on edit intents. Fires against the live campaign, so admins can sanity-check
          the current (saved) template without touching the draft. */}
      <RequireWrite scope="campaigns:write">
        <div className="bg-surface-elevated rounded-xl border border-border-default p-5">
          <h3 className="text-sm font-semibold text-foreground-muted uppercase tracking-widest mb-3">Send test</h3>
          <div className="flex items-center gap-2 flex-wrap">
            <input
              type="email"
              value={testEmail}
              onChange={e => setTestEmail(e.target.value)}
              placeholder="your@email.com for test send"
              className="h-control w-full sm:w-auto flex-1 sm:min-w-[180px] max-w-xs px-3 rounded-lg border border-border-secondary bg-surface text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-accent-500"
            />
            <button
              type="button"
              onClick={sendTest}
              disabled={testBusy || !testEmail.trim()}
              className="h-control inline-flex items-center justify-center px-4 bg-surface-secondary hover:bg-border-default text-foreground rounded-lg text-sm font-semibold transition-all active:scale-95 disabled:opacity-50"
            >
              {testBusy ? 'Sending…' : 'Send test'}
            </button>
          </div>
        </div>
      </RequireWrite>

      {/* Shared editor bottom bar — see docs/plans/EDITOR_SESSION_SEMANTICS.md.
          No top chrome: cancel, discard, save-as-draft, publish all live here. */}
      <RequireWrite scope="campaigns:write">
        <FormFooter
          sticky
          lock={lock}
          cancelHref={ap(`/admin/campaigns/${kind}/view`)}
          autosave={autoSaveStatus}
          draftBadge={hasDraft ? <Badge tone="amber">Draft pending</Badge> : null}
          discard={hasDraft ? discardDraft : undefined}
          cancel={async () => {
            const ok = await confirm({
              title: 'Discard changes?',
              message:
                'Any edits made since you opened this campaign will be rolled back. The live campaign stays as-is.',
              confirmLabel: 'Discard',
              variant: 'danger',
            })
            if (!ok) return
            if (edit.sessionId) await edit.cancel()
            router.push(ap(`/admin/campaigns/${kind}/view`))
          }}
        >
          <button
            type="button"
            onClick={save}
            disabled={saving || publishing}
            className="control-md inline-flex items-center justify-center whitespace-nowrap border border-border-secondary bg-surface text-foreground hover:bg-surface-secondary font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving…' : 'Save as Draft'}
          </button>
          <button
            type="button"
            onClick={publish}
            disabled={saving || publishing}
            className="control-md inline-flex items-center justify-center whitespace-nowrap bg-accent-500 hover:bg-accent-600 text-white font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {publishing ? 'Publishing…' : 'Update & Publish'}
          </button>
        </FormFooter>
      </RequireWrite>
    </div>
  )
}
