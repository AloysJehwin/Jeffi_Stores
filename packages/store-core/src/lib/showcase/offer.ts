import { SHOWCASE_FREE_DAYS, SHOWCASE_PRICE_INR } from './types'

// What hosting a Showcase costs, worded once for the console (client-safe). Billing phase B changes only this file:
// the days become the trial's and the payer the subscription.
export const SHOWCASE_OFFER = { freeDays: SHOWCASE_FREE_DAYS, priceInr: SHOWCASE_PRICE_INR, payer: 'from your wallet' } as const

const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`

/** "30 days free, then ₹200 a month from your wallet" */
export const showcaseOfferText = () => `${SHOWCASE_OFFER.freeDays} days free, then ${inr(SHOWCASE_OFFER.priceInr)} a month ${SHOWCASE_OFFER.payer}`

/** "₹200 a month, from your wallet" */
export const showcasePriceText = (priceInr: number = SHOWCASE_OFFER.priceInr) => `${inr(priceInr)} a month, ${SHOWCASE_OFFER.payer}`
