'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useToast } from '@/contexts/ToastContext'

interface CouponOption {
  id: string
  code: string
  discount_type: string
  discount_value: number
  description: string | null
}

const SAMPLE_VARS: Record<string, string | number> = {
  firstName: 'Sample',
  itemCount: 3,
  cartItems: '<ul><li>2 × Widget (₹500)</li><li>1 × Gadget (₹1200)</li></ul>',
  orderNumber: 'TEST-12345',
  total: '2200.00',
  discountPercent: 10,
  couponCode: 'BACK-AB12CD',
  productName: 'Sample Product',
  oldPrice: '999',
  newPrice: '799',
  ctaUrl: '#',
}

function renderTemplate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_m, k) => (vars[k] != null ? String(vars[k]) : ''))
}

const EMPTY = {
  name: '',
  kind: '',
  description: '',
  delay_hours: 0,
  discount_percent: 0,
  coupon_id: null as string | null,
  subject_template: '',
  body_template: '',
}

export default function NewCampaignClient() {
  const router = useRouter()
  const { showToast } = useToast()
  const [form, setForm] = useState(EMPTY)
  const [coupons, setCoupons] = useState<CouponOption[]>([])
  const [couponsLoaded, setCouponsLoaded] = useState(false)
  const [creating, setCreating] = useState(false)
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiGenerating, setAiGenerating] = useState(false)

  async function loadCoupons() {
    if (couponsLoaded) return
    const res = await fetch('/api/admin/coupons?is_active=true&limit=100', { credentials: 'include' })
    if (res.ok) {
      const data = await res.json()
      setCoupons(data.coupons || [])
    }
    setCouponsLoaded(true)
  }

  async function generateWithAI() {
    if (!aiPrompt.trim()) return
    setAiGenerating(true)
    try {
      const res = await fetch('/api/admin/campaigns/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ prompt: aiPrompt.trim(), campaignName: form.name }),
      })
      const data = await res.json()
      if (res.ok) {
        setForm(f => ({
          ...f,
          name: f.name.trim() ? f.name : (data.name || f.name),
          kind: f.kind.trim() ? f.kind : (data.kind || f.kind),
          subject_template: data.subject_template,
          body_template: data.body_template,
        }))
        showToast('Template generated', 'success')
      } else {
        showToast(data.error || 'Generation failed', 'error')
      }
    } finally {
      setAiGenerating(false)
    }
  }

  async function create() {
    if (!form.name.trim() || !form.kind.trim()) {
      showToast('Name and kind are required', 'error')
      return
    }
    setCreating(true)
    try {
      const res = await fetch('/api/admin/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (res.ok) {
        showToast('Campaign created', 'success')
        router.push(`/admin/campaigns/${data.kind}`)
      } else {
        showToast(data.error || 'Failed to create', 'error')
      }
    } finally {
      setCreating(false)
    }
  }

  const selectedCoupon = coupons.find(c => c.id === form.coupon_id)
  const previewVars = selectedCoupon
    ? { ...SAMPLE_VARS, couponCode: selectedCoupon.code, discountPercent: selectedCoupon.discount_type === 'percentage' ? selectedCoupon.discount_value : 0 }
    : SAMPLE_VARS
  const previewSubject = renderTemplate(form.subject_template || 'Subject preview will appear here', previewVars)
  const previewBody = renderTemplate(form.body_template || '<p style="color:#888;font-family:sans-serif">Email body preview will appear here</p>', previewVars)

  return (
    <div className="space-y-5">
      <div className="bg-surface-elevated rounded-xl border border-border-default p-5 space-y-3">
        <p className="text-xs font-semibold text-foreground-muted uppercase tracking-wide">Generate template with AI</p>
        <div className="flex gap-2">
          <input
            type="text"
            value={aiPrompt}
            onChange={e => setAiPrompt(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && generateWithAI()}
            placeholder="Describe the campaign email you want…"
            className="flex-1 px-3 py-2 text-sm border border-border-secondary rounded-lg bg-surface text-foreground focus:outline-none focus:ring-2 focus:ring-accent-500"
          />
          <button
            type="button"
            onClick={generateWithAI}
            disabled={aiGenerating || !aiPrompt.trim()}
            className="px-4 py-2 bg-secondary-500 hover:bg-secondary-600 text-white rounded-lg text-sm font-semibold transition-all active:scale-95 disabled:opacity-50 shrink-0"
          >
            {aiGenerating ? 'Generating…' : 'Generate'}
          </button>
        </div>
        <p className="text-[10px] text-foreground-muted">AI will fill the name, kind, subject and body. You can edit anything afterwards.</p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <div className="bg-surface-elevated rounded-xl border border-border-default p-5 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-foreground-muted uppercase tracking-wide mb-1">Campaign name</label>
              <input
                type="text"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Summer Sale"
                className="w-full px-3 py-2 text-sm border border-border-secondary rounded-lg bg-surface text-foreground focus:outline-none focus:ring-2 focus:ring-accent-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-foreground-muted uppercase tracking-wide mb-1">Kind (slug)</label>
              <input
                type="text"
                value={form.kind}
                onChange={e => setForm(f => ({ ...f, kind: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') }))}
                placeholder="e.g. summer_sale"
                className="w-full px-3 py-2 text-sm border border-border-secondary rounded-lg bg-surface text-foreground focus:outline-none focus:ring-2 focus:ring-accent-500"
              />
              <p className="text-[10px] text-foreground-muted mt-1">Unique identifier — lowercase letters, numbers, underscores</p>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-foreground-muted uppercase tracking-wide mb-1">Description (optional)</label>
            <input
              type="text"
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              className="w-full px-3 py-2 text-sm border border-border-secondary rounded-lg bg-surface text-foreground focus:outline-none focus:ring-2 focus:ring-accent-500"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-foreground-muted uppercase tracking-wide mb-1">Delay (hours)</label>
              <input
                type="number"
                min={0}
                max={720}
                value={form.delay_hours}
                onChange={e => setForm(f => ({ ...f, delay_hours: parseInt(e.target.value || '0', 10) }))}
                className="w-full px-3 py-2 text-sm border border-border-secondary rounded-lg bg-surface text-foreground focus:outline-none focus:ring-2 focus:ring-accent-500"
              />
              <p className="text-[10px] text-foreground-muted mt-1">Hours after trigger before sending</p>
            </div>
            <div>
              <label className="block text-xs font-semibold text-foreground-muted uppercase tracking-wide mb-1">Discount %</label>
              <input
                type="number"
                min={0}
                max={100}
                value={form.discount_percent}
                onChange={e => setForm(f => ({ ...f, discount_percent: parseInt(e.target.value || '0', 10) }))}
                className="w-full px-3 py-2 text-sm border border-border-secondary rounded-lg bg-surface text-foreground focus:outline-none focus:ring-2 focus:ring-accent-500"
              />
              <p className="text-[10px] text-foreground-muted mt-1">Auto-generates per-user coupon if no coupon assigned</p>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-foreground-muted uppercase tracking-wide mb-1">Assign coupon</label>
            <select
              value={form.coupon_id || ''}
              onChange={e => setForm(f => ({ ...f, coupon_id: e.target.value || null }))}
              onFocus={loadCoupons}
              className="w-full px-3 py-2 text-sm border border-border-secondary rounded-lg bg-surface text-foreground focus:outline-none focus:ring-2 focus:ring-accent-500"
            >
              <option value="">None — use discount % to auto-generate</option>
              {coupons.map(c => (
                <option key={c.id} value={c.id}>
                  {c.code} — {c.discount_type === 'percentage' ? `${c.discount_value}% off` : `₹${c.discount_value} off`}
                  {c.description ? ` (${c.description})` : ''}
                </option>
              ))}
            </select>
            {selectedCoupon && (
              <p className="text-[10px] text-accent-600 dark:text-accent-400 mt-1">
                This coupon will be injected as {'{couponCode}'} in the template for all recipients.
              </p>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold text-foreground-muted uppercase tracking-wide mb-1">Subject line</label>
            <input
              type="text"
              value={form.subject_template}
              onChange={e => setForm(f => ({ ...f, subject_template: e.target.value }))}
              className="w-full px-3 py-2 text-sm border border-border-secondary rounded-lg bg-surface text-foreground focus:outline-none focus:ring-2 focus:ring-accent-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-foreground-muted uppercase tracking-wide mb-1">HTML body</label>
            <textarea
              value={form.body_template}
              onChange={e => setForm(f => ({ ...f, body_template: e.target.value }))}
              rows={10}
              className="w-full px-3 py-2 text-xs font-mono border border-border-secondary rounded-lg bg-surface text-foreground focus:outline-none focus:ring-2 focus:ring-accent-500"
            />
            <p className="text-[10px] text-foreground-muted mt-1">
              Variables: <code className="px-1 bg-surface-secondary rounded">{'{firstName}'}</code> <code className="px-1 bg-surface-secondary rounded">{'{orderNumber}'}</code> <code className="px-1 bg-surface-secondary rounded">{'{couponCode}'}</code> <code className="px-1 bg-surface-secondary rounded">{'{discountPercent}'}</code> <code className="px-1 bg-surface-secondary rounded">{'{productName}'}</code> <code className="px-1 bg-surface-secondary rounded">{'{ctaUrl}'}</code>
            </p>
          </div>

          <div className="flex items-center gap-3 pt-1">
            <button
              type="button"
              onClick={create}
              disabled={creating || !form.name.trim() || !form.kind.trim()}
              className="px-5 py-2 bg-accent-500 hover:bg-accent-600 text-white rounded-lg text-sm font-semibold transition-all active:scale-95 disabled:opacity-50"
            >
              {creating ? 'Creating…' : 'Create campaign'}
            </button>
            <button
              type="button"
              onClick={() => router.push('/admin/campaigns')}
              className="px-4 py-2 text-sm text-foreground-muted hover:text-foreground transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>

        <div className="bg-surface-elevated rounded-xl border border-border-default p-5">
          <h3 className="text-sm font-semibold text-foreground-muted uppercase tracking-widest mb-3">Preview</h3>
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
    </div>
  )
}
