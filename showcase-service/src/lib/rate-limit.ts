import { getRedisClient } from '@/lib/shared/redis'

// Fixed-window counters: Redis when it answers (shared by every pod), else this process.

const local = new Map<string, { n: number; until: number }>()

function localHit(key: string, windowSecs: number): number {
  const now = Date.now()
  const e = local.get(key)
  if (!e || e.until < now) {
    if (local.size > 10_000) local.clear()
    local.set(key, { n: 1, until: now + windowSecs * 1000 })
    return 1
  }
  return ++e.n
}

/** This window's count for the key, including this hit. */
export async function hit(key: string, windowSecs: number): Promise<number> {
  try {
    const r = getRedisClient()
    const n = Number(await r.incr(key))
    if (!Number.isFinite(n)) return localHit(key, windowSecs)
    // A key left without an expiry (a crash between the two calls) would block for good.
    if (n === 1 || Number(await r.ttl(key)) < 0) {
      if (typeof r.expire === 'function') await r.expire(key, windowSecs)
      else await r.set(key, String(n), 'EX', windowSecs)
    }
    return n
  } catch {
    return localHit(key, windowSecs)
  }
}
