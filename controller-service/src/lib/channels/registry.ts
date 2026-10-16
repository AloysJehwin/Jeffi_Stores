import type { RuleSet } from './alerts-engine'
import { CHANNELS, type Channel } from './types'

// Lazy rule-set lookup per channel (imports stay inside so a route only loads its own channel).
export async function ruleSetFor(channel: Channel): Promise<RuleSet<any, any> | null> {
  switch (channel) {
    default:
      return null
  }
}

export function parseChannel(v: string | null | undefined): Channel | null {
  return v && (CHANNELS as readonly string[]).includes(v) ? (v as Channel) : null
}

