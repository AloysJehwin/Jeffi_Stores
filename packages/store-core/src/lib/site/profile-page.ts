import type { PageDoc, ThemeTokens } from '@jeffi/site-blocks'
import { packDoc, packRow, phoneVersion, type PackBlock } from './packs'
import { aiComposeBlock } from './compose'
import type { Pattern, ReferenceProfile } from './reference'

// A home page laid out like a reference site: each pattern of its profile becomes the closest block we have, with the
// store's own data. A pattern with no block becomes a custom block the AI composes (capped, it costs a model call).
// Copy here is a placeholder in the right shape; the site agent rewrites every page's words for the store afterwards.

type Mapper = (note: string, ctx: { brands: number }) => PackBlock | null

const MAP: Record<Pattern, Mapper> = {
  announcement: () => null, // the announcement bar is its own site-wide page
  hero_image: () => ({ type: 'image_banner', props: { heading: 'New season, new favourites', subheading: 'Made for every day', ctaLabel: 'Shop now', ctaUrl: '/products', height: 'tall', overlay: 'dark', align: 'center' } }),
  hero_split: () => ({ type: 'image_text', props: { heading: 'Made for every day', body: 'A short line about what makes the store special.', ctaLabel: 'Shop now', ctaUrl: '/products', imageSide: 'right' } }),
  product_carousel: note => packRow(/best|popular|trending/i.test(note) ? 'Best sellers' : 'New in', /best|popular|trending/i.test(note) ? 'best_sellers' : 'new_arrivals', 'carousel'),
  product_grid: note => packRow(/new|latest/i.test(note) ? 'New in' : 'Best sellers', /new|latest/i.test(note) ? 'new_arrivals' : 'best_sellers', 'grid'),
  collection_tiles: () => ({ type: 'category_grid', props: { title: 'Shop by category' } }),
  campaign_banner: () => ({ type: 'image_banner', props: { heading: 'The new collection', ctaLabel: 'Explore', ctaUrl: '/products', height: 'medium', overlay: 'dark', align: 'left' } }),
  testimonials: () => ({ type: 'testimonials', props: { title: 'What customers say' } }),
  press_marquee: (_, c) => (c.brands >= 3 ? { type: 'brand_carousel', props: { title: 'Brands we carry' } } : { type: 'trust_strip' }),
  brand_logos: (_, c) => (c.brands >= 3 ? { type: 'brand_carousel', props: { title: 'Shop by brand' } } : null),
  usp_strip: () => ({ type: 'trust_strip' }),
  text_story: () => ({ type: 'rich_text', props: { heading: 'Our story', body: 'Who we are and why we do it.', align: 'center' } }),
  image_text: () => ({ type: 'image_text', props: { heading: 'Crafted with care', body: 'A few words about how the products are made.', imageSide: 'left' } }),
  faq: () => ({ type: 'faq' }),
  blog: () => ({ type: 'blog_teaser' }),
  social: () => ({ type: 'social_strip' }),
  newsletter: () => null,
  countdown: () => null,
  video: () => null,
  other: () => null,
}

const COMPOSE_LIMIT = 2

export interface ProfileHome {
  web: PageDoc
  phone: PageDoc
  composed: number
  skipped: Pattern[]
}

/** The home page (desktop and phone) for a reference profile, or null when too little of it maps. */
export async function homeFromProfile(profile: ReferenceProfile, opts: { brands: number; compose: boolean; brief: string }): Promise<ProfileHome | null> {
  const list: PackBlock[] = []
  const skipped: Pattern[] = []
  let composed = 0
  for (const { pattern, note } of profile.sequence) {
    let block = MAP[pattern](note, { brands: opts.brands })
    // No block for it: compose one when allowed (not for a form or a video, which primitives don't cover).
    if (!block && opts.compose && composed < COMPOSE_LIMIT && (pattern === 'other' || pattern === 'countdown')) {
      const r = await aiComposeBlock({ prompt: `A ${pattern.replace('_', ' ')} section: ${note}. For this store: ${opts.brief}`, page: 'home' }).catch(() => null)
      if (r) {
        block = { type: 'composed', props: { label: r.label, tree: r.tree } }
        composed++
      }
    }
    if (!block) {
      if (pattern !== 'announcement') skipped.push(pattern)
      continue
    }
    // The same block twice in a row reads as a mistake.
    const prev = list[list.length - 1]
    if (prev && prev.type === block.type && JSON.stringify(prev.props) === JSON.stringify(block.props)) continue
    list.push(block)
  }
  if (list.length < 3) return null
  return { web: packDoc(list), phone: packDoc(phoneVersion(list)), composed, skipped }
}

/** Theme cues a reference gives: its fonts (when we have them) and density. Colours stay the store's own. */
export function themeFromProfile(profile: ReferenceProfile): Partial<ThemeTokens> {
  return {
    ...(profile.fonts.display ? { fontDisplay: profile.fonts.display } : {}),
    ...(profile.fonts.body ? { fontBody: profile.fonts.body } : {}),
    density: profile.density,
  }
}

