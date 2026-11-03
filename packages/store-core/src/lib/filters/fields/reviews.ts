import { defineFields, type FilterAlias, type FilterOption } from '@jeffi/list-filters/client'

// Product reviews list filters (client-safe; the SQL is in ../entities/reviews.ts).

const YES_NO: FilterOption[] = [
  { value: 'true', label: 'Yes' },
  { value: 'false', label: 'No' },
]

export const REVIEW_FIELDS = defineFields({
  // The list's Pending / Approved / All switch; the param keeps its old name.
  approval: {
    name: 'filter',
    label: 'Approval',
    type: 'select',
    quick: true,
    options: [
      { value: 'pending', label: 'Pending' },
      { value: 'approved', label: 'Approved' },
    ],
    section: 'Review',
  },
  rating: {
    label: 'Rating',
    type: 'multi-select',
    quick: true,
    options: [5, 4, 3, 2, 1].map(r => ({ value: String(r), label: `${r} star${r === 1 ? '' : 's'}` })),
    section: 'Review',
  },
  verified: { label: 'Verified purchase', type: 'toggle', options: YES_NO, section: 'Review' },
  has_images: { label: 'Has photos', type: 'toggle', options: YES_NO, section: 'Review' },
  tag: { label: 'Tag', type: 'value-help', placeholder: 'Any tag', noun: 'Reviews', section: 'Review' },
  product: { label: 'Product', type: 'value-help', placeholder: 'Any product', noun: 'Reviews', section: 'Product' },
  brand: { label: 'Brand', type: 'value-help', placeholder: 'Any brand', noun: 'Reviews', section: 'Product' },
  created: { name: ['from', 'to'], label: 'Reviewed on', type: 'date-range', section: 'Product' },
})

export const REVIEW_ALIASES: FilterAlias[] = []

export const REVIEW_SEARCH = { placeholder: 'Search by product, reviewer or text…', param: 'q' }

/** The list opens on pending reviews; links without a choice show every review. */
export const REVIEW_LIST_PRESET = 'filter=pending'
