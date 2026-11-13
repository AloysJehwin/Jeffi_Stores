// The one return / replacement rule, shared by the product page and order-time checks. No DB import,
// so client components can use it.

export interface ReturnPolicy {
  return_allowed: boolean
  return_window_days: number
  replacement_allowed: boolean
  replacement_window_days: number
}

export type ReturnPolicySource = 'product' | 'brand' | 'category' | 'parent_category' | 'default' | 'restrictive'

export interface PolicyFields {
  return_allowed?: boolean | null
  return_window_days?: number | null
  replacement_allowed?: boolean | null
  replacement_window_days?: number | null
}

export const DEFAULT_RETURN_POLICY: ReturnPolicy = {
  return_allowed: true,
  return_window_days: 7,
  replacement_allowed: true,
  replacement_window_days: 7,
}

const first = <T>(...values: Array<T | null | undefined>): T | null => values.find(v => v != null) ?? null
const known = <T>(...values: Array<T | null | undefined>): T[] => values.filter((v): v is T => v != null)

/**
 * The product's own return window wins. Otherwise the stricter of brand and category, where the
 * category takes each field from its parent when it leaves it blank (a child override beats the parent).
 */
export function resolveReturnPolicy(input: {
  productReturnWindowDays?: number | null
  brand?: PolicyFields | null
  category?: PolicyFields | null
  parent?: PolicyFields | null
}): ReturnPolicy & { source: ReturnPolicySource } {
  const { brand, category, parent } = input
  const cat: PolicyFields = {
    return_allowed: first(category?.return_allowed, parent?.return_allowed),
    return_window_days: first(category?.return_window_days, parent?.return_window_days),
    replacement_allowed: first(category?.replacement_allowed, parent?.replacement_allowed),
    replacement_window_days: first(category?.replacement_window_days, parent?.replacement_window_days),
  }

  const returnFlags = known(brand?.return_allowed, cat.return_allowed)
  const replaceFlags = known(brand?.replacement_allowed, cat.replacement_allowed)
  const returnWindows = known(brand?.return_window_days, cat.return_window_days).map(Number)
  const replaceWindows = known(brand?.replacement_window_days, cat.replacement_window_days).map(Number)

  let return_allowed = returnFlags.length ? returnFlags.every(Boolean) : DEFAULT_RETURN_POLICY.return_allowed
  let return_window_days = returnWindows.length ? Math.min(...returnWindows) : DEFAULT_RETURN_POLICY.return_window_days
  const replacement_allowed = replaceFlags.length ? replaceFlags.every(Boolean) : DEFAULT_RETURN_POLICY.replacement_allowed
  const replacement_window_days = replaceWindows.length
    ? Math.min(...replaceWindows)
    : DEFAULT_RETURN_POLICY.replacement_window_days

  const brandSet = brand?.return_allowed != null || brand?.replacement_allowed != null
  const ownCatSet = category?.return_allowed != null || category?.replacement_allowed != null
  const catSet = cat.return_allowed != null || cat.replacement_allowed != null
  let source: ReturnPolicySource = 'default'
  if (brandSet && catSet) source = 'restrictive'
  else if (brandSet) source = 'brand'
  else if (ownCatSet) source = 'category'
  else if (catSet) source = 'parent_category'

  const own = input.productReturnWindowDays
  if (own != null && Number.isFinite(Number(own))) {
    return_window_days = Math.max(0, Number(own))
    return_allowed = return_window_days > 0
    source = 'product'
  }

  return { return_allowed, return_window_days, replacement_allowed, replacement_window_days, source }
}
