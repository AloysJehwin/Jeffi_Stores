'use client'

import { useState } from 'react'
import AdminSelect from '@/components/admin/AdminSelect'
import type { BreakdownSlice } from '@/lib/queries'

// Customer engagement chart — horizontal bars (hand-rolled, no charting library; matches the
// house style / ProductBreakdownChart). A selector switches between engagement segments and
// notification-channel preference. Both datasets are passed in, so switching is instant.

const VIEWS: { value: string; label: string }[] = [
  { value: 'segments', label: 'Engagement' },
  { value: 'channel', label: 'Channel' },
]

export default function CustomerEngagementChart({
  segments, channelMix,
}: {
  segments: BreakdownSlice[]
  channelMix: BreakdownSlice[]
}) {
  const [view, setView] = useState('segments')
  const data = view === 'channel' ? channelMix : segments
  const rows = data.filter(d => d.value > 0)
  const max = Math.max(1, ...rows.map(d => d.value))
  const total = rows.reduce((s, d) => s + d.value, 0)

  return (
    <div className="bg-surface-elevated border border-border-default rounded-lg shadow-sm p-4 h-full flex flex-col overflow-hidden">
      <div className="flex items-center justify-between mb-2 flex-shrink-0 gap-2">
        <p className="text-sm font-semibold text-foreground">Customer Engagement</p>
        <AdminSelect xs value={view} options={VIEWS} onChange={setView} className="w-32" />
      </div>

      {rows.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-sm text-foreground-muted">No data</div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-2">
          {rows.map(row => {
            const pct = Math.round((row.value / max) * 100)
            const share = total > 0 ? Math.round((row.value / total) * 100) : 0
            return (
              <div key={row.label} className="group">
                <div className="flex items-center justify-between text-xs mb-0.5">
                  <span className="text-foreground-secondary truncate mr-2">{row.label}</span>
                  <span className="text-foreground-muted flex-shrink-0">
                    {row.value.toLocaleString('en-IN')}
                    <span className="ml-1 text-[10px]">({share}%)</span>
                  </span>
                </div>
                <div className="h-2.5 rounded-full bg-surface-secondary overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-300"
                    style={{ width: `${Math.max(2, pct)}%`, backgroundColor: row.color }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
