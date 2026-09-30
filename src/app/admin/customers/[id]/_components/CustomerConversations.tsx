'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  MessageSquare,
  Mail,
  MessageCircle,
  Smartphone,
  StickyNote,
  FileText,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Reply,
  Send,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import NoteAttachments from '@/components/admin/NoteAttachments'
import type { NoteAttachment } from '@/lib/customer-notes-shared'
import {
  CONVERSATION_CHANNELS,
  type ConversationChannel,
  type ConversationItem,
  type ConversationSummary,
} from '@/lib/customer-conversations-shared'

const CHANNEL_META: Record<ConversationChannel, { Icon: LucideIcon; label: string }> = {
  chat: { Icon: MessageSquare, label: 'Chat' },
  email: { Icon: Mail, label: 'Email' },
  whatsapp: { Icon: MessageCircle, label: 'WhatsApp' },
  sms: { Icon: Smartphone, label: 'SMS' },
  note: { Icon: StickyNote, label: 'Notes' },
  rfq: { Icon: FileText, label: 'RFQ' },
}

function filtersFor(isBusiness: boolean): { key: 'all' | ConversationChannel; label: string }[] {
  const channels = CONVERSATION_CHANNELS.filter(c => c !== 'rfq' || isBusiness)
  return [{ key: 'all', label: 'All' }, ...channels.map(c => ({ key: c, label: CHANNEL_META[c].label }))]
}

const FAILED_STATUSES = new Set(['failed', 'bounced', 'undelivered', 'error', 'rejected'])

const DIRECTION_BADGE: Record<ConversationItem['direction'], { label: string; className: string }> = {
  inbound: { label: 'In', className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
  outbound: { label: 'Out', className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' },
  internal: { label: 'Internal', className: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300' },
}

const PAGE_LIMIT = 40

function relTime(iso: string): string {
  const sec = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  if (sec < 60) return 'just now'
  if (sec < 3600) return `${Math.round(sec / 60)}m ago`
  if (sec < 86400) return `${Math.round(sec / 3600)}h ago`
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
}

function dayGroup(iso: string): string {
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

function toNoteAttachments(list: ConversationItem['attachments']): NoteAttachment[] {
  return list.map((a, i) => ({
    id: `${i}-${a.url}`,
    kind: a.kind === 'audio' ? 'audio' : 'image',
    url: a.url,
    thumbnailUrl: a.thumbnailUrl,
    mimeType: '',
    sizeBytes: 0,
    width: null,
    height: null,
    durationSeconds: null,
    originalName: null,
  }))
}

function median(minutes: number | null): string {
  if (minutes == null) return '—'
  if (minutes < 60) return `${Math.round(minutes)}m`
  if (minutes < 1440) return `${Math.round(minutes / 60)}h`
  return `${Math.round(minutes / 1440)}d`
}

function scrollToId(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function Chip({ label, value, tone }: { label: string; value: string; tone?: 'amber' | 'default' }) {
  return (
    <div
      className={`rounded-lg border px-3 py-2 ${
        tone === 'amber'
          ? 'border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/20'
          : 'border-border-default bg-surface'
      }`}
    >
      <p
        className={`text-[10px] uppercase tracking-widest font-medium ${tone === 'amber' ? 'text-amber-700 dark:text-amber-300' : 'text-foreground-muted'}`}
      >
        {label}
      </p>
      <p
        className={`text-sm font-semibold mt-0.5 ${tone === 'amber' ? 'text-amber-800 dark:text-amber-200' : 'text-foreground'}`}
      >
        {value}
      </p>
    </div>
  )
}

function SummaryStrip({ summary }: { summary: ConversationSummary }) {
  const counts = Object.entries(summary.counts30d).filter(([, n]) => n > 0)
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-4">
      <Chip label="Last inbound" value={summary.lastInboundAt ? relTime(summary.lastInboundAt) : 'none'} />
      <Chip label="Last outbound" value={summary.lastOutboundAt ? relTime(summary.lastOutboundAt) : 'none'} />
      {summary.awaitingReply && summary.awaitingReplySince ? (
        <Chip label="Awaiting reply since" value={relTime(summary.awaitingReplySince)} tone="amber" />
      ) : (
        <Chip label="Open chats" value={String(summary.openChats)} />
      )}
      <Chip label="Median first response" value={median(summary.medianFirstResponseMinutes)} />
      <div className="col-span-2 sm:col-span-3 rounded-lg border border-border-default bg-surface px-3 py-2">
        <p className="text-[10px] uppercase tracking-widest font-medium text-foreground-muted">Last 30 days</p>
        {counts.length ? (
          <div className="flex flex-wrap gap-2 mt-1">
            {counts.map(([c, n]) => (
              <span key={c} className="text-xs text-foreground-secondary">
                {CHANNEL_META[c as ConversationChannel].label} {n}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-sm text-foreground-muted mt-0.5">No messages</p>
        )}
      </div>
    </div>
  )
}

function ItemBody({ body }: { body: string }) {
  const [expanded, setExpanded] = useState(false)
  const long = body.split('\n').length > 3 || body.length > 240
  return (
    <div className="mt-1">
      <p
        className={`text-sm text-foreground-secondary whitespace-pre-line break-words ${expanded ? '' : 'line-clamp-3'}`}
      >
        {body}
      </p>
      {long && (
        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          className="text-[11px] font-medium text-accent-500 hover:text-accent-600 mt-1 flex items-center gap-0.5"
        >
          {expanded ? (
            <>
              <ChevronUp className="w-3 h-3" /> Show less
            </>
          ) : (
            <>
              <ChevronDown className="w-3 h-3" /> Show more
            </>
          )}
        </button>
      )}
    </div>
  )
}

function FeedItem({ item, phone }: { item: ConversationItem; phone: string | null }) {
  const { Icon, label } = CHANNEL_META[item.channel]
  const dir = DIRECTION_BADGE[item.direction]
  const failed = item.status ? FAILED_STATUSES.has(item.status.toLowerCase()) : false
  return (
    <div className="flex gap-3 py-3 hover:bg-surface-secondary/50 -mx-2 px-2 rounded-lg transition-colors">
      <div className="w-8 h-8 rounded-full bg-surface-secondary flex items-center justify-center text-foreground-secondary shrink-0">
        <Icon className="w-4 h-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-foreground">{label}</span>
          <span className={`px-1.5 py-0.5 text-[10px] font-semibold rounded ${dir.className}`}>{dir.label}</span>
          {item.actor && <span className="text-[11px] text-foreground-muted">{item.actor}</span>}
          <span className="text-[11px] text-foreground-muted">· {relTime(item.at)}</span>
          {failed && (
            <span className="px-1.5 py-0.5 text-[10px] font-semibold rounded bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300">
              {item.status}
            </span>
          )}
          {item.href && (
            <a href={item.href} className="text-foreground-muted hover:text-accent-500" title="Open linked record">
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
        </div>
        {item.subject && item.channel === 'email' && (
          <p className="text-sm font-semibold text-foreground mt-1">{item.subject}</p>
        )}
        {item.subject && item.channel !== 'email' && (
          <p className="text-xs text-foreground-secondary mt-1">{item.subject}</p>
        )}
        {item.body && <ItemBody body={item.body} />}
        {item.attachments.length > 0 && <NoteAttachments attachments={toNoteAttachments(item.attachments)} size="sm" />}
        <div className="flex gap-3 mt-2">
          <button
            type="button"
            onClick={() => scrollToId('mailer')}
            className="text-[11px] font-medium text-foreground-muted hover:text-accent-500 flex items-center gap-1"
          >
            <Reply className="w-3 h-3" /> Reply by email
          </button>
          {phone && (
            <button
              type="button"
              onClick={() => scrollToId('engagement')}
              className="text-[11px] font-medium text-foreground-muted hover:text-accent-500 flex items-center gap-1"
            >
              <Send className="w-3 h-3" /> WhatsApp
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function groupByThread(items: ConversationItem[]): ConversationItem[][] {
  const out: ConversationItem[][] = []
  for (const item of items) {
    const last = out[out.length - 1]
    if (last && item.threadId && last[0].threadId === item.threadId) last.push(item)
    else out.push([item])
  }
  return out
}

export default function CustomerConversations({
  customerId,
  phone,
  isBusiness = false,
}: {
  customerId: string
  email: string | null
  phone: string | null
  canWrite: boolean
  isBusiness?: boolean
}) {
  const [summary, setSummary] = useState<ConversationSummary | null>(null)
  const [items, setItems] = useState<ConversationItem[]>([])
  const [nextBefore, setNextBefore] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | ConversationChannel>('all')
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const reqRef = useRef(0)

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => {
    let alive = true
    fetch(`/api/admin/customers/${customerId}/conversations/summary`, { credentials: 'include' })
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (alive && d) setSummary(d)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [customerId])

  const load = useCallback(
    async (before: string | null) => {
      const token = ++reqRef.current
      if (before) setLoadingMore(true)
      else {
        setLoading(true)
        setError(null)
      }
      try {
        const sp = new URLSearchParams({ limit: String(PAGE_LIMIT) })
        if (filter !== 'all') sp.set('channels', filter)
        if (debounced) sp.set('q', debounced)
        if (before) sp.set('before', before)
        const res = await fetch(`/api/admin/customers/${customerId}/conversations?${sp.toString()}`, {
          credentials: 'include',
        })
        if (token !== reqRef.current) return
        if (!res.ok) {
          setError('Could not load conversations')
          return
        }
        const data = await res.json()
        const newItems: ConversationItem[] = data.items || []
        setItems(prev => (before ? [...prev, ...newItems] : newItems))
        setNextBefore(data.nextBefore ?? null)
      } catch {
        if (token === reqRef.current) setError('Could not load conversations')
      } finally {
        if (token === reqRef.current) {
          setLoading(false)
          setLoadingMore(false)
        }
      }
    },
    [customerId, filter, debounced]
  )

  useEffect(() => {
    load(null)
  }, [load])

  const groups = useMemo(() => {
    const byDay = new Map<string, ConversationItem[]>()
    for (const item of items) {
      const g = dayGroup(item.at)
      if (!byDay.has(g)) byDay.set(g, [])
      byDay.get(g)!.push(item)
    }
    return [...byDay.entries()]
  }, [items])

  const filters = useMemo(() => filtersFor(isBusiness), [isBusiness])

  return (
    <div>
      <h2 className="text-xs font-semibold text-foreground-muted uppercase tracking-widest mb-4">
        Conversation history
      </h2>

      {summary && <SummaryStrip summary={summary} />}

      <div className="flex flex-wrap gap-1.5 mb-3">
        {filters.map(f => {
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
            </button>
          )
        })}
      </div>

      <input
        type="search"
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Search messages"
        className="w-full mb-4 rounded-lg border border-border-default bg-surface px-3 py-2 text-sm text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-accent-500"
      />

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
      ) : error ? (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-foreground-muted">No messages found.</p>
      ) : (
        <div className="space-y-5 max-h-[700px] overflow-y-auto pr-1">
          {groups.map(([group, groupItems]) => (
            <div key={group}>
              <p className="text-[10px] font-semibold text-foreground-muted uppercase tracking-widest mb-1 sticky top-0 z-10 bg-surface-elevated py-1">
                {group}
              </p>
              <div className="divide-y divide-border-default">
                {groupByThread(groupItems).map((thread, ti) =>
                  thread.length > 1 ? (
                    <div key={`${group}-${ti}`} className="py-1">
                      <p className="text-[11px] font-medium text-foreground-secondary py-1">
                        {thread[0].threadLabel || CHANNEL_META[thread[0].channel].label} · {thread.length} messages
                      </p>
                      <div className="pl-3 border-l-2 border-border-default">
                        {thread.map(item => (
                          <FeedItem key={item.id} item={item} phone={phone} />
                        ))}
                      </div>
                    </div>
                  ) : (
                    <FeedItem key={thread[0].id} item={thread[0]} phone={phone} />
                  )
                )}
              </div>
            </div>
          ))}

          {nextBefore && (
            <button
              type="button"
              onClick={() => load(nextBefore)}
              disabled={loadingMore}
              className="w-full py-2 text-xs font-medium text-accent-500 hover:text-accent-600 transition-colors disabled:opacity-50"
            >
              {loadingMore ? 'Loading…' : 'Load more'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
