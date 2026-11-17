import type { Archetype } from '@jeffi/site-blocks'

// The store styles an owner can pick for the AI site build (one per store site pack), for pickers on the client.
// Names and colours match the packs in ./packs.ts.
export interface SiteStyle {
  id: Exclude<Archetype, 'b2b_pro'>
  name: string
  description: string
  colors: [string, string]
}

export const SITE_STYLES: SiteStyle[] = [
  { id: 'heritage_luxury', name: 'Heritage Luxury', description: 'Maroon and gold, serif type, few large blocks. Couture, handloom, fine craft.', colors: ['#7a1f2b', '#b8860b'] },
  { id: 'warm_festive', name: 'Warm Festive', description: 'Saffron and magenta, offers up top. Festive wear and gifting.', colors: ['#c2410c', '#be185d'] },
  { id: 'craft_earthy', name: 'Craft Earthy', description: 'Terracotta and leaf green, the maker story first. Handmade and organic.', colors: ['#8b5e34', '#4d7c0f'] },
  { id: 'minimal_modern', name: 'Minimal Modern', description: 'Black, white and one blue, lots of space. Lets products talk.', colors: ['#111827', '#2563eb'] },
  { id: 'bold_playful', name: 'Bold Playful', description: 'Pink and amber, chunky and rounded. Youthful brands and gifts.', colors: ['#db2777', '#f59e0b'] },
  { id: 'bazaar_dense', name: 'Bazaar Dense', description: 'Amber and green, compact, packed with deals. Large catalogues.', colors: ['#f59e0b', '#16a34a'] },
  { id: 'tech_mono', name: 'Tech Mono', description: 'Slate and electric green, geometric type. Electronics and tools.', colors: ['#0f172a', '#22c55e'] },
]

export const SITE_STYLE_IDS = SITE_STYLES.map(s => s.id) as [SiteStyle['id'], ...SiteStyle['id'][]]
