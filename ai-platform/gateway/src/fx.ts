import { setUsdInr } from './pricing'

// Live USD→INR for the AI price table: ECB reference via Frankfurter, else open.er-api.com. Fetched at start and every
// six hours; if no source answers, the last rate (or AI_USD_INR) stands.

const SOURCES = ['https://api.frankfurter.dev/v1/latest?base=USD&symbols=INR', 'https://open.er-api.com/v6/latest/USD']
const EVERY_MS = 6 * 60 * 60 * 1000

export async function refreshUsdInr(): Promise<number | null> {
  for (const url of SOURCES) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(4000) })
      const rate = res.ok ? ((await res.json()) as { rates?: { INR?: unknown } })?.rates?.INR : null
      if (typeof rate === 'number' && rate > 40 && rate < 250) {
        setUsdInr(Math.round(rate * 10000) / 10000)
        return rate
      }
    } catch {
      // try the next source
    }
  }
  return null
}

export function startUsdInrRefresh(): void {
  void refreshUsdInr()
  setInterval(() => void refreshUsdInr(), EVERY_MS).unref()
}
