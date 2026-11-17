import { SHOWCASE_GENERATION_CAP_INR } from '@/lib/showcase/types'
import { estimateGeneration } from '@/lib/ai/paid-generation'
import type { StudioProduct, StudioSession } from './sessions'

// What the platform pays for in the studio (AI_SITE_STUDIO_PLAN.md §1): one free full-site generation per owner, up
// to SITE_STUDIO_BUDGET_INR of AI spend across all its requests, and free tweaks capped per day. That is the store's
// free full generation once installed; another waits until the store is live (Site Builder's "Build my whole site with
// AI", charged to the AI wallet: lib/site/site-generation.ts).

export const TWEAKS_PER_DAY = Number(process.env.SITE_STUDIO_TWEAKS_PER_DAY || 30)
/** Weight against the daily cap: a section change, a page rebuilt, an AI hint or a fresh set of directions. */
export const COST = { tweak: 1, regenerate: 5, help: 1, directions: 2 } as const
/** Platform-funded budgets (₹) for one call outside the full build: a brief, hint, direction or tweak; a page rebuilt. */
export const BUDGET_INR = { small: 25, page: 60 } as const
/** The free generation's cap (the same setting lib/site/studio reads). */
export const FREE_CAP_INR = () => Number(process.env.SITE_STUDIO_BUDGET_INR || process.env.SITE_BUILD_BUDGET_INR || 1000)

/** A Showcase's free generation is one page: ₹100 of provider cost (SHOWCASE_STUDIO_BUDGET_INR). */
export const SHOWCASE_FREE_CAP_INR = () => Number(process.env.SHOWCASE_STUDIO_BUDGET_INR || 100)
export const freeCapInr = (product?: StudioProduct | null) => (product === 'showcase' ? SHOWCASE_FREE_CAP_INR() : FREE_CAP_INR())

export const AFTER_LIVE = 'Your first full generation was free. Another is available from Site Builder after your store is live, charged to your AI wallet.'

export interface StudioAllowance {
  /** available: never used · resume: claimed but not finished, budget left · used: done or spent (the next one is after go-live) */
  free: 'available' | 'resume' | 'used'
  tweaksLeft: number
  tweaksPerDay: number
  /** A Showcase whose free generation is used: another one is charged to the wallet, usually ₹low–₹high, never over the cap. */
  paid?: { lowInr: number; highInr: number; capInr: number }
}

const today = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10)

export function allowanceOf(
  s: (Pick<StudioSession, 'free_used_at' | 'generated_at' | 'tweaks_today' | 'tweaks_day' | 'spent_inr'> & { product?: StudioProduct }) | null
): StudioAllowance {
  const used = s?.tweaks_day === today() ? s.tweaks_today : 0
  const free = !s?.free_used_at ? 'available' : s.generated_at || Number(s.spent_inr || 0) >= freeCapInr(s.product) ? 'used' : 'resume'
  return {
    free,
    tweaksLeft: Math.max(0, TWEAKS_PER_DAY - used),
    tweaksPerDay: TWEAKS_PER_DAY,
    ...(s?.product === 'showcase' && free === 'used' ? { paid: estimateGeneration('one_page', { capInr: SHOWCASE_GENERATION_CAP_INR }) } : {}),
  }
}
