import { controlPlanePool } from '@/lib/tenant-registry'
import { debitWallet, isFlagshipTenant } from '@/lib/payments/wallet'

// SMS & WhatsApp add-on. A tenant store sends on a channel only while its tenant has paid for the current
// month (tenants.messaging_addon / _until) for that channel AND the platform has assigned it a sender
// (tenant_messaging_senders). Paid from the prepaid wallet like ad-free; a period's charge is keyed on
// its tier and start date, so a double click or a cron retry charges once. The flagship is exempt.

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
  // Twilio local number $1.15/month at ₹88 (compute pricing's rate). The store's messaging server is
  // already on its daily server bill; WhatsApp senders and the shared SMS header have no monthly fee.
  { label: 'Dedicated number (Twilio local number, $1.15/month)', inrMonth: 101.2 },
]
export const DEFAULT_MESSAGING_MARGIN_PCT = 40

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
  renew: boolean
}

/** 'ok' sends; 'addon' = the active tier doesn't cover the channel; 'number' = covered but no sender assigned yet. */
export type EntitlementState = 'ok' | 'addon' | 'number'
export type MessagingEntitlement = Record<MessagingChannel, EntitlementState>

const isTier = (v: unknown): v is MessagingTier => v === 'sms' || v === 'whatsapp' || v === 'both'
export const tierCovers = (tier: MessagingTier | 'none', channel: MessagingChannel) => tier === 'both' || tier === channel

export async function getMessagingAddon(tenantId: string): Promise<MessagingAddonStatus> {
  const r = await controlPlanePool().query(
    `SELECT messaging_addon, messaging_addon_until, messaging_addon_renew, messaging_addon_until > now() AS active
       FROM tenants WHERE id = $1`,
    [tenantId]
  )
  const row = r.rows[0]
  return {
    tier: isTier(row?.messaging_addon) ? row.messaging_addon : 'none',
    active: !!row?.active,
    until: row?.messaging_addon_until ? new Date(row.messaging_addon_until).toISOString() : null,
    renew: !!row?.messaging_addon_renew,
  }
}

/** The idempotency key of one period's charge (exported for tests). */
export const messagingAddonRef = (tenantId: string, tier: MessagingTier, periodKey: string) =>
  `messaging_addon:${tenantId}:${tier}:${periodKey}`

/**
 * Charge one month. Same tier while active → extends from the current end; a different tier (or a lapsed
 * add-on) starts a new period from now. With renew the daily cron keeps charging; without it the period
 * simply runs out.
 */
export async function buyMessagingAddonMonth(
  tenantId: string,
  opts: { tier: MessagingTier; renew: boolean; reason: 'purchase' | 'renewal' }
): Promise<{ ok: true; status: MessagingAddonStatus; charged: boolean } | { ok: false; error: string }> {
  if (isFlagshipTenant(tenantId)) return { ok: false, error: 'The platform store has no messaging add-on.' }
  if (!isTier(opts.tier)) return { ok: false, error: 'Unknown add-on tier.' }
  const [current, pricing] = await Promise.all([getMessagingAddon(tenantId), getMessagingAddonPricing()])
  const extend = current.active && current.until && current.tier === opts.tier
  const start = extend ? new Date(current.until!) : new Date()
  const periodKey = start.toISOString().slice(0, 10)
  const res = await debitWallet({
    tenantId,
    amountInr: pricing.priceInr,
    category: 'messaging_addon',
    externalRef: messagingAddonRef(tenantId, opts.tier, periodKey),
    note: `SMS & WhatsApp add-on (${MESSAGING_TIER_LABEL[opts.tier]}), month from ${periodKey}${opts.reason === 'renewal' ? ' (auto-renew)' : ''}`,
    floorInr: 0,
    onCharged: async client => {
      await client.query(
        `UPDATE tenants SET messaging_addon = $2, messaging_addon_until = $3::timestamptz + interval '1 month',
                messaging_addon_renew = $4, updated_at = now()
          WHERE id = $1`,
        [tenantId, opts.tier, start.toISOString(), opts.renew]
      )
    },
  })
  if (!res.ok) return res
  if (!res.charged) await setMessagingAddonRenew(tenantId, opts.renew)
  invalidateMessagingEntitlement(tenantId)
  return { ok: true, charged: res.charged, status: await getMessagingAddon(tenantId) }
}

export async function setMessagingAddonRenew(tenantId: string, renew: boolean): Promise<void> {
  await controlPlanePool().query(`UPDATE tenants SET messaging_addon_renew = $2, updated_at = now() WHERE id = $1`, [
    tenantId,
    renew,
  ])
}

/** Auto-renewing tenants whose month ends within a day, or lapsed under a week ago (wallet was short). */
export async function tenantsDueForMessagingAddonRenewal(): Promise<{ tenantId: string; tier: MessagingTier }[]> {
  const r = await controlPlanePool().query(
    `SELECT id, messaging_addon FROM tenants
      WHERE messaging_addon_renew AND status = 'active' AND messaging_addon <> 'none' AND messaging_addon_until IS NOT NULL
        AND messaging_addon_until < now() + interval '1 day' AND messaging_addon_until > now() - interval '7 days'`
  )
  return r.rows.filter(row => isTier(row.messaging_addon)).map(row => ({ tenantId: row.id as string, tier: row.messaging_addon as MessagingTier }))
}

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
            EXISTS (SELECT 1 FROM tenant_messaging_senders s WHERE s.tenant_id = t.id AND s.channel = 'sms' AND s.status = 'active') AS sms_sender,
            EXISTS (SELECT 1 FROM tenant_messaging_senders s WHERE s.tenant_id = t.id AND s.channel = 'whatsapp' AND s.status = 'active') AS wa_sender
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
