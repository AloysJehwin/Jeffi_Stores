import { z } from 'zod'
import { query, queryOne } from '@/lib/shared/db'
import { runChange, type ChangeOutcome } from '@/lib/channels/change-log'
import type { ChangeActor } from '@/lib/channels/types'
import { GMC_PUSH_DISABLED, merchantConfigured } from './client'
import {
  createReturnPolicy,
  deleteReturnPolicy,
  getShippingSettings,
  insertPromotion,
  insertShippingSettings,
  listPromotions,
  listReturnPolicies,
  toMicros,
} from './console-api'
import { syncProductToMerchant } from './sync'

// Changes made from the Merchant console. Each goes through runChange (validate, preview, apply,
// change log). Catalogue fixes change our product and re-push that one product.

const pushBlocked = () => (GMC_PUSH_DISABLED ? ['Pushing to Google is turned off in this environment (GMC_PUSH_DISABLED).'] : [])

/** GTIN-8/12/13/14 with a valid check digit. */
export function isValidGtin(v: string): boolean {
  if (!/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(v)) return false
  const digits = v.split('').map(Number)
  const check = digits.pop()!
  const sum = digits.reverse().reduce((s, d, i) => s + d * (i % 2 === 0 ? 3 : 1), 0)
  return (10 - (sum % 10)) % 10 === check
}

export const ActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('product.repush'), productId: z.string().uuid() }),
  z.object({
    action: z.literal('product.identifiers'),
    productId: z.string().uuid(),
    variantId: z.string().uuid().nullish(),
    gtin: z.string().trim().max(14).nullish(),
    mpn: z.string().trim().max(70).nullish(),
  }),
  z.object({ action: z.literal('product.price'), offerId: z.string().min(1).max(200), price: z.number().positive().max(10_000_000), allowBelowCost: z.boolean().optional() }),
  z.object({
    action: z.literal('promotion.create'),
    promotionId: z.string().regex(/^[A-Za-z0-9_-]{1,50}$/),
    title: z.string().trim().min(1).max(60),
    kind: z.enum(['PERCENT_OFF', 'MONEY_OFF']),
    value: z.number().positive().max(10_000_000),
    code: z.string().trim().regex(/^[A-Za-z0-9]{1,20}$/).nullish(),
    minimumPurchase: z.number().nonnegative().max(10_000_000).nullish(),
    start: z.string().datetime({ offset: true }),
    end: z.string().datetime({ offset: true }),
  }),
  z.object({ action: z.literal('promotion.end'), promotionId: z.string().regex(/^[A-Za-z0-9_-]{1,50}$/) }),
  z.object({
    action: z.literal('shipping.save'),
    services: z
      .array(
        z.object({
          name: z.string().trim().min(1).max(80),
          flatRate: z.number().nonnegative().max(100_000),
          minHandlingDays: z.number().int().min(0).max(30),
          maxHandlingDays: z.number().int().min(0).max(30),
          minTransitDays: z.number().int().min(0).max(60),
          maxTransitDays: z.number().int().min(0).max(60),
          active: z.boolean(),
        })
      )
      .min(1)
      .max(20),
  }),
  z.object({
    action: z.literal('returns.create'),
    label: z.string().trim().min(1).max(50),
    days: z.number().int().min(1).max(365),
    uri: z.string().url(),
    freeReturns: z.boolean(),
    fee: z.number().nonnegative().max(100_000).nullish(),
    refundDays: z.number().int().min(1).max(60).nullish(),
  }),
  z.object({ action: z.literal('returns.delete'), name: z.string().regex(/^accounts\/\d+\/onlineReturnPolicies\/[\w-]+$/) }),
])
export type MerchantAction = z.infer<typeof ActionSchema>

/** Shipping settings changes write this; settings tabs read the refreshed copy. */
export async function refreshAccountState(): Promise<void> {
  const [shipping, returns, promotions] = await Promise.all([
    getShippingSettings().catch(() => null),
    listReturnPolicies().catch(() => []),
    listPromotions().catch(() => []),
  ])
  await query(
    `INSERT INTO gmc_account_state (id, shipping, return_policies, promotions, refreshed_at) VALUES (1, $1::jsonb, $2::jsonb, $3::jsonb, now())
     ON CONFLICT (id) DO UPDATE SET shipping = EXCLUDED.shipping, return_policies = EXCLUDED.return_policies, promotions = EXCLUDED.promotions, refreshed_at = now()`,
    [shipping ? JSON.stringify(shipping) : null, JSON.stringify(returns), JSON.stringify(promotions)]
  )
}

interface OfferRow {
  product_id: string
  variant_id: string | null
  name: string
  price: string
  price_ex_gst: string | null
  cost: string | null
}

async function offerProduct(offerId: string): Promise<OfferRow | null> {
  return queryOne<OfferRow>(
    `SELECT p.id AS product_id, v.id AS variant_id, p.name, COALESCE(v.price, p.base_price) AS price,
            COALESCE(v.price_ex_gst, p.price_ex_gst) AS price_ex_gst, COALESCE(v.cost_price, p.cost_price) AS cost
     FROM products p LEFT JOIN product_variants v ON v.product_id = p.id
     WHERE lower(regexp_replace(COALESCE(v.sku, p.sku), '[^a-zA-Z0-9_:.-]', '_', 'g')) = lower($1) LIMIT 1`,
    [offerId]
  )
}

/** Ex-GST price that keeps the product's current GST ratio. */
export function exGstFor(newPrice: number, price: number, priceExGst: number | null): number | null {
  if (priceExGst == null || !price) return null
  return Math.round(newPrice * (priceExGst / price) * 100) / 100
}

export function priceProblems(next: number, current: number, exRatio: number, cost: number | null, allowBelowCost: boolean): string[] {
  const out: string[] = []
  if (current > 0 && Math.abs(next - current) / current > 0.5) out.push('That is more than a 50% change from the current price; change it on the product page instead.')
  if (cost != null && !allowBelowCost && next * exRatio < cost) out.push(`That price is below your cost (${cost.toFixed(2)} ex GST).`)
  return out
}

function promotionBody(a: Extract<MerchantAction, { action: 'promotion.create' }>) {
  return {
    promotionId: a.promotionId,
    contentLanguage: 'en',
    targetCountry: 'IN',
    redemptionChannel: ['ONLINE'],
    attributes: {
      productApplicability: 'ALL_PRODUCTS',
      offerType: a.code ? 'GENERIC_CODE' : 'NO_CODE',
      ...(a.code ? { genericRedemptionCode: a.code } : {}),
      longTitle: a.title,
      couponValueType: a.kind,
      ...(a.kind === 'PERCENT_OFF' ? { percentOff: String(Math.round(a.value)) } : { moneyOffAmount: toMicros(a.value) }),
      ...(a.minimumPurchase ? { minimumPurchaseAmount: toMicros(a.minimumPurchase) } : {}),
      promotionEffectiveTimePeriod: { startTime: a.start, endTime: a.end },
      promotionDestinations: ['FREE_LISTINGS', 'SHOPPING_ADS'],
    },
  }
}

/** Our simplified service list applied onto Google's settings: matching services (by name) keep
 * everything else Google has (rate tables, labels); new names become flat-rate India services. */
export function applyServices(current: any, services: Extract<MerchantAction, { action: 'shipping.save' }>['services']) {
  const existing = new Map<string, any>((current?.services ?? []).map((s: any) => [s.serviceName, s]))
  const next = services.map(s => {
    const base = existing.get(s.name) ?? { serviceName: s.name, deliveryCountries: ['IN'], currencyCode: 'INR' }
    return {
      ...base,
      active: s.active,
      deliveryTime: {
        ...(base.deliveryTime ?? {}),
        minHandlingDays: s.minHandlingDays,
        maxHandlingDays: s.maxHandlingDays,
        minTransitDays: s.minTransitDays,
        maxTransitDays: s.maxTransitDays,
      },
      rateGroups: existing.has(s.name) && (base.rateGroups ?? []).some((g: any) => !g?.singleValue?.flatRate)
        ? base.rateGroups
        : [{ singleValue: { flatRate: toMicros(s.flatRate) } }],
    }
  })
  return { ...(current ?? {}), services: next }
}

export function summariseServices(settings: any) {
  return (settings?.services ?? []).map((s: any) => ({
    name: s.serviceName,
    active: s.active !== false,
    flatRate: s.rateGroups?.[0]?.singleValue?.flatRate?.amountMicros != null ? Number(s.rateGroups[0].singleValue.flatRate.amountMicros) / 1e6 : null,
    handling: [s.deliveryTime?.minHandlingDays ?? null, s.deliveryTime?.maxHandlingDays ?? null],
    transit: [s.deliveryTime?.minTransitDays ?? null, s.deliveryTime?.maxTransitDays ?? null],
  }))
}

export async function runMerchantAction(a: MerchantAction, actor: ChangeActor, preview: boolean): Promise<ChangeOutcome<unknown>> {
  const notConnected = async () => ((await merchantConfigured()) ? [] : ['Connect Google Merchant Center first.'])
  switch (a.action) {
    case 'product.repush': {
      const p = await queryOne<{ name: string }>(`SELECT name FROM products WHERE id = $1`, [a.productId])
      return runChange(
        {
          channel: 'gmc',
          action: a.action,
          entityType: 'product',
          entityId: a.productId,
          summary: `Re-sent "${p?.name ?? a.productId}" to Google`,
          validate: async () => [...(p ? [] : ['Product not found']), ...pushBlocked(), ...(await notConnected())],
          apply: () => syncProductToMerchant(a.productId),
        },
        actor,
        preview
      )
    }
    case 'product.identifiers': {
      const table = a.variantId ? 'product_variants' : 'products'
      const id = a.variantId ?? a.productId
      const cur = await queryOne<{ gtin: string | null; mpn: string | null }>(`SELECT gtin, mpn FROM ${table} WHERE id = $1`, [id])
      const after = { gtin: a.gtin === undefined ? cur?.gtin ?? null : a.gtin || null, mpn: a.mpn === undefined ? cur?.mpn ?? null : a.mpn || null }
      return runChange(
        {
          channel: 'gmc',
          action: a.action,
          entityType: a.variantId ? 'variant' : 'product',
          entityId: id,
          summary: `Set ${[a.gtin !== undefined && 'GTIN', a.mpn !== undefined && 'MPN'].filter(Boolean).join(' and ')} and re-sent to Google`,
          before: cur,
          after,
          validate: () => [
            ...(cur ? [] : ['Product not found']),
            ...(after.gtin && !isValidGtin(after.gtin) ? ['That GTIN is not valid (8, 12, 13 or 14 digits with a correct check digit).'] : []),
          ],
          apply: async () => {
            await query(`UPDATE ${table} SET gtin = $2, mpn = $3, updated_at = now() WHERE id = $1`, [id, after.gtin, after.mpn])
            if (!GMC_PUSH_DISABLED) await syncProductToMerchant(a.productId)
          },
        },
        actor,
        preview
      )
    }
    case 'product.price': {
      const o = await offerProduct(a.offerId)
      const price = Number(o?.price ?? 0)
      const ex = o?.price_ex_gst == null ? null : Number(o.price_ex_gst)
      const exRatio = ex && price ? ex / price : 1
      const cost = o?.cost == null ? null : Number(o.cost)
      const newEx = exGstFor(a.price, price, ex)
      return runChange(
        {
          channel: 'gmc',
          action: a.action,
          entityType: o?.variant_id ? 'variant' : 'product',
          entityId: o?.variant_id ?? o?.product_id ?? a.offerId,
          summary: `Changed the price of "${o?.name ?? a.offerId}" from ${price.toFixed(2)} to ${a.price.toFixed(2)}`,
          before: { price, priceExGst: ex, marginPerUnit: cost == null ? null : Math.round((price * exRatio - cost) * 100) / 100 },
          after: { price: a.price, priceExGst: newEx, marginPerUnit: cost == null ? null : Math.round((a.price * exRatio - cost) * 100) / 100 },
          validate: () => (o ? priceProblems(a.price, price, exRatio, cost, !!a.allowBelowCost) : ['No product in your catalogue matches this offer.']),
          apply: async () => {
            if (o!.variant_id) {
              await query(`UPDATE product_variants SET price = $2, price_ex_gst = COALESCE($3, price_ex_gst), updated_at = now() WHERE id = $1`, [o!.variant_id, a.price, newEx])
            } else {
              await query(`UPDATE products SET base_price = $2, price_ex_gst = COALESCE($3, price_ex_gst), updated_at = now() WHERE id = $1`, [o!.product_id, a.price, newEx])
            }
            if (!GMC_PUSH_DISABLED) await syncProductToMerchant(o!.product_id)
          },
        },
        actor,
        preview
      )
    }
    case 'promotion.create': {
      const body = promotionBody(a)
      return runChange(
        {
          channel: 'gmc',
          action: a.action,
          entityType: 'promotion',
          entityId: a.promotionId,
          summary: `Created promotion "${a.title}"`,
          after: body,
          validate: async () => [
            ...(new Date(a.end) <= new Date(a.start) ? ['The end must be after the start.'] : []),
            ...(a.kind === 'PERCENT_OFF' && a.value > 100 ? ['A percentage off cannot be more than 100.'] : []),
            ...(await notConnected()),
          ],
          apply: async () => {
            const r = await insertPromotion(body)
            await refreshAccountState().catch(() => {})
            return r
          },
        },
        actor,
        preview
      )
    }
    case 'promotion.end': {
      const current = (await listPromotions().catch(() => [])).find((p: any) => p?.promotionId === a.promotionId)
      const now = new Date().toISOString()
      const next = current
        ? {
            ...current,
            attributes: { ...current.attributes, promotionEffectiveTimePeriod: { ...current.attributes?.promotionEffectiveTimePeriod, endTime: now } },
          }
        : null
      return runChange(
        {
          channel: 'gmc',
          action: a.action,
          entityType: 'promotion',
          entityId: a.promotionId,
          summary: `Ended promotion ${a.promotionId}`,
          before: current?.attributes?.promotionEffectiveTimePeriod ?? null,
          after: next?.attributes?.promotionEffectiveTimePeriod ?? null,
          validate: () => (current ? [] : ['Promotion not found']),
          apply: async () => {
            const { name: _name, dataSource: _ds, promotionStatus: _st, versionNumber: _v, ...body } = next as any
            const r = await insertPromotion(body)
            await refreshAccountState().catch(() => {})
            return r
          },
        },
        actor,
        preview
      )
    }
    case 'shipping.save': {
      const current = await getShippingSettings().catch(() => null)
      const next = applyServices(current, a.services)
      return runChange(
        {
          channel: 'gmc',
          action: a.action,
          entityType: 'shipping_settings',
          summary: `Saved shipping settings (${a.services.length} service${a.services.length === 1 ? '' : 's'})`,
          before: summariseServices(current),
          after: summariseServices(next),
          validate: async () => [
            ...a.services.flatMap(s => [
              ...(s.minHandlingDays > s.maxHandlingDays ? [`${s.name}: handling days are reversed.`] : []),
              ...(s.minTransitDays > s.maxTransitDays ? [`${s.name}: transit days are reversed.`] : []),
            ]),
            ...(new Set(a.services.map(s => s.name)).size !== a.services.length ? ['Service names must be unique.'] : []),
            ...(await notConnected()),
          ],
          apply: async () => {
            const { name: _n, ...body } = next as any
            const r = await insertShippingSettings(body)
            await refreshAccountState().catch(() => {})
            return r
          },
        },
        actor,
        preview
      )
    }
    case 'returns.create': {
      const policy = {
        label: a.label,
        countries: ['IN'],
        policy: { type: 'NUMBER_OF_DAYS_AFTER_DELIVERY', days: String(a.days) },
        returnMethods: ['BY_MAIL'],
        itemConditions: ['NEW'],
        returnPolicyUri: a.uri,
        returnShippingFee: a.freeReturns ? { type: 'FREE' } : { type: 'FIXED', fixedFee: toMicros(a.fee ?? 0) },
        ...(a.refundDays ? { processRefundDays: a.refundDays } : {}),
      }
      return runChange(
        {
          channel: 'gmc',
          action: a.action,
          entityType: 'return_policy',
          summary: `Added return policy "${a.label}" (${a.days} days)`,
          after: policy,
          validate: notConnected,
          apply: async () => {
            const r = await createReturnPolicy(policy)
            await refreshAccountState().catch(() => {})
            return r
          },
        },
        actor,
        preview
      )
    }
    case 'returns.delete':
      return runChange(
        {
          channel: 'gmc',
          action: a.action,
          entityType: 'return_policy',
          entityId: a.name,
          summary: `Deleted return policy ${a.name.split('/').pop()}`,
          validate: notConnected,
          apply: async () => {
            await deleteReturnPolicy(a.name)
            await refreshAccountState().catch(() => {})
          },
        },
        actor,
        preview
      )
  }
}

/** Account-wide settings (shipping, returns, promotions) need the extra settings scope. */
export const isSettingsAction = (a: MerchantAction) => /^(promotion|shipping|returns)\./.test(a.action)
