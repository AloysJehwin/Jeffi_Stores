'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import IconButton from '@/components/ui/IconButton'
import { Badge, Empty, Section, api, btnGhost } from '@/components/admin/channels/ui'
import PostGroup from './PostGroup'
import { STATUS_TONE, groupPosts, label, type Post } from './shared'

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`

/** Monday-start grid covering the month. */
function monthGrid(month: Date): Date[] {
  const offset = (new Date(month.getFullYear(), month.getMonth(), 1).getDay() + 6) % 7
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
  const cells = offset + days <= 35 ? 35 : 42
  return Array.from({ length: cells }, (_, i) => new Date(month.getFullYear(), month.getMonth(), 1 - offset + i))
}

export default function Calendar({ reloadKey }: { reloadKey: number }) {
  const [view, setView] = useState<'month' | 'list'>('month')
  const [month, setMonth] = useState(() => {
    const d = new Date()
    return new Date(d.getFullYear(), d.getMonth(), 1)
  })
  const [posts, setPosts] = useState<Post[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [day, setDay] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick(t => t + 1), [])

  const cells = useMemo(() => monthGrid(month), [month])

  useEffect(() => {
    const from = cells[0]
    const to = new Date(cells[cells.length - 1])
    to.setDate(to.getDate() + 1)
    setError(null)
    api<{ posts: Post[] }>(`/api/admin/social-posts?${new URLSearchParams({ from: from.toISOString(), to: to.toISOString() })}`).then(r =>
      r.ok ? setPosts(r.data.posts ?? []) : setError(r.data.error || 'Could not load posts')
    )
  }, [cells, reloadKey, tick])

  const groups = useMemo(() => groupPosts(posts ?? []), [posts])
  const byDay = useMemo(() => {
    const m = new Map<string, Post[][]>()
    for (const g of groups) {
      const k = dayKey(new Date(g[0].scheduled_at))
      m.set(k, [...(m.get(k) ?? []), g])
    }
    return m
  }, [groups])

  const shift = (n: number) => {
    setDay(null)
    setMonth(m => new Date(m.getFullYear(), m.getMonth() + n, 1))
  }
  const todayKey = dayKey(new Date())
  const selected = day ? (byDay.get(day) ?? []) : []

  return (
    <Section
      title={month.toLocaleString('en-IN', { month: 'long', year: 'numeric' })}
      action={
        <div className="flex items-center gap-2">
          <IconButton icon={ChevronLeft} label="Previous month" onClick={() => shift(-1)} />
          <button type="button" className={btnGhost} onClick={() => setMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}>
            Today
          </button>
          <IconButton icon={ChevronRight} label="Next month" onClick={() => shift(1)} />
          <div className="flex gap-1 p-1 bg-surface border border-border-default rounded-lg">
            {(['month', 'list'] as const).map(v => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                className={`px-3 py-1 text-xs font-medium rounded-md ${view === v ? 'bg-accent-500 text-white' : 'text-foreground-muted hover:text-foreground'}`}
              >
                {v === 'month' ? 'Month' : 'List'}
              </button>
            ))}
          </div>
        </div>
      }
    >
      {error ? (
        <p className="text-sm text-red-500">{error}</p>
      ) : !posts ? (
        <p className="text-sm text-foreground-muted">Loading...</p>
      ) : view === 'list' ? (
        groups.length ? (
          <div className="space-y-3">
            {groups.map(g => (
              <PostGroup key={g[0].group_id ?? g[0].id} posts={g} onChange={reload} />
            ))}
          </div>
        ) : (
          <Empty msg="No posts this month." />
        )
      ) : (
        <div className="space-y-4">
          <div className="overflow-x-auto">
            <div className="grid grid-cols-7 min-w-[700px] border-l border-t border-border-default">
              {WEEKDAYS.map(w => (
                <div key={w} className="px-2 py-1 text-xs text-foreground-muted border-r border-b border-border-default bg-surface-secondary">
                  {w}
                </div>
              ))}
              {cells.map(c => {
                const k = dayKey(c)
                const items = byDay.get(k) ?? []
                const inMonth = c.getMonth() === month.getMonth()
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setDay(d => (d === k ? null : k))}
                    className={`min-h-[92px] p-1 text-left align-top border-r border-b border-border-default flex flex-col gap-1 ${inMonth ? '' : 'bg-surface-secondary/50 text-foreground-muted'} ${day === k ? 'ring-2 ring-inset ring-accent-500' : 'hover:bg-surface-secondary'}`}
                  >
                    <span className={`text-xs ${k === todayKey ? 'font-bold text-accent-500' : ''}`}>{c.getDate()}</span>
                    {items.slice(0, 3).map(g => (
                      <span key={g[0].group_id ?? g[0].id} className="block truncate text-[11px] leading-tight">
                        <Badge tone={STATUS_TONE[g[0].status]}>
                          {new Date(g[0].scheduled_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                        </Badge>{' '}
                        {g.map(p => label(p.platform)).join(', ')}
                      </span>
                    ))}
                    {items.length > 3 && <span className="text-[11px] text-foreground-muted">+{items.length - 3} more</span>}
                  </button>
                )
              })}
            </div>
          </div>
          {day && (
            <div className="space-y-3">
              {selected.length ? (
                selected.map(g => <PostGroup key={g[0].group_id ?? g[0].id} posts={g} onChange={reload} />)
              ) : (
                <Empty msg="Nothing scheduled that day." />
              )}
            </div>
          )}
        </div>
      )}
    </Section>
  )
}
