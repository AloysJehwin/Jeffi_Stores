import { SHOWCASE_REDESIGN_PRICE_INR } from '@/lib/showcase/types'
import type { StudioProduct, StudioSession } from './sessions'

// What the platform pays for in the studio (AI_SITE_STUDIO_PLAN.md §1): one free full-site generation per owner, up
// to SITE_STUDIO_BUDGET_INR of AI spend across all its requests, design help capped per day, and a few free corrections
// a day once the site is built, then each charged to the AI wallet (./corrections.ts). That is the store's free full
// generation once installed; another waits until the store is live (Site Builder's "Build my whole site with AI",
// charged to the AI wallet: lib/site/site-generation.ts).

/** Free AI corrections per owner per IST day, across their studios: a section changed, a page designed again (COST). */
export const CORRECTIONS_FREE_PER_DAY = 3
/** Each correction past the day's free ones, charged to the AI wallet (₹). One correction is usually one Opus section
 *  call: ₹8.5 median, ₹12 p90, ₹14 for the largest section (2026-11-17 studio calls at ₹94/$); ₹20 is that largest
 *  × 1.4 (PUBLIC_MARGIN), so a repair round still stays at or above cost. */
export const CORRECTION_PRICE_INR = 20

/** Design help before the build (AI hints, a fresh set of directions), per session per day. */
export const HELP_PER_DAY = Number(process.env.SITE_STUDIO_TWEAKS_PER_DAY || 30)
/** Weight: corrections (tweak, regenerate) against CORRECTIONS_FREE_PER_DAY, help (help, directions) against HELP_PER_DAY. */
export const COST = { tweak: 1, regenerate: 5, help: 1, directions: 2 } as const
/** Platform-funded budgets (₹) for one call outside the full build: a brief, hint, direction or tweak; a page rebuilt. */
export const BUDGET_INR = { small: 25, page: 60 } as const
/** The free generation's cap (the same setting lib/site/studio reads). */
export const FREE_CAP_INR = () => Number(process.env.SITE_STUDIO_BUDGET_INR || process.env.SITE_BUILD_BUDGET_INR || 1000)

/** A Showcase's free generation is one page: ₹150 of provider cost (SHOWCASE_STUDIO_BUDGET_INR), enough for a full page on Opus. */
export const SHOWCASE_FREE_CAP_INR = () => Number(process.env.SHOWCASE_STUDIO_BUDGET_INR || 150)
export const freeCapInr = (product?: StudioProduct | null) => (product === 'showcase' ? SHOWCASE_FREE_CAP_INR() : FREE_CAP_INR())

export const AFTER_LIVE = 'Your first full generation was free. Another is available from Site Builder after your store is live, charged to your AI wallet.'

export interface StudioAllowance {
  /** available: never used · resume: claimed but not finished, budget left · used: done or spent (the next one is after go-live) */
  free: 'available' | 'resume' | 'used'
  /** Design help left today (HELP_PER_DAY). */
  helpLeft: number
  /** Free corrections left today; past them each costs correctionPriceInr from the AI wallet. */
  correctionsLeft: number
  correctionsPerDay: number
  correctionPriceInr: number
  /** How many corrections a section change and a page designed again count as. */
  correctionUnits: { tweak: number; page: number }
  /** A Showcase whose free generation is used: each redesign costs this, flat, from the workspace's wallet. */
  paid?: { priceInr: number }
}

const today = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10)

export function allowanceOf(
  s: (Pick<StudioSession, 'free_used_at' | 'generated_at' | 'tweaks_today' | 'tweaks_day' | 'spent_inr' | 'corrections_today'> & { product?: StudioProduct }) | null
): StudioAllowance {
  const used = s?.tweaks_day === today() ? s.tweaks_today : 0
  const free = !s?.free_used_at ? 'available' : s.generated_at || Number(s.spent_inr || 0) >= freeCapInr(s.product) ? 'used' : 'resume'
  return {
    free,
    helpLeft: Math.max(0, HELP_PER_DAY - used),
    correctionsLeft: Math.max(0, CORRECTIONS_FREE_PER_DAY - Number(s?.corrections_today ?? 0)),
    correctionsPerDay: CORRECTIONS_FREE_PER_DAY,
    correctionPriceInr: CORRECTION_PRICE_INR,
    correctionUnits: { tweak: COST.tweak, page: COST.regenerate },
    ...(s?.product === 'showcase' && free === 'used' ? { paid: { priceInr: SHOWCASE_REDESIGN_PRICE_INR } } : {}),
  }
}
