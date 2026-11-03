/**
 * One way to name a product line across the three grains.
 *
 * Product, variant and sub-variant are peers in the data model, but the display
 * convention grew up ad hoc as `variant_name ? ' / ' + variant_name : ''`, which
 * silently drops the sub-variant. Every surface that names a line — screens,
 * PDFs, labels, emails — should build the string here so the grains cannot
 * diverge again.
 */

export interface GrainNames {
  product_name?: string | null
  variant_name?: string | null
  sub_variant_name?: string | null
}

/** "Wire / Red / 10mm" — omits absent grains, never leaves a dangling separator. */
export function productLabel(names: GrainNames, separator = ' / '): string {
  return [names.product_name, names.variant_name, names.sub_variant_name]
    .map(part => (part ?? '').trim())
    .filter(Boolean)
    .join(separator)
}

/** Just the grain suffix, for callers that already render the product name. */
export function variantLabel(names: GrainNames, separator = ' / '): string {
  return [names.variant_name, names.sub_variant_name]
    .map(part => (part ?? '').trim())
    .filter(Boolean)
    .join(separator)
}

/** True when the line names a grain below the product. */
export function hasVariantGrain(names: GrainNames): boolean {
  return variantLabel(names).length > 0
}
