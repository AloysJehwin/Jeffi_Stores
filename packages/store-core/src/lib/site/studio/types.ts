import type { PageDoc, PageKey, SiteAudience, ThemeStyle, ThemeTokens } from '@jeffi/site-blocks'
import type { StoreSocials } from '@/lib/catalog/store-socials'

// AI Site Studio types (docs/AI_SITE_STUDIO_PLAN.md 4.5). Everything here is plain JSON, so a session row can hold it.

/** How customers reach the store (onboarding Store step). The site shows them through <Store>, never typed into copy. */
export interface StudioContact {
  phone?: string
  /** Digits with the country code. */
  whatsapp?: string
  email?: string
  /** One line: street, city, state and PIN. */
  address?: string
}

/** What the onboarding Store step says about the store, carried by the answers and the brief. */
export interface StudioStoreDetails {
  tagline?: string
  about?: string
  contact?: StudioContact
  socials?: StoreSocials
}

/** The owner's answers to the studio's questions; every field but `sell` is optional. */
export interface StudioAnswers extends StudioStoreDetails {
  storeName?: string
  /** What they sell. */
  sell: string
  /** Who buys. */
  audience?: string
  /** The mood or feel they want. */
  mood?: string
  /** Sites they like (https), at most 3 are read. */
  references?: string[]
  /** The design style picked in the brief (ui-styles.ts), or none for the AI to choose. */
  uiStyle?: string | null
  logoUrl?: string | null
  /** Anything else they said. */
  notes?: string
}

/** What a reference site gave the brief: its patterns and feel, never its words. */
export interface BriefReference {
  url: string
  feel: string
  patterns: string[]
  density: 'compact' | 'comfortable' | 'airy'
  imageLed: boolean
  colors: string[]
  fonts: { display?: string; body?: string }
  /** The site sets its labels in uppercase. */
  uppercaseLabels?: boolean
}

export interface StudioBrief extends StudioStoreDetails {
  storeName: string
  summary: string
  category: string
  /** Words shoppers of this category use ("Kanjivaram, Banarasi, organza"). */
  vocabulary: string[]
  audience: string
  priceTier: 'value' | 'mid' | 'premium' | 'luxury'
  voice: string
  mood: string
  artDirection: string
  references: BriefReference[]
  /** The design style the owner picked (ui-styles.ts); null lets the AI vary it. */
  uiStyle?: string | null
  logoUrl: string | null
  /** Varies every layout choice made for this brief; a new seed gives a different site. */
  seed: number
  /** What the site is for: a store (absent) or a Showcase, a business's one-page site (studio/showcase.ts). */
  kind?: StudioProduct
}

/** The product a studio session designs for: a store's site, or a Showcase. */
export type StudioProduct = 'store' | 'showcase'

/** One section the AI writes: what it is for and the library parts it must use. */
export interface PlannedSection {
  id: string
  label: string
  intent: string
  /** Composition idea (e.g. "asymmetric 5/7 split, image bleeding off the edge"). */
  layout: string
  /** Library components this section must contain (required parts are given to exactly one section). */
  parts: string[]
}

export interface PlannedPage {
  /** `${audience}:${page}`, the key a session stores the page's doc under. */
  key: string
  audience: SiteAudience
  page: PageKey
  label: string
  optional: boolean
  enabled: boolean
  /** Other page keys that use this page's document (the listing serves category and brand too). */
  alsoFor?: PageKey[]
  /** The page's overall shape in a sentence. */
  approach: string
  sections: PlannedSection[]
  /** Library parts the page must contain somewhere. */
  required: string[]
}

/** A page that takes the theme only (no AI per page). */
export interface ThemedPage {
  audience: SiteAudience
  key: string
  label: string
  /** The Site Builder page key, when the page has one. */
  page?: PageKey
  /** The engaging page whose document it shares (business product detail uses the store's). */
  sharedWith?: string
}

export interface StudioPlan {
  /** The content approach chosen for this brief (e.g. "storyteller"). */
  approach: { id: string; name: string; description: string }
  pages: PlannedPage[]
  themed: ThemedPage[]
}

/** Style tokens a direction sets for the non-engaging pages (contract 4.5b); a direction always sets all of them. */
export type StyleTokens = ThemeStyle

export type StudioTheme = ThemeTokens & StyleTokens

export interface DesignDirection {
  id: string
  name: string
  theme: StudioTheme
  /** The layout feel's id (editorial, bazaar, boutique, poster, grid, crafted, playful, gallery). */
  feel: string
  /** How pages are composed: spacing, image treatment, grids, motion. */
  layoutFeel: string
  rationale: string
  /** Google Fonts stylesheet for showing the font pair in its fonts. */
  fontsHref: string
  /** The site it takes its colours and type from, when the owner gave one ("headsupfortails.com"). */
  reference?: string
}

export interface StudioCtx {
  brief: StudioBrief
  plan: StudioPlan
  direction: DesignDirection
  /** Optional: refs for AI usage rows. */
  sessionId?: string
  signal?: AbortSignal
}

export type StudioEvent =
  | { type: 'page'; page: string; label: string; sections: number }
  | { type: 'section'; page: string; index: number; total: number; label: string; status: 'writing' | 'repairing' | 'done' | 'skipped'; issues?: string[] }
  | { type: 'done'; page: string; doc: PageDoc; skipped: { label: string; reason: string }[] }
  | { type: 'error'; page: string; message: string }

/**
 * What a finished session installs into the store: page docs by `${audience}:${page}` (a bare page key means the
 * store) and the theme. Untrusted: install recompiles and validates everything.
 */
export interface StudioSiteInput {
  pages: Record<string, unknown>
  theme?: Partial<StudioTheme> | Record<string, unknown> | null
  /** The direction's name, for the build status. */
  style?: string
  /** What the site was built from, kept with it so Site Builder can change its sections the studio way. */
  brief?: unknown
  plan?: unknown
  direction?: unknown
  /** The owner's free AI generation was used in the studio. A ready-made theme installed with it unused leaves the store's free generation unused too. */
  freeUsed?: boolean
}
