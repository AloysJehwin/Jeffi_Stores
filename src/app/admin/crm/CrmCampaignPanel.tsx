'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useToast } from '@/contexts/ToastContext'
import { ap } from '@/lib/admin-path'

interface CampaignForm {
  delay_hours: number
  discount_percent: number
  subject_template: string
  body_template: string
}

interface Campaign extends CampaignForm {
  kind: string
  name: string
  description: string | null
  enabled: boolean
  last_run_at: string | null
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

interface Props {
  defaultKind: string
  recipientCount: number
  onClose: () => void
}

export default function CrmCampaignPanel({ defaultKind, recipientCount, onClose }: Props) {
  const router = useRouter()
  const { showToast, showConfirm } = useToast()
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [selectedKind, setSelectedKind] = useState(defaultKind)
  const [form, setForm] = useState<CampaignForm | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [running, setRunning] = useState(false)
  const [tab, setTab] = useState<'config' | 'preview'>('config')

  useEffect(() => {
    async function loadAll() {
      setLoading(true)
      try {
        const res = await fetch('/api/admin/campaigns', { credentials: 'include' })
        if (res.ok) {
          const data = await res.json()
          setCampaigns(data.campaigns || [])
        }
      } finally {
        setLoading(false)
      }
    }
    loadAll()
  }, [])

  useEffect(() => {
    const c = campaigns.find(c => c.kind === selectedKind)
    if (c) {
      setForm({
        delay_hours: c.delay_hours,
        discount_percent: c.discount_percent,
        subject_template: c.subject_template,
        body_template: c.body_template,
      })
    }
  }, [selectedKind, campaigns])

  async function saveAndRun() {
    if (!form) return
    const ok = await showConfirm({
      title: 'Save & Send Campaign',
      message: `Save settings and send campaign to ${recipientCount} customers?`,
      confirmText: 'Send',
      type: 'info',
    })
    if (!ok) return
    setSaving(true)
    try {
      const patchRes = await fetch(`/api/admin/campaigns/${selectedKind}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(form),
      })
      if (!patchRes.ok) { showToast('Failed to save campaign settings.', 'error'); return }
    } finally {
      setSaving(false)
    }
    setRunning(true)
    try {
      const runRes = await fetch(`/api/admin/campaigns/${selectedKind}/run`, {
        method: 'POST',
        credentials: 'include',
      })
      if (runRes.ok) {
        showToast('Campaign triggered successfully.', 'success')
        onClose()
        router.push(ap(`/admin/campaigns/${selectedKind}`))
      } else {
        showToast('Failed to run campaign. Check Campaigns page.', 'error')
      }
    } finally {
      setRunning(false)
    }
  }

  async function saveOnly() {
    if (!form) return
    setSaving(true)
    try {
      const res = await fetch(`/api/admin/campaigns/${selectedKind}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(form),
      })
      if (res.ok) {
        const updated = campaigns.map(c =>
          c.kind === selectedKind ? { ...c, ...form } : c
        )
        setCampaigns(updated)
        showToast('Campaign settings saved.', 'success')
      } else {
        showToast('Failed to save campaign settings.', 'error')
      }
    } finally {
      setSaving(false)
    }
  }

  const inputCls = 'w-full px-3 py-2 text-sm border border-border-secondary rounded-lg bg-surface text-foreground focus:outline-none focus:ring-2 focus:ring-accent-500'

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <span className="w-5 h-5 border-2 border-accent-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const previewSubject = form ? renderTemplate(form.subject_template, SAMPLE_VARS) : ''
  const previewBody = form ? renderTemplate(form.body_template, SAMPLE_VARS) : ''

  return (
    <div className="flex flex-col gap-4">
      {/* Campaign selector */}
      <div>
        <label className="block text-xs font-semibold text-foreground-muted uppercase tracking-wide mb-1.5">
          Campaign
        </label>
        <div className="flex flex-wrap gap-2">
          {campaigns.map(c => (
            <button
              key={c.kind}
              type="button"
              onClick={() => setSelectedKind(c.kind)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                selectedKind === c.kind
                  ? 'bg-accent-500 border-accent-500 text-white'
                  : 'bg-surface border-border-secondary text-foreground-muted hover:text-foreground hover:border-border-default'
              }`}
            >
              {c.name}
            </button>
          ))}
        </div>
        {campaigns.find(c => c.kind === selectedKind)?.description && (
          <p className="text-[11px] text-foreground-muted mt-1.5">
            {campaigns.find(c => c.kind === selectedKind)!.description}
          </p>
        )}
      </div>

      {/* Config / Preview tabs */}
      <div className="flex items-center gap-1 bg-surface-secondary rounded-lg p-0.5 self-start">
        {(['config', 'preview'] as const).map(t => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-colors capitalize ${
              tab === t ? 'bg-surface-elevated shadow text-foreground' : 'text-foreground-muted hover:text-foreground'
            }`}
          >
            {t === 'config' ? 'Configure' : 'Preview'}
          </button>
        ))}
      </div>

      {form && tab === 'config' && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
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
                className={inputCls}
              />
              <p className="text-[10px] text-foreground-muted mt-0.5">Hours after trigger before sending</p>
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
                className={inputCls}
              />
              <p className="text-[10px] text-foreground-muted mt-0.5">Auto-generates a unique single-use coupon</p>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-foreground-muted uppercase tracking-wide mb-1">
              Subject line
            </label>
            <input
              type="text"
              value={form.subject_template}
              onChange={e => setForm({ ...form, subject_template: e.target.value })}
              className={inputCls}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-foreground-muted uppercase tracking-wide mb-1">
              HTML body
            </label>
            <textarea
              value={form.body_template}
              onChange={e => setForm({ ...form, body_template: e.target.value })}
              rows={6}
              className={`${inputCls} font-mono text-xs`}
            />
            <p className="text-[10px] text-foreground-muted mt-0.5">
              Variables: <code className="px-1 bg-surface-secondary rounded">{'{firstName}'}</code>{' '}
              <code className="px-1 bg-surface-secondary rounded">{'{couponCode}'}</code>{' '}
              <code className="px-1 bg-surface-secondary rounded">{'{discountPercent}'}</code>{' '}
              <code className="px-1 bg-surface-secondary rounded">{'{ctaUrl}'}</code>
            </p>
          </div>
        </div>
      )}

      {form && tab === 'preview' && (
        <div className="border border-border-default rounded-lg overflow-hidden">
          <div className="px-4 py-2 bg-surface-secondary border-b border-border-default text-xs">
            <span className="text-foreground-muted">Subject:</span>{' '}
            <span className="font-semibold text-foreground">{previewSubject}</span>
          </div>
          <div
            className="p-4 bg-white text-zinc-900 text-xs max-h-52 overflow-y-auto"
            dangerouslySetInnerHTML={{ __html: previewBody }}
          />
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-2 flex-wrap pt-1">
        <button
          type="button"
          onClick={saveOnly}
          disabled={saving || running || !form}
          className="px-3 py-1.5 rounded-lg border border-border-secondary text-xs font-semibold text-foreground hover:bg-surface-secondary transition-colors disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save settings'}
        </button>
        <button
          type="button"
          onClick={saveAndRun}
          disabled={saving || running || !form}
          className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-accent-500 hover:bg-accent-600 text-white text-xs font-semibold transition-colors disabled:opacity-60"
        >
          {running ? (
            <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          )}
          {running ? 'Sending…' : `Save & send to ${recipientCount}`}
        </button>
      </div>
    </div>
  )
}
