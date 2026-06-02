'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
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

export default function CampaignsListClient() {
  const { showToast } = useToast()
  const confirm = useConfirm()
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [offset, setOffset] = useState(0)
  const [total, setTotal] = useState(0)
  const LIMIT = 20

  async function load(off = offset) {
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/campaigns?limit=${LIMIT}&offset=${off}`, { credentials: 'include' })
      if (res.ok) {
        const data = await res.json()
        setCampaigns(data.campaigns || [])
        setTotal(data.total || 0)
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load(0) }, [])

  async function toggle(c: CampaignRow) {
    setBusy(c.kind)
    try {
      await fetch(`/api/admin/campaigns/${c.kind}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ enabled: !c.enabled }),
      })
      await load(offset)
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
      await load(offset)
    } finally {
      setBusy(null)
    }
  }

  function rate(num: number, den: number) {
    if (den === 0) return '—'
    return `${((num / den) * 100).toFixed(1)}%`
  }

  if (loading) return <p className="text-sm text-foreground-muted">Loading campaigns…</p>

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 border-b border-border-default">
        <div className="flex items-center gap-2">
          <Link
            href="/admin/campaigns"
            className="px-4 py-2 text-sm font-semibold text-accent-600 dark:text-accent-400 border-b-2 border-accent-500"
          >
            Campaigns
          </Link>
          <Link
            href="/admin/campaigns/scenarios"
            className="px-4 py-2 text-sm font-semibold text-foreground-muted hover:text-foreground border-b-2 border-transparent transition-colors"
          >
            Scenarios
          </Link>
        </div>
        <Link
          href="/admin/campaigns/new"
          className="mb-1 px-4 py-2 bg-accent-500 hover:bg-accent-600 text-white rounded-lg text-sm font-semibold transition-all active:scale-95"
        >
          + New Campaign
        </Link>
      </div>

      {campaigns.filter(c => c.kind !== 'broadcast').map(c => (
        <div key={c.kind} className="bg-surface-elevated rounded-xl border border-border-default p-5">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                <Link href={`/admin/campaigns/${c.kind}`} className="font-semibold text-foreground hover:text-accent-500 transition-colors">
                  {c.name}
                </Link>
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
                View / Edit
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

      {total > LIMIT && (
        <div className="flex items-center justify-between pt-1 text-sm text-foreground-muted">
          <span>Showing {offset + 1}–{Math.min(offset + LIMIT, total)} of {total}</span>
          <div className="flex gap-2">
            <button
              disabled={offset === 0}
              onClick={() => { const o = offset - LIMIT; setOffset(o); load(o) }}
              className="px-3 py-1.5 rounded-lg bg-surface-secondary hover:bg-border-default text-xs font-medium disabled:opacity-40 transition-colors"
            >
              Previous
            </button>
            <button
              disabled={offset + LIMIT >= total}
              onClick={() => { const o = offset + LIMIT; setOffset(o); load(o) }}
              className="px-3 py-1.5 rounded-lg bg-surface-secondary hover:bg-border-default text-xs font-medium disabled:opacity-40 transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
