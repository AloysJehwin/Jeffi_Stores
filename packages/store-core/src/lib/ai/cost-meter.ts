import { AsyncLocalStorage } from 'async_hooks'

// Provider cost (₹, what the gateway reports it paid) of the AI calls made inside runMetered, against a budget. A site
// generation stops calling the AI once the budget is spent and is charged on this cost (ai/paid-generation.ts). Fed as
// each answer arrives: aiChat/aiChatStream (lib/shared/ai-client.ts) and image/video settle (billing.ts).

interface Meter {
  budgetInr: number
  costInr: number
  onCost?: (costInr: number) => void
}

const meter = new AsyncLocalStorage<Meter>()

/** `onCost` hears the running total after each costed call (a paid generation checkpoints it on its hold). */
export function runMetered<T>(budgetInr: number, fn: () => Promise<T>, onCost?: (costInr: number) => void): Promise<T> {
  return meter.run({ budgetInr, costInr: 0, onCost }, fn)
}

/** Adds one call's provider cost to the current meter; a no-op outside runMetered. */
export function meterAiCost(costInr: unknown): void {
  const m = meter.getStore()
  const n = Number(costInr)
  if (!m || !Number.isFinite(n) || n <= 0) return
  m.costInr += n
  m.onCost?.(m.costInr)
}

/** Inside runMetered: the provider cost so far and what is left of the budget; else null. */
export function metered(): { costInr: number; remainingInr: number } | null {
  const m = meter.getStore()
  return m ? { costInr: Math.round(m.costInr * 10000) / 10000, remainingInr: Math.max(0, m.budgetInr - m.costInr) } : null
}
