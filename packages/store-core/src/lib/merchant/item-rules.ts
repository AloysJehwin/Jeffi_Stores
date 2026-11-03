// Product-data rules shared by the Merchant API mapper and the public XML feed.

export const MAX_TITLE = 150

// Google: identifiers exist only with a GTIN, or an MPN together with a brand. A brand alone is not one.
export function hasIdentifiers(gtin: unknown, mpn: unknown, brand: string): boolean {
  return !!(gtin || (mpn && brand))
}

// The MRP is the listed price only when it is a real markdown; otherwise the selling price
// (an MRP below the selling price, e.g. ex-GST, must never become the advertised price).
export function listedPrices(selling: number, mrp: number | null): { price: number; salePrice: number | null } {
  const price = mrp != null && mrp > selling ? mrp : selling
  return { price, salePrice: price > selling ? selling : null }
}

export function clipTitle(title: string): string {
  return title.length > MAX_TITLE ? title.slice(0, MAX_TITLE - 1).trimEnd() + '…' : title
}
