// AI billing: price-list lookup, wallet pre-authorise and true-up, ai_usage write.
// Contract: docs/plans/AI_MEDIA_PLATFORM_PLAN.md ("App billing"). The owner is credentialOwnerId():
// a tenant id, or the platform sentinel on the flagship. The flagship logs cost_inr/price_inr = 0
// and never touches the wallet; tenants are debited on preauthorize and trued-up on settle, keyed
// idempotently by external_ref = 'ai:' || usage.id. Insufficient balance throws AiWalletError
// before any provider call.

import { query, queryOne } from '@/lib/shared/db'
import { controlPlanePool } from '@/lib/tenant-registry'
import { credentialOwnerId, isPlatformOwner } from '@/lib/integrations/owner'
import { debit, trueUp } from '@jeffi/wallet'
import { getTenantWallet } from '@/lib/payments/wallet'
import { aiFeatureLabel } from './feature-labels'

export type Capability = 'text' | 'embed' | 'vision' | 'image' | 'video'
export type UnitType = 'token_1k_in' | 'token_1k_out' | 'image' | 'video_second' | 'call'

export interface UsageUnits {
  type: UnitType
  qty: number
}

export interface UsageInput {
  feature: string
  capability: Capability
  provider: string
  model: string
  units: UsageUnits[]
  costInr: number
  ref?: string
  actor?: string | null
  latencyMs?: number
  cache?: string | null
}

export class AiWalletError extends Error {
  status = 402 as const
  constructor(
    message: string,
    public balanceInr: number,
    public neededInr: number
  ) {
    super(message)
    this.name = 'AiWalletError'
  }
}

type PriceRow = { price_inr: number; cost_inr: number; model: string }

// 5-min in-process price cache. Keyed by capability+unit_type (the lookup granularity below).
const priceCache = new Map<string, { at: number; rows: Array<{ provider: string; model: string; price_inr: number; cost_inr: number }> }>()
const PRICE_TTL_MS = 5 * 60_000

async function loadPrices(capability: Capability, unitType: UnitType): Promise<{ provider: string; model: string; price_inr: number; cost_inr: number }[]> {
  const key = `${capability}:${unitType}`
  const cached = priceCache.get(key)
  if (cached && Date.now() - cached.at < PRICE_TTL_MS) return cached.rows
  const res = await controlPlanePool()
    .query<{ provider: string; model: string; price_inr: string; cost_inr: string }>(
      `SELECT provider, model, price_inr, cost_inr FROM ai_price_list
        WHERE active = true AND capability = $1 AND unit_type = $2`,
      [capability, unitType]
    )
    .catch(() => null)
  const rows = (res?.rows ?? []).map(r => ({ provider: r.provider, model: r.model, price_inr: Number(r.price_inr), cost_inr: Number(r.cost_inr) }))
  priceCache.set(key, { at: Date.now(), rows })
  return rows
}

/** Test hook. */
export function __resetAiBillingCache(): void {
  priceCache.clear()
}

/** Price for one unit of {capability, provider, model, unit_type}. Falls back to the provider's '*'
 *  row, then to any row for (capability, unit_type), warning rather than failing the call. */
async function unitPrice(capability: Capability, provider: string, model: string, unitType: UnitType): Promise<PriceRow> {
  const rows = await loadPrices(capability, unitType)
  const exact = rows.find(r => r.provider === provider && r.model === model)
  if (exact) return { price_inr: exact.price_inr, cost_inr: exact.cost_inr, model: exact.model }
  const providerAny = rows.find(r => r.provider === provider && r.model === '*')
  if (providerAny) return { price_inr: providerAny.price_inr, cost_inr: providerAny.cost_inr, model: providerAny.model }
  const any = rows.find(r => r.model === '*') ?? rows[0]
  if (any) {
    console.warn(`[ai-billing] no price row for ${capability}/${provider}/${model}/${unitType}; using ${any.provider}/${any.model}`)
    return { price_inr: any.price_inr, cost_inr: any.cost_inr, model: any.model }
  }
  console.warn(`[ai-billing] no price row for ${capability}/${provider}/${model}/${unitType}; charging 0`)
  return { price_inr: 0, cost_inr: 0, model: '*' }
}

/** Sum of unit price × qty across the units array. */
async function priceUnits(capability: Capability, provider: string, model: string, units: UsageUnits[]): Promise<number> {
  let total = 0
  for (const u of units) {
    const p = await unitPrice(capability, provider, model, u.type)
    total += p.price_inr * (u.qty || 0)
  }
  return Math.round(total * 10000) / 10000
}

const round4 = (n: number) => Math.round(n * 10000) / 10000

/** Pre-authorise an AI call: insert ai_usage(pending), estimate price, debit the wallet keyed to
 *  'ai:' || id. Flagship skips the wallet entirely (logged with price_inr = 0). */
export async function preauthorize(
  input: Omit<UsageInput, 'costInr' | 'units'> & { estimateUnits: UsageUnits[] }
): Promise<{ usageId: string; priceInr: number }> {
  const ownerId = await credentialOwnerId()
  const isFlagship = isPlatformOwner(ownerId)
  const estimated = isFlagship ? 0 : await priceUnits(input.capability, input.provider, input.model, input.estimateUnits)

  const row = await queryOne<{ id: string }>(
    `INSERT INTO ai_usage (feature, capability, provider, model, units, cost_inr, price_inr, wallet_ref, status, ref, actor)
     VALUES ($1,$2,$3,$4,$5::jsonb, 0, $6, NULL, 'pending', $7, $8)
     RETURNING id`,
    [input.feature, input.capability, input.provider, input.model, JSON.stringify(input.estimateUnits), estimated, input.ref ?? null, input.actor ?? null]
  )
  const usageId = row!.id
  const walletRef = `ai:${usageId}`

  if (isFlagship) return { usageId, priceInr: 0 }

  const result = await debit({
    tenantId: ownerId,
    amountInr: estimated,
    category: 'ai',
    externalRef: walletRef,
    note: `AI: ${aiFeatureLabel(input.feature)}`,
  })
  if (!result.ok) {
    // Mark the row failed so Finance shows the attempt, then throw a 402.
    await query(`UPDATE ai_usage SET status = 'failed', error = $2 WHERE id = $1`, [usageId, 'insufficient_balance']).catch(() => {})
    const balance = result.balance
    const needed = (result as { needed?: number }).needed ?? Math.max(0, estimated - balance)
    throw new AiWalletError('Insufficient wallet balance for AI call', balance, needed)
  }
  if (result.charged) {
    await query(`UPDATE ai_usage SET wallet_ref = $2 WHERE id = $1`, [usageId, walletRef]).catch(() => {})
  }
  return { usageId, priceInr: estimated }
}

/** Final units + cost from the provider. Trues the wallet up to the exact price (positive or
 *  negative delta), updates ai_usage status, latency, cache and error. */
export async function settle(
  usageId: string,
  input: Pick<UsageInput, 'units' | 'costInr' | 'latencyMs' | 'cache'> & { status: 'ok' | 'failed'; error?: string }
): Promise<void> {
  if (!usageId) return
  const current = await queryOne<{ feature: string; capability: Capability; provider: string; model: string; wallet_ref: string | null }>(
    `SELECT feature, capability, provider, model, wallet_ref FROM ai_usage WHERE id = $1`,
    [usageId]
  )
  if (!current) return

  const isFailed = input.status === 'failed'
  const finalPrice = isFailed ? 0 : await priceUnits(current.capability, current.provider, current.model, input.units)
  const walletRef = current.wallet_ref ?? `ai:${usageId}`

  await query(
    `UPDATE ai_usage SET units = $2::jsonb, cost_inr = $3, price_inr = $4, latency_ms = $5, cache = $6,
       status = $7, error = $8 WHERE id = $1`,
    [usageId, JSON.stringify(input.units), round4(input.costInr || 0), round4(finalPrice), input.latencyMs ?? null, input.cache ?? null, input.status, input.error ?? null]
  ).catch(() => {})

  const ownerId = await credentialOwnerId()
  if (isPlatformOwner(ownerId)) return
  await trueUp({ tenantId: ownerId, amountInr: finalPrice, externalRef: walletRef, note: `AI: ${aiFeatureLabel(current.feature)}` }).catch(err => {
    console.warn('[ai-billing] trueUp failed', (err as Error).message)
  })
}

/** One-shot write for callers that know units up front and charge AFTER the call (text).
 *  Inserts the ai_usage row, debits the wallet keyed to 'ai:' || id. If the wallet can't pay,
 *  marks the row 'unpaid' and throws AiWalletError (the caller already has the result and
 *  decides what to do). The flagship never debits (price 0). */
export async function recordUsage(input: UsageInput): Promise<{ usageId: string; priceInr: number }> {
  const ownerId = await credentialOwnerId()
  const isFlagship = isPlatformOwner(ownerId)
  const price = isFlagship ? 0 : await priceUnits(input.capability, input.provider, input.model, input.units)
  const row = await queryOne<{ id: string }>(
    `INSERT INTO ai_usage (feature, capability, provider, model, units, cost_inr, price_inr, wallet_ref, status, ref, actor, latency_ms, cache)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,NULL,'pending',$8,$9,$10,$11)
     RETURNING id`,
    [
      input.feature,
      input.capability,
      input.provider,
      input.model,
      JSON.stringify(input.units),
      round4(input.costInr || 0),
      round4(price),
      input.ref ?? null,
      input.actor ?? null,
      input.latencyMs ?? null,
      input.cache ?? null,
    ]
  )
  const usageId = row!.id
  const walletRef = `ai:${usageId}`

  if (isFlagship || price <= 0) {
    await query(`UPDATE ai_usage SET status = 'ok' WHERE id = $1`, [usageId]).catch(() => {})
    return { usageId, priceInr: 0 }
  }

  const result = await debit({
    tenantId: ownerId,
    amountInr: price,
    category: 'ai',
    externalRef: walletRef,
    note: `AI: ${aiFeatureLabel(input.feature)}`,
  })
  if (!result.ok) {
    await query(`UPDATE ai_usage SET status = 'unpaid', error = $2 WHERE id = $1`, [usageId, 'insufficient_balance']).catch(() => {})
    const balance = result.balance
    const needed = (result as { needed?: number }).needed ?? Math.max(0, price - balance)
    throw new AiWalletError('Insufficient wallet balance for AI call', balance, needed)
  }
  await query(`UPDATE ai_usage SET status = 'ok', wallet_ref = $2 WHERE id = $1`, [usageId, walletRef]).catch(() => {})
  return { usageId, priceInr: price }
}

/** Convenience: callers that have no estimate yet can ask whether the wallet can likely cover a
 *  price. Used by lib/shared/ai-client.ts to log 'unpaid' when the balance can't pay. */
export async function tenantCanPay(amountInr: number): Promise<{ ok: boolean; balance: number }> {
  const ownerId = await credentialOwnerId()
  if (isPlatformOwner(ownerId)) return { ok: true, balance: 0 }
  const w = await getTenantWallet(ownerId).catch(() => null)
  const bal = w?.balance ?? 0
  const floor = w?.minBalance ?? 0
  return { ok: bal - amountInr >= floor, balance: bal }
}
