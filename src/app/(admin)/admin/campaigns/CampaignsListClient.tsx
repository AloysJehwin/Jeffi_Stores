'use client'

import { useEffect, useState, useMemo } from 'react'
import Link from 'next/link'
import { useToast } from '@/contexts/ToastContext'
import { useConfirm } from '@/contexts/ConfirmContext'
import { ap } from '@/lib/shared/admin-path'
import { RequireWrite } from '@/contexts/AdminScopesContext'

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
  draft_fields: Record<string, unknown> | null
  updated_at: string | null
}

function getChannels(kind: string): ('email' | 'whatsapp')[] {
  const waKinds = [
    'abandoned_cart',
    'abandoned_checkout',
    'order_shipped',
    'order_delivered',
    'reorder_reminder',
    'back_in_stock',
    'back_in_stock_alert',
  ]
  if (waKinds.includes(kind)) return ['email', 'whatsapp']
  return ['email']
}

function ChannelChip({ channel }: { channel: 'email' | 'whatsapp' }) {
  if (channel === 'whatsapp')
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
        <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="currentColor">
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" />
          <path d="M12 2C6.477 2 2 6.477 2 12c0 1.89.525 3.66 1.438 5.168L2 22l4.975-1.407A9.953 9.953 0 0012 22c5.523 0 10-4.477 10-10S17.523 2 12 2zm0 18a7.946 7.946 0 01-4.073-1.117l-.292-.173-3.012.852.838-3.028-.19-.31A7.944 7.944 0 014 12c0-4.418 3.582-8 8-8s8 3.582 8 8-3.582 8-8 8z" />
        </svg>
        WhatsApp
      </span>
    )
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
      <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="2" y="4" width="20" height="16" rx="2" />
        <path d="m2 7 10 7 10-7" />
      </svg>
      Email
    </span>
  )
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

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'paused'>('all')
  const [channelFilter, setChannelFilter] = useState<'all' | 'email' | 'whatsapp'>('all')

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

  useEffect(() => {
    load(0)
  }, [])

  const filtered = useMemo(() => {
    return campaigns.filter(c => {
      if (c.kind === 'broadcast') return false
      if (statusFilter === 'active' && !c.enabled) return false
      if (statusFilter === 'paused' && c.enabled) return false
      if (channelFilter !== 'all') {
        if (!getChannels(c.kind).includes(channelFilter as 'email' | 'whatsapp')) return false
      }
      if (search.trim()) {
        const q = search.toLowerCase()
        if (
          !c.name.toLowerCase().includes(q) &&
          !(c.description || '').toLowerCase().includes(q) &&
          !c.kind.toLowerCase().includes(q)
        )
          return false
      }
      return true
    })
  }, [campaigns, search, statusFilter, channelFilter])

  async function discardDraft(c: CampaignRow) {
    const ok = await confirm({
      message: `Discard all unsaved changes for "${c.name}"? This cannot be undone.`,
      variant: 'danger',
      confirmLabel: 'Discard',
    })
    if (!ok) return
    setBusy(c.kind)
    try {
      await fetch(`/api/admin/campaigns/${c.kind}/draft`, { method: 'DELETE', credentials: 'include' })
      await load(offset)
    } finally {
      setBusy(null)
    }
  }

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
      const res = await fetch(`/api/admin/campaigns/${c.kind}/run`, { method: 'POST', credentials: 'include' })
      const data = await res.json()
      showToast(res.ok ? `Sent ${data.totalSent ?? 0} email(s).` : data.error || 'Failed', res.ok ? 'success' : 'error')
      await load(offset)
    } finally {
      setBusy(null)
    }
  }

  function rate(num: number, den: number) {
    if (den === 0) return '—'
    return `${((num / den) * 100).toFixed(1)}%`
  }

  if (loading)
    return (
      <div className="space-y-3">
        {[...Array(4)].map((_, i) => (
          <div
            key={i}
            className="bg-surface-elevated rounded-xl border border-border-default p-5 animate-pulse"
            style={{ animationDelay: `${i * 50}ms` }}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 space-y-2">
                <div className="h-5 w-40 bg-surface-secondary rounded" />
                <div className="h-3 w-56 bg-surface-secondary rounded" />
                <div className="h-3 w-32 bg-surface-secondary rounded" />
              </div>
              <div className="h-8 w-20 bg-surface-secondary rounded-lg" />
            </div>
          </div>
        ))}
      </div>
    )

  return (
    <div className="space-y-3">
      {/* Tab nav + New Campaign */}
      <div className="flex items-center justify-between gap-2 border-b border-border-default">
        <div className="flex items-center gap-2">
          <Link
            href={ap('/admin/campaigns')}
            className="px-4 py-2 text-sm font-semibold text-accent-600 dark:text-accent-400 border-b-2 border-accent-500"
          >
            Campaigns
          </Link>
          <Link
            href={ap('/admin/campaigns/scenarios')}
            className="px-4 py-2 text-sm font-semibold text-foreground-muted hover:text-foreground border-b-2 border-transparent transition-colors"
          >
            Scenarios
          </Link>
        </div>
        <RequireWrite scope="campaigns:write">
          <Link
            href={ap('/admin/campaigns/new')}
            className="mb-1 px-4 py-2 bg-accent-500 hover:bg-accent-600 text-white rounded-lg text-sm font-semibold transition-all active:scale-95"
          >
            + New Campaign
          </Link>
        </RequireWrite>
      </div>

      {/* Search + Filters */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground-muted pointer-events-none"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search campaigns..."
            className="w-full pl-9 pr-8 py-2 text-sm bg-surface-elevated border border-border-default rounded-lg text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-accent-500/40 focus:border-accent-500 transition-colors"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-foreground-muted hover:text-foreground"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* Status filter */}
        <div className="flex items-center gap-1 bg-surface-elevated border border-border-default rounded-lg p-1 shrink-0">
          {(['all', 'active', 'paused'] as const).map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1 rounded-md text-xs font-semibold capitalize transition-colors ${statusFilter === s ? 'bg-accent-500 text-white' : 'text-foreground-muted hover:text-foreground'}`}
            >
              {s}
            </button>
          ))}
        </div>

        {/* Channel filter */}
        <div className="flex items-center gap-1 bg-surface-elevated border border-border-default rounded-lg p-1 shrink-0">
          <button
            onClick={() => setChannelFilter('all')}
            className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${channelFilter === 'all' ? 'bg-accent-500 text-white' : 'text-foreground-muted hover:text-foreground'}`}
          >
            All
          </button>
          <button
            onClick={() => setChannelFilter('email')}
            className={`inline-flex items-center gap-1 px-3 py-1 rounded-md text-xs font-semibold transition-colors ${channelFilter === 'email' ? 'bg-blue-500 text-white' : 'text-foreground-muted hover:text-foreground'}`}
          >
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="2" y="4" width="20" height="16" rx="2" />
              <path d="m2 7 10 7 10-7" />
            </svg>
            Email
          </button>
          <button
            onClick={() => setChannelFilter('whatsapp')}
            className={`inline-flex items-center gap-1 px-3 py-1 rounded-md text-xs font-semibold transition-colors ${channelFilter === 'whatsapp' ? 'bg-green-500 text-white' : 'text-foreground-muted hover:text-foreground'}`}
          >
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" />
              <path d="M12 2C6.477 2 2 6.477 2 12c0 1.89.525 3.66 1.438 5.168L2 22l4.975-1.407A9.953 9.953 0 0012 22c5.523 0 10-4.477 10-10S17.523 2 12 2zm0 18a7.946 7.946 0 01-4.073-1.117l-.292-.173-3.012.852.838-3.028-.19-.31A7.944 7.944 0 014 12c0-4.418 3.582-8 8-8s8 3.582 8 8-3.582 8-8 8z" />
            </svg>
            WhatsApp
          </button>
        </div>
      </div>

      {/* Result count when filtering */}
      {(search || statusFilter !== 'all' || channelFilter !== 'all') && (
        <p className="text-xs text-foreground-muted">
          {filtered.length} campaign{filtered.length !== 1 ? 's' : ''} found
          {search && (
            <>
              {' '}
              matching <span className="font-medium text-foreground">&quot;{search}&quot;</span>
            </>
          )}
        </p>
      )}

      {/* Pending drafts */}
      {(() => {
        const pendingDrafts = campaigns.filter(c => c.kind !== 'broadcast' && c.draft_fields != null)
        if (!pendingDrafts.length) return null
        return (
          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-700 rounded-lg overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-amber-200 dark:border-amber-700/50">
              <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                Pending Drafts ({pendingDrafts.length})
              </p>
              <p className="text-xs text-amber-600 dark:text-amber-400">Unpublished edits — click to open</p>
            </div>
            <div className="divide-y divide-amber-100 dark:divide-amber-800/30">
              {pendingDrafts.map(d => (
                <div
                  key={d.kind}
                  className="flex items-center justify-between px-4 py-2.5 hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-colors"
                >
                  <Link href={ap(`/admin/campaigns/${d.kind}`)} className="flex-1 min-w-0 mr-4">
                    <p className="text-sm font-medium text-amber-900 dark:text-amber-200">{d.name}</p>
                  </Link>
                  <div className="flex items-center gap-2 shrink-0">
                    <RequireWrite scope="campaigns:write">
                      <Link
                        href={ap(`/admin/campaigns/${d.kind}`)}
                        className="px-2.5 py-1 text-xs font-semibold bg-green-600 hover:bg-green-700 text-white rounded-md transition-colors"
                      >
                        Publish
                      </Link>
                      <button
                        type="button"
                        onClick={() => discardDraft(d)}
                        disabled={busy === d.kind}
                        className="px-2.5 py-1 text-xs font-semibold bg-surface border border-amber-300 dark:border-amber-600 text-amber-800 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/40 rounded-md transition-colors disabled:opacity-50"
                      >
                        {busy === d.kind ? '…' : 'Discard'}
                      </button>
                    </RequireWrite>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      })()}

      {/* Campaign cards */}
      {filtered.length === 0 ? (
        <div className="py-12 text-center text-foreground-muted text-sm">No campaigns match your filters.</div>
      ) : (
        filtered.map(c => (
          <div key={c.kind} className="bg-surface-elevated rounded-xl border border-border-default p-5">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <Link
                    href={ap(`/admin/campaigns/${c.kind}`)}
                    className="font-semibold text-foreground hover:text-accent-500 transition-colors"
                  >
                    {c.name}
                  </Link>
                  <span
                    className={`px-2 py-0.5 text-[10px] font-semibold rounded-full ${c.enabled ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'}`}
                  >
                    {c.enabled ? 'Active' : 'Paused'}
                  </span>
                  {getChannels(c.kind).map(ch => (
                    <ChannelChip key={ch} channel={ch} />
                  ))}
                  {c.draft_fields != null && (
                    <span className="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                      Draft pending
                    </span>
                  )}
                  {c.discount_percent > 0 && (
                    <span className="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                      {c.discount_percent}% off
                    </span>
                  )}
                </div>
                {c.description && <p className="text-xs text-foreground-muted mt-1">{c.description}</p>}
                <p className="text-[10px] text-foreground-muted mt-2">
                  Delay: {c.delay_hours}h · Last run:{' '}
                  {c.last_run_at
                    ? new Date(c.last_run_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
                    : 'never'}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <RequireWrite scope="campaigns:write">
                  <button
                    type="button"
                    onClick={() => toggle(c)}
                    disabled={busy === c.kind}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all active:scale-95 disabled:opacity-50 ${c.enabled ? 'bg-zinc-200 hover:bg-zinc-300 text-zinc-800 dark:bg-zinc-700 dark:text-zinc-200' : 'bg-green-500 hover:bg-green-600 text-white'}`}
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
                </RequireWrite>
                <Link
                  href={ap(`/admin/campaigns/${c.kind}`)}
                  className="px-3 py-1.5 bg-secondary-500 hover:bg-secondary-600 text-white rounded-lg text-xs font-semibold transition-all"
                >
                  View / Edit
                </Link>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <div>
                <p className="text-[10px] uppercase tracking-wide text-foreground-muted">Sent</p>
                <p className="text-lg font-bold text-foreground tabular-nums">
                  {Number(c.total_sent).toLocaleString('en-IN')}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-foreground-muted">Opened</p>
                <p className="text-lg font-bold text-foreground tabular-nums">
                  {Number(c.total_opened).toLocaleString('en-IN')}
                </p>
                <p className="text-[10px] text-foreground-muted">
                  {rate(Number(c.total_opened), Number(c.total_sent))}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-foreground-muted">Clicked</p>
                <p className="text-lg font-bold text-foreground tabular-nums">
                  {Number(c.total_clicked).toLocaleString('en-IN')}
                </p>
                <p className="text-[10px] text-foreground-muted">
                  {rate(Number(c.total_clicked), Number(c.total_sent))}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-foreground-muted">Converted</p>
                <p className="text-lg font-bold text-green-600 dark:text-green-400 tabular-nums">
                  {Number(c.total_converted).toLocaleString('en-IN')}
                </p>
                <p className="text-[10px] text-foreground-muted">
                  {rate(Number(c.total_converted), Number(c.total_sent))}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-foreground-muted">Revenue</p>
                <p className="text-lg font-bold text-foreground tabular-nums">
                  ₹{Math.round(Number(c.revenue_attributed)).toLocaleString('en-IN')}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-foreground-muted">Unsub</p>
                <p className="text-lg font-bold text-red-500 tabular-nums">
                  {Number(c.total_unsubscribed).toLocaleString('en-IN')}
                </p>
                <p className="text-[10px] text-foreground-muted">
                  {rate(Number(c.total_unsubscribed), Number(c.total_sent))}
                </p>
              </div>
            </div>
          </div>
        ))
      )}

      {total > LIMIT && !search && statusFilter === 'all' && channelFilter === 'all' && (
        <div className="flex items-center justify-between pt-1 text-sm text-foreground-muted">
          <span>
            Showing {offset + 1}–{Math.min(offset + LIMIT, total)} of {total}
          </span>
          <div className="flex gap-2">
            <button
              disabled={offset === 0}
              onClick={() => {
                const o = offset - LIMIT
                setOffset(o)
                load(o)
              }}
              className="px-3 py-1.5 rounded-lg bg-surface-secondary hover:bg-border-default text-xs font-medium disabled:opacity-40 transition-colors"
            >
              Previous
            </button>
            <button
              disabled={offset + LIMIT >= total}
              onClick={() => {
                const o = offset + LIMIT
                setOffset(o)
                load(o)
              }}
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
