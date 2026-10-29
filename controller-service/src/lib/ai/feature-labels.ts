// Client-safe labels for ai_usage.feature keys (Finance AI costs, wallet notes).

const LABELS: Record<string, string> = {
  text: 'Text (other)',
  embed: 'Search embeddings',
  social_caption: 'Social caption',
  social_hashtags: 'Social hashtags',
  social_image: 'Social image',
  social_video: 'Social video',
  product_image: 'Product image',
  product_copy: 'Product copy',
  enrichment: 'Catalog enrichment',
  ads_image: 'Ad image',
  email_hero: 'Email hero image',
  email_copy: 'Email copy',
  hero_image: 'Homepage hero image',
  offer_image: 'Offer banner image',
  meta_ads_image: 'Meta ad image',
  generate_image: 'Image generation',
  homepage_image: 'Homepage image',
  homepage_video: 'Homepage video',
  offer_video: 'Offer video',
  brand_image: 'Brand logo',
  category_image: 'Category image',
  logo_image: 'Store logo',
  campaign_image: 'Campaign image',
  template_image: 'Template header image',
  template_video: 'Template header video',
  admin_agent: 'Admin agent',
  storefront_assistant: 'Storefront assistant',
  support_agent: 'Support assistant',
  support_translate: 'Support translation',
  campaign_scenario: 'Campaign scenario',
  form_fill: 'AI form fill',
  vision: 'Vision / OCR',
  quotation_ocr: 'Quotation OCR',
}

export function aiFeatureLabel(feature: string | null | undefined): string {
  if (!feature) return 'AI'
  return LABELS[feature] ?? feature.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase())
}

export const AI_CAPABILITY_LABEL: Record<string, string> = {
  text: 'Text',
  embed: 'Embeddings',
  vision: 'Vision',
  image: 'Images',
  video: 'Video',
}

/** Readable wallet note for an 'ai' ledger entry; billing writes 'AI: <label>', older rows 'AI <key>'. */
export function aiLedgerNote(note: string | null | undefined): string {
  if (!note) return 'AI usage'
  const m = note.match(/^AI[: ]\s*([a-z0-9_]+)$/)
  return m ? `AI: ${aiFeatureLabel(m[1])}` : note
}
