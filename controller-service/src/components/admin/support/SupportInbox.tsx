'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Bot, MessagesSquare, Search, UserRound } from 'lucide-react'
import PresenceBadge from '@/components/chat/PresenceBadge'
import { ago, previewOf } from '@/components/chat/format'
import type { SupportChannel, SupportEvent, SupportSession } from '@/lib/support/types'
import SupportConversation, { CHANNEL_ICON, CHANNEL_LABEL } from './SupportConversation'

type Filter = 'needs_human' | 'mine' | 'ai' | 'open' | 'closed'
const TABS: Array<{ key: Filter; label: string }> = [
  { key: 'needs_human', label: 'Needs a person' },
  { key: 'mine', label: 'Mine' },
  { key: 'ai', label: 'Assistant' },
  { key: 'open', label: 'All open' },
  { key: 'closed', label: 'Closed' },
]

const needsHuman = (s: SupportSession) => s.status === 'open' && s.handler === 'human' && !s.assignedAdminId
const order = (a: SupportSession, b: SupportSession) =>
  Number(needsHuman(b)) - Number(needsHuman(a)) || (b.lastMessageAt ?? b.createdAt).localeCompare(a.lastMessageAt ?? a.createdAt)

function fits(s: SupportSession, f: Filter, me: string | null) {
  if (f === 'closed') return s.status === 'closed'
  if (s.status !== 'open') return false
  if (f === 'needs_human') return needsHuman(s)
  if (f === 'mine') return !!me && s.assignedAdminId === me
  if (f === 'ai') return s.handler === 'ai'
  return true
}

/** The support inbox: every conversation, the ones needing a person first, and the open one beside it. */
export default function SupportInbox({ initialId, me }: { initialId?: string | null; me: string | null }) {
  const [filter, setFilter] = useState<Filter>('open')
  const [channel, setChannel] = useState<SupportChannel | ''>('')
  const [q, setQ] = useState('')
  const [sessions, setSessions] = useState<SupportSession[]>([])
  const [counts, setCounts] = useState<Partial<Record<Filter, number>>>({})
  const [selected, setSelected] = useState<string | null>(initialId ?? null)
  const [loading, setLoading] = useState(true)
  const [, tick] = useState(0)
  const selectedRef = useRef(selected)
  selectedRef.current = selected

  const load = useCallback(async () => {
    const sp = new URLSearchParams({ filter })
    if (channel) sp.set('channel', channel)
    if (q.trim()) sp.set('q', q.trim())
    const r = await fetch(`/api/admin/support/sessions?${sp}`).catch(() => null)
    if (r?.ok) {
      const d = await r.json()
      setSessions(d.sessions ?? [])
      setCounts(d.counts ?? {})
    }
    setLoading(false)
  }, [filter, channel, q])

  useEffect(() => {
    const t = setTimeout(load, q ? 300 : 0)
    return () => clearTimeout(t)
  }, [load, q])

  // Land on "Needs a person" when someone is waiting.
  const landed = useRef(false)
  useEffect(() => {
    if (landed.current || !counts.open) return
    landed.current = true
    if ((counts.needs_human ?? 0) > 0 && !initialId) setFilter('needs_human')
  }, [counts, initialId])

  useEffect(() => {
    const t = setInterval(() => tick(x => x + 1), 30_000)
    return () => clearInterval(t)
  }, [])

  const refetchSoon = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scheduleReload = useCallback(() => {
    if (refetchSoon.current) clearTimeout(refetchSoon.current)
    refetchSoon.current = setTimeout(() => loadRef.current(), 800)
  }, [])
  const loadRef = useRef(load)
  loadRef.current = load

  const countsSoon = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scheduleCounts = () => {
    if (countsSoon.current) clearTimeout(countsSoon.current)
    countsSoon.current = setTimeout(() => loadRef.current(), 1500)
  }

  useEffect(() => {
    const es = new EventSource('/api/admin/support/stream', { withCredentials: true })
    es.onmessage = ev => {
      let e: SupportEvent | { kind: 'hello' }
      try {
        e = JSON.parse(ev.data)
      } catch {
        return
      }
      if (e.kind === 'hello') return
      if (e.kind === 'message') {
        const m = e.message
        let known = false
        setSessions(prev =>
          prev
            .map(s => {
              if (s.id !== e.sessionId) return s
              known = true
              return {
                ...s,
                lastMessageAt: m.at,
                lastMessage: { sender: m.sender, text: previewOf(m), at: m.at },
                unread: m.sender === 'customer' && selectedRef.current !== s.id ? s.unread + 1 : s.unread,
              }
            })
            .sort(order)
        )
        if (!known) scheduleReload()
      } else if (e.kind === 'session') {
        let known = false
        setSessions(prev =>
          prev
            .map(s => {
              if (s.id !== e.sessionId) return s
              known = true
              return { ...s, ...e.session }
            })
            .sort(order)
        )
        if (!known) scheduleReload()
        else scheduleCounts()
      } else if (e.kind === 'presence' && e.side === 'customer') {
        setSessions(prev => prev.map(s => (s.id === e.sessionId ? { ...s, customerLastSeenAt: e.lastSeenAt } : s)))
      }
    }
    return () => es.close()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const pick = (id: string | null) => {
    setSelected(id)
    if (id) setSessions(prev => prev.map(s => (s.id === id ? { ...s, unread: 0 } : s)))
    const url = new URL(window.location.href)
    if (id) url.searchParams.set('s', id)
    else url.searchParams.delete('s')
    window.history.replaceState(null, '', url)
  }

  const onSession = useCallback((s: SupportSession) => {
    setSessions(prev => {
      const i = prev.findIndex(x => x.id === s.id)
      if (i < 0) return prev
      const next = prev.slice()
      next[i] = { ...next[i], ...s, unread: 0, lastMessage: next[i].lastMessage }
      return next.sort(order)
    })
  }, [])

  const visible = useMemo(() => sessions.filter(s => fits(s, filter, me) || s.id === selected), [sessions, filter, me, selected])

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(300px,360px)_1fr] gap-0 rounded-xl border border-border-default bg-surface-elevated overflow-hidden h-[calc(100dvh-15rem)] min-h-[520px]">
      <aside className={`min-h-0 flex-col border-r border-border-default ${selected ? 'hidden lg:flex' : 'flex'}`}>
        <div className="p-3 space-y-2 border-b border-border-default">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-foreground-muted" />
            <input
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Search name, phone, email, ticket"
              className="w-full h-9 pl-8 pr-3 rounded-lg border border-border-default bg-surface text-sm text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-primary-400"
            />
          </div>
          <div className="flex flex-wrap gap-1">
            {TABS.map(t => (
              <button
                key={t.key}
                type="button"
                onClick={() => setFilter(t.key)}
                className={`shrink-0 h-7 px-2.5 rounded-full text-xs font-medium inline-flex items-center gap-1 ${
                  filter === t.key ? 'bg-primary-500 text-white' : 'bg-surface-secondary text-foreground-secondary hover:text-foreground'
                }`}
              >
                {t.label}
                {t.key !== 'closed' && (counts[t.key] ?? 0) > 0 && (
                  <span className={`rounded-full px-1.5 text-[10px] font-bold ${filter === t.key ? 'bg-white/25' : t.key === 'needs_human' ? 'bg-red-500 text-white' : 'bg-surface text-foreground-muted'}`}>
                    {counts[t.key]}
                  </span>
                )}
              </button>
            ))}
          </div>
          <div className="flex gap-1">
            {(['', 'web', 'app', 'whatsapp'] as const).map(c => (
              <button
                key={c || 'all'}
                type="button"
                onClick={() => setChannel(c)}
                className={`h-6 px-2 rounded-md text-[11px] ${channel === c ? 'bg-foreground text-surface' : 'text-foreground-muted hover:bg-surface-secondary'}`}
              >
                {c ? CHANNEL_LABEL[c] : 'All channels'}
              </button>
            ))}
          </div>
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto divide-y divide-border-default">
          {loading && <li className="p-6 text-center text-xs text-foreground-muted">Loading…</li>}
          {!loading && visible.length === 0 && (
            <li className="p-8 text-center text-xs text-foreground-muted">
              <MessagesSquare className="w-6 h-6 mx-auto mb-2 opacity-50" />
              Nothing here right now.
            </li>
          )}
          {visible.map(s => {
            const Icon = CHANNEL_ICON[s.channel]
            const who = s.lastMessage?.sender
            const prefix = who === 'admin' ? (s.assignedAdminId === me ? 'You: ' : `${s.adminName ?? 'Agent'}: `) : who === 'ai' || who === 'bot' ? 'Assistant: ' : ''
            return (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => pick(s.id)}
                  className={`w-full text-left px-3 py-2.5 flex gap-2.5 ${selected === s.id ? 'bg-primary-50 dark:bg-primary-900/20' : 'hover:bg-surface-secondary'}`}
                >
                  <span className="relative shrink-0">
                    <span className="w-9 h-9 rounded-full bg-surface-secondary text-foreground-secondary flex items-center justify-center text-sm font-semibold">
                      {s.customer.name.slice(0, 1).toUpperCase()}
                    </span>
                    {s.channel !== 'whatsapp' && s.status === 'open' && (
                      <span className="absolute -bottom-0.5 -right-0.5">
                        <PresenceBadge compact lastSeenAt={s.customerLastSeenAt} />
                      </span>
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className={`truncate text-sm ${s.unread ? 'font-bold text-foreground' : 'font-medium text-foreground'}`}>{s.customer.name}</span>
                      <Icon className="w-3 h-3 shrink-0 text-foreground-muted" aria-label={CHANNEL_LABEL[s.channel]} />
                      <span className="ml-auto shrink-0 text-[10px] text-foreground-muted">{ago(s.lastMessageAt ?? s.createdAt)}</span>
                    </span>
                    <span className="flex items-center gap-1.5 mt-0.5">
                      <span className={`truncate text-xs ${s.unread ? 'text-foreground' : 'text-foreground-muted'}`}>{s.lastMessage ? `${prefix}${s.lastMessage.text}` : 'No messages yet'}</span>
                      {s.unread > 0 && <span className="ml-auto shrink-0 rounded-full bg-primary-500 text-white text-[10px] font-bold min-w-[18px] h-[18px] px-1 flex items-center justify-center">{s.unread}</span>}
                    </span>
                    <span className="flex items-center gap-1.5 mt-1">
                      {needsHuman(s) ? (
                        <span className="text-[10px] font-semibold text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded px-1.5 py-0.5">Needs a person</span>
                      ) : s.status === 'closed' ? (
                        <span className="text-[10px] text-foreground-muted">Closed</span>
                      ) : s.handler === 'ai' ? (
                        <span className="text-[10px] text-violet-600 dark:text-violet-400 inline-flex items-center gap-0.5">
                          <Bot className="w-3 h-3" /> Assistant
                        </span>
                      ) : (
                        <span className="text-[10px] text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-0.5">
                          <UserRound className="w-3 h-3" /> {s.assignedAdminId === me ? 'You' : s.adminName ?? 'Agent'}
                        </span>
                      )}
                      {s.ticket && <span className="text-[10px] text-foreground-muted font-mono">{s.ticket}</span>}
                    </span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </aside>
      <section className={`min-h-0 ${selected ? 'flex' : 'hidden lg:flex'} flex-col`}>
        {selected ? (
          <SupportConversation key={selected} sessionId={selected} onSession={onSession} onClose={() => pick(null)} />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center text-sm text-foreground-muted gap-2 p-6">
            <MessagesSquare className="w-8 h-8 opacity-40" />
            Pick a conversation. The assistant answers every customer first; the ones that need a person are listed first.
          </div>
        )}
      </section>
    </div>
  )
}
