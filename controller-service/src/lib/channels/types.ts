export const CHANNELS = ['gmc', 'amazon', 'amazon_ads', 'meta_ads', 'social'] as const
export type Channel = (typeof CHANNELS)[number]

export type Severity = 'info' | 'warning' | 'critical'

export interface ChangeActor {
  adminId: string | null
  email: string | null
}

/** Display name, admin console path and the scope that may see each channel. */
export const CHANNEL_INFO: Record<Channel, { label: string; path: string; readScope: string }> = {
  gmc: { label: 'Google Merchant', path: '/merchant', readScope: 'merchant_sync:read' },
  amazon: { label: 'Amazon', path: '/amazon', readScope: 'amazon:read' },
  amazon_ads: { label: 'Amazon Ads', path: '/amazon-ads', readScope: 'amazon_ads:read' },
  meta_ads: { label: 'Meta Ads', path: '/meta-ads', readScope: 'meta_ads:read' },
  social: { label: 'Social', path: '/social-posts', readScope: 'social:read' },
}

// Advisory lock keys, one per channel job. Existing keys elsewhere: 84219575/6 (Amazon push and
// status), 84219591 (Google Ads sync).
export const CHANNEL_LOCKS = {
  gmc_reports: 84219601,
  gmc_issues: 84219602,
  amazon_pricing: 84219611,
  amazon_fees: 84219612,
  amazon_orders: 84219613,
  amazon_stock: 84219614,
  amazon_reports: 84219615,
  amazon_repricer: 84219616,
  amazon_ads_sync: 84219621,
  meta_ads_sync: 84219631,
  meta_capi: 84219632,
  social_insights: 84219641,
  social_inbox: 84219642,
  social_catalog: 84219643,
} as const
export type ChannelLock = keyof typeof CHANNEL_LOCKS
