import 'server-only'
import { runStudioFunded, studioSpentInr } from '@/lib/site/studio'
import { addStudioSpend, type StudioSession } from './sessions'
import { allowanceOf, BUDGET_INR, freeCapInr } from './allowance'

// Every studio AI call runs platform-funded (lib/site/studio runStudioFunded) and its spend is added to the session,
// so the free generation's cap (SITE_STUDIO_BUDGET_INR, ₹1,000; a Showcase's ₹100) holds across requests, not per
// request.

/** What is left of the owner's free generation. */
export const freeBudgetLeft = (s: Pick<StudioSession, 'spent_inr'> & { product?: StudioSession['product'] }) =>
  Math.max(0, freeCapInr(s.product) - Number(s.spent_inr || 0))

/**
 * A call before the build (brief, plan, directions, hints) comes out of the free generation's budget. A Showcase whose
 * free generation is used still gets them (its next generation is paid), within the day's tweaks.
 */
export const preBuildBudget = (s: Pick<StudioSession, 'free_used_at' | 'generated_at' | 'tweaks_today' | 'tweaks_day' | 'spent_inr' | 'product'>) =>
  s.product === 'showcase' && allowanceOf(s).free === 'used' ? BUDGET_INR.small : Math.min(BUDGET_INR.small, freeBudgetLeft(s))

/** Runs fn on a platform-funded budget of `budgetInr` and records what it spent on the session, even when it fails. */
export async function funded<T>(sessionId: string, budgetInr: number, fn: () => Promise<T>): Promise<T> {
  let spent = 0
  try {
    return await runStudioFunded(async () => {
      try {
        return await fn()
      } finally {
        spent = studioSpentInr()
      }
    }, Math.max(0, budgetInr))
  } finally {
    await addStudioSpend(sessionId, spent).catch(err => console.warn('[studio] spend not recorded:', (err as Error).message))
  }
}
