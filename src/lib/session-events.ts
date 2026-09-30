import { EventEmitter } from 'events'
import { getRedisClient } from './redis'

export type SessionLogoutReason = 'logout' | 'idle' | 'expired' | 'revoked' | 'binding'

export type SessionEvent =
  { type: 'deadline'; deadlineAt: string; expiresAt: string } | { type: 'logout'; reason: SessionLogoutReason }

const CHANNEL_PREFIX = 'sess:'
const local = new EventEmitter()
local.setMaxListeners(0)

let subscriber: any | null = null
const refCounts = new Map<string, number>()

function realRedis(): any | null {
  try {
    const r = getRedisClient()
    return r && typeof r.duplicate === 'function' && typeof r.publish === 'function' ? r : null
  } catch {
    return null
  }
}

function ensureSubscriber(r: any): any {
  if (subscriber) return subscriber
  subscriber = r.duplicate()
  subscriber.on('error', () => {})
  subscriber.on('message', (channel: string, raw: string) => {
    try {
      local.emit(channel, JSON.parse(raw))
    } catch {
      /* malformed frame */
    }
  })
  return subscriber
}

/** Fan a session event out to every connected tab of that session, on every instance. */
export async function publishSessionEvent(sessionId: string, event: SessionEvent): Promise<void> {
  const channel = CHANNEL_PREFIX + sessionId
  const r = realRedis()
  if (r) {
    try {
      await r.publish(channel, JSON.stringify(event))
      return
    } catch {
      /* redis down: deliver locally at least */
    }
  }
  local.emit(channel, event)
}

export function subscribeSessionEvents(sessionId: string, handler: (event: SessionEvent) => void): () => void {
  const channel = CHANNEL_PREFIX + sessionId
  local.on(channel, handler)
  const r = realRedis()
  if (r) {
    const sub = ensureSubscriber(r)
    const n = (refCounts.get(channel) || 0) + 1
    refCounts.set(channel, n)
    if (n === 1) Promise.resolve(sub.subscribe(channel)).catch(() => {})
  }
  return () => {
    local.off(channel, handler)
    if (!r) return
    const n = (refCounts.get(channel) || 1) - 1
    if (n <= 0) {
      refCounts.delete(channel)
      try {
        Promise.resolve(subscriber?.unsubscribe(channel)).catch(() => {})
      } catch {
        /* ignore */
      }
    } else {
      refCounts.set(channel, n)
    }
  }
}
