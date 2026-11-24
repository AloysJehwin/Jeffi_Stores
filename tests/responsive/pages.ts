// Shared by prepare.ts (node, tsx), sweep.spec.ts (Playwright) and summary.ts: the widths and where pack pages render.

export const WIDTHS = [320, 360, 390, 768, 1024, 1280, 1920] as const
export type Width = (typeof WIDTHS)[number]

/** Phones get the pack's web_mobile layout (`?layout=mobile`); 768 and up the desktop one. */
export const layoutFor = (w: number): 'mobile' | 'desktop' => (w < 768 ? 'mobile' : 'desktop')

/** Widths that keep a full-page screenshot (home page only). */
export const SCREENSHOT_WIDTHS: readonly Width[] = [360, 768, 1280]

export const MIN_TAP = 44
export const WARN_TAP = 48
/** Tap targets are checked at touch widths (phones, tablets); 1280 and up are mouse-driven. */
export const TAP_MAX_WIDTH = 1024

/**
 * Load budgets per page (Web Vitals' good and poor lines): CLS while loading, and when the largest paint lands. Over
 * the warning line is a warning; over the error line fails the page, where a production build serves it (CI, or
 * SWEEP_VITALS=budget), since a dev server compiling on first load paints late.
 */
export const VITALS = { cls: { warn: 0.1, error: 0.25 }, lcpMs: { warn: 2500, error: 4000 } }
export const vitalsStrict = () => !!process.env.CI || process.env.SWEEP_VITALS === 'budget'

export type Audience = 'store' | 'business'

export interface SweepPage {
  /** Pack page key (site-blocks PageKey). */
  page: string
  /** Storefront path; `{product}` is the product slug from the manifest. */
  path: string
  /** Needs a business session cookie (SWEEP_BUSINESS_COOKIE); skipped without one. */
  businessSession?: boolean
}

/** Site-wide pack pages: drawn around every page, so not visited on their own. */
export const CHROME_PAGES = ['header', 'footer', 'announcement']

/** Where each pack page renders. A pack page missing here is listed as skipped in the summary. */
export const PAGE_PATHS: Record<Audience, Record<string, Omit<SweepPage, 'page'>>> = {
  store: {
    home: { path: '/' },
    about: { path: '/about' },
    contact: { path: '/contact' },
    product: { path: '/products/{product}' },
    cart: { path: '/cart' },
    login: { path: '/login' },
    signup: { path: '/signup' },
  },
  business: {
    home: { path: '/business' },
    about: { path: '/business/about', businessSession: true },
    support: { path: '/business/support', businessSession: true },
  },
}

export interface ManifestDraft {
  packId: string
  name: string
  archetype: string
  audience: Audience
  draftId: string
  token: string
  /** block id → block type, for naming findings. */
  blocks: Record<string, string>
  pages: SweepPage[]
}

export interface Skipped {
  archetype: string
  pack: string
  page: string | null
  reason: string
}

export interface Manifest {
  baseUrl: string
  productSlug: string | null
  createdAt: string
  drafts: ManifestDraft[]
  skipped: Skipped[]
}

export const OUTPUT_DIR = 'tests/responsive/output'
export const MANIFEST_PATH = `${OUTPUT_DIR}/manifest.json`
export const FINDINGS_PATH = `${OUTPUT_DIR}/findings.jsonl`
export const DRAFT_TITLE_PREFIX = 'responsive-sweep:'
/** The visual editor's page (editor-pack.ts), swept beside the packs; SWEEP_PACKS=editor sweeps it alone. */
export const EDITOR_ARCHETYPE = 'editor'
