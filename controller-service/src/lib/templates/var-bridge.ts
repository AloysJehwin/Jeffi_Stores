// Campaign scenarios speak {camelCase}; the templates library speaks {{snake_case}}. One alias table so a
// template written in either style renders in either engine. Only fills a name that is missing — never
// overrides a value the caller set under that exact name.

const ALIASES: Array<[camel: string, snake: string[]]> = [
  ['orderNumber', ['order_number']],
  ['couponCode', ['coupon_code']],
  ['discountPercent', ['discount_percent']],
  ['productName', ['product_name']],
  ['productImageUrl', ['product_image_url']],
  ['oldPrice', ['old_price']],
  ['newPrice', ['new_price']],
  ['itemsHtml', ['items_html']],
  ['productCard', ['product_card']],
  ['itemCount', ['item_count']],
  ['total', ['cart_total']],
  ['ctaUrl', ['cta_url', 'short_url', 'cart_url', 'product_url', 'collection_url', 'review_url', 'redeem_url', 'reorder_url']],
  ['firstName', ['first_name', 'customer_first_name']],
]

const present = (v: unknown) => v !== undefined && v !== null && v !== ''

export function bridgeVars<T extends string | number>(vars: Record<string, T>): Record<string, T> {
  const out: Record<string, T> = { ...vars }
  for (const [camel, snakes] of ALIASES) {
    if (present(out[camel])) {
      for (const s of snakes) if (!present(out[s])) out[s] = out[camel]
    } else {
      const from = snakes.find(s => present(out[s]))
      if (from) out[camel] = out[from]
    }
  }
  return out
}

/** Library variable names a campaign scenario can supply (for "can't fill" warnings in pickers). */
export const CAMPAIGN_SUPPLIED = new Set(ALIASES.flatMap(([c, s]) => [c, ...s]))

// Registered (recipient/store) variables every send resolves.
const REGISTERED = new Set(['customer_first_name', 'customer_last_name', 'customer_name', 'customer_email', 'store_name',
  'store_email', 'store_phone', 'store_web', 'current_year', 'date'])

/** Can a campaign send fill this variable? camelCase names are scenario variables (each scenario supplies its own). */
export function campaignCanFill(name: string): boolean {
  return REGISTERED.has(name) || CAMPAIGN_SUPPLIED.has(name) || !name.includes('_')
}
