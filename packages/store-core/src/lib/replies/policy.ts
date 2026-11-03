import type { Tier } from './types'

export type Outcome = 'apply' | 'ask' | 'admin'

/**
 * What to do with a reply we understood.
 *  - admin-tier intents, unsure readings, unverified senders, or auto-apply switched off → an admin approves
 *  - a clear reading of a low-risk intent → applied now
 *  - otherwise the customer confirms with YES/NO first
 */
export function decideOutcome(p: { tier: Tier; confidence: number; verified: boolean; autoApply: boolean }): Outcome {
  if (p.tier === 'admin' || p.confidence < 0.5 || !p.verified || !p.autoApply) return 'admin'
  if (p.tier === 'auto' && p.confidence >= 0.85) return 'apply'
  return 'ask'
}
