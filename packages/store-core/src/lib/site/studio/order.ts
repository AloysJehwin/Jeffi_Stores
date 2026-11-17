import { UTILITY_RANK } from './utility'
import type { PlannedPage, StudioPlan } from './types'

// The order a whole-site build writes pages in (the onboarding studio and Site Builder's redesign). Home first (the
// preview opens on it), then the header and footer every page wears, then the rest in plan order; the working pages
// (sign in, account, policies…) after every main page, so a budget that runs out loses only those.

const RANK: Record<string, number> = { 'store:home': 0, 'store:header': 1, 'store:footer': 2, 'store:announcement': 3, ...UTILITY_RANK }

export function buildOrder(plan: StudioPlan): PlannedPage[] {
  return plan.pages
    .map((p, i) => ({ p, i }))
    .filter(x => x.p.enabled)
    .sort((a, b) => (RANK[a.p.key] ?? (a.p.audience === 'business' ? 20 : 10)) - (RANK[b.p.key] ?? (b.p.audience === 'business' ? 20 : 10)) || a.i - b.i)
    .map(x => x.p)
}
