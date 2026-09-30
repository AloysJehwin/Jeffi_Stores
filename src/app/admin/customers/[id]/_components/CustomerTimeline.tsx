'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import {
  ShoppingCart,
  Package,
  CreditCard,
  Undo2,
  Tag,
  StickyNote,
  MessageSquare,
  Unlock,
  Lock,
  Sparkles,
  MapPin,
  User,
  Flag,
  CheckCircle,
  Check,
  Circle,
  Heart,
  Star,
  KeyRound,
  BellOff,
  BellRing,
  MessagesSquare,
  Eye,
  ShoppingBag,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { categoryFor, type ActivityCategory } from '@/lib/shared/activity-shared'
import { ap } from '@/lib/shared/admin-path'

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

const KIND_META: Record<string, { Icon: LucideIcon; color: string; label: string }> = {
  order_placed: { Icon: ShoppingCart, color: 'bg-blue-500', label: 'Order placed' },
  order_status: { Icon: Package, color: 'bg-indigo-500', label: 'Order status' },
  payment_status: { Icon: CreditCard, color: 'bg-emerald-500', label: 'Payment' },
  return_requested: { Icon: Undo2, color: 'bg-purple-500', label: 'Return' },
  return_status: { Icon: Undo2, color: 'bg-purple-500', label: 'Return status' },
  cart_abandoned: { Icon: ShoppingCart, color: 'bg-orange-500', label: 'Cart abandoned' },
  cart_item_added: { Icon: ShoppingBag, color: 'bg-blue-400', label: 'Cart add' },
  cart_item_removed: { Icon: ShoppingBag, color: 'bg-zinc-400', label: 'Cart remove' },
  product_viewed: { Icon: Eye, color: 'bg-zinc-400', label: 'Viewed' },
  tag_added: { Icon: Tag, color: 'bg-cyan-500', label: 'Tag added' },
  tag_removed: { Icon: Tag, color: 'bg-zinc-500', label: 'Tag removed' },
  note_added: { Icon: StickyNote, color: 'bg-amber-500', label: 'Note' },
  support_message: { Icon: MessageSquare, color: 'bg-sky-500', label: 'Support' },
  support_session_started: { Icon: MessagesSquare, color: 'bg-sky-600', label: 'Support chat' },
  login: { Icon: Unlock, color: 'bg-zinc-500', label: 'Login' },
  logout: { Icon: Lock, color: 'bg-zinc-400', label: 'Logout' },
  signup: { Icon: Sparkles, color: 'bg-pink-500', label: 'Signup' },
  address_added: { Icon: MapPin, color: 'bg-zinc-500', label: 'Address added' },
  address_updated: { Icon: MapPin, color: 'bg-zinc-500', label: 'Address updated' },
  address_removed: { Icon: MapPin, color: 'bg-zinc-400', label: 'Address removed' },
  profile_updated: { Icon: User, color: 'bg-zinc-500', label: 'Profile' },
  password_changed: { Icon: KeyRound, color: 'bg-zinc-600', label: 'Password' },
  wishlist_added: { Icon: Heart, color: 'bg-rose-500', label: 'Wishlist' },
  wishlist_removed: { Icon: Heart, color: 'bg-zinc-400', label: 'Wishlist removed' },
  review_submitted: { Icon: Star, color: 'bg-yellow-500', label: 'Review' },
  flagged: { Icon: Flag, color: 'bg-red-500', label: 'Flagged' },
  unflagged: { Icon: CheckCircle, color: 'bg-green-500', label: 'Reactivated' },
  task_created: { Icon: Check, color: 'bg-violet-500', label: 'Task' },
  task_completed: { Icon: Check, color: 'bg-green-500', label: 'Task done' },
  marketing_opted_in: { Icon: BellRing, color: 'bg-emerald-500', label: 'Marketing on' },
  marketing_opted_out: { Icon: BellOff, color: 'bg-zinc-400', label: 'Marketing off' },
}

type FilterKey = ActivityCategory | 'all'

const FILTERS: { key: FilterKey; label: string; ringColor: string }[] = [
  { key: 'all', label: 'All', ringColor: 'ring-foreground' },
  { key: 'auth', label: 'Auth', ringColor: 'ring-zinc-500' },
  { key: 'orders', label: 'Orders', ringColor: 'ring-blue-500' },
  { key: 'support', label: 'Support', ringColor: 'ring-sky-500' },
  { key: 'account', label: 'Account', ringColor: 'ring-rose-500' },
  { key: 'admin', label: 'Admin', ringColor: 'ring-amber-500' },
  { key: 'marketing', label: 'Marketing', ringColor: 'ring-emerald-500' },
]

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
  const [filter, setFilter] = useState<FilterKey>('all')
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
        setEvents(prev => (before ? [...prev, ...newEvents] : newEvents))
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
      return ap(`/admin/orders/${e.reference_id}`)
    }
    return null
  }

  const counts = useMemo(() => {
    const c: Record<FilterKey, number> = {
      all: events.length,
      auth: 0,
      orders: 0,
      support: 0,
      account: 0,
      admin: 0,
      marketing: 0,
      other: 0,
    } as any
    for (const e of events) {
      const cat = categoryFor(e.kind) as FilterKey
      c[cat] = (c[cat] || 0) + 1
    }
    return c
  }, [events])

  const visibleEvents = filter === 'all' ? events : events.filter(e => categoryFor(e.kind) === filter)

  const grouped = visibleEvents.reduce<Record<string, ActivityEvent[]>>((acc, e) => {
    const g = dateGroup(e.created_at)
    if (!acc[g]) acc[g] = []
    acc[g].push(e)
    return acc
  }, {})

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-semibold text-foreground-muted uppercase tracking-widest">Activity Timeline</h2>
      </div>

      {!loading && events.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-4">
          {FILTERS.map(f => {
            const n = counts[f.key] || 0
            if (f.key !== 'all' && n === 0) return null
            const active = filter === f.key
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                className={`text-[11px] font-medium px-2.5 py-1 rounded-full border transition-colors ${
                  active
                    ? 'bg-accent-500 text-white border-accent-500'
                    : 'bg-surface border-border-default text-foreground-muted hover:bg-surface-secondary'
                }`}
              >
                {f.label}
                <span className={`ml-1.5 text-[10px] ${active ? 'opacity-80' : 'opacity-60'}`}>{n}</span>
              </button>
            )
          })}
        </div>
      )}

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
      ) : visibleEvents.length === 0 ? (
        <p className="text-sm text-foreground-muted italic">No {filter} activity yet</p>
      ) : (
        <div className="space-y-5 max-h-[600px] overflow-y-auto pr-1">
          {Object.entries(grouped).map(([group, items]) => (
            <div key={group}>
              <p className="text-[10px] font-semibold text-foreground-muted uppercase tracking-widest mb-2 sticky top-0 z-20 bg-surface-elevated py-1">
                {group}
              </p>
              <div className="relative space-y-3">
                <div className="absolute left-[15px] top-1 bottom-1 w-px bg-border-default" aria-hidden />
                {items.map(e => {
                  const meta = KIND_META[e.kind] || { Icon: Circle, color: 'bg-zinc-500', label: e.kind }
                  const Icon = meta.Icon
                  const link = refLink(e)
                  const content = (
                    <>
                      <div
                        className={`relative z-10 w-8 h-8 rounded-full ${meta.color} flex items-center justify-center text-white shrink-0 ring-4 ring-surface-elevated`}
                      >
                        <Icon className="w-4 h-4" />
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
                    <Link
                      key={e.id}
                      href={link}
                      className="flex gap-3 items-start hover:bg-surface-secondary/50 -mx-2 px-2 py-1 rounded transition-colors"
                    >
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
