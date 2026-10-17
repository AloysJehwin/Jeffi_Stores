'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Power, Play, Eye } from 'lucide-react'
import { ap } from '@/lib/shared/admin-path'
import { useHasScope } from '@/contexts/AdminScopesContext'
import MobileListCard from '@/components/admin/mobile/MobileListCard'
import MobileDetailSheet from '@/components/admin/mobile/MobileDetailSheet'
import MobileActionSheet, { type MobileAction } from '@/components/admin/mobile/MobileActionSheet'
import { type CampaignRow, getChannels, ChannelChip, rate } from './campaign-presentation'

const num = (n: number | string) => Number(n).toLocaleString('en-IN')

function StatTile({
  label,
  value,
  sub,
  accent,
}: {
  label: string
  value: string
  sub?: string
  accent?: 'green' | 'red'
}) {
  const valueColor =
    accent === 'green' ? 'text-green-600 dark:text-green-400' : accent === 'red' ? 'text-red-500' : 'text-foreground'
  return (
    <div className="rounded-lg border border-border-default bg-surface p-3">
      <p className="text-[10px] uppercase tracking-wide text-foreground-muted">{label}</p>
      <p className={`text-lg font-bold tabular-nums ${valueColor}`}>{value}</p>
      {sub && <p className="text-[10px] text-foreground-muted">{sub}</p>}
    </div>
  )
}

interface Props {
  campaigns: CampaignRow[]
  busy: string | null
  onToggle: (c: CampaignRow) => void
  onRunNow: (c: CampaignRow) => void
}

export default function CampaignsMobileList({ campaigns, busy, onToggle, onRunNow }: Props) {
  const canWrite = useHasScope('campaigns:write')
  const [selected, setSelected] = useState<CampaignRow | null>(null)
  const [actionsOpen, setActionsOpen] = useState(false)

  function buildActions(c: CampaignRow): MobileAction[] {
    if (!canWrite) return []
    return [
      {
        key: 'toggle',
        label: c.enabled ? 'Pause' : 'Activate',
        icon: <Power className="w-4 h-4" />,
        disabled: busy === c.kind,
        onSelect: () => {
          onToggle(c)
          setActionsOpen(false)
          setSelected(null)
        },
      },
      {
        key: 'run',
        label: 'Run now',
        icon: <Play className="w-4 h-4" />,
        disabled: busy === c.kind || !c.enabled,
        onSelect: () => {
          onRunNow(c)
          setActionsOpen(false)
          setSelected(null)
        },
      },
    ]
  }

  return (
    <>
      <div className="space-y-3">
        {campaigns.map(c => (
          <MobileListCard key={c.kind} ariaLabel={`Open ${c.name}`} onTap={() => setSelected(c)}>
            <div className="min-w-0 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold text-foreground truncate">{c.name}</span>
                <span
                  className={`px-2 py-0.5 text-[10px] font-semibold rounded-full ${c.enabled ? 'bg-green-500/10 text-green-700 dark:text-green-400' : 'bg-surface-secondary text-foreground-muted '}`}
                >
                  {c.enabled ? 'Active' : 'Paused'}
                </span>
                {c.draft_fields != null && (
                  <span className="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-400">
                    Draft pending
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                {getChannels(c.kind).map(ch => (
                  <ChannelChip key={ch} channel={ch} />
                ))}
                {c.discount_percent > 0 && (
                  <span className="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-400">
                    {c.discount_percent}% off
                  </span>
                )}
              </div>
              {c.description && <p className="text-xs text-foreground-muted line-clamp-1">{c.description}</p>}
            </div>
          </MobileListCard>
        ))}
      </div>

      <MobileDetailSheet
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.name}
        subtitle={selected ? (selected.enabled ? 'Active' : 'Paused') : undefined}
        footer={
          <div className="flex gap-2">
            {canWrite && (
              <button
                type="button"
                onClick={() => setActionsOpen(true)}
                className="control-md flex-1 bg-accent-500 font-semibold text-white hover:bg-accent-600"
              >
                Actions
              </button>
            )}
            {selected && (
              <Link
                href={ap(`/admin/campaigns/${selected.kind}/view`)}
                className="control-md flex-1 border border-border-default bg-surface-elevated font-semibold text-foreground hover:bg-surface-secondary"
              >
                <Eye className="w-4 h-4" /> View
              </Link>
            )}
          </div>
        }
      >
        {selected && (
          <div className="px-5 py-4 space-y-4">
            <div className="flex items-center gap-1.5 flex-wrap">
              {getChannels(selected.kind).map(ch => (
                <ChannelChip key={ch} channel={ch} />
              ))}
              {selected.discount_percent > 0 && (
                <span className="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-400">
                  {selected.discount_percent}% off
                </span>
              )}
            </div>

            {selected.description && <p className="text-sm text-foreground-secondary">{selected.description}</p>}

            <p className="text-xs text-foreground-muted">
              Delay: {selected.delay_hours}h · Last run:{' '}
              {selected.last_run_at
                ? new Date(selected.last_run_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
                : 'never'}
            </p>

            <div className="grid grid-cols-2 gap-3">
              <StatTile label="Sent" value={num(selected.total_sent)} />
              <StatTile
                label="Opened"
                value={num(selected.total_opened)}
                sub={rate(Number(selected.total_opened), Number(selected.total_sent))}
              />
              <StatTile
                label="Clicked"
                value={num(selected.total_clicked)}
                sub={rate(Number(selected.total_clicked), Number(selected.total_sent))}
              />
              <StatTile
                label="Converted"
                value={num(selected.total_converted)}
                sub={rate(Number(selected.total_converted), Number(selected.total_sent))}
                accent="green"
              />
              <StatTile
                label="Revenue"
                value={`₹${Math.round(Number(selected.revenue_attributed)).toLocaleString('en-IN')}`}
              />
              <StatTile
                label="Unsub"
                value={num(selected.total_unsubscribed)}
                sub={rate(Number(selected.total_unsubscribed), Number(selected.total_sent))}
                accent="red"
              />
            </div>
          </div>
        )}
      </MobileDetailSheet>

      <MobileActionSheet
        open={actionsOpen && !!selected}
        onClose={() => setActionsOpen(false)}
        title={selected?.name}
        actions={selected ? buildActions(selected) : []}
      />
    </>
  )
}
