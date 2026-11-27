// The store templates a shopper agent may send. No imports: the tool schemas read it without loading the store layer.
export const SHOPPER_TEMPLATES = ['order/confirmed', 'order/shipped', 'order/out-for-delivery', 'order/delivered', 'order/payment-failed', 'cart/abandoned'] as const
export type ShopperTemplate = (typeof SHOPPER_TEMPLATES)[number]
export const isShopperTemplate = (s: string): s is ShopperTemplate => (SHOPPER_TEMPLATES as readonly string[]).includes(s)
