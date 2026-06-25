'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useToast } from '@/contexts/ToastContext'
import AdminSelect, { type SelectOption } from '@/components/admin/AdminSelect'
import AIEnrichButton from '@/components/admin/AIEnrichButton'

interface EligibleRecipient {
  reference_id: string
  user_id: string | null
  user_email: string | null
  user_name: string | null
  marketing_opt_out: boolean
  raw: Record<string, any>
}

interface SuppressedRecipient {
  reference_id: string
  user_id: string | null
  user_email: string | null
  user_name: string | null
  reason: string
  reason_detail: string | null
  blocked_until: string | null
  raw: Record<string, any>
}

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
}

interface ParamDef {
  type: 'integer' | 'float' | 'boolean'
  min?: number
  max?: number
  label: string
  description?: string
}

interface ScenarioOption {
  kind: string
  name: string
  description: string
  default_parameters?: Record<string, number | boolean | string>
  param_schema?: Record<string, ParamDef>
}

interface RecentSend {
  id: string
  user_id: string
  reference_id: string | null
  sent_at: string
  opened_at: string | null
  clicked_at: string | null
  converted_at: string | null
  unsubscribed_at: string | null
  bounced_at: string | null
  user_email: string | null
  user_name: string | null
  send_count: number
}

interface CouponOption {
  id: string
  code: string
  discount_type: string
  discount_value: number
  description: string | null
}

const SAMPLE_ITEMS_HTML = `<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="border-top:1px solid #e5e7eb;border-bottom:1px solid #e5e7eb;margin:16px 0;">
  <tr>
    <td valign="top" style="padding:12px 12px 12px 0;width:80px;"><img src="https://placehold.co/120x120/e07b3f/ffffff?text=A" alt="Sample A" width="72" height="72" style="display:block;border-radius:6px;border:1px solid #e5e7eb;background:#f5f5f5;width:72px;height:72px;" /></td>
    <td valign="top" style="padding:12px 0;"><span style="color:#1a3a4a;font-weight:600;font-size:15px;">Sample Product A</span><div style="color:#777;font-size:13px;margin-top:4px;">Qty: 2</div></td>
    <td align="right" valign="top" style="padding:12px 0 12px 12px;color:#1a3a4a;font-weight:600;font-size:14px;white-space:nowrap;">₹500</td>
  </tr>
  <tr>
    <td valign="top" style="padding:12px 12px 12px 0;width:80px;"><img src="https://placehold.co/120x120/1a3a4a/ffffff?text=B" alt="Sample B" width="72" height="72" style="display:block;border-radius:6px;border:1px solid #e5e7eb;background:#f5f5f5;width:72px;height:72px;" /></td>
    <td valign="top" style="padding:12px 0;"><span style="color:#1a3a4a;font-weight:600;font-size:15px;">Sample Product B</span><div style="color:#777;font-size:13px;margin-top:4px;">Qty: 1</div></td>
    <td align="right" valign="top" style="padding:12px 0 12px 12px;color:#1a3a4a;font-weight:600;font-size:14px;white-space:nowrap;">₹1,200</td>
  </tr>
</table>`

const SAMPLE_PRODUCT_CARD = `<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin:8px 0 20px;background:#fafafa;border:1px solid #e5e7eb;border-radius:8px;">
  <tr><td align="center" style="padding:24px 24px 16px;"><img src="https://placehold.co/280x280/e07b3f/ffffff?text=Product" alt="Sample Product" width="280" style="display:block;max-width:100%;border-radius:6px;background:#fff;" /></td></tr>
  <tr><td align="center" style="padding:0 24px 24px;"><div style="color:#1a3a4a;font-size:18px;font-weight:700;">Sample Product</div><div style="margin:12px 0 0;"><span style="color:#999;text-decoration:line-through;font-size:14px;">₹999</span>&nbsp;&nbsp;<strong style="color:#e07b3f;font-size:22px;">₹799</strong></div></td></tr>
</table>`

const SAMPLE_VARS: Record<string, string | number> = {
  firstName: 'Sample',
  itemCount: 2,
  cartItems: SAMPLE_ITEMS_HTML,
  itemsHtml: SAMPLE_ITEMS_HTML,
  productCard: SAMPLE_PRODUCT_CARD,
  orderNumber: 'TEST-12345',
  total: '2200.00',
  discountPercent: 10,
  couponCode: 'BACK-AB12CD',
  productName: 'Sample Product',
  productImageUrl: 'https://placehold.co/280x280/e07b3f/ffffff?text=Product',
  oldPrice: '999',
  newPrice: '799',
  ctaUrl: '#',
}

function renderTemplate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_m, k) => (vars[k] != null ? String(vars[k]) : ''))
}

export default function CampaignDetailClient({ kind }: { kind: string }) {
  const router = useRouter()
  const { showToast } = useToast()
  const [campaign, setCampaign] = useState<Campaign | null>(null)
  const [recentSends, setRecentSends] = useState<RecentSend[]>([])
  const [loading, setLoading] = useState(true)
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiGenerating, setAiGenerating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testEmail, setTestEmail] = useState('')
  const [testBusy, setTestBusy] = useState(false)
  const [coupons, setCoupons] = useState<CouponOption[]>([])
  const [scenarios, setScenarios] = useState<ScenarioOption[]>([])
  const [sendsOffset, setSendsOffset] = useState(0)
  const [sendsTotal, setSendsTotal] = useState(0)
  const SENDS_LIMIT = 20
  const [eligible, setEligible] = useState<EligibleRecipient[] | null>(null)
  const [eligibleTotal, setEligibleTotal] = useState(0)
  const [suppressed, setSuppressed] = useState<SuppressedRecipient[] | null>(null)
  const [suppressedTotal, setSuppressedTotal] = useState(0)
  const [eligibleLoading, setEligibleLoading] = useState(false)
  const [eligibleError, setEligibleError] = useState<string | null>(null)
  const [eligibleNote, setEligibleNote] = useState<string | null>(null)
  const [eligibleTrigger, setEligibleTrigger] = useState<string | null>(null)
  const [form, setForm] = useState<{
    enabled: boolean
    delay_hours: number
    discount_percent: number
    coupon_id: string | null
    scenario_kind: string | null
    subject_template: string
    body_template: string
    parameters: Record<string, number | boolean | string>
  } | null>(null)

  async function load(sOff = sendsOffset) {
    setLoading(true)
    try {
      const [campaignRes, couponsRes, scenariosRes] = await Promise.all([
        fetch(`/api/admin/campaigns/${kind}?offset=${sOff}`, { credentials: 'include' }),
        fetch('/api/admin/campaigns/coupons', { credentials: 'include' }),
        fetch('/api/admin/campaigns/scenarios', { credentials: 'include' }),
      ])
      if (campaignRes.ok) {
        const data = await campaignRes.json()
        setCampaign(data.campaign)
        setRecentSends(data.recentSends || [])
        setSendsTotal(data.total || 0)
        setForm({
          enabled: data.campaign.enabled,
          delay_hours: data.campaign.delay_hours,
          discount_percent: data.campaign.discount_percent,
          coupon_id: data.campaign.coupon_id || null,
          scenario_kind: data.campaign.scenario_kind || null,
          subject_template: data.campaign.subject_template,
          body_template: data.campaign.body_template,
          parameters: (data.campaign.parameters || {}) as Record<string, number | boolean | string>,
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

  useEffect(() => { load(0) }, [kind])
  useEffect(() => { loadEligible() }, [kind])

  const [autoSaveStatus, setAutoSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [paramsBaseline, setParamsBaseline] = useState<string>('')
  const [scenarioBaseline, setScenarioBaseline] = useState<string | null>(null)

  useEffect(() => {
    if (!campaign) return
    setParamsBaseline(JSON.stringify(campaign.parameters || {}))
    setScenarioBaseline(campaign.scenario_kind || null)
  }, [campaign])

  useEffect(() => {
    if (!form || !campaign) return
    const currentParams = JSON.stringify(form.parameters || {})
    const currentScenario = form.scenario_kind || null
    if (currentParams === paramsBaseline && currentScenario === scenarioBaseline) return
    const t = setTimeout(async () => {
      setAutoSaveStatus('saving')
      try {
        const res = await fetch(`/api/admin/campaigns/${kind}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            parameters: form.parameters,
            scenario_kind: form.scenario_kind,
          }),
        })
        if (res.ok) {
          setAutoSaveStatus('saved')
          setParamsBaseline(currentParams)
          setScenarioBaseline(currentScenario)
          setTimeout(() => setAutoSaveStatus('idle'), 1500)
        } else {
          const data = await res.json().catch(() => ({}))
          setAutoSaveStatus('error')
          showToast(data.error || 'Auto-save failed', 'error')
        }
      } catch {
        setAutoSaveStatus('error')
      }
    }, 700)
    return () => clearTimeout(t)
  }, [form?.parameters, form?.scenario_kind, paramsBaseline, scenarioBaseline, campaign, kind, showToast, form])

  async function loadEligible() {
    setEligibleLoading(true)
    setEligibleError(null)
    setEligibleNote(null)
    try {
      const res = await fetch(`/api/admin/campaigns/${kind}/eligible`, { credentials: 'include' })
      const data = await res.json()
      if (!res.ok) {
        setEligibleError(data?.error || `HTTP ${res.status}`)
        setEligible([])
        setEligibleTotal(0)
        return
      }
      setEligible(data.eligible || [])
      setEligibleTotal(data.total || 0)
      setSuppressed(data.suppressed || [])
      setSuppressedTotal(data.suppressedTotal || 0)
      setEligibleTrigger(data.trigger || null)
      if (data.note) setEligibleNote(data.note)
    } catch (err: any) {
      setEligibleError(err?.message || 'Network error')
      setEligible([])
      setEligibleTotal(0)
    } finally {
      setEligibleLoading(false)
    }
  }

  async function save() {
    if (!form) return
    setSaving(true)
    try {
      const res = await fetch(`/api/admin/campaigns/${kind}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(form),
      })
      if (res.ok) {
        await load(sendsOffset)
        router.refresh()
        showToast('Campaign settings saved', 'success')
      } else {
        const data = await res.json().catch(() => ({}))
        showToast(data.error || 'Failed to save', 'error')
      }
    } finally {
      setSaving(false)
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
        res.ok ? `Test email sent to ${testEmail}` : (data.error || 'Failed to send'),
        res.ok ? 'success' : 'error'
      )
    } finally {
      setTestBusy(false)
    }
  }

  async function generateWithAI() {
    if (!aiPrompt.trim() || !form) return
    setAiGenerating(true)
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
        setForm(f => f ? { ...f, subject_template: data.subject_template, body_template: data.body_template } : f)
        showToast('Template updated', 'success')
      } else {
        showToast(data.error || 'Generation failed', 'error')
      }
    } finally {
      setAiGenerating(false)
    }
  }

  if (loading || !campaign || !form) return <p className="text-sm text-foreground-muted">Loading…</p>

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
    ? { ...SAMPLE_VARS, couponCode: selectedCoupon.code, discountPercent: selectedCoupon.discount_type === 'percentage' ? selectedCoupon.discount_value : 0 }
    : SAMPLE_VARS
  const previewSubject = renderTemplate(form.subject_template, previewVars)
  const previewBody = renderTemplate(form.body_template, previewVars)

  const SINGLE_PRODUCT_KINDS = new Set(['restock', 'price_drop'])
  const MULTI_PRODUCT_KINDS = new Set(['abandoned_cart', 'abandoned_checkout', 'post_purchase', 'review_reminder', 'winback_90', 'winback_180'])
  const refKind = (form.scenario_kind || campaign?.kind || '').toLowerCase()
  const tplWarning = (() => {
    const b = form.body_template || ''
    const hasCard = /\{productCard\}/.test(b)
    const hasItems = /\{itemsHtml\}/.test(b) || /\{cartItems\}/.test(b)
    const usesProductTokens = /\{(productName|productImageUrl|oldPrice|newPrice|itemCount)\}/i.test(b)
    if (SINGLE_PRODUCT_KINDS.has(refKind) && !hasCard) return 'This is a single-product scenario — body MUST include {productCard} so an image renders.'
    if (MULTI_PRODUCT_KINDS.has(refKind) && !hasItems) return 'This is a multi-product scenario — body MUST include {itemsHtml} so the gallery renders.'
    if (usesProductTokens && !hasCard && !hasItems) return 'Body uses product tokens but has no {productCard} or {itemsHtml} — the email will render without an image.'
    return null
  })()

  function status(s: RecentSend): { label: string; color: string } {
    if (s.bounced_at) return { label: 'Bounced', color: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' }
    if (s.unsubscribed_at) return { label: 'Unsub', color: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300' }
    if (s.converted_at) return { label: 'Converted', color: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' }
    if (s.clicked_at) return { label: 'Clicked', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' }
    if (s.opened_at) return { label: 'Opened', color: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300' }
    return { label: 'Sent', color: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300' }
  }

  return (
    <div className="space-y-5">
      <div className="bg-surface-elevated rounded-xl border border-border-default p-5 space-y-3">
        <p className="text-xs font-semibold text-foreground-muted uppercase tracking-wide">Regenerate template with AI</p>
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
            className="px-4 py-1.5 bg-secondary-500 hover:bg-secondary-600 text-white rounded-lg text-sm font-semibold transition-all active:scale-95 disabled:opacity-50 shrink-0"
          >
            {aiGenerating ? 'Generating…' : 'Generate'}
          </button>
        </div>
        <p className="text-[10px] text-foreground-muted">AI will rewrite the subject and body. Your other settings are untouched.</p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
      <div className="bg-surface-elevated rounded-xl border border-border-default p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-xl font-bold text-foreground">{campaign.name}</h2>
            {campaign.description && <p className="text-sm text-foreground-secondary mt-1">{campaign.description}</p>}
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={e => setForm({ ...form, enabled: e.target.checked })}
              className="w-4 h-4"
            />
            <span className="text-sm font-medium text-foreground">{form.enabled ? 'Active' : 'Paused'}</span>
          </label>
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
            <p className="text-[10px] text-foreground-muted mt-1">Auto-generates a unique per-user coupon if no coupon is assigned below</p>
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
            <p className="text-[10px] text-accent-600 dark:text-accent-400 mt-1">
              This coupon will be injected as {'{couponCode}'} in the template for all recipients.
            </p>
          )}
        </div>

        <div className="mt-4">
          <label className="block text-xs font-semibold text-foreground-muted uppercase tracking-wide mb-1">
            Subject line
          </label>
          <AIEnrichButton
            fieldLabel="Subject line"
            value={form.subject_template}
            onChange={v => setForm({ ...form, subject_template: v })}
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
            HTML body
          </label>
          <textarea
            value={form.body_template}
            onChange={e => setForm({ ...form, body_template: e.target.value })}
            rows={10}
            className="field-normal text-xs font-mono w-full border border-border-secondary bg-surface text-foreground focus:outline-none focus:ring-2 focus:ring-accent-500"
          />
          <p className="text-[10px] text-foreground-muted mt-1">
            Variables: <code className="px-1 bg-surface-secondary rounded">{'{firstName}'}</code> <code className="px-1 bg-surface-secondary rounded">{'{orderNumber}'}</code> <code className="px-1 bg-surface-secondary rounded">{'{couponCode}'}</code> <code className="px-1 bg-surface-secondary rounded">{'{discountPercent}'}</code> <code className="px-1 bg-surface-secondary rounded">{'{productName}'}</code> <code className="px-1 bg-surface-secondary rounded">{'{productImageUrl}'}</code> <code className="px-1 bg-surface-secondary rounded">{'{ctaUrl}'}</code>
          </p>
        </div>

        <div className="flex items-center gap-2 mt-5 flex-wrap">
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="px-4 py-1.5 bg-accent-500 hover:bg-accent-600 text-white rounded-lg text-sm font-semibold transition-all active:scale-95 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
          <input
            type="email"
            value={testEmail}
            onChange={e => setTestEmail(e.target.value)}
            placeholder="your@email.com for test send"
            className="field-normal flex-1 max-w-xs border border-border-secondary bg-surface text-foreground focus:outline-none focus:ring-2 focus:ring-accent-500"
          />
          <button
            type="button"
            onClick={sendTest}
            disabled={testBusy || !testEmail.trim()}
            className="px-4 py-1.5 bg-secondary-500 hover:bg-secondary-600 text-white rounded-lg text-sm font-semibold transition-all active:scale-95 disabled:opacity-50"
          >
            {testBusy ? 'Sending…' : 'Send test'}
          </button>
        </div>
      </div>

      <div className="bg-surface-elevated rounded-xl border border-border-default p-5">
        <h3 className="text-sm font-semibold text-foreground-muted uppercase tracking-widest mb-3">Preview</h3>
        {tplWarning && (
          <div className="mb-3 p-2.5 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800 text-amber-800 dark:text-amber-300 text-xs flex items-start gap-2">
            <span className="font-semibold">⚠</span>
            <span>{tplWarning}</span>
          </div>
        )}
        <div className="border border-border-default rounded-lg overflow-hidden">
          <div className="px-4 py-2 bg-surface-secondary border-b border-border-default text-xs">
            <span className="text-foreground-muted">Subject:</span> <span className="font-semibold text-foreground">{previewSubject}</span>
          </div>
          <div
            className="p-4 bg-white text-zinc-900"
            dangerouslySetInnerHTML={{ __html: previewBody }}
          />
        </div>
      </div>
      </div>

      <div className="bg-surface-elevated rounded-xl border border-border-default p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-foreground-muted uppercase tracking-widest">Scenario &amp; parameters</h3>
          <span className={`text-[11px] font-medium ${
            autoSaveStatus === 'saving' ? 'text-foreground-muted' :
            autoSaveStatus === 'saved' ? 'text-green-600 dark:text-green-400' :
            autoSaveStatus === 'error' ? 'text-red-600 dark:text-red-400' :
            'text-foreground-muted/50'
          }`}>
            {autoSaveStatus === 'saving' ? 'Saving…' :
             autoSaveStatus === 'saved' ? 'Saved' :
             autoSaveStatus === 'error' ? 'Save failed' :
             'Auto-saves on change'}
          </span>
        </div>
        <div>
          <label className="block text-xs font-semibold text-foreground-muted uppercase tracking-wide mb-1">Scenario (trigger)</label>
          {isSeededCampaign ? (
            <div className="px-3 py-2 text-sm bg-surface-secondary rounded-lg border border-border-default text-foreground-secondary">
              {currentScenario ? `${currentScenario.name} — ${currentScenario.description}` : (form.scenario_kind || 'Built-in')}
              <span className="ml-2 px-2 py-0.5 text-[10px] font-semibold rounded-full bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 align-middle">Locked</span>
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
              ? "Built-in campaigns keep their original scenario. Create a new campaign to use this scenario with a different template."
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
                        <AdminSelect
                          value={isOverridden ? String(overrideVal) : ''}
                          onChange={v => {
                            const next = { ...form.parameters }
                            if (v === '') delete next[key]
                            else next[key] = v === 'true'
                            setForm({ ...form, parameters: next })
                          }}
                          options={[
                            { value: '', label: `Default (${String(defaultVal)})` },
                            { value: 'true', label: 'true' },
                            { value: 'false', label: 'false' },
                          ]}
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
                      {def.description && (
                        <p className="text-[10px] text-foreground-muted mt-1">{def.description}</p>
                      )}
                      {(def.min !== undefined || def.max !== undefined) && (
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

      <div className="bg-surface-elevated rounded-xl border border-border-default overflow-hidden">
        <div className="px-5 py-3 border-b border-border-default flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-foreground">
              Eligible recipients{eligible !== null ? ` (${eligibleTotal})` : ''}
            </h3>
            {eligibleTrigger && (
              <p className="text-[11px] text-foreground-muted mt-0.5">{eligibleTrigger}</p>
            )}
          </div>
          <button
            type="button"
            onClick={loadEligible}
            disabled={eligibleLoading}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-border-default text-foreground hover:bg-surface-secondary disabled:opacity-50"
          >
            {eligibleLoading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
        {eligibleError ? (
          <p className="p-8 text-sm text-red-500 text-center">{eligibleError}</p>
        ) : eligibleNote ? (
          <p className="p-8 text-sm text-foreground-muted text-center italic">{eligibleNote}</p>
        ) : eligibleLoading && !eligible ? (
          <p className="p-8 text-sm text-foreground-muted text-center">Loading…</p>
        ) : eligible && eligible.length === 0 ? (
          <p className="p-8 text-sm text-foreground-muted text-center">
            No customers currently match this campaign&apos;s trigger.
            <br />
            <span className="text-[11px]">When a customer crosses the threshold, they will appear here and the next sweep will email them.</span>
          </p>
        ) : eligible && eligible.length > 0 ? (
          <div className="divide-y divide-border-default max-h-96 overflow-y-auto">
            {eligible.map((r, i) => (
              <div key={r.reference_id || `row-${i}`} className="px-5 py-3 flex items-center justify-between gap-3 hover:bg-surface-secondary/50">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-foreground truncate">
                    {r.user_name || r.user_email || <span className="text-foreground-muted italic">No user</span>}
                    {r.marketing_opt_out && (
                      <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">opted out</span>
                    )}
                  </p>
                  <p className="text-[11px] text-foreground-muted truncate">
                    {r.user_email || ''}
                    {r.raw?.order_number ? ` · #${r.raw.order_number}` : ''}
                    {r.raw?.total_amount ? ` · ₹${Number(r.raw.total_amount).toLocaleString('en-IN')}` : ''}
                    {r.raw?.product_name ? ` · ${r.raw.product_name}` : ''}
                  </p>
                </div>
                <span className="text-[10px] font-mono text-foreground-muted">{(r.reference_id || '').slice(0, 8) || '—'}…</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {suppressed && suppressed.length > 0 && (
        <div className="bg-surface-elevated rounded-xl border border-border-default overflow-hidden">
          <div className="px-5 py-3 border-b border-border-default">
            <h3 className="text-sm font-semibold text-foreground">
              Suppressed ({suppressedTotal})
            </h3>
            <p className="text-[11px] text-foreground-muted mt-0.5">
              Customers who would otherwise qualify but are blocked from receiving this campaign right now.
            </p>
          </div>
          <div className="divide-y divide-border-default max-h-96 overflow-y-auto">
            {suppressed.map((r, i) => {
              const reasonColor = r.reason === 'cooldown' || r.reason === 'recent_send'
                ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                : r.reason === 'opted_out'
                  ? 'bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-300'
                  : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
              const reasonLabel = r.reason === 'cooldown' ? 'Cooldown'
                : r.reason === 'recent_send' ? 'Already sent'
                : r.reason === 'opted_out' ? 'Opted out'
                : r.reason === 'inactive' ? 'Inactive'
                : r.reason
              return (
                <div key={r.reference_id || `sup-${i}`} className="px-5 py-3 flex items-center justify-between gap-3 hover:bg-surface-secondary/50">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-foreground truncate">
                      {r.user_name || r.user_email || <span className="text-foreground-muted italic">No user</span>}
                    </p>
                    <p className="text-[11px] text-foreground-muted truncate">
                      {r.user_email || ''}
                      {r.reason_detail ? ` · ${r.reason_detail}` : ''}
                      {r.blocked_until ? ` · unblocks ${new Date(r.blocked_until).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}` : ''}
                    </p>
                  </div>
                  <span className={`px-2 py-0.5 text-[10px] font-semibold rounded-full ${reasonColor}`}>{reasonLabel}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="bg-surface-elevated rounded-xl border border-border-default overflow-hidden">
        <div className="px-5 py-3 border-b border-border-default">
          <h3 className="text-sm font-semibold text-foreground">Recent sends ({sendsTotal})</h3>
        </div>
        {recentSends.length === 0 ? (
          <p className="p-8 text-sm text-foreground-muted text-center">No sends yet</p>
        ) : (
          <>
            <div className="grid grid-cols-[1fr_140px_80px_80px] px-5 py-2 border-b border-border-default bg-surface-secondary/40">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-foreground-muted">Customer</span>
              <span className="text-[10px] font-semibold uppercase tracking-wide text-foreground-muted">Sent at</span>
              <span className="text-[10px] font-semibold uppercase tracking-wide text-foreground-muted text-center">Total sends</span>
              <span className="text-[10px] font-semibold uppercase tracking-wide text-foreground-muted text-right">Status</span>
            </div>
            <div className="divide-y divide-border-default">
              {recentSends.map(s => {
                const st = status(s)
                return (
                  <div key={s.id} className="grid grid-cols-[1fr_140px_80px_80px] items-center px-5 py-3 hover:bg-surface-secondary/50">
                    <div className="min-w-0">
                      <p className="text-sm text-foreground truncate">{s.user_name || s.user_email}</p>
                      <p className="text-[10px] text-foreground-muted truncate">{s.user_email}</p>
                    </div>
                    <p className="text-xs text-foreground-muted">{new Date(s.sent_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</p>
                    <p className="text-sm font-semibold text-foreground text-center">{Number(s.send_count)}</p>
                    <div className="flex justify-end">
                      <span className={`px-2 py-0.5 text-[10px] font-semibold rounded-full ${st.color}`}>{st.label}</span>
                    </div>
                  </div>
                )
              })}
            </div>
            {sendsTotal > SENDS_LIMIT && (
              <div className="px-5 py-3 border-t border-border-default flex items-center justify-between text-sm text-foreground-muted">
                <span>Showing {sendsOffset + 1}–{Math.min(sendsOffset + SENDS_LIMIT, sendsTotal)} of {sendsTotal}</span>
                <div className="flex gap-2">
                  <button
                    disabled={sendsOffset === 0}
                    onClick={() => { const o = sendsOffset - SENDS_LIMIT; setSendsOffset(o); load(o) }}
                    className="px-3 py-1 rounded-lg bg-surface-secondary hover:bg-border-default text-xs font-medium disabled:opacity-40 transition-colors"
                  >
                    Previous
                  </button>
                  <button
                    disabled={sendsOffset + SENDS_LIMIT >= sendsTotal}
                    onClick={() => { const o = sendsOffset + SENDS_LIMIT; setSendsOffset(o); load(o) }}
                    className="px-3 py-1 rounded-lg bg-surface-secondary hover:bg-border-default text-xs font-medium disabled:opacity-40 transition-colors"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
