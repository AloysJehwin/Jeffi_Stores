import { SignJWT, jwtVerify } from 'jose'

const SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET ?? (() => { throw new Error('JWT_SECRET not set') })()
)

const DRAFT_TTL_SECONDS = 600

export interface DraftCartItem {
  productId: string
  variantId: string | null
  subVariantId: string | null
  quantity: number
  buyMode: string
  buyUnit: string | null
  priceAtAddition: number
}

export interface DraftBuyNowItem {
  productId: string
  variantId: string | null
  qty: number
  buyMode: string
  buyUnit: string | null
  price: number
}

export interface DraftPayload {
  userId: string
  mode: 'cart' | 'buyNow'
  addressId: string
  couponId: string | null
  shippingAmount: number
  cartHash: string | null
  cartItemIds: string[] | null
  buyNowItem: DraftBuyNowItem | null
  notes: string | null
  paymentMethod: 'razorpay'
}

export async function signDraftToken(payload: DraftPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${DRAFT_TTL_SECONDS}s`)
    .sign(SECRET)
}

export async function verifyDraftToken(token: string): Promise<DraftPayload | null> {
  try {
    const { payload } = await jwtVerify(token, SECRET)
    if (
      typeof payload.userId !== 'string' ||
      (payload.mode !== 'cart' && payload.mode !== 'buyNow') ||
      typeof payload.addressId !== 'string'
    ) {
      return null
    }
    return {
      userId: payload.userId,
      mode: payload.mode,
      addressId: payload.addressId,
      couponId: (payload.couponId as string) || null,
      shippingAmount: typeof payload.shippingAmount === 'number' ? payload.shippingAmount : 0,
      cartHash: (payload.cartHash as string) || null,
      cartItemIds: (payload.cartItemIds as string[]) || null,
      buyNowItem: (payload.buyNowItem as DraftBuyNowItem) || null,
      notes: (payload.notes as string) || null,
      paymentMethod: 'razorpay',
    }
  } catch {
    return null
  }
}

export function hashCartItems(items: DraftCartItem[]): string {
  const sorted = [...items].sort((a, b) => {
    const ka = `${a.productId}|${a.variantId || ''}|${a.subVariantId || ''}|${a.buyMode}`
    const kb = `${b.productId}|${b.variantId || ''}|${b.subVariantId || ''}|${b.buyMode}`
    return ka.localeCompare(kb)
  })
  const fp = sorted.map(i =>
    `${i.productId}:${i.variantId || ''}:${i.subVariantId || ''}:${i.buyMode}:${i.quantity}:${i.priceAtAddition}`
  ).join('|')
  let h = 5381
  for (let i = 0; i < fp.length; i++) {
    h = ((h << 5) + h) ^ fp.charCodeAt(i)
  }
  return (h >>> 0).toString(36)
}
