import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AppState, type AppStateStatus } from 'react-native'
import EventSource from 'react-native-sse'
import {
  decideSupportAction, getSupportSession, listSupportMessages, postSupportMessage, sendSupportHeartbeat, sendSupportReceipt,
  sendSupportTyping, setSupportLanguage, supportStream, uploadSupportAttachment,
} from '../../api/info'
import { HEARTBEAT_MS, type MessageStatus, type SupportEvent, type SupportMessage, type SupportPayload, type SupportSession, type SupportUpload } from '../../types/support'

// The customer's side of one support conversation, ported from controller-service
// components/chat/useSupportChat.ts: history + live events (SSE, polling as the fallback), optimistic
// sends with retry, read receipts, typing, presence heartbeats, uploads and translation.

type Item = SupportMessage & { tr: Record<string, string> }
export type Typing = { who: 'customer' | 'admin' | 'ai'; name?: string | null } | null

/** An uploaded file ready to go out; `localUri` previews it in the sending bubble. */
export type ReadyAttachment = SupportUpload & { localUri?: string | null }
export interface PickedFile {
  uri: string
  name: string
  type: string
}

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

const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 10)}`

export function useAppState(): AppStateStatus {
  const [state, setState] = useState<AppStateStatus>(AppState.currentState)
  useEffect(() => {
    const sub = AppState.addEventListener('change', setState)
    return () => sub.remove()
  }, [])
  return state
}

export interface UseSupportChat {
  messages: SupportMessage[]
  session: SupportSession | null
  setSession: (fn: (s: SupportSession | null) => SupportSession | null) => void
  /** The chat's language (the customer's). */
  lang: string | null
  loading: boolean
  error: string | null
  typing: Typing
  send: (text: string, attachments?: ReadyAttachment[]) => void
  retry: (m: SupportMessage) => void
  decide: (actionId: string, decision: 'confirm' | 'decline') => Promise<void>
  upload: (file: PickedFile, onProgress: (pct: number) => void) => Promise<SupportUpload>
  notifyTyping: () => void
  setLanguage: (lang: string) => Promise<void>
  reload: () => Promise<void>
}

/** `focused`: the chat screen is the one on top (receipts read, presence beats). */
export function useSupportChat({ sessionId: id, focused }: { sessionId: string | null; focused: boolean }): UseSupportChat {
  const [items, setItems] = useState<Item[]>([])
  const [session, setSessionState] = useState<SupportSession | null>(null)
  const [loadedId, setLoadedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [typing, setTyping] = useState<Typing>(null)
  const appState = useAppState()
  const awake = appState !== 'background'
  const live = focused && appState === 'active'

  const lang = session?.customerLang ?? null
  const langRef = useRef(lang)
  langRef.current = lang
  const itemsRef = useRef(items)
  itemsRef.current = items
  const idRef = useRef(id)
  idRef.current = id

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
    if (!id) return
    try {
      const d = await listSupportMessages(id)
      if (idRef.current !== id) return
      const vl = d.session?.customerLang ?? null
      if (d.session) setSessionState(d.session)
      setItems(prev => {
        const got = new Set(d.messages.map(m => m.clientId).filter(Boolean))
        const pending = prev.filter(p => p.id.startsWith('tmp:') && !got.has(p.clientId))
        return [...d.messages.map(m => normalize(m, vl)), ...pending]
      })
      setError(null)
    } catch (e) {
      setError(e instanceof Error && e.message === 'Session not found' ? 'This chat is no longer available' : 'Could not load the chat')
    } finally {
      setLoadedId(id)
    }
  }, [id])

  const catchUp = useCallback(async () => {
    if (!id) return
    const last = [...itemsRef.current].reverse().find(m => !m.id.startsWith('tmp:'))
    if (!last) return load()
    const d = await listSupportMessages(id, last.id).catch(() => null)
    if (!d || idRef.current !== id) return
    upsert(d.messages.map(m => normalize(m, langRef.current)))
    const s = await getSupportSession(id).catch(() => null)
    if (s?.session && idRef.current === id) setSessionState(s.session)
  }, [id, load, upsert])

  const catchUpRef = useRef(catchUp)
  catchUpRef.current = catchUp

  useEffect(() => {
    setItems([])
    setSessionState(null)
    setTyping(null)
    if (!id) return
    load()
  }, [id, load])

  // Live events. The handler lives in a ref so the stream doesn't reconnect on every render.
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onEvent = useRef<(e: SupportEvent | { kind: 'hello' }) => void>(() => {})
  // Every connect says hello; after the first one for this chat, catch up on what was missed.
  const helloed = useRef<string | null>(null)
  onEvent.current = e => {
    switch (e.kind) {
      case 'hello':
        if (helloed.current === id) catchUp()
        helloed.current = id
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
        if (e.who === 'customer') return
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
  useEffect(
    () => () => {
      if (typingTimer.current) clearTimeout(typingTimer.current)
    },
    []
  )

  // SSE while the app is up; polling ?after= every 5s while it can't connect. Backgrounding drops the
  // stream and coming back reconnects, whose hello catches up.
  useEffect(() => {
    if (!id || !awake) return
    let es: EventSource | null = null
    let stopped = false
    let failures = 0
    let poll: ReturnType<typeof setInterval> | null = null
    let retryT: ReturnType<typeof setTimeout> | null = null
    let helloT: ReturnType<typeof setTimeout> | null = null
    const startPolling = () => {
      if (!poll) poll = setInterval(() => catchUpRef.current(), 5000)
    }
    const stopPolling = () => {
      if (poll) clearInterval(poll)
      poll = null
    }
    const open = async () => {
      if (stopped) return
      const { url, headers } = await supportStream(id)
      if (stopped) return
      const src = new EventSource(url, { headers, pollingInterval: 2000, timeoutBeforeConnection: 0 })
      es = src
      // Connected but silent (a proxy buffering the stream): poll until events flow.
      src.addEventListener('open', () => {
        failures = 0
        if (helloT) clearTimeout(helloT)
        helloT = setTimeout(startPolling, 8000)
      })
      src.addEventListener('message', ev => {
        if (helloT) clearTimeout(helloT)
        helloT = null
        stopPolling()
        if (!ev.data) return
        try {
          onEvent.current(JSON.parse(ev.data))
        } catch {
          /* malformed */
        }
      })
      src.addEventListener('error', () => {
        if (stopped || es !== src) return
        es = null
        // Closed after the library schedules its own retry, so close() cancels that too.
        setTimeout(() => {
          src.removeAllEventListeners()
          src.close()
        }, 0)
        failures++
        startPolling()
        retryT = setTimeout(connect, Math.min(30_000, 2000 * failures))
      })
    }
    const connect = () => {
      open().catch(startPolling)
    }
    connect()
    return () => {
      stopped = true
      es?.removeAllEventListeners()
      es?.close()
      stopPolling()
      if (retryT) clearTimeout(retryT)
      if (helloT) clearTimeout(helloT)
    }
  }, [id, awake])

  // Presence: beat while the chat is on screen; say goodbye on blur or backgrounding.
  const open = session?.status === 'open'
  useEffect(() => {
    if (!id || !open || !live) return
    const beat = () => sendSupportHeartbeat(id).catch(() => {})
    beat()
    const t = setInterval(beat, HEARTBEAT_MS)
    return () => {
      clearInterval(t)
      sendSupportHeartbeat(id, true).catch(() => {})
    }
  }, [id, open, live])

  // Receipts: what the other side sent is delivered once it's here, read once it's on screen.
  const sentReceipt = useRef<{ delivered?: string; read?: string }>({})
  useEffect(() => {
    sentReceipt.current = {}
  }, [id])
  useEffect(() => {
    if (!id) return
    const last = [...items].reverse().find(m => m.sender !== 'customer' && m.sender !== 'system' && !m.id.startsWith('tmp:'))
    if (!last) return
    const state = live ? 'read' : 'delivered'
    if (sentReceipt.current.read === last.id || (state === 'delivered' && sentReceipt.current.delivered === last.id)) return
    sentReceipt.current[state] = last.id
    sendSupportReceipt(id, state, last.id).catch(() => {})
  }, [items, live, id])

  const pendingSends = useRef(new Map<string, { text: string; attachmentIds: string[] }>())
  const post = useCallback(
    async (clientId: string) => {
      const body = pendingSends.current.get(clientId)
      if (!body || !id) return
      try {
        const d = await postSupportMessage(id, { message: body.text, clientId, attachmentIds: body.attachmentIds.length ? body.attachmentIds : undefined })
        pendingSends.current.delete(clientId)
        upsert([normalize(d.message, langRef.current)])
      } catch (e) {
        setItems(prev => prev.map(x => (x.clientId === clientId && x.status === 'sending' ? { ...x, status: 'failed', error: e instanceof Error ? e.message : 'Not sent' } : x)))
      }
    },
    [id, upsert]
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
          sender: 'customer',
          senderName: null,
          text,
          original: null,
          lang: null,
          at: new Date().toISOString(),
          status: 'sending',
          channel: 'app',
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
            url: a.localUri || '',
            thumbUrl: null,
          })),
          clientId,
          tr: {},
        },
      ])
      post(clientId)
    },
    [id, upsert, post]
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
      if (!id) return
      await decideSupportAction(id, actionId, decision)
      setItems(prev =>
        prev.map(x =>
          x.payloads.some(p => p.type === 'confirm' && p.actionId === actionId)
            ? { ...x, payloads: x.payloads.map(p => (p.type === 'confirm' && p.actionId === actionId && p.status === 'pending' ? { ...p, status: decision === 'confirm' ? 'confirmed' : 'declined' } : p)) }
            : x
        )
      )
    },
    [id]
  )

  const upload = useCallback(
    (file: PickedFile, onProgress: (pct: number) => void) => (id ? uploadSupportAttachment(id, file, onProgress) : Promise.reject(new Error('No chat'))),
    [id]
  )

  const typingState = useRef<{ last: number; off: ReturnType<typeof setTimeout> | null }>({ last: 0, off: null })
  const notifyTyping = useCallback(() => {
    if (!id) return
    const t = typingState.current
    if (Date.now() - t.last > 3000) {
      t.last = Date.now()
      sendSupportTyping(id, true).catch(() => {})
    }
    if (t.off) clearTimeout(t.off)
    t.off = setTimeout(() => {
      t.last = 0
      sendSupportTyping(id, false).catch(() => {})
    }, 4000)
  }, [id])
  useEffect(
    () => () => {
      const t = typingState.current
      if (!t.off) return
      clearTimeout(t.off)
      t.off = null
      t.last = 0
      if (id) sendSupportTyping(id, false).catch(() => {})
    },
    [id]
  )

  const setLanguage = useCallback(
    async (next: string) => {
      if (!id) return
      setSessionState(s => (s ? { ...s, customerLang: next } : s))
      await setSupportLanguage(id, next).catch(() => {})
    },
    [id]
  )

  const messages = useMemo(() => items.map(i => view(i, lang)), [items, lang])
  const loading = !!id && loadedId !== id
  return { messages, session, setSession, lang, loading, error, typing, send, retry, decide, upload, notifyTyping, setLanguage, reload: load }
}
