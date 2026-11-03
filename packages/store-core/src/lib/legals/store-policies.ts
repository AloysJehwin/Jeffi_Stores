import 'server-only'
import type { Policy } from '@/lib/legals/policies'
import { policies } from '@/lib/legals/policies'
import { buildTenantPolicies, type TenantLegalInfo } from '@/lib/legals/template'

// The policies for whichever store the request belongs to: the flagship's static set, or on a
// tenant host the same text templated with that store's own identity at request time.

const TTL_MS = 60 * 1000
const cache = new Map<string, { value: Policy[]; info: TenantLegalInfo; expiresAt: number }>()

export interface StoreLegalContext {
  /** null on the flagship. */
  slug: string | null
  info: TenantLegalInfo | null
}

async function currentSlug(): Promise<string | null> {
  const { resolveCurrentTenant } = await import('@/lib/catalog/brand')
  return (await resolveCurrentTenant().catch(() => null))?.slug ?? null
}

async function tenantLegalInfo(slug: string): Promise<TenantLegalInfo> {
  const [{ getStoreIdentity }, { queryMany }] = await Promise.all([
    import('@/lib/catalog/site-controls'),
    import('@/lib/shared/db'),
  ])
  const identity = await getStoreIdentity()
  const rows = await queryMany<{ key: string; value: string }>(
    `SELECT key, value FROM site_settings WHERE key = ANY($1::text[])`,
    [['business_legal_name', 'business_address', 'business_gstin', 'business_city', 'business_state', 'business_seal_url']]
  ).catch(() => [])
  const m = Object.fromEntries(rows.map(r => [r.key, (r.value ?? '').trim()]))
  return {
    businessName: identity.name,
    slug,
    legalName: m.business_legal_name || undefined,
    address: m.business_address || '',
    gstin: m.business_gstin || undefined,
    email: identity.email || undefined,
    phone: identity.phone || undefined,
    web: identity.web || undefined,
    jurisdiction: [m.business_city, m.business_state].filter(Boolean).join(', ') || undefined,
    logoUrl: identity.logoUrl || undefined,
    sealUrl: m.business_seal_url || undefined,
  }
}

async function load(): Promise<{ slug: string | null; value: Policy[]; info: TenantLegalInfo | null }> {
  const slug = await currentSlug()
  if (!slug) return { slug: null, value: policies, info: null }
  const hit = cache.get(slug)
  if (hit && Date.now() < hit.expiresAt) return { slug, value: hit.value, info: hit.info }
  const info = await tenantLegalInfo(slug)
  const value = buildTenantPolicies(info)
  cache.set(slug, { value, info, expiresAt: Date.now() + TTL_MS })
  return { slug, value, info }
}

export async function getStorePolicies(): Promise<Policy[]> {
  return (await load()).value
}

export async function getStorePolicyBySlug(slug: string): Promise<Policy | undefined> {
  return (await load()).value.find(p => p.slug === slug)
}

export async function getStoreLegalContext(): Promise<StoreLegalContext> {
  const { slug, info } = await load()
  return { slug, info }
}

/** Download name for a policy PDF: `${slug}-${policy}.pdf`, `jeffistores-…` on the flagship. */
export function policyPdfName(storeSlug: string | null, policySlug: string): string {
  return `${storeSlug || 'jeffistores'}-${policySlug}.pdf`
}

/** Seal for a policy PDF: undefined on the flagship (its own seal), the store's seal or null on a tenant. */
export async function storeSealForPdf(ctx: StoreLegalContext): Promise<Buffer | null | undefined> {
  if (!ctx.slug) return undefined
  const url = ctx.info?.sealUrl
  if (!url || !/^https?:\/\//i.test(url)) return null
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) })
    return res.ok ? Buffer.from(await res.arrayBuffer()) : null
  } catch {
    return null
  }
}
