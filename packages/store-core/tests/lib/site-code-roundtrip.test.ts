import { describe, it, expect, vi } from 'vitest'
import { Fragment, createElement, isValidElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

// code_section v2: the visual editor's tree (ids mode), the printer, and the save path. The property under test: for
// every ready-made theme section and a set of representative hand-written ones, compile → print → compile gives the
// same tree, and the printed section renders exactly as the original through the interpreter.

vi.mock('@/lib/shared/db', () => ({ queryMany: vi.fn(async () => []), queryOne: vi.fn(async () => null), query: vi.fn(), withTransaction: vi.fn() }))
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children?: ReactNode }) => createElement('a', { href, ...rest }, children) }))

import type { CodeNode, PageDoc, PageKey } from '@jeffi/site-blocks'
import { SHOWCASE_TEMPLATES, STORE_TEMPLATES } from '@/lib/site/themes/templates/index'
import { studioPageOf } from '@/lib/site/studio/showcase'
import { GENERIC_SAMPLE } from '@/lib/site/themes/sample'
import { canvasCodeSections, checkSection, compileCodeProps, compileSection, recompileCodeSections, sectionTree, upgradeCodeProps, type CompiledSection } from '@/lib/site/code/compile'
import { stripTree } from '@/lib/site/code/ids'
import { PrintError, printSection } from '@/lib/site/code/print'
import CodeSection from '@/components/visitor/site/code/CodeSection'
import { makeEnv, renderNode, Resolve } from '@/components/visitor/site/code/interpret'
import { sampleSiteData } from '@/lib/site/data'

type Template = { pages: Record<string, { sections: { label: string; source: string }[] }> }
type Case = { name: string; page: PageKey; source: string }

const TEMPLATE_CASES: Case[] = []
for (const [style, file] of [
  ...Object.entries(STORE_TEMPLATES as Record<string, Template>),
  ...Object.entries(SHOWCASE_TEMPLATES as Record<string, Template>).map(([k, v]) => [`showcase-${k}`, v] as const),
])
  for (const [key, page] of Object.entries(file.pages ?? {})) {
    const at = (key === 'showcase:home' ? 'showcase' : studioPageOf(key)) as PageKey | null
    if (at) page.sections.forEach((s, i) => TEMPLATE_CASES.push({ name: `${style} ${key} #${i} (${s.label})`, page: at, source: s.source }))
  }

const wrap = (jsx: string, before = '') => `${before}\nexport default function Section() {\n  return (\n    ${jsx}\n  )\n}\n`

// What stored sections are made of, written the ways the AI writes them.
const REPRESENTATIVE: Case[] = [
  {
    name: 'consts and a .map over a literal list, with index and conditions',
    page: 'home',
    source: wrap(
      `<section className="py-12">
      <h2 className="text-3xl font-display">{TITLE}</h2>
      <ul className="grid gap-4 md:grid-cols-3">
        {FEATURES.map((f, i) => (
          <li key={f.title} className={i === 0 ? 'col-span-2 bg-primary-50' : 'bg-surface'}>
            <h3 className="font-bold">{f.title}</h3>
            {f.note && <p className="text-sm text-foreground-muted">{f.note}</p>}
            <p>{f.count} items · {i + 1}</p>
          </li>
        ))}
      </ul>
    </section>`,
      `const TITLE = 'Why shop with us'\nconst FEATURES = [{ title: 'Fast delivery', note: 'Two days', count: 12 }, { title: 'Easy returns', count: 3 }, { title: "Shop 'n' save", note: '{curly} <b>' }]`
    ),
  },
  {
    name: 'render functions, destructuring, templates and fallbacks',
    page: 'home',
    source: wrap(
      `<section className="container mx-auto">
      <Products query={{ sort: 'new', limit: 4 }} className="grid grid-cols-2 gap-4">
        {({ name, price, url }) => (
          <Link href={url} className="block">
            <span className={\`font-bold \${price ? 'text-primary-600' : 'text-foreground'}\`}>{name}</span>
            {' '}
            <span>{price.formatted || 'Ask us'}</span>
          </Link>
        )}
      </Products>
      <Store>{s => <p title={\`\${s.name} – since \${s.year}\`}>&copy; {s.year} {s.name}. All rights reserved.</p>}</Store>
    </section>`,
      `import { Products, Link, Store } from '@site/ui'`
    ),
  },
  {
    name: 'nested lists, a bound list, whitespace and entities',
    page: 'home',
    source: wrap(
      `<div className="space-y-2">
      {GROUPS.map(g => (
        <div key={g.name}>
          <b>{g.name}</b>  <i>tags:</i>
          {g.tags.map(t => <span className="mr-1">{t}</span>)}
        </div>
      ))}
      <Categories className="flex gap-2">{c => <a href={c.url}>{c.name} ({c.slug})</a>}</Categories>
      <p>
        Line one
        line two &amp; more
      </p>
      <img src="https://cdn.example.com/a.jpg" alt="" width={640} />
    </div>`,
      `const GROUPS = [{ name: 'Sarees', tags: ['silk', 'cotton'] }, { name: 'Kurtas', tags: [] }]`
    ),
  },
  {
    name: 'the site card',
    page: 'card',
    source: `export default function Card({ p }) {\n  return (\n    <article className="group">\n      <Link href={p.url}><Image src={p.image} alt={p.name} className="aspect-square" /></Link>\n      <p className={p.inStock ? 'text-foreground' : 'line-through'}>{p.name}</p>\n      <PriceTag product={p} />\n    </article>\n  )\n}\n`,
  },
  {
    name: 'data-e ids kept, a duplicate replaced',
    page: 'home',
    source: wrap(`<section data-e="hero" className="py-8"><h1 data-e="title">Hello</h1><p data-e="title">Copy</p><p>New</p></section>`),
  },
]

const canon = (v: unknown): string =>
  JSON.stringify(v ?? null, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(k => [k, x[k]])) : x))

function treeOf(c: Case) {
  const r = checkSection(c.source, { page: c.page, ids: true })
  if (!r.ok) throw new Error(`${c.name}: ${r.issues.map(i => i.message).join('; ')}`)
  return r
}

const data = sampleSiteData({ ...GENERIC_SAMPLE, store: { name: 'Test Store', tagline: 'A tagline' } })

const isAsync = (f: unknown) => typeof f === 'function' && f.constructor.name === 'AsyncFunction'
const nameOf = (t: unknown): string => {
  const x = t as { displayName?: string; name?: string; render?: { name?: string }; type?: unknown }
  return x.displayName || x.name || x.render?.name || (x.type ? nameOf(x.type) : '?')
}

/**
 * What the interpreter draws, as data: server parts (async components, Resolve) awaited, fragments flattened, client
 * components kept as leaves with their props (they draw the same for the same props, and need the app around them).
 */
async function drawn(node: unknown, depth = 0): Promise<unknown> {
  if (depth > 400) return '…'
  if (node == null || typeof node === 'boolean') return null
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (typeof node === 'function') return '[fn]'
  if (Array.isArray(node)) {
    const out: unknown[] = []
    for (const x of (await Promise.all(node.map(n => drawn(n, depth + 1)))).flat(Infinity)) {
      if (x == null || x === '') continue
      if (typeof x === 'string' && typeof out[out.length - 1] === 'string') out[out.length - 1] += x
      else out.push(x)
    }
    return out
  }
  if (typeof (node as Promise<unknown>).then === 'function') return drawn(await node, depth + 1)
  if (!isValidElement(node)) {
    if (typeof node !== 'object') return String(node)
    return Object.fromEntries(await Promise.all(Object.entries(node as object).map(async ([k, v]) => [k, await drawn(v, depth + 1)] as const)))
  }
  const { children, ...props } = node.props as { children?: ReactNode }
  if (node.type === Fragment) return drawn([children], depth + 1)
  if (node.type === Resolve) return drawn([await (props as { promise: Promise<ReactNode> }).promise], depth + 1)
  if (isAsync(node.type)) return drawn([await (node.type as (p: unknown) => Promise<ReactNode>)(node.props)], depth + 1)
  return { type: typeof node.type === 'string' ? node.type : nameOf(node.type), props: await drawn(props, depth + 1), children: await drawn([children], depth + 1) }
}

/** The section drawn as a page draws it (CodeSection: empty data, links, a Showcase's stand-ins), under one scope id. */
async function draw(ast: CodeNode, page: PageKey, preview = false): Promise<string> {
  const section = { id: 'cs-test', ast, css: '', classes: [], components: [] } as CompiledSection
  return JSON.stringify(await drawn(await CodeSection({ section, page, data, always: true, preview })))
}

/** Plain markup, for sections whose parts need no app around them. */
const html = (ast: CodeNode, preview: boolean) => renderToStaticMarkup(createElement('div', null, renderNode(ast, makeEnv({ data, page: 'home', sectionId: 'cs-test', preview }))))

describe('code_section v2: every theme template round-trips', () => {
  it('has templates to check', () => expect(TEMPLATE_CASES.length).toBeGreaterThan(200))

  it('compile → print → compile gives the same tree, and printing again the same source', () => {
    const failed: string[] = []
    for (const c of TEMPLATE_CASES) {
      const first = treeOf(c)
      const printed = printSection(first.tree!, { card: c.page === 'card' })
      const again = checkSection(printed, { page: c.page, ids: true })
      if (!again.ok || canon(again.tree) !== canon(first.tree) || printSection(again.tree!, { card: c.page === 'card' }) !== printed) failed.push(c.name)
    }
    expect(failed).toEqual([])
  })

  it('saves every template as v2: the printed source fits and compiles to the stored tree', () => {
    const failed: string[] = []
    for (const c of TEMPLATE_CASES) {
      const t = sectionTree(c.source, c.page)
      if (!t?.ok) failed.push(c.name)
      // The rendered AST is the printed source's plain compile: the tree without what only the editor reads.
      else expect(canon(t.check.ast)).toBe(canon(stripTree(t.tree)))
    }
    expect(failed).toEqual([])
  })

  it('renders the printed section exactly as the original', async () => {
    const failed: string[] = []
    for (const c of TEMPLATE_CASES) {
      const before = checkSection(c.source, { page: c.page })
      const t = sectionTree(c.source, c.page)
      if (!before.ok || !t?.ok) {
        failed.push(`${c.name}: no tree`)
        continue
      }
      const [a, b] = await Promise.all([draw(before.ast, c.page), draw(t.check.ast, c.page)])
      if (a !== b) failed.push(c.name)
    }
    expect(failed).toEqual([])
  }, 120_000)
})

describe('code_section v2: representative sections', () => {
  for (const c of REPRESENTATIVE)
    it(`${c.name}: round-trips and renders the same`, async () => {
      const first = treeOf(c)
      const printed = printSection(first.tree!, { card: c.page === 'card' })
      const again = checkSection(printed, { page: c.page, ids: true })
      expect(again.ok).toBe(true)
      expect(canon(again.ok && again.tree)).toBe(canon(first.tree))
      const t = sectionTree(c.source, c.page)
      expect(t?.ok).toBe(true)
      const before = checkSection(c.source, { page: c.page })
      if (!before.ok || !t?.ok) return
      expect(await draw(t.check.ast, c.page)).toBe(await draw(before.ast, c.page))
    })

  it('unrolls literal lists into explicit nodes and inlines consts', () => {
    const { tree } = treeOf(REPRESENTATIVE[0])
    const printed = printSection(tree!)
    expect(printed).not.toMatch(/\.map\(|FEATURES|TITLE/)
    expect(printed).toContain('Why shop with us')
    const items = JSON.stringify(tree).match(/"tag":"li"/g) ?? []
    expect(items).toHaveLength(3)
    // A className picked by the index is written out per item, so each card's classes are editable.
    expect(printed).toContain('className="col-span-2 bg-primary-50"')
    expect(printed).toContain('className="bg-surface"')
  })

  it('keeps bound lists and render functions, marks expression-built classes read-only', () => {
    const { tree } = treeOf(REPRESENTATIVE[1])
    const printed = printSection(tree!)
    expect(printed).toMatch(/<Products data-e="e\d+"/)
    expect(printed).toContain('($1) =>')
    const ro: string[] = []
    const visit = (n: CodeNode) => {
      if ((n.t === 'el' || n.t === 'cmp') && n.ro) ro.push(n.t === 'el' ? n.tag : n.name)
      if (n.t === 'el' || n.t === 'cmp' || n.t === 'frag') n.children.forEach(visit)
      if (n.t === 'cmp' && n.render) visit(n.render.body)
    }
    visit(tree!)
    expect(ro).toEqual(['span'])
  })

  it('gives every node an id: tags keep data-e, a copy gets a fresh one, others derive theirs', () => {
    const { tree } = treeOf(REPRESENTATIVE[4])
    const ids: string[] = []
    const visit = (n: CodeNode) => {
      ids.push(n.id!)
      if (n.t === 'el') n.children.forEach(visit)
    }
    visit(tree!)
    expect(ids).toEqual(['hero', 'title', 'title.0', 'e1', 'e1.0', 'e2', 'e2.0'])
  })

  it('marks parts the page needs as locked', () => {
    const r = checkSection(wrap('<div><ProductGallery /><AddToCart /></div>'), { page: 'product', ids: true })
    expect(r.ok).toBe(true)
    const kids = r.ok && r.tree!.t === 'el' ? r.tree!.children : []
    expect(kids.map(k => (k.t === 'cmp' ? [k.name, !!k.locked] : null))).toEqual([
      ['ProductGallery', false],
      ['AddToCart', true],
    ])
  })

  it('refuses to print what is not a tree', () => {
    expect(() => printSection({ t: 'text', value: 'x' })).toThrow(PrintError)
    expect(() => printSection({ t: 'el', tag: 'div onclick', props: {}, children: [] })).toThrow(PrintError)
    expect(() => printSection({ t: 'el', tag: 'div', props: { 'on click': { k: 'lit', v: 'x' } }, children: [] })).toThrow(PrintError)
    expect(() => printSection({ t: 'el', tag: 'div', props: {}, children: [{ t: 'expr', value: { k: 'path', root: 'a.b', path: [] } }] })).toThrow(PrintError)
  })
})

describe('code_section v2: load and save', () => {
  const page: PageKey = 'home'
  const source = REPRESENTATIVE[0].source

  it('upgrades a v1 section on load, keeping its compiled section until the next save', async () => {
    const v1 = await compileSection(source, { page })
    expect(v1.ok).toBe(true)
    const props = { label: 'Features', source, compiled: v1.ok ? v1.section : null }
    const up = upgradeCodeProps(props, page)
    expect(up.tree).toBeTruthy()
    expect(up.compiled).toBe(props.compiled)
    expect(up.source).toContain('data-e=')
    expect(upgradeCodeProps(up, page)).toBe(up)
  })

  it('saves a v1 section exactly as before', async () => {
    const r = await compileCodeProps({ label: 'x', source }, page)
    const plain = await compileSection(source, { page })
    expect(r.ok && plain.ok).toBe(true)
    if (!r.ok || !plain.ok) return
    expect(r.props.tree).toBeUndefined()
    expect(r.props.source).toBe(source)
    expect(canon(r.props.compiled)).toBe(canon(plain.section))
  })

  it('saves v2 as compileSection(print(tree)) with the compile’s own tree, never the browser’s', async () => {
    const up = upgradeCodeProps({ label: 'x', source, compiled: null }, page)
    const tampered = { ...up, tree: { t: 'el', tag: 'script', props: {}, children: [] } }
    const r = await compileCodeProps(tampered, page)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(canon(r.props.tree)).toBe(canon(up.tree))
    expect(r.props.source).toBe(up.source)
    expect((r.props.compiled as CompiledSection).ast).toEqual(stripTree(up.tree as CodeNode))
  })

  it('takes a source-level edit (literals, the AI) over a stale tree, keeping the ids it still carries', async () => {
    const up = upgradeCodeProps({ label: 'x', source, compiled: null }, page)
    const edited = { ...up, source: (up.source as string).replace('Why shop with us', 'Why us') }
    const r = await compileCodeProps(edited, page)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.props.source).toContain('Why us')
    const ids = (s: unknown) => [...JSON.stringify(s).matchAll(/"id":"(e\d+)"/g)].map(m => m[1])
    expect(ids(r.props.tree)).toEqual(ids(up.tree))
  })

  it('prints the tree when a v2 section comes without a source, and still compiles it', async () => {
    const up = upgradeCodeProps({ label: 'x', source, compiled: null }, page)
    const r = await compileCodeProps({ ...up, source: '' }, page)
    expect(r.ok && r.props.source).toBe(up.source)
    const bad = await compileCodeProps({ label: 'x', source: '', tree: { t: 'el', tag: 'script', props: {}, children: [] } }, page)
    expect(bad.ok).toBe(false)
  })

  it('recompiles a page of v1 and v2 sections, reporting bad ones per block', async () => {
    const up = upgradeCodeProps({ label: 'v2', source, compiled: null }, page)
    const doc = {
      schemaVersion: 1,
      order: ['a', 'b'],
      blocks: {
        a: { id: 'a', type: 'code_section', v: 1, props: { label: 'v1', source, compiled: null } },
        b: { id: 'b', type: 'code_section', v: 1, props: up },
      },
    }
    const next = await recompileCodeSections(doc, { page })
    expect(next.blocks.a.props.tree).toBeUndefined()
    expect(next.blocks.b.props.tree).toBeTruthy()
    await expect(recompileCodeSections({ ...doc, blocks: { b: { ...doc.blocks.b, props: { ...up, source: 'nope(' } } }, order: ['b'] }, { page })).rejects.toThrow(/v2/)
  })
})

describe('code_section v2: data-e only in the preview', () => {
  it('draws data-e with a preview token and never on a live page', async () => {
    const t = sectionTree(REPRESENTATIVE[0].source, 'home')
    expect(t?.ok).toBe(true)
    if (!t?.ok) return
    const live = html(t.check.ast, false)
    const preview = html(t.check.ast, true)
    expect(live).not.toContain('data-e')
    expect(preview).toMatch(/<section class="py-12 cs-test" data-e="e1">/)
    // Written-out words are marked editable in place (an unrolled card's too); data-bound ones are not.
    expect(preview).toMatch(/data-e="e\d+" data-e-text="">Why shop with us</)
    expect(preview).toMatch(/data-e="e\d+" data-e-text="">Fast delivery</)
    const env = makeEnv({ data, page: 'home', sectionId: 'cs-test', preview: true })
    env.vars.set('s', { name: 'Bound' })
    const bound: CodeNode = { t: 'el', tag: 'p', props: {}, children: [{ t: 'expr', value: { k: 'path', root: 's', path: ['name'] } }], id: 'e1' }
    expect(renderToStaticMarkup(createElement('div', null, renderNode(bound, env)))).toBe('<div><p data-e="e1">Bound</p></div>')
    expect(preview.replace(/ data-e(-text)?="[^"]*"/g, '')).toBe(live)
    // Through CodeSection, as pages draw it: only its preview prop turns them on.
    expect(await draw(t.check.ast, 'home')).not.toContain('data-e')
    expect(await draw(t.check.ast, 'home', true)).toContain('"data-e":"e1"')
  })

  it('draws a v1 section on the canvas with the ids the editor loads, in its stored styles', async () => {
    const source = REPRESENTATIVE[0].source
    const v1 = await compileSection(source, { page: 'home' })
    if (!v1.ok) throw new Error('compile')
    const props = { label: 'x', source, compiled: v1.section }
    const doc = { schemaVersion: 1, order: ['a'], blocks: { a: { id: 'a', type: 'code_section', v: 1, props } } } as unknown as PageDoc
    const canvas = canvasCodeSections(doc, 'home').blocks.a.props.compiled as CompiledSection
    expect([canvas.id, canvas.css]).toEqual([v1.section.id, v1.section.css])
    const ids = (n: unknown) => [...JSON.stringify(n).matchAll(/"id":"(e\d+)"/g)].map(m => m[1])
    expect(ids(canvas.ast)).toEqual(ids(stripTree(upgradeCodeProps(props, 'home').tree as CodeNode)))
    expect(await draw(canvas.ast, 'home')).toBe(await draw(v1.section.ast, 'home'))
  })
})
