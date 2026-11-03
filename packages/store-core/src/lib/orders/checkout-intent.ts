import { SignJWT, jwtVerify } from 'jose'

const SECRET = new TextEncoder().encode(
  process.env.CHECKOUT_INTENT_SECRET ||
    process.env.JWT_SECRET ||
    (() => {
      throw new Error('CHECKOUT_INTENT_SECRET / JWT_SECRET not set')
    })()
)
const TTL_SECONDS = 60 * 60

export interface BuyNowIntentPayload {
  mode: 'buyNow'
  productId: string
  variantId: string | null
  subVariantId: string | null
  qty: number
  buyMode: string
  buyUnit: string | null
}

export interface CartIntentPayload {
  mode: 'cart'
  userId: string
}

export type CheckoutIntentPayload = BuyNowIntentPayload | CartIntentPayload

export async function signIntent(payload: CheckoutIntentPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${TTL_SECONDS}s`)
    .sign(SECRET)
}

export async function verifyIntent(token: string): Promise<CheckoutIntentPayload | null> {
  try {
    const { payload } = await jwtVerify(token, SECRET)
    if (payload.mode === 'cart') {
      if (typeof payload.userId !== 'string') return null
      return { mode: 'cart', userId: payload.userId as string }
    }
    if (typeof payload.productId !== 'string') return null
    return {
      mode: 'buyNow',
      productId: payload.productId as string,
      variantId: (payload.variantId as string) || null,
      subVariantId: (payload.subVariantId as string) || null,
      qty: Number(payload.qty),
      buyMode: (payload.buyMode as string) || 'unit',
      buyUnit: (payload.buyUnit as string) || null,
    }
  } catch (err) {
    console.error('[route]', err)
    return null
  }
}
