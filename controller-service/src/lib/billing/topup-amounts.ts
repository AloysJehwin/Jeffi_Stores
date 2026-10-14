export const TOPUP_GST_RATE = 0.18
const r2 = (n: number) => Math.round(n * 100) / 100

/** Wallet top-ups: 18% GST on top of the credit (pay ₹1180 → ₹1000 balance). */
export function topupAmounts(creditInr: number) {
  const gst = r2(creditInr * TOPUP_GST_RATE)
  return { credit: r2(creditInr), gst, total: r2(creditInr + gst) }
}
