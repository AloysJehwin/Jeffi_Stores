'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useToast } from '@/contexts/ToastContext'
import { useConfirm } from '@/contexts/ConfirmContext'

interface CampaignRow {
  kind: string
  name: string
  description: string | null
  enabled: boolean
  delay_hours: number
  discount_percent: number
  total_sent: number
  total_opened: number
  total_clicked: number
  total_converted: number
  total_unsubscribed: number
  revenue_attributed: string | number
  sent_last_24h: string | null
  last_run_at: string | null
}

const EMPTY_FORM = { name: '', kind: '', description: '', subject_template: '', body_template: '' }

export default function CampaignsListClient() {
  const { showToast } = useToast()
  const confirm = useConfirm()
  const router = useRouter()
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [newForm, setNewForm] = useState(EMPTY_FORM)
  const [creating, setCreating] = useState(false)
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiGenerating, setAiGenerating] = useState(false)

  async function load() {
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

  useEffect(() => { load() }, [])

  async function toggle(c: CampaignRow) {
    setBusy(c.kind)
    try {
      await fetch(`/api/admin/campaigns/${c.kind}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ enabled: !c.enabled }),
      })
      await load()
    } finally {
      setBusy(null)
    }
  }

  async function runNow(c: CampaignRow) {
    const ok = await confirm({
      title: 'Run campaign now?',
      message: `"${c.name}" will send emails to all eligible customers right now. Continue?`,
      confirmLabel: 'Run now',
    })
    if (!ok) return
    setBusy(c.kind)
    try {
      const res = await fetch(`/api/admin/campaigns/${c.kind}/run`, {
        method: 'POST',
        credentials: 'include',
      })
      const data = await res.json()
      showToast(
        res.ok ? `Sent ${data.totalSent ?? 0} email(s).` : (data.error || 'Failed'),
        res.ok ? 'success' : 'error'
      )
      await load()
    } finally {
      setBusy(null)
    }
  }

  async function generateWithAI() {
    if (!aiPrompt.trim()) return
    setAiGenerating(true)
    try {
      const res = await fetch('/api/admin/campaigns/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ prompt: aiPrompt.trim(), campaignName: newForm.name }),
      })
      const data = await res.json()
      if (res.ok) {
        setNewForm(f => ({
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

  async function createCampaign() {
    if (!newForm.name.trim() || !newForm.kind.trim()) {
      showToast('Name and kind are required', 'error')
      return
    }
    setCreating(true)
    try {
      const res = await fetch('/api/admin/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(newForm),
      })
      const data = await res.json()
      if (res.ok) {
        setShowNew(false)
        setNewForm(EMPTY_FORM)
        setAiPrompt('')
        showToast('Campaign created', 'success')
        router.push(`/admin/campaigns/${data.kind}`)
      } else {
        showToast(data.error || 'Failed to create', 'error')
      }
    } finally {
      setCreating(false)
    }
  }

  function rate(num: number, den: number) {
    if (den === 0) return '—'
    return `${((num / den) * 100).toFixed(1)}%`
  }

  if (loading) return <p className="text-sm text-foreground-muted">Loading campaigns…</p>

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setShowNew(true)}
          className="px-4 py-2 bg-accent-500 hover:bg-accent-600 text-white rounded-lg text-sm font-semibold transition-all active:scale-95"
        >
          + New Campaign
        </button>
      </div>

      {showNew && (
        <div className="bg-surface-elevated rounded-xl border border-accent-300 dark:border-accent-700 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-foreground">New Campaign</h3>
            <button
              type="button"
              onClick={() => { setShowNew(false); setNewForm(EMPTY_FORM); setAiPrompt('') }}
              className="text-foreground-muted hover:text-foreground text-lg leading-none"
            >
              ×
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-foreground-muted uppercase tracking-wide mb-1">Campaign name</label>
              <input
                type="text"
                value={newForm.name}
                onChange={e => setNewForm(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Summer Sale"
                className="w-full px-3 py-2 text-sm border border-border-secondary rounded-lg bg-surface text-foreground focus:outline-none focus:ring-2 focus:ring-accent-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-foreground-muted uppercase tracking-wide mb-1">Kind (slug)</label>
              <input
                type="text"
                value={newForm.kind}
                onChange={e => setNewForm(f => ({ ...f, kind: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') }))}
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
              value={newForm.description}
              onChange={e => setNewForm(f => ({ ...f, description: e.target.value }))}
              className="w-full px-3 py-2 text-sm border border-border-secondary rounded-lg bg-surface text-foreground focus:outline-none focus:ring-2 focus:ring-accent-500"
            />
          </div>

          <div className="border border-border-default rounded-lg p-4 space-y-3 bg-surface">
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
          </div>

          <div>
            <label className="block text-xs font-semibold text-foreground-muted uppercase tracking-wide mb-1">Subject template</label>
            <input
              type="text"
              value={newForm.subject_template}
              onChange={e => setNewForm(f => ({ ...f, subject_template: e.target.value }))}
              placeholder="Hi {firstName}, here's your offer!"
              className="w-full px-3 py-2 text-sm border border-border-secondary rounded-lg bg-surface text-foreground focus:outline-none focus:ring-2 focus:ring-accent-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-foreground-muted uppercase tracking-wide mb-1">Body template (HTML)</label>
            <textarea
              value={newForm.body_template}
              onChange={e => setNewForm(f => ({ ...f, body_template: e.target.value }))}
              rows={8}
              placeholder="<p>Hi {firstName},</p>"
              className="w-full px-3 py-2 text-xs font-mono border border-border-secondary rounded-lg bg-surface text-foreground focus:outline-none focus:ring-2 focus:ring-accent-500"
            />
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => { setShowNew(false); setNewForm(EMPTY_FORM); setAiPrompt('') }}
              className="px-4 py-2 text-sm text-foreground-secondary hover:text-foreground transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={createCampaign}
              disabled={creating || !newForm.name.trim() || !newForm.kind.trim()}
              className="px-4 py-2 bg-accent-500 hover:bg-accent-600 text-white rounded-lg text-sm font-semibold transition-all active:scale-95 disabled:opacity-50"
            >
              {creating ? 'Creating…' : 'Create campaign'}
            </button>
          </div>
        </div>
      )}

      {campaigns.filter(c => c.kind !== 'broadcast').map(c => (
        <div key={c.kind} className="bg-surface-elevated rounded-xl border border-border-default p-5">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                <h3 className="font-semibold text-foreground">{c.name}</h3>
                <span className={`px-2 py-0.5 text-[10px] font-semibold rounded-full ${
                  c.enabled
                    ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                    : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'
                }`}>
                  {c.enabled ? 'Active' : 'Paused'}
                </span>
                {c.discount_percent > 0 && (
                  <span className="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                    {c.discount_percent}% off
                  </span>
                )}
              </div>
              {c.description && <p className="text-xs text-foreground-muted mt-1">{c.description}</p>}
              <p className="text-[10px] text-foreground-muted mt-2">
                Delay: {c.delay_hours}h · Last run: {c.last_run_at ? new Date(c.last_run_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : 'never'}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => toggle(c)}
                disabled={busy === c.kind}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all active:scale-95 disabled:opacity-50 ${
                  c.enabled
                    ? 'bg-zinc-200 hover:bg-zinc-300 text-zinc-800 dark:bg-zinc-700 dark:text-zinc-200'
                    : 'bg-green-500 hover:bg-green-600 text-white'
                }`}
              >
                {c.enabled ? 'Pause' : 'Activate'}
              </button>
              <button
                type="button"
                onClick={() => runNow(c)}
                disabled={busy === c.kind || !c.enabled}
                className="px-3 py-1.5 bg-accent-500 hover:bg-accent-600 text-white rounded-lg text-xs font-semibold transition-all active:scale-95 disabled:opacity-50"
              >
                Run now
              </button>
              <Link
                href={`/admin/campaigns/${c.kind}`}
                className="px-3 py-1.5 bg-secondary-500 hover:bg-secondary-600 text-white rounded-lg text-xs font-semibold transition-all"
              >
                Edit
              </Link>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <div>
              <p className="text-[10px] uppercase tracking-wide text-foreground-muted">Sent</p>
              <p className="text-lg font-bold text-foreground tabular-nums">{Number(c.total_sent).toLocaleString('en-IN')}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-foreground-muted">Opened</p>
              <p className="text-lg font-bold text-foreground tabular-nums">{Number(c.total_opened).toLocaleString('en-IN')}</p>
              <p className="text-[10px] text-foreground-muted">{rate(Number(c.total_opened), Number(c.total_sent))}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-foreground-muted">Clicked</p>
              <p className="text-lg font-bold text-foreground tabular-nums">{Number(c.total_clicked).toLocaleString('en-IN')}</p>
              <p className="text-[10px] text-foreground-muted">{rate(Number(c.total_clicked), Number(c.total_sent))}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-foreground-muted">Converted</p>
              <p className="text-lg font-bold text-green-600 dark:text-green-400 tabular-nums">{Number(c.total_converted).toLocaleString('en-IN')}</p>
              <p className="text-[10px] text-foreground-muted">{rate(Number(c.total_converted), Number(c.total_sent))}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-foreground-muted">Revenue</p>
              <p className="text-lg font-bold text-foreground tabular-nums">₹{Math.round(Number(c.revenue_attributed)).toLocaleString('en-IN')}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-foreground-muted">Unsub</p>
              <p className="text-lg font-bold text-red-500 tabular-nums">{Number(c.total_unsubscribed).toLocaleString('en-IN')}</p>
              <p className="text-[10px] text-foreground-muted">{rate(Number(c.total_unsubscribed), Number(c.total_sent))}</p>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
