import { EventEmitter } from 'events'
import { getRedisClient } from '@/lib/shared/redis'

// Redis pub/sub with an in-process fallback: without Redis (dev, or Redis down) events still
// reach subscribers on this instance. One shared subscriber connection, ref-counted per channel.
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

/** Publish to every subscriber of `channel`, on every instance. */
export async function publish(channel: string, payload: unknown): Promise<void> {
  const r = realRedis()
  if (r) {
    try {
      await r.publish(channel, JSON.stringify(payload))
      return
    } catch {
      /* redis down: deliver locally at least */
    }
  }
  local.emit(channel, payload)
}

export function subscribe<T = unknown>(channel: string, handler: (payload: T) => void): () => void {
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
