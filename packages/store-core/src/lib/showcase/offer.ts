import { SHOWCASE_PRICE_INR, SHOWCASE_TRIAL_DAYS } from './types'

// What hosting a Showcase costs, worded once for the console (client-safe).
export const SHOWCASE_OFFER = { freeDays: SHOWCASE_TRIAL_DAYS, priceInr: SHOWCASE_PRICE_INR, payer: 'on your subscription' } as const

const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`

/** "₹200/month" */
export const showcaseMonthly = (priceInr: number = SHOWCASE_OFFER.priceInr) => `${inr(priceInr)}/month`

/** "7 days free, then ₹200/month on your subscription" */
export const showcaseOfferText = () => `${SHOWCASE_OFFER.freeDays} days free, then ${showcaseMonthly()} ${SHOWCASE_OFFER.payer}`

/** "₹200/month on your subscription" */
export const showcasePriceText = (priceInr: number = SHOWCASE_OFFER.priceInr) => `${showcaseMonthly(priceInr)} ${SHOWCASE_OFFER.payer}`
