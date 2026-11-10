// SES enforces one account-wide sending rate (MaxSendRate, 14/s for this account). Every mail waits for a
// slot in the current second; bulk mail may only use part of each second so OTPs and order mail keep
// flowing during a broadcast. A throttled send is retried with backoff; a spent daily quota is not.

export type SesTier = 'bulk' | 'transactional'

/** Counts sends per one-second window: in-process by default, Redis when several pods share the account. */
export interface PaceCounter {
  hit(key: string): Promise<number>
  undo(key: string): Promise<void>
}

let win = { key: '', n: 0 }
export const localCounter: PaceCounter = {
  async hit(key) {
    if (win.key !== key) win = { key, n: 0 }
    return ++win.n
  },
  async undo(key) {
    if (win.key === key && win.n > 0) win.n--
  },
}

export const sesRate = () => Math.max(1, Number(process.env.SES_MAX_SEND_RATE) || 14)
// Open SMTP connections to keep up with the rate; one SES send takes ~150–300 ms.
export const sesConnections = () => Math.min(32, Math.max(4, Math.ceil(sesRate() / 4)))
const BULK_SHARE = 0.75
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// Bulk sends are also spaced evenly so a broadcast never bursts at the start of a second.
let nextBulkAt = 0
async function spaceBulk(intervalMs: number) {
  const now = Date.now()
  const at = Math.max(now, nextBulkAt)
  nextBulkAt = at + intervalMs
  if (at > now) await sleep(at - now)
}

export async function sesSlot(tier: SesTier, counter: PaceCounter = localCounter): Promise<void> {
  const rate = sesRate()
  const cap = tier === 'bulk' ? Math.max(1, Math.floor(rate * BULK_SHARE)) : rate
  if (tier === 'bulk') await spaceBulk(1000 / cap)
  for (let i = 0; i < 300; i++) {
    const now = Date.now()
    const key = `ses:pace:${Math.floor(now / 1000)}`
    const n = await counter.hit(key).catch(() => localCounter.hit(key))
    if (n <= cap) return
    await counter.undo(key).catch(() => {})
    await sleep(1000 - (now % 1000) + Math.random() * 100)
  }
}

const errText = (e: any) => `${e?.responseCode ?? ''} ${e?.response ?? ''} ${e?.message ?? e ?? ''}`
// SES answers both with "454 Throttling failure: …", so the quota check comes first.
const QUOTA = /daily (message|sending) quota|24[- ]?hour (send|sending) quota/i
const THROTTLED = /throttl|maximum sending rate|rate exceeded|too many (connections|requests)|^\s*4(21|54)\b/i

export class SesQuotaError extends Error {
  name = 'SesQuotaError'
}

export const isSesQuota = (e: unknown) => QUOTA.test(errText(e))
export const isSesThrottle = (e: unknown) => !isSesQuota(e) && THROTTLED.test(errText(e))

/** Sends inside the account's rate, retrying a throttled send up to 5 times. */
export async function sesSend<T>(send: () => Promise<T>, tier: SesTier, counter?: PaceCounter): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    await sesSlot(tier, counter)
    try {
      return await send()
    } catch (e) {
      if (isSesQuota(e)) throw new SesQuotaError('Amazon SES daily sending quota reached — the rest go out after it resets')
      if (!isSesThrottle(e) || attempt >= 5) throw e
      await sleep(Math.min(16_000, 1000 * 2 ** attempt) * (0.5 + Math.random()))
    }
  }
}
