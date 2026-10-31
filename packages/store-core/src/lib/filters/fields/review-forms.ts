import { defineFields, type FilterOption } from '@jeffi/list-filters/client'

// Review forms list filters (client-safe; the SQL is in ../entities/review-forms.ts).

const YES_NO: FilterOption[] = [
  { value: 'true', label: 'Yes' },
  { value: 'false', label: 'No' },
]

export const REVIEW_FORM_FIELDS = defineFields({
  active: {
    label: 'Status',
    type: 'toggle',
    quick: true,
    options: [
      { value: 'true', label: 'Active' },
      { value: 'false', label: 'Inactive' },
    ],
    section: 'Form',
  },
  template: { label: 'Template', type: 'value-help', placeholder: 'Any template', noun: 'Forms', section: 'Form' },
  has_coupon: { label: 'Has reward coupon', type: 'toggle', options: YES_NO, section: 'Form' },
  pending: { label: 'Submissions awaiting review', type: 'boolean', section: 'Submissions' },
  submissions: { label: 'Submissions', type: 'range', section: 'Submissions' },
  created: { name: ['from', 'to'], label: 'Created', type: 'date-range', section: 'Submissions' },
})

export const REVIEW_FORM_SEARCH = { placeholder: 'Search by title or slug...', param: 'search', suggestType: 'review_forms' }
