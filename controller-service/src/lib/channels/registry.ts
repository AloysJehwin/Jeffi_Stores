import type { RuleSet } from './alerts-engine'
import { CHANNELS, type Channel } from './types'

// Lazy rule-set lookup per channel (imports stay inside so a route only loads its own channel).
export async function ruleSetFor(channel: Channel): Promise<RuleSet<any, any> | null> {
  switch (channel) {
    case 'gmc':
      return (await import('@/lib/merchant/alerts')).GMC_RULES
    case 'amazon':
      return (await import('@/lib/amazon/alerts')).AMAZON_RULES
    case 'amazon_ads':
      return (await import('@/lib/amazon-ads/alerts')).AMAZON_ADS_RULES
    default:
      return null
  }
}

export function parseChannel(v: string | null | undefined): Channel | null {
  return v && (CHANNELS as readonly string[]).includes(v) ? (v as Channel) : null
}

