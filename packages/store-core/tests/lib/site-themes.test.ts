import { describe, it, expect, vi } from 'vitest'
import { cloneElement, createElement, isValidElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

// The ready-made themes against every sample catalogue: each home page opens on a picture, its category grids fill
// their rectangle for any number of categories, no tile shows a bare "no image" icon, and every class it writes is a
// real one. Plus the engine pieces those guards stand on: the mosaic, itemClassName, HeroPicture and the grid lint.

const db = vi.hoisted(() => ({ queryMany: vi.fn(async (..._a: unknown[]): Promise<unknown[]> => []) }))
vi.mock('@/lib/shared/db', () => ({ queryMany: db.queryMany, queryOne: vi.fn(async () => null), query: vi.fn(), withTransaction: vi.fn() }))
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children?: ReactNode }) => createElement('a', { href, ...rest }, children) }))

import { SHOWCASE_TEMPLATES, STORE_TEMPLATES } from '@/lib/site/themes/templates/index'
import { studioPageOf } from '@/lib/site/studio/showcase'
import { SAMPLE_CATALOGS } from '@/lib/site/themes/samples/index'
import { GENERIC_SAMPLE, generatedSample } from '@/lib/site/themes/sample'
import { checkSection, compileSection } from '@/lib/site/code/compile'
import { deadClasses } from '@/lib/site/code/css'
import { checkGrid, gridTrouble } from '@/lib/site/code/grid'
import { heroPicture } from '@/lib/site/code/parts/common'
import { LINT, studioLint } from '@/lib/site/studio/lint'
import { makeEnv, renderNode, Resolve } from '@/components/visitor/site/code/interpret'
import { mosaicItemClass } from '@/components/visitor/site/code/common/tiles'
import { dbSiteData, sampleSiteData, type SampleCatalog } from '@/lib/site/data'
import type { CodeNode } from '@/lib/site/code/ast'

type Template = { pages: Record<string, { sections: { label: string; source: string }[] }> }
const TEMPLATES = Object.entries(STORE_TEMPLATES as Record<string, Template>)
const store = { name: 'Test Store', tagline: 'A tagline' }
// No pictures at all: every picture is a designed fill.
const BARE: SampleCatalog = {
  ...GENERIC_SAMPLE,
  store,
  products: GENERIC_SAMPLE.products.map(p => ({ ...p, images: [] })),
  offers: [],
}
const CATALOGUES: [string, SampleCatalog][] = [
  ...Object.keys(SAMPLE_CATALOGS).map(slug => [slug, { ...generatedSample(slug)!, store }] as [string, SampleCatalog]),
  ['generic', { ...GENERIC_SAMPLE, store }],
  ['no pictures', BARE],
]
const hasPicture = (c: SampleCatalog) => c.products.some(p => p.images?.length) || c.categories.some(x => x.image) || (c.offers ?? []).some(o => o.image)

/** Awaits the data components (Resolve) so the tree can be rendered synchronously. */
async function resolve(node: ReactNode): Promise<ReactNode> {
  if (Array.isArray(node)) return Promise.all(node.map(resolve))
  if (!isValidElement(node)) return node
  if (node.type === Resolve) return resolve(await (node.props as { promise: Promise<ReactNode> }).promise)
  const kids = (node.props as { children?: ReactNode }).children
  if (kids === undefined) return node
  const done = Array.isArray(kids) ? await Promise.all(kids.map(resolve)) : [await resolve(kids)]
  return cloneElement(node, undefined, ...done)
}

async function draw(ast: CodeNode, catalog: SampleCatalog): Promise<HTMLElement> {
  const html = renderToStaticMarkup(createElement('div', null, await resolve(renderNode(ast, makeEnv({ data: sampleSiteData(catalog), page: 'home', sectionId: 'cs-test' })))))
  const root = document.createElement('div')
  root.innerHTML = html
  return root
}

const classes = (el: Element) => (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean)
/** Grids whose items are category links: the elements a category grid's spans must hold for. */
const categoryGrids = (root: HTMLElement) =>
  [...root.querySelectorAll('*')].filter(
    el => classes(el).includes('grid') && el.children.length > 0 && [...el.children].every(c => c.matches('a[href^="/categories/"]') || !!c.querySelector('a[href^="/categories/"]'))
  )
// A photo, or a designed picture: the platform's fill (data-picture-fallback) or a template's own, marked as a picture.
const PICTURE = 'img, [role="img"], [data-picture-fallback]'
const picture = (el: Element) => !!el.querySelector(PICTURE)

const compiled = new Map<string, Promise<Awaited<ReturnType<typeof compileSection>>>>()
const compile = (source: string) => {
  if (!compiled.has(source)) compiled.set(source, compileSection(source, { page: 'home' }))
  return compiled.get(source)!
}

describe('ready-made themes: home pages', () => {
  for (const [style, file] of TEMPLATES) {
    const home = file.pages['store:home']?.sections ?? []
    describe(style, () => {
      it('has a home page whose sections compile, write only real classes and pass the opening and grid lint', async () => {
        expect(home.length).toBeGreaterThan(0)
        for (const [i, s] of home.entries()) {
          const r = await compile(s.source)
          if (!r.ok) throw new Error(`${s.label}: ${JSON.stringify(r.issues)}`)
          expect(deadClasses(r.section.classes, r.section.css), s.label).toEqual([])
          const notes = studioLint(r.section.ast, 'home', { first: i === 0 })
          expect(notes.filter(n => n === LINT.hero || /'s grid /.test(n)), s.label).toEqual([])
        }
      }, 60_000)

      for (const [name, catalog] of CATALOGUES)
        it(`opens on a picture and lays its category tiles out whole with the ${name} catalogue`, async () => {
          const r = await compile(home[0].source)
          if (!r.ok) throw new Error(JSON.stringify(r.issues))
          const hero = await draw(r.section.ast, catalog)
          if (hasPicture(catalog)) expect(hero.querySelector('img'), 'a photo in the opening').not.toBeNull()
          else expect(hero.querySelector(PICTURE), 'a designed picture in the opening').not.toBeNull()

          for (const s of home) {
            if (!/<(Categories|AllCategories)\b/.test(s.source)) continue
            const c = await compile(s.source)
            if (!c.ok) throw new Error(JSON.stringify(c.issues))
            const root = await draw(c.section.ast, catalog)
            expect(root.querySelector('svg.lucide-image'), `${s.label}: a bare "no image" icon`).toBeNull()
            const grids = categoryGrids(root)
            expect(grids.length, `${s.label}: a category grid`).toBeGreaterThan(0)
            for (const grid of grids) {
              const items = [...grid.children]
              for (const item of items) expect(picture(item), `${s.label}: ${item.textContent?.trim()} has a picture`).toBe(true)
              for (const width of [390, 1440]) {
                const check = checkGrid(classes(grid), items.map(classes), width)
                expect(check, `${s.label} at ${width}px`).not.toBeNull()
                expect({ holes: check!.holes, overflow: check!.overflow, narrow: check!.narrow }, `${s.label}: ${items.length} tiles at ${width}px`).toEqual({ holes: 0, overflow: false, narrow: false })
              }
            }
          }
        }, 60_000)
    })
  }
})

describe('ready-made themes: every page', () => {
  const files: [string, Template][] = [...TEMPLATES, ...Object.entries(SHOWCASE_TEMPLATES as Record<string, Template>).map(([s, f]) => [`showcase-${s}`, f] as [string, Template])]
  for (const [style, file] of files)
    it(`${style}: every section compiles, writes only real classes and lays its data grids out for any count`, async () => {
      for (const [key, page] of Object.entries(file.pages)) {
        const at = key === 'showcase:home' ? 'showcase' : studioPageOf(key)
        if (!at) continue
        for (const s of page.sections) {
          const r = await compileSection(s.source, { page: at })
          if (!r.ok) throw new Error(`${key} ${s.label}: ${JSON.stringify(r.issues)}`)
          expect(deadClasses(r.section.classes, r.section.css), `${key} ${s.label}`).toEqual([])
          expect(studioLint(r.section.ast, at).filter(n => /'s grid /.test(n)), `${key} ${s.label}`).toEqual([])
        }
      }
    }, 120_000)
})

describe('the mosaic layout', () => {
  const MOSAIC = 'grid grid-cols-2 lg:grid-cols-12'.split(' ')
  it('fills its rectangle for any number of items on phones, tablets and desktops', () => {
    for (let n = 1; n <= 24; n++)
      for (const width of [390, 768, 1024, 1440]) {
        const check = checkGrid(MOSAIC, Array.from({ length: n }, (_, i) => mosaicItemClass(i, n).split(/\s+/).filter(Boolean)), width)
        expect({ n, width, holes: check?.holes, overflow: check?.overflow, narrow: check?.narrow }).toEqual({ n, width, holes: 0, overflow: false, narrow: false })
      }
  })

  it('puts its spans on each item itself, so first: and group-first: still read the real position', async () => {
    const r = checkSection(
      `export default function S() { return <Categories layout="mosaic" className="gap-1">{c => <Link href={c.url} className="group block h-full"><span className="hidden group-first:inline">First</span>{c.name}</Link>}</Categories> }`,
      { page: 'home' }
    )
    if (!r.ok) throw new Error(JSON.stringify(r.issues))
    const root = await draw(r.ast, { ...GENERIC_SAMPLE, store })
    const grid = categoryGrids(root)[0]
    expect(classes(grid)).toEqual(expect.arrayContaining(['grid', 'gap-1']))
    const links = [...grid.children]
    expect(links.every(a => a.tagName === 'A')).toBe(true)
    expect(classes(links[0])).toEqual(expect.arrayContaining(['group', 'block', 'col-span-2', 'row-span-2', 'lg:col-span-6', 'lg:row-span-2']))
  })

  it('is refused columns and spans of its own', () => {
    const issues = (src: string) => {
      const r = checkSection(`export default function S() { return ${src} }`, { page: 'home' })
      return r.ok ? '' : r.issues.map(i => i.message).join('\n')
    }
    expect(issues('<Categories layout="mosaic" className="grid-cols-3 gap-2" />')).toMatch(/places its items itself: drop "grid-cols-3" from className/)
    expect(issues('<Categories layout="mosaic" itemClassName="first:col-span-2" />')).toMatch(/drop "first:col-span-2" from itemClassName/)
    expect(issues('<Categories layout="mosaic">{c => <Link href={c.url} className="lg:row-span-2">{c.name}</Link>}</Categories>')).toMatch(/from the item's className/)
    expect(issues('<Categories layout="mosaic" className="mt-8 gap-1 auto-rows-[9rem]" />')).toBe('')
  })
})

describe('itemClassName on a grid', () => {
  it("lands on the grid's own children, whatever drew them", async () => {
    const src = `export default function S() { return <><Categories className="grid grid-cols-4" itemClassName="first:col-span-2 lg:[&:nth-child(n+4)]:col-span-2">{c => <Link href={c.url} className="block">{c.name}</Link>}</Categories><Categories className="grid grid-cols-3" itemClassName="first:col-span-3" /></> }`
    const r = await compileSection(src, { page: 'home' })
    if (!r.ok) throw new Error(JSON.stringify(r.issues))
    // The CSS for the variants is built at save time, scoped to the section.
    expect(r.section.css).toContain('.first\\:col-span-2:first-child')
    expect(r.section.css).toContain('.lg\\:\\[\\&\\:nth-child\\(n\\+4\\)\\]\\:col-span-2:nth-child(n+4)')
    const [withFn, plain] = categoryGrids(await draw(r.section.ast, { ...GENERIC_SAMPLE, store }))
    for (const a of withFn.children) expect(classes(a)).toEqual(expect.arrayContaining(['block', 'first:col-span-2', 'lg:[&:nth-child(n+4)]:col-span-2']))
    // A default tile takes them on its own root too.
    for (const a of plain.children) expect(a.tagName === 'A' && classes(a).includes('first:col-span-3')).toBe(true)
  })
})

describe('the grid lint', () => {
  const grid = (cls: string, item: string, limit = 5) => {
    const r = checkSection(`export default function S() { return <Categories limit={${limit}} className="${cls}">{c => <Link href={c.url} className="${item}">{c.name}</Link>}</Categories> }`, { page: 'home' })
    if (!r.ok) throw new Error(JSON.stringify(r.issues))
    return studioLint(r.ast, 'home')
  }
  it('catches a bento that leaves holes for some counts, and leaves plain grids alone', () => {
    expect(grid('grid grid-cols-2 md:grid-cols-4', 'block first:col-span-2 first:row-span-2').join()).toMatch(/grid leaves \d+ empty cells? with \d+ items?/)
    expect(grid('grid grid-cols-2 gap-4 md:grid-cols-4', 'block')).toEqual([])
    // Twelve columns with nothing spanning them: slivers.
    expect(grid('grid grid-cols-2 lg:grid-cols-12', 'block').join()).toMatch(/slivers/)
    expect(gridTrouble(['grid', 'grid-cols-2', 'md:grid-cols-4', '[&>*:first-child]:col-span-2', '[&>*:first-child]:row-span-2'], [], 9)).not.toBeNull()
  })
})

describe('the opening picture', () => {
  it('falls back from an offer to a featured product, the newest product, a category, then a designed fill', async () => {
    const base: SampleCatalog = { store, categories: [{ slug: 'a', name: 'A' }], brands: [], reviews: [], products: [{ slug: 'p1', name: 'P1', price: 10, category: 'a' }], offers: [] }
    const of = async (c: SampleCatalog) => {
      const h = await heroPicture(sampleSiteData(c))
      return [h.kind, h.image]
    }
    expect(await of(base)).toEqual(['none', null])
    expect(await of({ ...base, categories: [{ slug: 'a', name: 'A', image: 'https://cdn.example.com/c.jpg' }] })).toEqual(['category', 'https://cdn.example.com/c.jpg'])
    expect(await of({ ...base, products: [...base.products, { slug: 'p2', name: 'P2', price: 10, category: 'a', images: ['https://cdn.example.com/p2.jpg'] }] })).toEqual(['product', 'https://cdn.example.com/p2.jpg'])
    const featured = { slug: 'p3', name: 'P3', price: 10, category: 'a', featured: true, images: ['https://cdn.example.com/p3.jpg'] }
    expect(await of({ ...base, products: [{ slug: 'p2', name: 'P2', price: 10, category: 'a', images: ['https://cdn.example.com/p2.jpg'] }, featured] })).toEqual(['product', 'https://cdn.example.com/p3.jpg'])
    expect(await of({ ...base, products: [featured], offers: [{ slug: 'o', title: 'Sale', image: 'https://cdn.example.com/o.jpg' }] })).toEqual(['offer', 'https://cdn.example.com/o.jpg'])
  })

  it('is what the lint asks an opening for, and an opening built on offers alone is flagged', () => {
    const lint = (jsx: string) => {
      const r = checkSection(`export default function S() { return ${jsx} }`, { page: 'home' })
      if (!r.ok) throw new Error(JSON.stringify(r.issues))
      return studioLint(r.ast, 'home', { first: true })
    }
    expect(lint('<section><h1>Hi</h1><Offers limit={1}>{o => <Image src={o.image} />}</Offers></section>')).toContain(LINT.hero)
    expect(lint('<section><h1>Hi</h1></section>')).toContain(LINT.hero)
    expect(lint('<section><h1>Hi</h1><HeroPicture aspect="4:5" /></section>')).not.toContain(LINT.hero)
    expect(lint('<section><Categories layout="mosaic" /></section>')).not.toContain(LINT.hero)
  })
})

describe('category photos on the live store', () => {
  it("gives a category without a picture its products' photo", async () => {
    db.queryMany.mockImplementation(async (sql: unknown) =>
      String(sql).includes('CROSS JOIN LATERAL')
        ? [{ id: 'c1', image_url: 'https://cdn.example.com/p.jpg' }]
        : [
            { id: 'c1', name: 'One', slug: 'one', image_url: null },
            { id: 'c2', name: 'Two', slug: 'two', image_url: 'https://cdn.example.com/two.jpg' },
          ]
    )
    const list = await dbSiteData().categories({ parent: null, limit: 8 })
    expect(list.map(c => c.image)).toEqual(['https://cdn.example.com/p.jpg', 'https://cdn.example.com/two.jpg'])
    const photoCall = db.queryMany.mock.calls.find(c => String(c[0]).includes('CROSS JOIN LATERAL'))
    expect(photoCall?.[1]).toEqual([['c1']])
  })
})
