import { randomUUID } from 'crypto'
import { normalizeDoc, topBlocks, type Block, type PageDoc, type PageRef } from '@jeffi/site-blocks'
import type { HomepageAudience, HomepagePage, HomepageSection, HomepageSurface } from '@/lib/catalog/homepage-sections'
import type { HeroSlide } from '@/lib/catalog/hero-slides'
import type { DraftSection, HomepageDraftState } from '@/lib/catalog/homepage-draft'
import { isSectionBlock, type SectionBlockProps } from './blocks'

// Between the homepage tables (sections + hero slides) and Site Builder documents: importing today's layouts, and
// rendering a document through the existing section pipeline (buildHomeModel takes rows the same way as a preview).

const SLIDE_DROP = new Set(['surface', 'audience', 'display_order', 'created_at', 'updated_at'])

const byOrder = <T extends { display_order?: number | null; created_at?: string | null }>(rows: T[]) =>
  [...rows].sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0) || (Date.parse(a.created_at ?? '') || 0) - (Date.parse(b.created_at ?? '') || 0))

/** One layout's sections (and, for its hero, the layout's slides) as a document. */
export function sectionsToDoc(sections: HomepageSection[], slides: HeroSlide[] = []): PageDoc {
  const blocks: Record<string, Block> = {}
  const order: string[] = []
  for (const s of byOrder(sections)) {
    const id = s.id && !s.id.startsWith('default-') ? s.id : randomUUID()
    const props: SectionBlockProps = {
      title: s.title ?? null,
      subtitle: s.subtitle ?? null,
      eyebrow: s.eyebrow ?? null,
      ctaLabel: s.cta_label ?? null,
      ctaUrl: s.cta_url ?? null,
      config: s.config ?? {},
      ...(s.type === 'hero'
        ? { slides: byOrder(slides).map(sl => Object.fromEntries(Object.entries(sl).filter(([k]) => !SLIDE_DROP.has(k)))) }
        : {}),
    }
    const hidden = s.is_active === false
    const visibility = hidden || s.starts_at || s.ends_at ? { hidden, from: s.starts_at ?? null, to: s.ends_at ?? null } : undefined
    blocks[id] = { id, type: s.type, v: 1, props: props as unknown as Record<string, unknown>, ...(visibility ? { visibility } : {}) }
    order.push(id)
  }
  return normalizeDoc({ blocks, order })
}

/** A document as the section rows (and hero slides) the homepage pipeline renders. */
export function docToRows(doc: PageDoc, ref: Pick<PageRef, 'audience' | 'surface'> & { page: HomepagePage }, now = new Date(0).toISOString()): HomepageDraftState {
  const surface = ref.surface as HomepageSurface
  const audience = ref.audience as HomepageAudience
  const sections: DraftSection[] = []
  const heroSlides: HeroSlide[] = []
  topBlocks(normalizeDoc(doc)).forEach((b, i) => {
    // A block that is not a homepage section (text, image banner…) carries its settings as the row's config.
    const p = (isSectionBlock(b.type) ? b.props : { config: b.props }) as Partial<SectionBlockProps>
    sections.push({
      id: b.id,
      type: b.type as HomepageSection['type'],
      title: p.title ?? null,
      subtitle: p.subtitle ?? null,
      eyebrow: p.eyebrow ?? null,
      cta_label: p.ctaLabel ?? null,
      cta_url: p.ctaUrl ?? null,
      config: p.config ?? {},
      display_order: i,
      is_active: !b.visibility?.hidden,
      starts_at: b.visibility?.from ?? null,
      ends_at: b.visibility?.to ?? null,
      surface,
      page: ref.page,
      audience,
      created_at: now,
      updated_at: now,
    })
    if (b.type === 'hero' && Array.isArray(p.slides)) {
      p.slides.forEach((sl, j) =>
        heroSlides.push({
          title: '', subtitle: null, badge_text: null, badge_color: null, image_url: null, image_url_mobile: null,
          cta_label: null, cta_url: null, filter_category: null, filter_brand: null, filter_grade: null, filter_material: null,
          filter_min_price: null, filter_max_price: null, filter_in_stock: false, filter_on_sale: false, is_active: true,
          ...(sl as Partial<HeroSlide>),
          id: String((sl as { id?: unknown }).id ?? `${b.id}-${j}`),
          display_order: j,
          surface,
          audience,
          created_at: now,
          updated_at: now,
        })
      )
    }
  })
  return { sections, heroSlides }
}
