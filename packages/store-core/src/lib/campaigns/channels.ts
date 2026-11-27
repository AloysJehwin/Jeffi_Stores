// Client-safe: which channels a campaign row sends on (list chips, channel filter, export).
import { campaignSupportsPush } from './push-kinds'

export type CampaignChannel = 'email' | 'whatsapp' | 'push'

export const CAMPAIGN_LIST_WA_KINDS = [
  'abandoned_cart',
  'abandoned_checkout',
  'order_shipped',
  'order_delivered',
  'reorder_reminder',
  'back_in_stock',
  'back_in_stock_alert',
]

/** `on` is Site Controls' switches (useMessagingChannels): an off channel gets no chip or filter. */
export function campaignChannels(
  kind: string,
  params: Record<string, unknown> | null | undefined,
  scenarioKind: string | null | undefined,
  on: { whatsapp: boolean; push: boolean }
): CampaignChannel[] {
  const out: CampaignChannel[] = on.whatsapp && CAMPAIGN_LIST_WA_KINDS.includes(kind) ? ['email', 'whatsapp'] : ['email']
  if (on.push && params?.pushEnabled === true && (campaignSupportsPush(kind) || campaignSupportsPush(scenarioKind ?? ''))) out.push('push')
  return out
}
