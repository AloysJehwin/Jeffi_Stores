import { resolveAmazonCreds } from '@/lib/integrations/resolve'
import { spApiRequest } from './client'

// SP-API Product Pricing v0 (offers batch) and Product Fees v0 (fee estimates batch), plus a price
// change through Listings Items PATCH with Amazon's validation preview.

export interface OfferSnapshot {
  asin: string
  ourPrice: number | null
  buyboxPrice: number | null
  buyboxIsOurs: boolean | null
  buyboxFba: boolean | null
  lowestPrice: number | null
  lowestFbaPrice: number | null
  offerCount: number
  buyboxEligible: boolean | null
}

const amt = (m: any): number | null => (m?.Amount == null ? null : Number(m.Amount))
const landed = (o: any): number | null => {
  const p = amt(o?.ListingPrice)
  return p == null ? null : p + (amt(o?.Shipping) ?? 0)
}

/** One getItemOffers payload to our snapshot. `sellerId` marks which offer is ours. */
export function mapItemOffers(payload: any, sellerId: string): OfferSnapshot | null {
  if (!payload?.ASIN) return null
  const offers: any[] = payload.Offers ?? []
  const mine = offers.find(o => o?.MyOffer === true || o?.SellerId === sellerId)
  const winner = offers.find(o => o?.IsBuyBoxWinner)
  const bb = payload.Summary?.BuyBoxPrices?.find((b: any) => (b?.condition ?? b?.Condition ?? 'New').toLowerCase() === 'new') ?? payload.Summary?.BuyBoxPrices?.[0]
  const lowest = (payload.Summary?.LowestPrices ?? []).filter((l: any) => (l?.condition ?? 'new').toLowerCase() === 'new')
  const low = (channel: string | null) => {
    const vals = lowest.filter((l: any) => !channel || l?.fulfillmentChannel === channel).map((l: any) => amt(l?.LandedPrice) ?? amt(l?.ListingPrice))
    const nums = vals.filter((v: any): v is number => v != null)
    return nums.length ? Math.min(...nums) : null
  }
  return {
    asin: String(payload.ASIN),
    ourPrice: mine ? landed(mine) : null,
    buyboxPrice: bb ? (amt(bb.LandedPrice) ?? amt(bb.ListingPrice)) : winner ? landed(winner) : null,
    buyboxIsOurs: winner ? !!(winner.MyOffer || winner.SellerId === sellerId) : mine ? false : null,
    buyboxFba: winner ? !!winner.IsFulfilledByAmazon : null,
    lowestPrice: low(null),
    lowestFbaPrice: low('Amazon'),
    offerCount: Number(payload.Summary?.TotalOfferCount ?? offers.length ?? 0),
    buyboxEligible: mine ? (mine.IsFeaturedMerchant ?? null) : null,
  }
}

/** Up to 20 ASINs per call (Amazon's batch limit). */
export async function getItemOffersBatch(asins: string[]): Promise<OfferSnapshot[]> {
  const creds = await resolveAmazonCreds()
  const res = await spApiRequest('POST', '/batches/products/pricing/v0/itemOffers', {
    body: {
      requests: asins.slice(0, 20).map(asin => ({
        uri: `/products/pricing/v0/items/${encodeURIComponent(asin)}/offers`,
        method: 'GET',
        MarketplaceId: creds.marketplaceId,
        ItemCondition: 'New',
        CustomerType: 'Consumer',
      })),
    },
  })
  return (res?.responses ?? [])
    .map((r: any) => (r?.status?.statusCode && r.status.statusCode >= 400 ? null : mapItemOffers(r?.body?.payload, creds.sellerId)))
    .filter(Boolean) as OfferSnapshot[]
}

export interface FeeEstimate {
  sku: string
  price: number
  referral: number
  closing: number
  fulfillment: number
  other: number
  total: number
  gstOnFees: number
  details: { type: string; amount: number }[]
}

export const GST_ON_FEES = 0.18

/** Fee lines grouped the way sellers read them; GST on fees is Amazon's own tax line when it
 * sends one, else 18% of the fees. */
export function mapFeeResult(r: any, price: number): FeeEstimate | null {
  const res = r?.FeesEstimateResult
  if (!res || res.Status !== 'Success') return null
  const sku = String(res.FeesEstimateIdentifier?.IdValue ?? '')
  const details: { type: string; amount: number }[] = (res.FeesEstimate?.FeeDetailList ?? []).map((d: any) => ({
    type: String(d?.FeeType ?? 'Fee'),
    amount: amt(d?.FinalFee) ?? amt(d?.FeeAmount) ?? 0,
  }))
  const sum = (re: RegExp) => details.filter(d => re.test(d.type)).reduce((s, d) => s + d.amount, 0)
  const tax = sum(/tax|gst/i)
  const referral = sum(/referral/i)
  const closing = sum(/closing/i)
  const fulfillment = sum(/fba|fulfil|pick|weight|shipping|easyship/i)
  const fees = details.filter(d => !/tax|gst/i.test(d.type)).reduce((s, d) => s + d.amount, 0)
  const r2 = (v: number) => Math.round(v * 100) / 100
  return {
    sku,
    price,
    referral: r2(referral),
    closing: r2(closing),
    fulfillment: r2(fulfillment),
    other: r2(fees - referral - closing - fulfillment),
    total: r2(fees),
    gstOnFees: r2(tax > 0 ? tax : fees * GST_ON_FEES),
    details,
  }
}

/** Fee estimates for up to 20 SKUs at the given prices. */
export async function getFeeEstimates(items: { sku: string; price: number; fba: boolean }[]): Promise<FeeEstimate[]> {
  const creds = await resolveAmazonCreds()
  const batch = items.slice(0, 20)
  const res = await spApiRequest('POST', '/products/fees/v0/feesEstimate', {
    body: batch.map(i => ({
      IdType: 'SellerSKU',
      IdValue: i.sku,
      FeesEstimateRequest: {
        MarketplaceId: creds.marketplaceId,
        IsAmazonFulfilled: i.fba,
        Identifier: i.sku,
        PriceToEstimateFees: { ListingPrice: { CurrencyCode: 'INR', Amount: i.price } },
      },
    })),
  })
  const bySku = new Map(batch.map(i => [i.sku, i.price]))
  return (Array.isArray(res) ? res : [])
    .map((r: any) => mapFeeResult(r, bySku.get(String(r?.FeesEstimateResult?.FeesEstimateIdentifier?.IdValue ?? '')) ?? 0))
    .filter(Boolean) as FeeEstimate[]
}

/** Price change for one SKU; `preview` asks Amazon to validate without changing anything. */
export async function patchPrice(sku: string, productType: string, price: number, preview: boolean): Promise<any> {
  const creds = await resolveAmazonCreds()
  return spApiRequest('PATCH', `/listings/2021-08-01/items/${encodeURIComponent(creds.sellerId)}/${encodeURIComponent(sku)}`, {
    query: { marketplaceIds: creds.marketplaceId, ...(preview ? { mode: 'VALIDATION_PREVIEW' } : {}) },
    body: {
      productType,
      patches: [
        {
          op: 'replace',
          path: '/attributes/purchasable_offer',
          value: [{ marketplace_id: creds.marketplaceId, currency: 'INR', our_price: [{ schedule: [{ value_with_tax: price }] }] }],
        },
      ],
    },
  })
}

/** Amazon's own problems with a submission (status INVALID or ERROR issues). */
export function submissionProblems(res: any): string[] {
  const issues: any[] = res?.issues ?? []
  const errors = issues.filter(i => String(i?.severity).toUpperCase() === 'ERROR').map(i => String(i?.message ?? i?.code ?? 'Amazon rejected the change'))
  if (errors.length) return errors
  return res?.status === 'INVALID' ? ['Amazon rejected the change'] : []
}
