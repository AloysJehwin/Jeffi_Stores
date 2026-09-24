import { ap } from '@/lib/admin-path'

export type SessionFrame =
  | { kind: 'session'; type: 'hello' | 'deadline'; deadlineAt: number; expiresAt: number; serverNow: number }
  | { kind: 'session'; type: 'logout'; reason: string; serverNow: number }
export type NotificationsFrame = { kind: 'notifications'; items: any[]; unreadCount: number }
export type AdminEventFrame = SessionFrame | NotificationsFrame
export type StreamStatus = 'open' | 'error' | 'closed'

type Handler = (frame: AdminEventFrame) => void
type StatusHandler = (status: StreamStatus) => void

// One EventSource per tab, shared by every subscriber (session controller, notification bell).
let es: EventSource | null = null
const handlers = new Set<Handler>()
const statusHandlers = new Set<StatusHandler>()
let retryMs = 1000
let retryTimer: ReturnType<typeof setTimeout> | null = null

function emitStatus(s: StreamStatus) { statusHandlers.forEach(h => { try { h(s) } catch { /* listener bug */ } }) }

function scheduleRetry() {
  if (retryTimer || handlers.size === 0) return
  retryTimer = setTimeout(() => { retryTimer = null; connect() }, retryMs)
  retryMs = Math.min(retryMs * 2, 30_000)
}

function connect() {
  if (es || handlers.size === 0 || typeof window === 'undefined' || typeof EventSource === 'undefined') return
  try {
    es = new EventSource(ap('/api/admin/events'))
  } catch {
    scheduleRetry()
    return
  }
  es.onopen = () => { retryMs = 1000; emitStatus('open') }
  es.onmessage = (e) => {
    let frame: AdminEventFrame | null = null
    try { frame = JSON.parse(e.data) } catch { return }
    if (frame) handlers.forEach(h => { try { h(frame!) } catch { /* listener bug */ } })
  }
  es.onerror = () => {
    es?.close()
    es = null
    emitStatus('error')
    scheduleRetry()
  }
}

export function subscribeAdminEvents(handler: Handler, onStatus?: StatusHandler): () => void {
  handlers.add(handler)
  if (onStatus) statusHandlers.add(onStatus)
  connect()
  return () => {
    handlers.delete(handler)
    if (onStatus) statusHandlers.delete(onStatus)
    if (handlers.size === 0) {
      es?.close()
      es = null
      if (retryTimer) { clearTimeout(retryTimer); retryTimer = null }
      emitStatus('closed')
    }
  }
}

/** Drop the current connection and reconnect now (after sleep, focus, or network return). */
export function reconnectAdminEvents() {
  if (handlers.size === 0) return
  es?.close()
  es = null
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null }
  retryMs = 1000
  connect()
}
