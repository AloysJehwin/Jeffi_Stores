import { inr } from './format'

/** One spoken label for a product tile: "Drill, ₹1,499.00, MRP ₹1,999.00, 25% off, In stock". */
export function productLabel(p: {
  name: string
  price?: number | string | null
  from?: boolean
  mrp?: number | string | null
  discountPct?: number
  stock?: string | null
  extra?: (string | null | false | undefined)[]
}): string {
  const price = p.price != null ? Number(p.price) : null
  const mrp = p.mrp != null ? Number(p.mrp) : null
  return [
    p.name,
    price != null ? `${p.from ? 'From ' : ''}₹${inr(price)}` : null,
    mrp != null && price != null && mrp > price ? `MRP ₹${inr(mrp)}` : null,
    p.discountPct ? `${p.discountPct}% off` : null,
    p.stock,
    ...(p.extra ?? []),
  ]
    .filter(Boolean)
    .join(', ')
}
