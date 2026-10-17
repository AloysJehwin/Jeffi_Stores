'use client'

import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import { useActionToast } from '@/components/admin/kit'
import { Kpi, KpiGrid, Section, Table, api, btnGhost, count, money, when } from '@/components/admin/channels/ui'
import { label } from './shared'

interface Totals {
  posts: number
  impressions: number
  reach: number
  engagement: number
  clicks: number
  orders: number
  revenue: number
}
interface NetRow {
  network: string
  posts: number
  impressions: number
  reach: number
  engagement: number
  clicks: number
}
interface TopRow {
  id: string
  platform: string
  caption: string | null
  title: string | null
  permalink: string | null
  scheduled_at: string
  impressions: number | null
  reach: number | null
  clicks: number | null
  engagement: number
  orders: number
  revenue: number
}

export default function Insights({ onSynced }: { onSynced: () => void }) {
  const canWrite = useCanWrite('social')
  const [days, setDays] = useState(30)
  const [d, setD] = useState<{ totals: Totals; byNetwork: NetRow[]; top: TopRow[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const toast = useActionToast()
  const setBanner = (b: { ok: boolean; text: string } | null) => void (b && toast.result(b))
  const [tick, setTick] = useState(0)

  useEffect(() => {
    setD(null)
    setError(null)
    api(`/api/admin/social/insights?days=${days}`).then(r => (r.ok ? setD(r.data) : setError(r.data.error || 'Could not load insights')))
  }, [days, tick])

  async function sync() {
    setSyncing(true)
    setBanner(null)
    const r = await api<{ insights: { networks: Record<string, number | string> }; inbox: { networks: Record<string, number | string> } }>('/api/admin/social/sync', {
      method: 'POST',
    })
    setSyncing(false)
    if (!r.ok) return setBanner({ ok: false, text: r.data.error || 'Refresh failed' })
    const errors = [...Object.entries(r.data.insights?.networks ?? {}), ...Object.entries(r.data.inbox?.networks ?? {})].filter(([, v]) => typeof v === 'string')
    setBanner(errors.length ? { ok: false, text: `Refreshed with problems: ${errors.map(([k, v]) => `${k}: ${v}`).join('; ')}` } : { ok: true, text: 'Metrics and inbox refreshed.' })
    setTick(t => t + 1)
    onSynced()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex h-control w-fit gap-1 rounded-lg border border-border-default bg-surface-elevated p-0.5">
          {[7, 30, 90].map(n => (
            <button
              key={n}
              type="button"
              onClick={() => setDays(n)}
              className={`h-full px-3 text-xs font-medium rounded-md ${days === n ? 'bg-accent-500 text-white' : 'text-foreground-muted hover:text-foreground'}`}
            >
              {n}d
            </button>
          ))}
        </div>
        {canWrite && (
          <button type="button" className={btnGhost} disabled={syncing} onClick={sync}>
            <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} /> {syncing ? 'Refreshing...' : 'Refresh now'}
          </button>
        )}
      </div>
      {error ? (
        <p className="text-sm text-red-500">{error}</p>
      ) : !d ? (
        <p className="text-sm text-foreground-muted">Loading...</p>
      ) : (
        <>
          <KpiGrid>
            <Kpi label="Posts" value={count(d.totals.posts)} />
            <Kpi label="Impressions" value={count(d.totals.impressions)} />
            <Kpi label="Reach" value={count(d.totals.reach)} />
            <Kpi label="Engagement" value={count(d.totals.engagement)} sub="likes, comments, shares, saves" />
            <Kpi label="Clicks" value={count(d.totals.clicks)} />
            <Kpi label="Revenue" value={money(d.totals.revenue)} sub={`${count(d.totals.orders)} orders`} highlight />
          </KpiGrid>
          <p className="text-xs text-foreground-muted">
            Orders and revenue come from your own orders whose UTM campaign is social_ plus the post (or its group of networks), so a post sent to several networks is counted once.
          </p>
          <Section title="By network">
            <Table
              rows={d.byNetwork}
              rowKey={r => r.network}
              empty="No posted content in this period."
              cols={[
                { key: 'n', label: 'Network', render: r => r.network },
                { key: 'posts', label: 'Posts', num: true, render: r => count(r.posts), sort: r => r.posts },
                { key: 'imp', label: 'Impressions', num: true, render: r => count(r.impressions), sort: r => r.impressions },
                { key: 'reach', label: 'Reach', num: true, render: r => count(r.reach), sort: r => r.reach },
                { key: 'eng', label: 'Engagement', num: true, render: r => count(r.engagement), sort: r => r.engagement },
                { key: 'clicks', label: 'Clicks', num: true, render: r => count(r.clicks), sort: r => r.clicks },
              ]}
            />
          </Section>
          <Section title="Top posts">
            <Table
              rows={d.top}
              rowKey={r => r.id}
              empty="No posted content in this period."
              cols={[
                {
                  key: 'post',
                  label: 'Post',
                  render: r => (
                    <div className="max-w-md">
                      <p className="truncate">{r.title || r.caption || '-'}</p>
                      <p className="text-xs text-foreground-muted">
                        {label(r.platform)} - {when(r.scheduled_at)}
                        {r.permalink && (
                          <a href={r.permalink} target="_blank" rel="noopener noreferrer" className="ml-1 text-accent-500 hover:underline">
                            view
                          </a>
                        )}
                      </p>
                    </div>
                  ),
                },
                { key: 'imp', label: 'Impressions', num: true, render: r => count(r.impressions), sort: r => r.impressions ?? 0 },
                { key: 'eng', label: 'Engagement', num: true, render: r => count(r.engagement), sort: r => r.engagement },
                { key: 'clicks', label: 'Clicks', num: true, render: r => count(r.clicks), sort: r => r.clicks ?? 0 },
                { key: 'orders', label: 'Orders', num: true, render: r => count(r.orders), sort: r => r.orders },
                { key: 'rev', label: 'Revenue', num: true, render: r => money(r.revenue), sort: r => r.revenue },
              ]}
            />
          </Section>
        </>
      )}
    </div>
  )
}
