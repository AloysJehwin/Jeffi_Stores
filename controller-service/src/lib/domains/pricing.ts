import 'server-only'
import { controlPlanePool } from '@/lib/tenant-registry'
import { getCatalog } from '@controller/lib/compute/catalog'
import { domainProviders, type TldPrice } from './providers'

// Domain price = AWS's yearly price (USD) × the compute catalog's USD→INR rate × (1 + margin), rounded up
// to the rupee. Paid from the wallet, whose top-ups already carry GST. Settings: platform_infra 'domain_pricing'.

export interface DomainPricingSettings {
  marginPct: number
  /** The renewal is charged and submitted from this many days before expiry. */
  renewLeadDays: number
  /** A renewal still unpaid this many days before expiry is given up; the domain expires. */
  renewCutoffDays: number
  /** TLDs offered, in display order (only those Route 53 also sells are shown). */
  tlds: string[]
}

export const DEFAULT_DOMAIN_PRICING: DomainPricingSettings = {
  marginPct: 25,
  renewLeadDays: 30,
  renewCutoffDays: 3,
  tlds: ['com', 'in', 'store', 'shop', 'co', 'net', 'org', 'online'],
}

let settingsCache: { at: number; value: DomainPricingSettings } | null = null
let pricesCache: { at: number; value: TldPrice[] } | null = null

export async function getDomainPricing(): Promise<DomainPricingSettings> {
  if (settingsCache && Date.now() - settingsCache.at < 60_000) return settingsCache.value
  const r = await controlPlanePool().query<{ value: string }>(`SELECT value FROM platform_infra WHERE key = 'domain_pricing'`)
  let stored: Partial<DomainPricingSettings> = {}
  try {
    stored = JSON.parse(r.rows[0]?.value ?? '{}')
  } catch {
    stored = {}
  }
  const value = { ...DEFAULT_DOMAIN_PRICING, ...stored }
  settingsCache = { at: Date.now(), value }
  return value
}

export async function saveDomainPricing(s: DomainPricingSettings): Promise<void> {
  await controlPlanePool().query(
    `INSERT INTO platform_infra (key, value) VALUES ('domain_pricing', $1)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [JSON.stringify(s)]
  )
  settingsCache = null
}

/** AWS list prices per TLD, cached for six hours. */
export async function tldPrices(): Promise<Map<string, TldPrice>> {
  if (!pricesCache || Date.now() - pricesCache.at > 6 * 3600_000) {
    const { registrar } = await domainProviders()
    pricesCache = { at: Date.now(), value: await registrar.listPrices() }
  }
  return new Map(pricesCache.value.map(p => [p.tld, p]))
}

export function clearDomainPricingCache() {
  settingsCache = null
  pricesCache = null
}

export const toInr = (usd: number, usdInr: number, margin: number) => Math.max(1, Math.ceil(usd * usdInr * (1 + margin)))

/** The registrable TLD of a name we sell: the longest offered suffix (co.in before in). */
export function tldOf(domain: string, offered: Iterable<string>): string | null {
  let best: string | null = null
  for (const t of offered) if (domain.endsWith('.' + t) && (!best || t.length > best.length)) best = t
  return best
}

export interface DomainQuote {
  tld: string
  costUsd: number
  renewalCostUsd: number
  usdInr: number
  margin: number
  priceInr: number
  renewalPriceInr: number
}

export async function quoteTld(tld: string): Promise<DomainQuote | null> {
  const [prices, settings, catalog] = await Promise.all([tldPrices(), getDomainPricing(), getCatalog()])
  const p = prices.get(tld)
  if (!p) return null
  const margin = settings.marginPct / 100
  const usdInr = catalog.settings.usdInr
  return {
    tld,
    costUsd: p.registrationUsd,
    renewalCostUsd: p.renewalUsd,
    usdInr,
    margin,
    priceInr: toInr(p.registrationUsd, usdInr, margin),
    renewalPriceInr: toInr(p.renewalUsd, usdInr, margin),
  }
}
