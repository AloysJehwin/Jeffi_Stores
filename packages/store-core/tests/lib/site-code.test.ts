import type { PageDoc } from '@jeffi/site-blocks'
import { describe, it, expect, vi } from 'vitest'
import { cloneElement, createElement, isValidElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import postcss from 'postcss'
import { z } from 'zod'

// The other parts' modules are built separately; the engine is tested on its own components.
vi.mock('@/lib/site/code/parts/product', () => ({}))
vi.mock('@/lib/site/code/parts/listing', () => ({}))
vi.mock('@/lib/site/code/parts/cart', () => ({}))
vi.mock('@/lib/site/code/parts/checkout', () => ({}))
vi.mock('@/lib/site/code/parts/chrome', () => ({}))
vi.mock('@/lib/shared/db', () => ({ queryMany: vi.fn(async () => []), queryOne: vi.fn(async () => null), withTransaction: vi.fn() }))
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children?: ReactNode }) => createElement('a', { href, ...rest }, children) }))

import { checkSection, compileSection, recompileCodeSections, CodeSectionInvalid, checkPageParts, type CompiledSection } from '@/lib/site/code/compile'
import { defineCodeComponent, describeLibrary, codeLibrary } from '@/lib/site/code/library'
import { inertCss, safeHref, safeSrc } from '@/lib/site/code/allow'
import { evalValue } from '@/lib/site/code/evaluate'
import type { CodeNode } from '@/lib/site/code/ast'
import { makeEnv, renderNode, Resolve } from '@/components/visitor/site/code/interpret'
import CodeSection from '@/components/visitor/site/code/CodeSection'
import { sampleSiteData, type SampleCatalog } from '@/lib/site/data'
import { siteRegistry } from '@/lib/site/blocks'

// Stand-ins for page parts owned by other modules.
defineCodeComponent({ name: 'PaymentStep', pages: ['checkout'], props: z.object({}), required: ['checkout'], describe: 'test', render: () => createElement('div', { 'data-pay': '' }) })
defineCodeComponent({ name: 'AddToCart', pages: ['product'], props: z.object({}), required: ['product'], describe: 'test', render: () => null })

const catalog: SampleCatalog = {
  store: { name: 'Loom & Thread', tagline: 'Handwoven sarees' },
  categories: [{ slug: 'sarees', name: 'Sarees' }, { slug: 'silk', name: 'Silk', parent: 'sarees' }],
  brands: [{ slug: 'loom', name: 'Loom' }],
  products: [
    { slug: 'kanjivaram-red', name: 'Kanjivaram Red', price: 12999, mrp: 15999, category: 'silk', brand: 'loom', images: ['https://cdn.example.com/a.jpg'] },
    { slug: 'banarasi-gold', name: 'Banarasi Gold', price: 8999, category: 'sarees' },
    { slug: 'cotton-blue', name: 'Cotton Blue', price: 1999, category: 'sarees', inStock: false },
  ],
  reviews: [{ productSlug: 'kanjivaram-red', rating: 5, comment: 'Beautiful weave and colour, arrived quickly.', author: 'Asha K.' }],
}

const wrap = (jsx: string, before = '') => `${before}\nexport default function Section() {\n  return (\n    ${jsx}\n  )\n}\n`
const check = (src: string, page: Parameters<typeof checkSection>[1]['page'] = 'home') => checkSection(src, { page })
const issuesOf = (src: string, page: Parameters<typeof checkSection>[1]['page'] = 'home') => {
  const r = check(src, page)
  return r.ok ? [] : r.issues
}
const rejects = (src: string, pattern: RegExp, page: Parameters<typeof checkSection>[1]['page'] = 'home') => {
  const issues = issuesOf(src, page)
  expect(issues.length, `expected a rejection for:\n${src}`).toBeGreaterThan(0)
  expect(issues.map(i => i.message).join('\n')).toMatch(pattern)
  return issues
}

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
const html = async (ast: CodeNode, page: 'home' | 'checkout' = 'home') =>
  renderToStaticMarkup(createElement('div', null, await resolve(renderNode(ast, makeEnv({ data: sampleSiteData(catalog), page, sectionId: 'cs-test' })))))

describe('code sections: compile happy path', () => {
  it('compiles Products with a render function and Tailwind classes into an AST and scoped CSS', async () => {
    const src = `import { Products } from '@site/ui'
const TITLE = 'New in silk'
export default function Section() {
  return (
    <section className="bg-surface py-12 md:py-20">
      <h2 className="font-display text-3xl md:text-5xl text-foreground">{TITLE}</h2>
      <Products query={{ category: 'sarees', limit: 4, sort: 'price_desc' }} className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-4">
        {p => (
          <a href={p.url} className={p.inStock ? 'group block' : 'group block opacity-60'}>
            <h3 className="text-sm font-semibold">{p.name}</h3>
            <span className="text-accent-600">{p.price.formatted}</span>
            {p.mrp && <s className="ml-2 text-foreground-muted">{p.mrp.formatted}</s>}
            {p.discountPct > 0 ? <em>{\`\${p.discountPct}% off\`}</em> : null}
          </a>
        )}
      </Products>
    </section>
  )
}`
    const r = await compileSection(src, { page: 'home' })
    if (!r.ok) throw new Error(JSON.stringify(r.issues))
    const s = r.section
    expect(s.id).toMatch(/^cs-[0-9a-f]{8}$/)
    expect(s.components).toEqual(['Products'])
    expect(s.classes).toEqual(expect.arrayContaining(['grid-cols-2', 'md:grid-cols-4', 'opacity-60', 'text-accent-600', 'font-display']))
    const scope = `[data-code-section="${s.id}"]`
    expect(s.css).toContain(`${scope} .grid-cols-2.${s.id}`)
    expect(s.css).toContain(`${scope} .md\\:grid-cols-4.${s.id}`)
    expect(s.css).toContain('@media (min-width: 768px)')
    // Theme colours resolve to the store's variables.
    expect(s.css).toMatch(/--c-accent-600/)
    expect(s.css).not.toMatch(/(^|})\s*\.[a-z]/)

    const out = await html(s.ast)
    expect(out).toContain('New in silk')
    expect(out).toContain('Kanjivaram Red')
    expect(out).toContain('₹12,999')
    expect(out).toContain('₹15,999')
    expect(out).toContain('19% off')
    expect(out).toContain('href="/products/kanjivaram-red"')
    // Sorted by price, highest first; the out-of-stock one is dimmed.
    expect(out.indexOf('Kanjivaram')).toBeLessThan(out.indexOf('Banarasi'))
    expect(out).toMatch(/class="group block opacity-60 cs-test"[^>]*><h3[^>]*>Cotton Blue/)
  })

  it('scopes every rule but keyframe steps to the marked elements, and keeps hover / dark / group variants working', async () => {
    const { compileSectionCss, cardScope, CSS_FORMAT } = await import('@/lib/site/code/css')
    const css = await compileSectionCss(['animate-spin', 'hover:underline', 'dark:bg-black', 'group-hover:scale-105', 'space-y-4', 'md:flex', 'supports-[display:grid]:grid', 'bogus-class'], 'cs-abc')
    expect(css.startsWith(CSS_FORMAT)).toBe(true)
    expect(css).toMatch(/@keyframes spin \{to \{transform: rotate\(360deg\)\}\}/)
    expect(css).toContain('[data-code-section="cs-abc"] .hover\\:underline.cs-abc:hover')
    expect(css).toContain('[data-code-section="cs-abc"] .dark\\:bg-black.cs-abc:is(.dark *)')
    expect(css).toContain('[data-code-section="cs-abc"] .group:hover .group-hover\\:scale-105.cs-abc')
    expect(css).toContain('[data-code-section="cs-abc"] .space-y-4.cs-abc > :not([hidden]) ~ :not([hidden])')
    expect(css).toMatch(/@media \(min-width: 768px\) \{\[data-code-section="cs-abc"\] \.md\\:flex\.cs-abc \{/)
    expect(css).toMatch(/@supports \(display:grid\) \{\[data-code-section="cs-abc"\] \.supports-\\\[display\\:grid\\\]\\:grid\.cs-abc \{/)
    expect(css).not.toContain('bogus')
    for (const rule of css.slice(CSS_FORMAT.length).replace(/@keyframes[^{]+\{([^{}]*\{[^{}]*\})*\}/g, '').match(/(^|\})[^{}@]+\{/g) ?? [])
      expect(rule.replace(/^\}/, '')).toMatch(/^\[data-code-section="cs-abc"\] .*\.cs-abc/)
    // A card's doubled scope still leads, and its id is its mark.
    expect(await compileSectionCss(['flex'], cardScope('cs-card'))).toContain('[data-site-card="cs-card"][data-site-card="cs-card"] .flex.cs-card')
  })

  it("marks the compound holding each rule's own class, in every selector shape", async () => {
    const { markSelector } = await import('@/lib/site/code/css')
    const cases: [string, string][] = [
      ['.flex', '.flex.cs-1'],
      ['.group:hover .group-hover\\:x', '.group:hover .group-hover\\:x.cs-1'],
      ['.placeholder\\:x::placeholder', '.placeholder\\:x.cs-1::placeholder'],
      ['.space-x-4 > :not([hidden]) ~ :not([hidden])', '.space-x-4.cs-1 > :not([hidden]) ~ :not([hidden])'],
      ['.\\[\\&\\>\\*\\]\\:p-4 > *', '.\\[\\&\\>\\*\\]\\:p-4.cs-1 > *'],
      ['.dark\\:bg-black:is(.dark *)', '.dark\\:bg-black.cs-1:is(.dark *)'],
      [':is(.dark .dark\\:bg-black)', ':is(.dark .dark\\:bg-black.cs-1)'],
      ['.dark .\\[\\.dark_\\&\\]\\:block', '.dark .\\[\\.dark_\\&\\]\\:block.cs-1'],
      ['.marker\\:x *::marker', '.marker\\:x.cs-1 *::marker'],
      ['.\\[\\&_\\&\\]\\:p-1 .\\[\\&_\\&\\]\\:p-1', '.\\[\\&_\\&\\]\\:p-1.cs-1 .\\[\\&_\\&\\]\\:p-1.cs-1'],
      // Format 2's shared mark, or this one, is replaced.
      ['.hover\\:x.cs-own:hover', '.hover\\:x.cs-1:hover'],
      ['.flex.cs-1', '.flex.cs-1'],
      ['to', 'to'],
    ]
    for (const [from, to] of cases) expect(markSelector(from, 'cs-1'), from).toBe(to)
  })

  const selectors = (css: string) => {
    const out: string[] = []
    postcss.parse(css).walkRules(r => {
      out.push(...r.selectors)
    })
    return out
  }
  const draw = async (section: CompiledSection) =>
    renderToStaticMarkup(createElement('div', null, await resolve(await CodeSection({ section, data: sampleSiteData(catalog), page: 'home' }))))

  it("leaves the parts' own markup to the app stylesheet: a lg:hidden menu button is not the section's to show", async () => {
    const { compileSectionCss, CSS_FORMAT } = await import('@/lib/site/code/css')
    const css = await compileSectionCss(['flex', 'hidden', 'items-center', 'md:flex'], 'cs-hdr')
    const root = document.createElement('div')
    root.setAttribute('data-code-section', 'cs-hdr')
    root.innerHTML = '<button class="lg:hidden flex"></button><div class="hidden lg:block"></div><div class="flex items-center cs-hdr"></div>'
    document.body.append(root)
    const [button, links, own] = [...root.children]
    for (const s of selectors(css)) {
      expect(button.matches(s), s).toBe(false)
      expect(links.matches(s), s).toBe(false)
    }
    expect(selectors(css).some(s => own.matches(s))).toBe(true)
    // The CSS from before reached them, and its `.flex` beat the app's `lg:hidden`.
    expect(selectors(css.slice(CSS_FORMAT.length).replaceAll('.cs-hdr', '')).some(s => button.matches(s))).toBe(true)
    root.remove()
  })

  it("keeps an outer section's rules off a section drawn inside it", async () => {
    const { compileSectionCss } = await import('@/lib/site/code/css')
    const section = async (id: string, cls: string) =>
      ({ id, ast: { t: 'el', tag: 'div', props: { className: { k: 'lit', v: cls } }, children: [] }, classes: cls.split(' '), css: await compileSectionCss(cls.split(' '), id), components: [] }) as unknown as CompiledSection
    const outer = await section('cs-0a0a0a0a', 'flex')
    const inner = await section('cs-1b1b1b1b', 'flex md:block')
    const root = document.createElement('div')
    root.innerHTML = await draw(outer)
    root.querySelector('.flex')!.innerHTML = await draw(inner)
    document.body.append(root)
    const nested = root.querySelector('[data-code-section="cs-1b1b1b1b"] .flex')!
    expect(nested.className).toBe('flex md:block cs-1b1b1b1b')
    // Only the inner section's own `.flex` and `md:block` rules reach it, so its md:block wins from md up.
    expect(selectors(outer.css).filter(s => nested.matches(s))).toEqual([])
    expect(selectors(inner.css).filter(s => nested.matches(s))).toHaveLength(2)
    root.remove()
  })

  it('upgrades CSS saved in an earlier format at render, and draws the section with it', async () => {
    const { compileSectionCss, currentCss, CSS_FORMAT } = await import('@/lib/site/code/css')
    const id = 'cs-0ld0ld00'
    const fresh = await compileSectionCss(['text-4xl', 'md:text-6xl', 'hover:underline', 'space-y-4', 'animate-spin'], id)
    const old = fresh.slice(CSS_FORMAT.length).replaceAll(`.${id}`, '')
    const shared = `/*cs:2*/${fresh.slice(CSS_FORMAT.length).replaceAll(`.${id}`, '.cs-own')}`
    expect(currentCss(old, id)).toBe(fresh)
    expect(currentCss(shared, id)).toBe(fresh)
    expect(currentCss(fresh, id)).toBe(fresh)
    expect(currentCss(undefined)).toBe('')
    const section = {
      id,
      ast: { t: 'el', tag: 'h1', props: { className: { k: 'lit', v: 'text-4xl md:text-6xl' } }, children: [{ t: 'text', value: 'Hi' }] },
      classes: ['md:text-6xl', 'text-4xl'],
      css: old,
      components: [],
    } as unknown as CompiledSection
    const out = await draw(section)
    expect(out).toContain(`[data-code-section="${id}"] .text-4xl.${id}`)
    expect(out).toContain(`<h1 class="text-4xl md:text-6xl ${id}">Hi</h1>`)
  })

  it('supports .map over literal lists, destructured parameters, Store and conditionals', async () => {
    const src = wrap(`<footer className="py-8">
      <ul className="flex gap-4">{LINKS.map((l, i) => <li key={i} className={i === 0 ? 'font-bold' : ''}><a href={l.href}>{l.label}</a></li>)}</ul>
      <Store>{({ name, year }) => <p>© {year} {name}</p>}</Store>
    </footer>`, "const LINKS = [{ label: 'Shop', href: '/products' }, { label: 'Story', href: '/about' }]")
    const r = check(src)
    if (!r.ok) throw new Error(JSON.stringify(r.issues))
    const out = await html(r.ast)
    expect(out).toContain('<li class="font-bold cs-test"><a href="/products">Shop</a></li>')
    expect(out).toContain(`© ${new Date().getFullYear()} Loom &amp; Thread`)
  })

  it('reports syntax errors with the line', () => {
    const [i] = issuesOf('export default function S() {\n  return (\n    <div>\n  )\n}')
    expect(i.message).toMatch(/Syntax error/)
    expect(i.line).toBeGreaterThan(1)
  })

  it('describes the library for a page', () => {
    const text = describeLibrary('home')
    expect(text).toMatch(/<Products>/)
    expect(text).toMatch(/item fields: id/)
    expect(text).not.toMatch(/<PaymentStep>/)
    expect(describeLibrary('checkout')).toMatch(/<PaymentStep> REQUIRED on this page/)
    expect(codeLibrary().get('Image')).toBeTruthy()
  })
})

describe('code sections: the validator rejects', () => {
  it('event handlers, refs, style and dangerouslySetInnerHTML', () => {
    const [i] = rejects(wrap('<div onClick={() => 1}>x</div>'), /Event handlers \(onClick\)/)
    expect(i.line).toBe(4)
    rejects(wrap('<div onclick="alert(1)">x</div>'), /Event handlers/)
    rejects(wrap('<div ref={x}>x</div>'), /refs/)
    rejects(wrap('<div style={{ color: "red" }}>x</div>'), /style isn't allowed/)
    rejects(wrap('<div dangerouslySetInnerHTML={{ __html: "<img src=x onerror=alert(1)>" }} />'), /dangerouslySetInnerHTML/)
    rejects(wrap('<Link href="/x" onMouseEnter={() => 1}>x</Link>'), /Event handlers/)
  })

  it('script, iframe, object, form, style and unknown tags', () => {
    rejects(wrap('<script>alert(1)</script>'), /<script> isn't allowed/)
    rejects(wrap('<div><iframe src="https://evil.example" /></div>'), /<iframe> isn't allowed/)
    rejects(wrap('<object data="x" />'), /<object>/)
    rejects(wrap('<form action="/x"><input /></form>'), /<form>/)
    rejects(wrap('<style>{"body{display:none}"}</style>'), /<style>/)
    rejects(wrap('<svg><foreignObject /></svg>'), /SVG/)
    rejects(wrap('<marquee>x</marquee>'), /isn't an allowed tag/)
    rejects(wrap('<button>Buy</button>'), /<button> isn't allowed/)
  })

  it('javascript:, data: and other unsafe URLs', () => {
    rejects(wrap('<a href="javascript:alert(1)">x</a>'), /href="javascript:alert\(1\)" isn't allowed/)
    rejects(wrap('<a href="  JaVaScRiPt:alert(1)">x</a>'), /isn't allowed/)
    rejects(wrap('<a href="//evil.example/x">x</a>'), /isn't allowed/)
    rejects(wrap('<a href="http://insecure.example">x</a>'), /isn't allowed/)
    rejects(wrap('<img src="data:image/svg+xml;base64,PHN2Zz4=" alt="" />'), /src="data:/)
    rejects(wrap('<Image src="data:image/png;base64,AAAA" />'), /src="data:/)
    rejects(wrap('<Products>{p => <a href={`javascript:${p.slug}`}>x</a>}</Products>'), /href must start with https:\/\/ or a \/ path/)
    rejects(wrap('<Link href="vbscript:x">x</Link>'), /isn't allowed/)
    expect(safeHref('https://example.com/a?b=1')).toBeTruthy()
    expect(safeHref('https://example.com@evil.com')).toBeNull()
    expect(safeHref('java\tscript:alert(1)')).toBeNull()
    expect(safeSrc('blob:https://x/1')).toBeNull()
    expect(safeHref('mailto:hi@shop.in')).toBeTruthy()
  })

  it('unknown identifiers, globals and prototype access', () => {
    rejects(wrap('<p>{window.location.href}</p>'), /Unknown name "window"/)
    rejects(wrap('<p>{secret}</p>'), /Unknown name "secret"/)
    rejects(wrap('<Products>{p => <p>{p.constructor}</p>}</Products>'), /"constructor" can't be accessed/)
    rejects(wrap('<Products>{p => <p>{p.name.__proto__}</p>}</Products>'), /"__proto__" can't be accessed/)
    rejects(wrap('<Products>{p => <p>{p.password}</p>}</Products>'), /has no field "password"/)
    rejects(wrap('<Products>{p => <p>{p[key]}</p>}</Products>'), /Computed access/)
    rejects(wrap('<p>{this.props}</p>'), /this/)
  })

  it('function calls other than a render function or LIST.map', () => {
    rejects(wrap('<p>{alert(1)}</p>'), /Function calls aren't allowed/)
    rejects(wrap('<Products>{p => <p>{p.price.value.toFixed(2)}</p>}</Products>'), /\.toFixed\(\) aren't allowed/)
    rejects(wrap('<p>{new Date().getFullYear()}</p>'), /Date isn't available/)
    rejects(wrap('<p>{fetch("https://evil.example")}</p>'), /fetch isn't available/)
    rejects(wrap('<p>{new Function("return 1")()}</p>'), /new|Function/)
    rejects(wrap('<p>{eval("1")}</p>'), /eval isn't available/)
    rejects(wrap('<p>{(() => 1)()}</p>'), /Function calls aren't allowed/)
    rejects(wrap('<Image src={() => "x"} />'), /Functions are only allowed/)
    rejects(wrap('<p>{`${alert(1)}`}</p>'), /Function calls/)
    rejects(wrap('<Image alt={String(1)} />'), /String isn't available/)
  })

  it('spreads, imports and extra code', () => {
    rejects(wrap('<div {...props}>x</div>'), /Spread props/)
    rejects(wrap('<Products query={{ ...q }} />'), /Spreads/)
    rejects(wrap('<div>{...items}</div>'), /Spread children|spread/i)
    rejects(wrap('<div>x</div>', "import fs from 'fs'"), /Only import from '@site\/ui'/)
    rejects(wrap('<div>x</div>', "import { Products as P } from '@site/ui'"), /own names/)
    rejects(wrap('<div>x</div>', "import { Nope } from '@site/ui'"), /has no component Nope/)
    rejects(wrap('<div>x</div>', 'let x = 1'), /Use const/)
    rejects(wrap('<div>x</div>', 'const x = window'), /Unknown name "window"/)
    rejects(wrap('<div>x</div>', 'fetch("x")'), /top level/)
    rejects(wrap('<Card />', 'function Card() { return <div /> }'), /helper components|Unknown component <Card>/)
    rejects(wrap('<div>x</div>', 'export const x = () => 1'), /helper components/)
    rejects(`export default async function S() { return <div /> }`, /plain function/)
    rejects(`export default function S(props) { return <div>{props.x}</div> }`, /takes no props|Unknown name/)
    rejects(`export default function S() { const r = fetch('x'); return <div /> }`, /isn't available|Function calls/)
    expect(check(wrap('<div>x</div>', "import React from 'react'\nimport type { FC } from 'react'")).ok).toBe(true)
  })

  it('class names that fetch or are built from pieces', () => {
    rejects(wrap('<div className="bg-[url(https://evil.example/t.png)]">x</div>'), /class .* isn't allowed/)
    rejects(wrap('<Products>{p => <div className={`text-${p.slug}`}>x</div>}</Products>'), /from pieces/)
    rejects(wrap('<Products>{p => <div className={p.badge}>x</div>}</Products>'), /className takes class names written out/)
  })

  it('caps: source size, element count and depth', () => {
    rejects(wrap(`<p>${'x'.repeat(31 * 1024)}</p>`), /over 30 KB/)
    rejects(wrap(`<div>${'<span>a</span>'.repeat(401)}</div>`), /Too many JSX elements/)
    rejects(wrap(`${'<div>'.repeat(22)}x${'</div>'.repeat(22)}`), /Nested too deep/)
  })

  it('components off their page, unknown props and bad literal props', () => {
    rejects(wrap('<AddToCart />'), /can't be used on the home page/)
    rejects(wrap('<Products colour="red" />'), /has no prop "colour"/)
    rejects(wrap('<Products limit={500} />'), /<Products> limit/)
    rejects(wrap('<Icon name="skull-and-bones" />'), /<Icon> name/)
    rejects(wrap('<><Store>{s => <p>{s.name}</p>}</Store><Image>{x => <p />}</Image></>'), /doesn't take a render function/)
    rejects(wrap('<Carousel><Products /></Carousel>'), /layout="carousel"/)
  })

  it('PaymentStep: once, unconditional, and required on checkout', async () => {
    expect(check(wrap('<main><PaymentStep /></main>'), 'checkout').ok).toBe(true)
    rejects(wrap('<main><PaymentStep /><PaymentStep /></main>'), /exactly once \(found 2\)/, 'checkout')
    rejects(wrap('<main>{false && <PaymentStep />}</main>'), /can't be inside a condition/, 'checkout')
    rejects(wrap('<Products>{p => <PaymentStep />}</Products>'), /can't be inside/, 'checkout')
    rejects(wrap('<PaymentStep />'), /can't be used on the home page/)

    const block = (id: string, source: string) => ({ id, type: 'code_section', v: 1, props: { label: id, source, compiled: null } })
    const doc = (blocks: ReturnType<typeof block>[], extra: Record<string, unknown> = {}) =>
      ({ schemaVersion: 1, blocks: { ...Object.fromEntries(blocks.map(b => [b.id, b])), ...extra }, order: blocks.map(b => b.id) }) as unknown as PageDoc
    await expect(recompileCodeSections(doc([block('a', wrap('<div>Hello</div>'))]), { page: 'checkout' })).rejects.toThrow(/needs <PaymentStep \/>/)
    await expect(
      recompileCodeSections(doc([block('a', wrap('<div><PaymentStep /></div>')), block('b', wrap('<div><PaymentStep /></div>'))]), { page: 'checkout' })
    ).rejects.toThrow(/exactly once on the page \(found 2\)/)
    const ok = await recompileCodeSections(doc([block('a', wrap('<div>Hello</div>')), block('b', wrap('<div><PaymentStep /></div>'))]), { page: 'checkout' })
    expect((ok.blocks.b.props.compiled as CompiledSection).components).toEqual(['PaymentStep'])
    // With the page's own checkout block, a second payment step is refused.
    const core = { c: { id: 'c', type: 'checkout_main', v: 1, props: {} } }
    expect(checkPageParts({ ...ok, blocks: { ...ok.blocks, ...core } }, 'checkout', 'checkout_main').map(i => i.message).join()).toMatch(/already has the payment step/)
  })
})

describe('code sections: saving recompiles', () => {
  it('replaces a tampered compiled AST and reports bad sources per block', async () => {
    const evil = { id: 'cs-evil', ast: { t: 'el', tag: 'script', props: {}, children: [{ t: 'text', value: 'alert(1)' }] }, classes: [], css: '</style><script>alert(1)</script>', components: [] }
    const doc = { schemaVersion: 1, blocks: { a: { id: 'a', type: 'code_section', v: 1, props: { label: 'Hero', source: wrap('<h1 className="text-4xl">Hi</h1>'), compiled: evil } } }, order: ['a'] }
    const out = await recompileCodeSections(doc, { page: 'home' })
    const c = out.blocks.a.props.compiled as CompiledSection
    expect(c.ast).toMatchObject({ t: 'el', tag: 'h1' })
    expect(c.css).toContain('.text-4xl')
    expect(c.css).not.toContain('<')

    const bad = { ...doc, blocks: { a: { ...doc.blocks.a, props: { label: 'Hero', source: wrap('<div onClick={x}>Hi</div>'), compiled: null } } } }
    const err = await recompileCodeSections(bad, { page: 'home' }).catch(e => e)
    expect(err).toBeInstanceOf(CodeSectionInvalid)
    expect(err.issues[0]).toMatchObject({ blockId: 'a' })
    expect(err.issues[0].message).toMatch(/^Hero: line 4: Event handlers/)
  })

  it('registers code_section on the engaging and working pages only', () => {
    const def = siteRegistry.get('code_section')!
    expect(def.pages).toEqual(expect.arrayContaining(['home', 'product', 'cart', 'checkout', 'header', 'footer', 'catalog', 'quotes', 'account', 'login', 'not_found']))
    expect(def.pages).not.toContain('custom')
    expect(def.pages).not.toContain('orders')
    expect(def.props.safeParse({}).success).toBe(true)
  })
})

describe('code sections: the interpreter re-checks the AST', () => {
  const lit = (v: unknown) => ({ k: 'lit', v }) as never
  it('skips disallowed tags and components, drops unsafe attributes and URLs', async () => {
    const ast = {
      t: 'el', tag: 'div', props: { className: lit('box'), onClick: lit('alert(1)'), style: lit('color:red'), dangerouslySetInnerHTML: lit({ __html: '<b>x</b>' }) },
      children: [
        { t: 'el', tag: 'script', props: {}, children: [{ t: 'text', value: 'alert(1)' }] },
        { t: 'el', tag: 'iframe', props: { src: lit('https://evil.example') }, children: [] },
        { t: 'el', tag: 'a', props: { href: lit('javascript:alert(1)'), target: lit('_top') }, children: [{ t: 'text', value: 'bad link' }] },
        { t: 'el', tag: 'a', props: { href: lit('https://ok.example'), target: lit('_blank') }, children: [{ t: 'text', value: 'ok' }] },
        { t: 'el', tag: 'img', props: { src: lit('data:image/png;base64,AAAA'), alt: lit('x') }, children: [] },
        { t: 'cmp', name: 'Evil', props: {}, children: [] },
        { t: 'cmp', name: 'PaymentStep', props: {}, children: [] },
        { t: 'expr', value: { k: 'path', root: 'nobody', path: ['x'] } },
      ],
    } as unknown as CodeNode
    const out = await html(ast)
    expect(out).toBe('<div><div class="box cs-test"><a>bad link</a><a href="https://ok.example" target="_blank" rel="noopener noreferrer">ok</a></div></div>')
    // PaymentStep renders on checkout only.
    expect(await html({ t: 'cmp', name: 'PaymentStep', props: {}, children: [] }, 'checkout')).toContain('data-pay')
  })

  it('never reads prototypes or functions, and caps lists', () => {
    const vars = new Map<string, unknown>([['p', { name: 'x', fn: () => 1 }]])
    expect(evalValue({ k: 'path', root: 'p', path: ['constructor'] }, vars)).toBeUndefined()
    expect(evalValue({ k: 'path', root: 'p', path: ['__proto__'] }, vars)).toBeUndefined()
    expect(evalValue({ k: 'path', root: 'p', path: ['toString'] }, vars)).toBeUndefined()
    expect(evalValue({ k: 'path', root: 'p', path: ['fn'] }, vars)).toBeUndefined()
    const many = { t: 'each', items: lit(Array.from({ length: 500 }, (_, i) => i)), param: 'n', body: { t: 'el', tag: 'i', props: {}, children: [] } } as unknown as CodeNode
    expect(renderToStaticMarkup(createElement('div', null, renderNode(many, makeEnv({ data: sampleSiteData(catalog), sectionId: 'x' })))).match(/<i>/g)).toHaveLength(60)
  })

  it('makes stored CSS inert', () => {
    const css = inertCss('a{b:c}</style><script>alert(1)</script>@import url(https://x);.x{background:url(https://evil)}')
    expect(css).not.toContain('<')
    expect(css).not.toMatch(/@import|url\(/i)
  })
})
