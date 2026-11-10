import { localCounter, sesSend, type PaceCounter, type SesTier } from '@jeffi/mail-shell'
import { getRedisClient } from '@/lib/shared/redis'

// The store's pods share one Redis, so their sends count against the same per-second window.
let redisDownUntil = 0
function counter(): PaceCounter {
  if (!process.env.REDIS_URL || Date.now() < redisDownUntil) return localCounter
  const r = getRedisClient()
  if (typeof r?.pexpire !== 'function') return localCounter
  const down = () => {
    redisDownUntil = Date.now() + 60_000
  }
  return {
    async hit(key) {
      try {
        const n: number = await r.incr(key)
        if (n === 1) await r.pexpire(key, 2000)
        return n
      } catch (e) {
        down()
        throw e
      }
    },
    async undo(key) {
      await r.decr(key).catch(down)
    },
  }
}

/** Bulk = broadcasts and automated campaigns; everything else is transactional. */
export const sesTierFor = (kind: string): SesTier => (kind === 'campaign' || kind === 'automation' ? 'bulk' : 'transactional')

export const pacedSesSend = <T>(send: () => Promise<T>, tier: SesTier) => sesSend(send, tier, counter())
