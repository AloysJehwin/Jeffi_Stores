'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'

interface ActivityEvent {
  id: string
  kind: string
  reference_id: string | null
  reference_type: string | null
  summary: string
  metadata: Record<string, any> | null
  created_at: string
  actor_id: string | null
  actor_first_name: string | null
  actor_last_name: string | null
  actor_username: string | null
}

const KIND_META: Record<string, { icon: string; color: string; label: string }> = {
  order_placed:     { icon: '🛒', color: 'bg-blue-500',   label: 'Order placed' },
  order_status:     { icon: '📦', color: 'bg-indigo-500', label: 'Order status' },
  payment_status:   { icon: '💳', color: 'bg-emerald-500', label: 'Payment' },
  return_requested: { icon: '↩️', color: 'bg-purple-500', label: 'Return' },
  return_status:    { icon: '↩️', color: 'bg-purple-500', label: 'Return status' },
  tag_added:        { icon: '🏷️', color: 'bg-cyan-500',   label: 'Tag added' },
  tag_removed:      { icon: '🏷️', color: 'bg-zinc-500',   label: 'Tag removed' },
  note_added:       { icon: '📝', color: 'bg-amber-500',  label: 'Note' },
  support_message:  { icon: '💬', color: 'bg-sky-500',    label: 'Support' },
  login:            { icon: '🔓', color: 'bg-zinc-500',   label: 'Login' },
  signup:           { icon: '✨', color: 'bg-pink-500',   label: 'Signup' },
  address_added:    { icon: '📍', color: 'bg-zinc-500',   label: 'Address' },
  address_updated:  { icon: '📍', color: 'bg-zinc-500',   label: 'Address' },
  profile_updated:  { icon: '👤', color: 'bg-zinc-500',   label: 'Profile' },
  flagged:          { icon: '🚩', color: 'bg-red-500',    label: 'Flagged' },
  unflagged:        { icon: '✅', color: 'bg-green-500',  label: 'Reactivated' },
  task_created:     { icon: '✓',  color: 'bg-violet-500', label: 'Task' },
  task_completed:   { icon: '✓',  color: 'bg-green-500',  label: 'Task done' },
}

function relTime(iso: string) {
  const then = new Date(iso).getTime()
  const now = Date.now()
  const sec = Math.round((now - then) / 1000)
  if (sec < 60) return 'just now'
  if (sec < 3600) return `${Math.round(sec / 60)}m ago`
  if (sec < 86400) return `${Math.round(sec / 3600)}h ago`
  if (sec < 86400 * 30) return `${Math.round(sec / 86400)}d ago`
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

function dateGroup(iso: string) {
  const d = new Date(iso)
  d.setHours(0, 0, 0, 0)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const diff = Math.round((today.getTime() - d.getTime()) / 86400000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  if (diff < 7) return d.toLocaleDateString('en-IN', { weekday: 'long' })
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function CustomerTimeline({ customerId }: { customerId: string }) {
  const [events, setEvents] = useState<ActivityEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [hasMore, setHasMore] = useState(true)
  const loadingMoreRef = useRef(false)

  async function load(before?: string) {
    if (loadingMoreRef.current) return
    loadingMoreRef.current = true
    try {
      const url = `/api/admin/customers/${customerId}/activity?limit=50${before ? `&before=${encodeURIComponent(before)}` : ''}`
      const res = await fetch(url, { credentials: 'include' })
      if (res.ok) {
        const data = await res.json()
        const newEvents: ActivityEvent[] = data.events || []
        setEvents(prev => before ? [...prev, ...newEvents] : newEvents)
        setHasMore(newEvents.length === 50)
      }
    } finally {
      setLoading(false)
      loadingMoreRef.current = false
    }
  }

  useEffect(() => {
    load()
  }, [customerId])

  function actorLabel(e: ActivityEvent) {
    if (!e.actor_id) return 'Customer'
    const f = e.actor_first_name || ''
    const l = e.actor_last_name || ''
    return `${f} ${l}`.trim() || e.actor_username || 'Admin'
  }

  function refLink(e: ActivityEvent) {
    if (e.reference_type === 'orders' && e.reference_id) {
      return `/admin/orders/${e.reference_id}`
    }
    return null
  }

  const grouped = events.reduce<Record<string, ActivityEvent[]>>((acc, e) => {
    const g = dateGroup(e.created_at)
    if (!acc[g]) acc[g] = []
    acc[g].push(e)
    return acc
  }, {})

  return (
    <div>
      <h2 className="text-xs font-semibold text-foreground-muted uppercase tracking-widest mb-4">Activity Timeline</h2>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="flex gap-3 animate-pulse">
              <div className="w-8 h-8 rounded-full bg-surface-secondary" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3 bg-surface-secondary rounded w-3/4" />
                <div className="h-2 bg-surface-secondary rounded w-1/3" />
              </div>
            </div>
          ))}
        </div>
      ) : events.length === 0 ? (
        <p className="text-sm text-foreground-muted italic">No activity yet</p>
      ) : (
        <div className="space-y-5 max-h-[600px] overflow-y-auto pr-1">
          {Object.entries(grouped).map(([group, items]) => (
            <div key={group}>
              <p className="text-[10px] font-semibold text-foreground-muted uppercase tracking-widest mb-2 sticky top-0 bg-surface-elevated py-1">
                {group}
              </p>
              <div className="relative space-y-3">
                <div className="absolute left-[15px] top-1 bottom-1 w-px bg-border-default" aria-hidden />
                {items.map(e => {
                  const meta = KIND_META[e.kind] || { icon: '•', color: 'bg-zinc-500', label: e.kind }
                  const link = refLink(e)
                  const content = (
                    <>
                      <div className={`relative z-10 w-8 h-8 rounded-full ${meta.color} flex items-center justify-center text-sm shrink-0 ring-4 ring-surface-elevated`}>
                        {meta.icon}
                      </div>
                      <div className="flex-1 min-w-0 pt-0.5">
                        <p className="text-sm text-foreground break-words">{e.summary}</p>
                        <p className="text-[10px] text-foreground-muted mt-0.5">
                          {actorLabel(e)} · {relTime(e.created_at)}
                        </p>
                      </div>
                    </>
                  )
                  return link ? (
                    <Link key={e.id} href={link} className="flex gap-3 items-start hover:bg-surface-secondary/50 -mx-2 px-2 py-1 rounded transition-colors">
                      {content}
                    </Link>
                  ) : (
                    <div key={e.id} className="flex gap-3 items-start">
                      {content}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}

          {hasMore && events.length > 0 && (
            <button
              type="button"
              onClick={() => load(events[events.length - 1].created_at)}
              disabled={loadingMoreRef.current}
              className="w-full py-2 text-xs font-medium text-accent-500 hover:text-accent-600 transition-colors disabled:opacity-50"
            >
              Load older events
            </button>
          )}
        </div>
      )}
    </div>
  )
}
