import { describe, it, expect } from 'vitest'
import { DEFAULT_THEME, cloneDoc, mergeDocs, normalizeDoc, paletteFrom, styleCssVars, themeCssVars, normalizeTheme, validateDoc, type PageDoc } from '@jeffi/site-blocks'
import { siteRegistry } from '@/lib/site/blocks'
import { docToRows, sectionsToDoc } from '@/lib/site/legacy'
import { builtInTemplates } from '@/lib/site/templates'
import type { HomepageSection } from '@/lib/catalog/homepage-sections'

const section = (id: string, over: Partial<HomepageSection> = {}): HomepageSection => ({
  id,
  type: 'product_row',
  title: id,
  subtitle: null,
  eyebrow: null,
  cta_label: null,
  cta_url: null,
  config: { source: 'featured' },
  display_order: 0,
  is_active: true,
  starts_at: null,
  ends_at: null,
  ...over,
})

const doc = (ids: string[], props: Record<string, Record<string, unknown>> = {}): PageDoc =>
  normalizeDoc({
    blocks: Object.fromEntries(ids.map(id => [id, { id, type: 'product_row', v: 1, props: props[id] ?? { title: id } }])),
    order: ids,
  })

describe('Site Builder documents', () => {
  it('round-trips a layout between the homepage tables and a document', () => {
    const rows = [
      section('b', { display_order: 1, is_active: false }),
      section('a', { display_order: 0 }),
      section('h', { type: 'hero', display_order: 2 }),
    ]
    const slides = [{ id: 's1', title: 'Sale', display_order: 0, is_active: true } as never]
    const d = sectionsToDoc(rows, slides)
    expect(d.order).toEqual(['a', 'b', 'h'])
    expect(d.blocks.b.visibility?.hidden).toBe(true)
    const back = docToRows(d, { audience: 'store', surface: 'app', page: 'home' })
    expect(back.sections.map(s => [s.id, s.display_order, s.is_active, s.surface])).toEqual([
      ['a', 0, true, 'app'],
      ['b', 1, false, 'app'],
      ['h', 2, true, 'app'],
    ])
    expect(back.heroSlides.map(s => [s.id, s.title, s.surface])).toEqual([['s1', 'Sale', 'app']])
  })

  it('merges a draft block by block, keeping changes published since', () => {
    const base = doc(['a', 'b'])
    const live = doc(['a', 'b', 'c'], { a: { title: 'live edit' } })
    const draft = doc(['b', 'a'], { b: { title: 'draft edit' } })
    const { doc: merged, conflicts } = mergeDocs(base, live, draft)
    expect(merged.order).toEqual(['b', 'a', 'c'])
    expect(merged.blocks.a.props.title).toBe('live edit')
    expect(merged.blocks.b.props.title).toBe('draft edit')
    expect(conflicts).toEqual([])
    const both = mergeDocs(base, doc(['a', 'b'], { a: { title: 'x' } }), doc(['a', 'b'], { a: { title: 'y' } }))
    expect(both.conflicts).toEqual(['a'])
    expect(both.doc.blocks.a.props.title).toBe('y')
  })

  it('drops unknown types and blocks a page cannot have, and fills defaults', () => {
    const input = {
      blocks: {
        x: { id: 'x', type: 'nonsense', v: 1, props: {} },
        q: { id: 'q', type: 'business_quotes', v: 1, props: {} },
        p: { id: 'p', type: 'product_row', v: 1, props: { config: { source: 'new_arrivals' } } },
      },
      order: ['x', 'q', 'p'],
    }
    const r = validateDoc(input, siteRegistry, { audience: 'store', surface: 'web', page: 'home' })
    expect(r.ok).toBe(false)
    expect(r.doc.order).toEqual(['p'])
    expect(r.doc.blocks.p.props).toMatchObject({ title: null, config: { source: 'new_arrivals' } })
  })

  it('copies a document with fresh ids', () => {
    let n = 0
    const copy = cloneDoc(doc(['a', 'b']), () => `n${++n}`)
    expect(copy.order).toEqual(['n1', 'n2'])
    expect(copy.blocks.n1.id).toBe('n1')
  })

  it('ships built-in templates and site packs that pass the block rules', () => {
    const all = builtInTemplates()
    expect(all.filter(t => t.kind === 'site').length).toBe(8)
    for (const t of all) {
      for (const p of t.pages) {
        const r = validateDoc(p.doc, siteRegistry, p)
        expect(r.issues, `${t.id} ${p.audience}:${p.surface}:${p.page}`).toEqual([])
        expect(r.doc.order.length, `${t.id} ${p.page}`).toBeGreaterThan(0)
      }
    }
  })

  it('turns a theme into Tailwind colour channels', () => {
    const t = normalizeTheme({ primary: '#ff0000', fontDisplay: 'Not A Font' })
    expect(t.fontDisplay).toBe('Bebas Neue')
    expect(paletteFrom('#ff0000')[500]).toBe('#ff0000')
    const vars = themeCssVars(t)
    expect(vars['--c-primary-500']).toBe('255 0 0')
    expect(vars['--primary-500']).toBe('#ff0000')
  })

  it('keeps style tokens optional: unset ones add no variables, set ones drive the ui hooks', () => {
    expect(normalizeTheme(DEFAULT_THEME)).toStrictEqual(DEFAULT_THEME)
    expect(Object.keys(themeCssVars(normalizeTheme(null))).filter(k => k.startsWith('--ui-'))).toEqual([])
    const t = normalizeTheme({ radius: 'md', buttonShape: 'pill', cardStyle: 'shadow', inputStyle: 'underline', headingCase: 'upper', shadow: 'strong', headingTracking: 'sideways' as never })
    expect(t).toMatchObject({ buttonShape: 'pill', cardStyle: 'shadow', inputStyle: 'underline', headingCase: 'upper', shadow: 'strong' })
    expect('headingTracking' in t).toBe(false)
    const vars = themeCssVars(t)
    expect(vars['--ui-btn-radius']).toBe('999px')
    expect(vars['--ui-card-radius']).toBe('12px')
    expect(vars['--ui-card-border-width']).toBe('0px')
    expect(vars['--ui-input-border-width']).toBe('0 0 1px')
    expect(vars['--ui-heading-case']).toBe('uppercase')
    expect(vars['--ui-heading-weight']).toBe('400')
    expect(vars['--ui-heading-tracking']).toBeUndefined()
    expect(styleCssVars({ ...DEFAULT_THEME, buttonShape: 'rounded' })['--ui-btn-radius']).toBe('8px')
  })
})
