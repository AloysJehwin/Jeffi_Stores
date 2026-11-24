import { controlPlanePool } from '@/lib/tenant-registry'
import { isFlagshipTenant } from '@/lib/payments/wallet'

// SMS & WhatsApp add-on. A tenant store sends on a channel only while its tenant has paid for the current
// period (tenants.messaging_addon / _until) for that channel AND the platform has assigned it a sender
// (tenant_messaging_senders). A messaging_addon line on the workspace's subscription; only the controller's billing
// handler writes messaging_addon(_until) (controller-service/src/lib/billing). The flagship is exempt.

export type MessagingTier = 'sms' | 'whatsapp' | 'both'
export type MessagingChannel = 'sms' | 'whatsapp'
export const MESSAGING_TIERS: readonly MessagingTier[] = ['sms', 'whatsapp', 'both']

/**
 * One monthly service fee for both channels: what a store's own sender costs the platform, plus a margin.
 * Message usage is billed separately from the wallet. Platform admins edit the cost lines and margin
 * (control-plane platform_infra 'messaging_addon_pricing'); these defaults apply until they do.
 */
export interface MessagingCostLine {
  label: string
  inrMonth: number
}
export interface MessagingAddonPricing {
  costLines: MessagingCostLine[]
  marginPct: number
  costInr: number
  priceInr: number
}
export const DEFAULT_MESSAGING_COST_LINES: MessagingCostLine[] = [
  // Two Twilio local numbers at $1.15/month and ₹88 (compute pricing's rate): customer-facing (WhatsApp + SMS) and
  // admin-facing (WhatsApp). The store's messaging server is already on its daily server bill.
  { label: 'Customer-facing number (Twilio local, $1.15/month)', inrMonth: 101.2 },
  { label: 'Admin-facing number (Twilio local, $1.15/month)', inrMonth: 101.2 },
  { label: 'WhatsApp sender registration, upkeep and support', inrMonth: 197.6 },
]
export const DEFAULT_MESSAGING_MARGIN_PCT = 25

export function messagingAddonPrice(costLines: MessagingCostLine[], marginPct: number): { costInr: number; priceInr: number } {
  const costInr = Math.round(costLines.reduce((a, l) => a + (Number(l.inrMonth) || 0), 0) * 100) / 100
  return { costInr, priceInr: Math.max(1, Math.ceil(costInr * (1 + marginPct / 100))) }
}

const PRICING_TTL_MS = 60_000
let pricingCache: { at: number; value: MessagingAddonPricing } | null = null

export function invalidateMessagingAddonPricing() {
  pricingCache = null
}

export async function getMessagingAddonPricing(): Promise<MessagingAddonPricing> {
  if (pricingCache && Date.now() - pricingCache.at < PRICING_TTL_MS) return pricingCache.value
  let stored: Partial<Pick<MessagingAddonPricing, 'costLines' | 'marginPct'>> = {}
  try {
    const r = await controlPlanePool().query(`SELECT value FROM platform_infra WHERE key = 'messaging_addon_pricing'`)
    stored = JSON.parse(r.rows[0]?.value ?? '{}') || {}
  } catch {
    stored = {}
  }
  const costLines = Array.isArray(stored.costLines) && stored.costLines.length ? stored.costLines : DEFAULT_MESSAGING_COST_LINES
  const marginPct = Number.isFinite(Number(stored.marginPct)) ? Number(stored.marginPct) : DEFAULT_MESSAGING_MARGIN_PCT
  const value = { costLines, marginPct, ...messagingAddonPrice(costLines, marginPct) }
  pricingCache = { at: Date.now(), value }
  return value
}
export const MESSAGING_TIER_LABEL: Record<MessagingTier, string> = { sms: 'SMS', whatsapp: 'WhatsApp', both: 'SMS & WhatsApp' }

export interface MessagingAddonStatus {
  /** Stored tier; 'none' until first bought. Covers nothing once `until` has passed. */
  tier: MessagingTier | 'none'
  active: boolean
  until: string | null
}

/** 'ok' sends; 'addon' = the active tier doesn't cover the channel; 'number' = covered but no sender assigned yet. */
export type EntitlementState = 'ok' | 'addon' | 'number'
export type MessagingEntitlement = Record<MessagingChannel, EntitlementState>

const isTier = (v: unknown): v is MessagingTier => v === 'sms' || v === 'whatsapp' || v === 'both'
export const tierCovers = (tier: MessagingTier | 'none', channel: MessagingChannel) => tier === 'both' || tier === channel

export async function getMessagingAddon(tenantId: string): Promise<MessagingAddonStatus> {
  const r = await controlPlanePool().query(
    `SELECT messaging_addon, messaging_addon_until, messaging_addon_until > now() AS active
       FROM tenants WHERE id = $1`,
    [tenantId]
  )
  const row = r.rows[0]
  return {
    tier: isTier(row?.messaging_addon) ? row.messaging_addon : 'none',
    active: !!row?.active,
    until: row?.messaging_addon_until ? new Date(row.messaging_addon_until).toISOString() : null,
  }
}

/** The wallet_ledger key of a wallet-paid month from before the switch (the migration credits from it). */
export const messagingAddonRef = (tenantId: string, tier: MessagingTier, periodKey: string) =>
  `messaging_addon:${tenantId}:${tier}:${periodKey}`

const ENTITLEMENT_TTL_MS = 60_000
const entitlementCache = new Map<string, { at: number; value: MessagingEntitlement }>()
const ALL_OK: MessagingEntitlement = { sms: 'ok', whatsapp: 'ok' }

/**
 * What a store may send. Flagship always ok. Cached 60 s; `maxAgeMs` lets a caller with its own cache
 * (Site Controls, 30 s) take a fresher read so a purchase shows within a minute. Throws when the
 * control plane can't be read — callers decide how to fail.
 */
export async function messagingEntitlement(tenantId: string | null | undefined, opts: { maxAgeMs?: number } = {}): Promise<MessagingEntitlement> {
  if (isFlagshipTenant(tenantId)) return ALL_OK
  const id = tenantId!
  const hit = entitlementCache.get(id)
  if (hit && Date.now() - hit.at < Math.min(ENTITLEMENT_TTL_MS, opts.maxAgeMs ?? ENTITLEMENT_TTL_MS)) return hit.value
  const r = await controlPlanePool().query(
    `SELECT t.messaging_addon AS tier, t.messaging_addon_until > now() AS active,
            EXISTS (SELECT 1 FROM tenant_messaging_senders s WHERE s.tenant_id = t.id AND s.channel = 'sms' AND s.audience = 'customer' AND s.status = 'active') AS sms_sender,
            EXISTS (SELECT 1 FROM tenant_messaging_senders s WHERE s.tenant_id = t.id AND s.channel = 'whatsapp' AND s.audience = 'customer' AND s.status = 'active') AS wa_sender
       FROM tenants t WHERE t.id = $1`,
    [id]
  )
  const row = r.rows[0]
  const tier: MessagingTier | 'none' = row?.active && isTier(row.tier) ? row.tier : 'none'
  const state = (channel: MessagingChannel, hasSender: boolean): EntitlementState =>
    !tierCovers(tier, channel) ? 'addon' : hasSender ? 'ok' : 'number'
  const value: MessagingEntitlement = { sms: state('sms', !!row?.sms_sender), whatsapp: state('whatsapp', !!row?.wa_sender) }
  entitlementCache.set(id, { at: Date.now(), value })
  return value
}

export function invalidateMessagingEntitlement(tenantId?: string) {
  if (tenantId) entitlementCache.delete(tenantId)
  else entitlementCache.clear()
}
