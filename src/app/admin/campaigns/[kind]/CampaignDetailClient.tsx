'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useToast } from '@/contexts/ToastContext'

interface Campaign {
  kind: string
  name: string
  description: string | null
  enabled: boolean
  delay_hours: number
  discount_percent: number
  coupon_id: string | null
  subject_template: string
  body_template: string
  last_run_at: string | null
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
}

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

export default function CampaignDetailClient({ kind }: { kind: string }) {
  const router = useRouter()
  const { showToast } = useToast()
  const [campaign, setCampaign] = useState<Campaign | null>(null)
  const [recentSends, setRecentSends] = useState<RecentSend[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testEmail, setTestEmail] = useState('')
  const [testBusy, setTestBusy] = useState(false)
  const [coupons, setCoupons] = useState<CouponOption[]>([])
  const [form, setForm] = useState<{
    enabled: boolean
    delay_hours: number
    discount_percent: number
    coupon_id: string | null
    subject_template: string
    body_template: string
  } | null>(null)

  async function load() {
    setLoading(true)
    try {
      const [campaignRes, couponsRes] = await Promise.all([
        fetch(`/api/admin/campaigns/${kind}`, { credentials: 'include' }),
        fetch('/api/admin/coupons?is_active=true&limit=100', { credentials: 'include' }),
      ])
      if (campaignRes.ok) {
        const data = await campaignRes.json()
        setCampaign(data.campaign)
        setRecentSends(data.recentSends || [])
        setForm({
          enabled: data.campaign.enabled,
          delay_hours: data.campaign.delay_hours,
          discount_percent: data.campaign.discount_percent,
          coupon_id: data.campaign.coupon_id || null,
          subject_template: data.campaign.subject_template,
          body_template: data.campaign.body_template,
        })
      }
      if (couponsRes.ok) {
        const cd = await couponsRes.json()
        setCoupons(cd.coupons || [])
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [kind])

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
        await load()
        router.refresh()
        showToast('Campaign settings saved', 'success')
      } else {
        showToast('Failed to save', 'error')
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

  if (loading || !campaign || !form) return <p className="text-sm text-foreground-muted">Loading…</p>

  const selectedCoupon = coupons.find(c => c.id === form.coupon_id)
  const previewVars = selectedCoupon
    ? { ...SAMPLE_VARS, couponCode: selectedCoupon.code, discountPercent: selectedCoupon.discount_type === 'percentage' ? selectedCoupon.discount_value : 0 }
    : SAMPLE_VARS
  const previewSubject = renderTemplate(form.subject_template, previewVars)
  const previewBody = renderTemplate(form.body_template, previewVars)

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
              className="w-full px-3 py-2 text-sm border border-border-secondary rounded-lg bg-surface text-foreground focus:outline-none focus:ring-2 focus:ring-accent-500"
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
              className="w-full px-3 py-2 text-sm border border-border-secondary rounded-lg bg-surface text-foreground focus:outline-none focus:ring-2 focus:ring-accent-500"
            />
            <p className="text-[10px] text-foreground-muted mt-1">Auto-generates a unique per-user coupon if no coupon is assigned below</p>
          </div>
        </div>

        <div className="mt-4">
          <label className="block text-xs font-semibold text-foreground-muted uppercase tracking-wide mb-1">
            Assign coupon
          </label>
          <select
            value={form.coupon_id || ''}
            onChange={e => setForm({ ...form, coupon_id: e.target.value || null })}
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

        <div className="mt-4">
          <label className="block text-xs font-semibold text-foreground-muted uppercase tracking-wide mb-1">
            Subject line
          </label>
          <input
            type="text"
            value={form.subject_template}
            onChange={e => setForm({ ...form, subject_template: e.target.value })}
            className="w-full px-3 py-2 text-sm border border-border-secondary rounded-lg bg-surface text-foreground focus:outline-none focus:ring-2 focus:ring-accent-500"
          />
        </div>

        <div className="mt-4">
          <label className="block text-xs font-semibold text-foreground-muted uppercase tracking-wide mb-1">
            HTML body
          </label>
          <textarea
            value={form.body_template}
            onChange={e => setForm({ ...form, body_template: e.target.value })}
            rows={10}
            className="w-full px-3 py-2 text-xs font-mono border border-border-secondary rounded-lg bg-surface text-foreground focus:outline-none focus:ring-2 focus:ring-accent-500"
          />
          <p className="text-[10px] text-foreground-muted mt-1">
            Variables: <code className="px-1 bg-surface-secondary rounded">{'{firstName}'}</code> <code className="px-1 bg-surface-secondary rounded">{'{orderNumber}'}</code> <code className="px-1 bg-surface-secondary rounded">{'{couponCode}'}</code> <code className="px-1 bg-surface-secondary rounded">{'{discountPercent}'}</code> <code className="px-1 bg-surface-secondary rounded">{'{productName}'}</code> <code className="px-1 bg-surface-secondary rounded">{'{ctaUrl}'}</code>
          </p>
        </div>

        <div className="flex items-center gap-2 mt-5 flex-wrap">
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="px-4 py-2 bg-accent-500 hover:bg-accent-600 text-white rounded-lg text-sm font-semibold transition-all active:scale-95 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
          <input
            type="email"
            value={testEmail}
            onChange={e => setTestEmail(e.target.value)}
            placeholder="your@email.com for test send"
            className="flex-1 max-w-xs px-3 py-2 text-sm border border-border-secondary rounded-lg bg-surface text-foreground focus:outline-none focus:ring-2 focus:ring-accent-500"
          />
          <button
            type="button"
            onClick={sendTest}
            disabled={testBusy || !testEmail.trim()}
            className="px-4 py-2 bg-secondary-500 hover:bg-secondary-600 text-white rounded-lg text-sm font-semibold transition-all active:scale-95 disabled:opacity-50"
          >
            {testBusy ? 'Sending…' : 'Send test'}
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

      <div className="bg-surface-elevated rounded-xl border border-border-default overflow-hidden">
        <div className="px-5 py-3 border-b border-border-default">
          <h3 className="text-sm font-semibold text-foreground">Recent sends ({recentSends.length})</h3>
        </div>
        {recentSends.length === 0 ? (
          <p className="p-8 text-sm text-foreground-muted text-center">No sends yet</p>
        ) : (
          <div className="divide-y divide-border-default">
            {recentSends.map(s => {
              const st = status(s)
              return (
                <div key={s.id} className="px-5 py-3 flex items-center justify-between gap-3 hover:bg-surface-secondary/50">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-foreground truncate">{s.user_name || s.user_email}</p>
                    <p className="text-[10px] text-foreground-muted">{new Date(s.sent_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</p>
                  </div>
                  <span className={`px-2 py-0.5 text-[10px] font-semibold rounded-full ${st.color}`}>{st.label}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
