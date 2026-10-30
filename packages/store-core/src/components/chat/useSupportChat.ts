'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { HEARTBEAT_MS, type MessageStatus, type SupportEvent, type SupportMessage, type SupportPayload, type SupportSession } from '@/lib/support/types'
import { apiProofHeaders } from '@/lib/client/session-guard'
import type { ReadyAttachment } from './Composer'

// One support conversation on the client, for the customer widget and the agent's pane alike:
// history + live events (SSE, with polling as the fallback), optimistic sends with retry, read
// receipts, typing, presence heartbeats, uploads and translation.

type Role = 'customer' | 'admin'
type Item = SupportMessage & { tr: Record<string, string> }
type Typing = { who: 'customer' | 'admin' | 'ai'; name?: string | null } | null

const RANK: Record<MessageStatus, number> = { failed: -1, sending: 0, sent: 1, delivered: 2, read: 3 }
const later = (a: MessageStatus, b: MessageStatus): MessageStatus => (b === 'failed' || a === 'failed' ? b : RANK[b] >= RANK[a] ? b : a)

/** Keep the words as written, with what we know of their translations. */
function normalize(m: SupportMessage, viewerLang: string | null, translations?: Record<string, string>): Item {
  if (m.original) return { ...m, text: m.original.text, lang: m.original.lang, original: null, tr: { ...translations, ...(viewerLang ? { [viewerLang]: m.text } : {}) } }
  return { ...m, tr: { ...translations } }
}

function view(i: Item, lang: string | null): SupportMessage {
  const { tr, ...m } = i
  if (!lang || !m.lang || m.lang === lang || !m.text) return m
  const t = tr[lang]
  return t ? { ...m, text: t, original: { text: m.text, lang: m.lang } } : m
}

const uid = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`)

export interface UseSupportChat {
  messages: SupportMessage[]
  session: SupportSession | null
  setSession: (fn: (s: SupportSession | null) => SupportSession | null) => void
  /** The viewer's language: the agent's preference, or the customer's chat language. */
  lang: string | null
  /** Admin only: the viewing agent's id. */
  me: string | null
  loading: boolean
  error: string | null
  typing: Typing
  send: (text: string, attachments?: ReadyAttachment[]) => void
  retry: (m: SupportMessage) => void
  decide: (actionId: string, decision: 'confirm' | 'decline') => Promise<void>
  upload: (file: File, onProgress: (pct: number) => void) => Promise<ReadyAttachment>
  notifyTyping: () => void
  setLanguage: (lang: string) => Promise<void>
  reload: () => Promise<void>
}

export function useSupportChat(opts: { sessionId: string | null; role: Role; portal?: 'business' | null; active?: boolean }): UseSupportChat {
  const { sessionId: id, role, portal = null, active = true } = opts
  const [items, setItems] = useState<Item[]>([])
  const [session, setSessionState] = useState<SupportSession | null>(null)
  const [adminLang, setAdminLang] = useState<string | null>(null)
  const [me, setMe] = useState<string | null>(null)
  const [loading, setLoading] = useState(!!id)
  const [error, setError] = useState<string | null>(null)
  const [typing, setTyping] = useState<Typing>(null)
  const [visible, setVisible] = useState(true)

  const lang = role === 'admin' ? adminLang : session?.customerLang ?? null
  const langRef = useRef(lang)
  langRef.current = lang
  const itemsRef = useRef(items)
  itemsRef.current = items

  const base = id ? (role === 'admin' ? `/api/admin/support/sessions/${id}` : `/api/support/sessions/${id}`) : ''
  const v2 = role === 'customer' ? '?v=2' : ''
  const headers = useMemo<Record<string, string>>(() => (portal === 'business' ? { 'X-Auth-Portal': 'business' } : ({} as Record<string, string>)), [portal])
  const portalQ = portal === 'business' ? 'portal=business' : ''

  const setSession = useCallback((fn: (s: SupportSession | null) => SupportSession | null) => setSessionState(fn), [])

  const upsert = useCallback((incoming: Item[]) => {
    if (!incoming.length) return
    setItems(prev => {
      const next = prev.slice()
      for (const m of incoming) {
        let i = next.findIndex(x => x.id === m.id)
        if (i < 0 && m.clientId) i = next.findIndex(x => x.clientId === m.clientId)
        if (i >= 0) {
          const old = next[i]
          next[i] = { ...m, status: old.status === 'sending' ? m.status : later(old.status, m.status), tr: { ...old.tr, ...m.tr } }
        } else next.push(m)
      }
      next.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
      return next
    })
  }, [])

  const load = useCallback(async () => {
    if (!base) return
    try {
      const r = await fetch(`${base}/messages${v2}`, { headers, credentials: 'include', cache: 'no-store' })
      if (!r.ok) throw new Error(r.status === 404 ? 'This chat is no longer available' : 'Could not load the chat')
      const d = await r.json()
      const vl = role === 'admin' ? d.lang ?? null : d.session?.customerLang ?? null
      if (role === 'admin') {
        setAdminLang(d.lang ?? null)
        setMe(d.me ?? null)
      }
      if (d.session) setSessionState(d.session)
      setItems(prev => {
        const pending = prev.filter(p => p.id.startsWith('tmp:'))
        return [...(d.messages as SupportMessage[]).map(m => normalize(m, vl)), ...pending]
      })
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the chat')
    } finally {
      setLoading(false)
    }
  }, [base, v2, headers, role])

  const catchUp = useCallback(async () => {
    if (!base) return
    const last = [...itemsRef.current].reverse().find(m => !m.id.startsWith('tmp:'))
    if (!last) return load()
    const r = await fetch(`${base}/messages${v2 ? `${v2}&` : '?'}after=${last.id}`, { headers, credentials: 'include', cache: 'no-store' }).catch(() => null)
    if (!r?.ok) return
    const d = await r.json()
    upsert((d.messages as SupportMessage[]).map(m => normalize(m, langRef.current)))
    const s = await fetch(base + v2, { headers, credentials: 'include', cache: 'no-store' }).then(x => (x.ok ? x.json() : null)).catch(() => null)
    if (s?.session) setSessionState(s.session)
  }, [base, v2, headers, load, upsert])

  const catchUpRef = useRef(catchUp)
  catchUpRef.current = catchUp

  useEffect(() => {
    setItems([])
    setSessionState(null)
    setTyping(null)
    if (!id) return
    setLoading(true)
    load()
  }, [id, load])

  // Live events. The handler lives in a ref so the stream doesn't reconnect on every render.
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onEvent = useRef<(e: SupportEvent | { kind: 'hello' }) => void>(() => {})
  const helloed = useRef(false)
  onEvent.current = e => {
    switch (e.kind) {
      case 'hello':
        if (helloed.current) catchUp()
        helloed.current = true
        return
      case 'message': {
        upsert([normalize(e.message, langRef.current, e.translations)])
        const from = e.message.sender === 'customer' ? 'customer' : e.message.sender === 'admin' ? 'admin' : 'ai'
        setTyping(t => (t?.who === from ? null : t))
        return
      }
      case 'translation':
        setItems(prev => prev.map(x => (x.id === e.id ? { ...x, tr: { ...x.tr, ...e.translations } } : x)))
        return
      case 'message_update':
        setItems(prev =>
          prev.map(x =>
            x.id === e.id
              ? { ...x, status: e.status ? later(x.status, e.status) : x.status, payloads: (e.payloads as SupportPayload[] | undefined) ?? x.payloads, error: e.error !== undefined ? e.error : x.error }
              : x
          )
        )
        return
      case 'receipts': {
        // The other side read (or received) everything up to `upTo` that wasn't theirs.
        const theirs = (m: Item) => (e.side === 'customer' ? m.sender === 'customer' : m.sender !== 'customer')
        setItems(prev => {
          const upTo = prev.findIndex(x => x.id === e.upTo)
          if (upTo < 0) return prev
          return prev.map((x, i) => (i <= upTo && !theirs(x) && x.channel !== 'whatsapp' && x.status !== 'failed' && x.status !== 'sending' ? { ...x, status: later(x.status, e.state) } : x))
        })
        return
      }
      case 'typing': {
        const mine = role === 'customer' ? e.who === 'customer' : e.who === 'admin'
        if (mine) return
        if (typingTimer.current) clearTimeout(typingTimer.current)
        if (e.on) {
          setTyping({ who: e.who, name: e.name })
          typingTimer.current = setTimeout(() => setTyping(null), 8000)
        } else setTyping(null)
        return
      }
      case 'presence':
        setSessionState(s => (s ? { ...s, ...(e.side === 'customer' ? { customerLastSeenAt: e.lastSeenAt } : { adminLastSeenAt: e.lastSeenAt }) } : s))
        return
      case 'session':
        setSessionState(s => (s ? { ...s, ...e.session } : s))
        return
    }
  }

  useEffect(() => {
    if (!id) return
    helloed.current = false
    const url = role === 'admin' ? `/api/admin/support/stream?s=${id}` : `${base}/stream${portalQ ? `?${portalQ}` : ''}`
    let es: EventSource | null = null
    let stopped = false
    let failures = 0
    let poll: ReturnType<typeof setInterval> | null = null
    let retryT: ReturnType<typeof setTimeout> | null = null
    const startPolling = () => {
      if (!poll) poll = setInterval(() => catchUpRef.current(), 5000)
    }
    const open = () => {
      if (stopped) return
      es = new EventSource(url, { withCredentials: true })
      es.onopen = () => {
        failures = 0
        if (poll) {
          clearInterval(poll)
          poll = null
        }
      }
      es.onmessage = ev => {
        try {
          onEvent.current(JSON.parse(ev.data))
        } catch {
          /* keepalive or malformed */
        }
      }
      es.onerror = () => {
        if (es?.readyState !== EventSource.CLOSED) return
        es.close()
        failures++
        startPolling()
        retryT = setTimeout(open, Math.min(30_000, 2000 * failures))
      }
    }
    if (typeof EventSource === 'undefined') startPolling()
    else open()
    return () => {
      stopped = true
      es?.close()
      if (poll) clearInterval(poll)
      if (retryT) clearTimeout(retryT)
    }
  }, [id, role, base, portalQ])
  useEffect(() => {
    const on = () => setVisible(document.visibilityState === 'visible')
    on()
    document.addEventListener('visibilitychange', on)
    return () => document.removeEventListener('visibilitychange', on)
  }, [])

  // Presence: beat while the chat is on screen; the customer's tab says goodbye when it goes away.
  const open = session?.status === 'open'
  useEffect(() => {
    if (!base || !open || !active || !visible) return
    const beat = () => fetch(`${base}/heartbeat`, { method: 'POST', headers, credentials: 'include', keepalive: true }).catch(() => {})
    beat()
    const t = setInterval(beat, HEARTBEAT_MS)
    return () => clearInterval(t)
  }, [base, open, active, visible, headers])
  useEffect(() => {
    if (!base || !open || role !== 'customer') return
    // A signed keepalive fetch, not sendBeacon: script-made POSTs must carry the session proof.
    const bye = () => fetch(`${base}/heartbeat`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, credentials: 'include', keepalive: true, body: JSON.stringify({ leaving: true }) }).catch(() => {})
    const onHide = () => document.visibilityState === 'hidden' && bye()
    window.addEventListener('pagehide', bye)
    document.addEventListener('visibilitychange', onHide)
    return () => {
      window.removeEventListener('pagehide', bye)
      document.removeEventListener('visibilitychange', onHide)
    }
  }, [base, open, role, headers])

  // Receipts: what the other side sent is delivered once it's here, read once it's on screen.
  const sentReceipt = useRef<{ delivered?: string; read?: string }>({})
  useEffect(() => {
    sentReceipt.current = {}
  }, [id])
  useEffect(() => {
    if (!base) return
    const theirs = (m: Item) => (role === 'customer' ? m.sender !== 'customer' && m.sender !== 'system' : m.sender === 'customer')
    const last = [...items].reverse().find(m => theirs(m) && !m.id.startsWith('tmp:'))
    if (!last) return
    const state = active && visible ? 'read' : 'delivered'
    if (sentReceipt.current.read === last.id || (state === 'delivered' && sentReceipt.current.delivered === last.id)) return
    sentReceipt.current[state] = last.id
    fetch(`${base}/receipts`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, credentials: 'include', body: JSON.stringify({ state, upTo: last.id }) }).catch(() => {})
  }, [items, active, visible, base, role, headers])

  // The agent sees the customer's words in their own language: ask for what's missing.
  const asked = useRef(new Set<string>())
  useEffect(() => {
    if (role !== 'admin' || !base || !adminLang) return
    const missing = items.filter(m => m.text && m.lang && m.lang !== adminLang && !m.tr[adminLang] && !m.id.startsWith('tmp:') && !asked.current.has(`${m.id}:${adminLang}`))
    if (!missing.length) return
    const t = setTimeout(() => {
      missing.forEach(m => asked.current.add(`${m.id}:${adminLang}`))
      fetch(`${base}/translate`, { method: 'POST', headers, credentials: 'include' }).catch(() => {})
    }, 600)
    return () => clearTimeout(t)
  }, [items, adminLang, role, base, headers])

  const pendingSends = useRef(new Map<string, { text: string; attachmentIds: string[] }>())
  const post = useCallback(
    async (clientId: string) => {
      const body = pendingSends.current.get(clientId)
      if (!body || !base) return
      try {
        const r = await fetch(`${base}/messages${v2}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...headers },
          credentials: 'include',
          body: JSON.stringify({ message: body.text, clientId, attachmentIds: body.attachmentIds }),
        })
        const d = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(d?.error || 'Not sent')
        pendingSends.current.delete(clientId)
        upsert([normalize(d.message, langRef.current)])
      } catch (e) {
        setItems(prev => prev.map(x => (x.clientId === clientId && x.status === 'sending' ? { ...x, status: 'failed', error: e instanceof Error ? e.message : 'Not sent' } : x)))
      }
    },
    [base, v2, headers, upsert]
  )

  const send = useCallback(
    (text: string, attachments: ReadyAttachment[] = []) => {
      if (!id || (!text.trim() && !attachments.length)) return
      const clientId = uid()
      pendingSends.current.set(clientId, { text, attachmentIds: attachments.map(a => a.id) })
      upsert([
        {
          id: `tmp:${clientId}`,
          sessionId: id,
          sender: role === 'customer' ? 'customer' : 'admin',
          senderName: role === 'admin' ? 'You' : null,
          text,
          original: null,
          lang: null,
          at: new Date().toISOString(),
          status: 'sending',
          channel: session?.channel ?? 'web',
          payloads: [],
          attachments: attachments.map(a => ({
            id: a.id,
            kind: a.kind,
            mime: a.mime,
            name: a.name,
            size: a.size,
            width: a.width ?? null,
            height: a.height ?? null,
            duration: null,
            url: a.previewUrl || '#',
            thumbUrl: null,
          })),
          clientId,
          tr: {},
        },
      ])
      post(clientId)
    },
    [id, role, session?.channel, upsert, post]
  )

  const retry = useCallback(
    (m: SupportMessage) => {
      if (!m.clientId || !pendingSends.current.has(m.clientId)) return
      setItems(prev => prev.map(x => (x.clientId === m.clientId ? { ...x, status: 'sending', error: null } : x)))
      post(m.clientId)
    },
    [post]
  )

  const decide = useCallback(
    async (actionId: string, decision: 'confirm' | 'decline') => {
      const r = await fetch(`${base}/actions/${actionId}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, credentials: 'include', body: JSON.stringify({ decision }) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d?.error || 'Could not do that')
      setItems(prev =>
        prev.map(x =>
          x.payloads.some(p => p.type === 'confirm' && p.actionId === actionId)
            ? { ...x, payloads: x.payloads.map(p => (p.type === 'confirm' && p.actionId === actionId && p.status === 'pending' ? { ...p, status: decision === 'confirm' ? 'confirmed' : 'declined' } : p)) }
            : x
        )
      )
    },
    [base, headers]
  )

  // XHR for the progress bar; it isn't window.fetch, so it carries the session proof itself.
  const upload = useCallback(
    async (file: File, onProgress: (pct: number) => void) => {
      const url = `${base}/attachments`
      const proof = await apiProofHeaders('POST', url)
      return new Promise<ReadyAttachment>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.open('POST', url)
        xhr.withCredentials = true
        for (const [k, v] of Object.entries({ ...headers, ...proof })) xhr.setRequestHeader(k, v)
        xhr.upload.onprogress = e => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100))
        xhr.onload = () => {
          let d: any = {}
          try {
            d = JSON.parse(xhr.responseText)
          } catch {
            /* not json */
          }
          if (xhr.status >= 200 && xhr.status < 300 && d.attachment) resolve(d.attachment)
          else reject(new Error(d?.error || (xhr.status === 413 ? 'File too large' : 'Upload failed')))
        }
        xhr.onerror = () => reject(new Error('Upload failed'))
        const fd = new FormData()
        fd.append('file', file)
        xhr.send(fd)
      })
    },
    [base, headers]
  )

  const typingState = useRef<{ last: number; off: ReturnType<typeof setTimeout> | null }>({ last: 0, off: null })
  const notifyTyping = useCallback(() => {
    if (!base) return
    const t = typingState.current
    const ping = (on: boolean) => fetch(`${base}/typing`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, credentials: 'include', body: JSON.stringify({ on }) }).catch(() => {})
    if (Date.now() - t.last > 3000) {
      t.last = Date.now()
      ping(true)
    }
    if (t.off) clearTimeout(t.off)
    t.off = setTimeout(() => {
      t.last = 0
      ping(false)
    }, 4000)
  }, [base, headers])

  const setLanguage = useCallback(
    async (next: string) => {
      if (role === 'admin') {
        setAdminLang(next)
        await fetch('/api/admin/support/preferences', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ lang: next }) }).catch(() => {})
        return
      }
      if (!base) return
      setSessionState(s => (s ? { ...s, customerLang: next } : s))
      await fetch(`${base}/language`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, credentials: 'include', body: JSON.stringify({ lang: next }) }).catch(() => {})
    },
    [role, base, headers]
  )

  const messages = useMemo(() => items.map(i => view(i, lang)), [items, lang])
  return { messages, session, setSession, lang, me, loading, error, typing, send, retry, decide, upload, notifyTyping, setLanguage, reload: load }
}
