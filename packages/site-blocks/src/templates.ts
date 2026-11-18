import type { PageDoc } from './doc'
import type { PageKey, SiteAudience, SiteSurface } from './layouts'
import type { ThemeTokens } from './theme'

// A template is ready-made page documents: one page on one layout, or a whole site pack (every page on every layout,
// plus a theme). Built-in ones ship as JSON under packages/site-blocks/templates; owners save their own.

export type Archetype =
  | 'heritage_luxury'
  | 'warm_festive'
  | 'craft_earthy'
  | 'minimal_modern'
  | 'bold_playful'
  | 'bazaar_dense'
  | 'tech_mono'
  | 'b2b_pro'

export interface TemplatePage {
  audience: SiteAudience
  surface: SiteSurface
  page: PageKey
  doc: PageDoc
}

export interface SiteTemplate {
  id: string
  name: string
  description?: string
  /** page: one page; site: a whole pack; block: one block the owner saved ("My blocks"). */
  kind: 'page' | 'site' | 'block'
  archetype?: Archetype
  categories?: string[]
  pages: TemplatePage[]
  theme?: Partial<ThemeTokens>
  /** Preview image for the picker. */
  thumbnail?: string
}
