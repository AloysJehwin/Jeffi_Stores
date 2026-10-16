// Shared fetch with retries for channel APIs: 429 and 5xx are retried with backoff, honouring
// Retry-After when the provider sends it. Each client keeps its own auth and error parsing.

export interface RetryOptions {
  /** Waits between attempts (ms); the length is the number of retries. */
  delays?: number[]
  retryOn?: (status: number) => boolean
  sleep?: (ms: number) => Promise<void>
}

const defaultSleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const RETRY_STATUS = (s: number) => s === 429 || s >= 500

export function retryAfterMs(res: Response): number | null {
  const v = res.headers.get('retry-after')
  if (!v) return null
  const secs = Number(v)
  if (Number.isFinite(secs)) return Math.min(secs * 1000, 60_000)
  const at = Date.parse(v)
  return Number.isFinite(at) ? Math.max(0, Math.min(at - Date.now(), 60_000)) : null
}

export async function fetchWithRetry(url: string, init: RequestInit, opts: RetryOptions = {}): Promise<Response> {
  const delays = opts.delays ?? [1000, 3000, 8000]
  const retryOn = opts.retryOn ?? RETRY_STATUS
  const sleep = opts.sleep ?? defaultSleep
  for (let attempt = 0; ; attempt++) {
    let res: Response
    try {
      res = await fetch(url, init)
    } catch (e) {
      if (attempt >= delays.length) throw e
      await sleep(delays[attempt])
      continue
    }
    if (!retryOn(res.status) || attempt >= delays.length) return res
    await sleep(retryAfterMs(res) ?? delays[attempt])
  }
}

/** Runs `fn` over `items` with at most `limit` in flight; results keep input order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i], i)
    }
  })
  await Promise.all(workers)
  return out
}

export const chunk = <T,>(arr: T[], size: number): T[][] => {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}
