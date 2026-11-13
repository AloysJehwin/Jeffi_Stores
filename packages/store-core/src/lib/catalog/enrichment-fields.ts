// Product columns AI enrichment may fill (only when empty). Client-safe.
export const ENRICH_CONTENT_FIELDS = [
  { key: 'short_description', label: 'Short description', max: 500 },
  { key: 'usage_instructions', label: 'Usage instructions', max: 2000 },
  { key: 'care_instructions', label: 'Care instructions', max: 2000 },
  { key: 'safety_warnings', label: 'Safety warnings', max: 2000 },
  { key: 'meta_title', label: 'SEO title', max: 160 },
  { key: 'meta_description', label: 'SEO description', max: 320 },
] as const
export type EnrichContentKey = (typeof ENRICH_CONTENT_FIELDS)[number]['key']
