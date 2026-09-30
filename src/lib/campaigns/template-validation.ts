const PRODUCT_TOKEN_RE = /\{(productName|productImageUrl|oldPrice|newPrice|itemCount)\}/i
const SINGLE_PRODUCT_HINT_RE = /\{(productName|productImageUrl|oldPrice|newPrice)\}/i
const HAS_PRODUCT_CARD_RE = /\{productCard\}/
const HAS_ITEMS_HTML_RE = /\{itemsHtml\}/
const HAS_CART_ITEMS_RE = /\{cartItems\}/
const PRODUCT_COPY_HINT_RE =
  /\b(your items?|the items?|your cart|your favou?rites?|your wishlist|back in stock|price drop|featured products?|recommendations?|recommended products?|these products?)\b/i

const SINGLE_PRODUCT_KINDS = new Set(['restock', 'price_drop'])
const MULTI_PRODUCT_KINDS = new Set([
  'abandoned_cart',
  'abandoned_checkout',
  'post_purchase',
  'review_reminder',
  'winback_90',
  'winback_180',
])

export interface TemplateValidationOk {
  ok: true
}
export interface TemplateValidationErr {
  ok: false
  reason: string
  hint?: string
}
export type TemplateValidation = TemplateValidationOk | TemplateValidationErr

export function validateCampaignBodyTemplate(
  body: string,
  opts?: { kind?: string; scenarioKind?: string | null }
): TemplateValidation {
  if (typeof body !== 'string' || !body.trim()) {
    return { ok: false, reason: 'body_template is required' }
  }
  if (body.length > 50_000) {
    return { ok: false, reason: 'body_template exceeds 50,000 chars' }
  }

  const hasCard = HAS_PRODUCT_CARD_RE.test(body)
  const hasItems = HAS_ITEMS_HTML_RE.test(body) || HAS_CART_ITEMS_RE.test(body)
  const mentionsSingleProduct = SINGLE_PRODUCT_HINT_RE.test(body)
  const mentionsAnyProductToken = PRODUCT_TOKEN_RE.test(body)
  const mentionsProductCopy = PRODUCT_COPY_HINT_RE.test(body)
  const refKind = (opts?.scenarioKind || opts?.kind || '').toLowerCase()

  if (SINGLE_PRODUCT_KINDS.has(refKind)) {
    if (!hasCard) {
      return {
        ok: false,
        reason: `Single-product scenario "${refKind}" requires {productCard} in the body so the product image renders.`,
        hint: 'Insert the literal token {productCard} where you want the image + name + price card to appear. Do not build an <img> manually.',
      }
    }
    return { ok: true }
  }

  if (MULTI_PRODUCT_KINDS.has(refKind)) {
    if (!hasItems) {
      return {
        ok: false,
        reason: `Scenario "${refKind}" requires {itemsHtml} in the body so the product gallery (with thumbnails) renders.`,
        hint: 'Insert the literal token {itemsHtml} where you want the image-bearing items table to appear.',
      }
    }
    return { ok: true }
  }

  if (mentionsSingleProduct && !hasCard) {
    return {
      ok: false,
      reason:
        'Body uses single-product tokens ({productName} / {productImageUrl} / {oldPrice} / {newPrice}) but is missing {productCard}.',
      hint: 'Replace the manual product block with the {productCard} token so an image always renders. The card already shows name and price.',
    }
  }

  if (mentionsAnyProductToken && !hasCard && !hasItems) {
    return {
      ok: false,
      reason:
        'Body references product details but does not include {productCard} or {itemsHtml}, so no product image will render.',
      hint: 'Add {productCard} for a single product or {itemsHtml} for a list of items. Image-less product emails are not allowed.',
    }
  }

  if (mentionsProductCopy && !hasCard && !hasItems) {
    return {
      ok: false,
      reason:
        'Body talks about products ("your items", "back in stock", "favorites", etc.) but contains no image-bearing product token.',
      hint: 'Insert {productCard} (single product) or {itemsHtml} (multi-item gallery). If the email is genuinely product-free, remove the product copy.',
    }
  }

  return { ok: true }
}
