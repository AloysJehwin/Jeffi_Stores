// Mirrors packages/store-core/src/lib/catalog/return-policy-rules.ts (the app cannot import store-core).
// Product window first; otherwise the stricter of brand and category (category already falls back to its parent).

interface PolicyFields {
  return_allowed?: boolean | null
  return_window_days?: number | string | null
  replacement_allowed?: boolean | null
  replacement_window_days?: number | string | null
}

const known = <T,>(...values: Array<T | null | undefined>): T[] => values.filter((v): v is T => v != null)

export function resolveReturnPolicy(input: {
  productReturnWindowDays?: number | string | null
  brand?: PolicyFields | null
  category?: PolicyFields | null
}) {
  const { brand, category } = input
  const returnFlags = known(brand?.return_allowed, category?.return_allowed)
  const replaceFlags = known(brand?.replacement_allowed, category?.replacement_allowed)
  const returnWindows = known(brand?.return_window_days, category?.return_window_days).map(Number)
  const replaceWindows = known(brand?.replacement_window_days, category?.replacement_window_days).map(Number)

  let returnAllowed = returnFlags.length ? returnFlags.every(Boolean) : true
  let returnDays = returnWindows.length ? Math.min(...returnWindows) : 7
  const replacementAllowed = replaceFlags.length ? replaceFlags.every(Boolean) : true
  const replacementDays = replaceWindows.length ? Math.min(...replaceWindows) : 7

  const own = input.productReturnWindowDays
  if (own != null && own !== '' && Number.isFinite(Number(own))) {
    returnDays = Math.max(0, Number(own))
    returnAllowed = returnDays > 0
  }

  return {
    returnAllowed,
    returnDays: returnAllowed ? returnDays : 0,
    replacementAllowed,
    replacementDays: replacementAllowed ? replacementDays : 0,
  }
}
