import { describe, it, expect, vi } from 'vitest'
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

// The other parts' modules are built separately; these sections use the common parts.
vi.mock('@/lib/site/code/parts/product', () => ({}))
vi.mock('@/lib/site/code/parts/listing', () => ({}))
vi.mock('@/lib/site/code/parts/cart', () => ({}))
vi.mock('@/lib/site/code/parts/checkout', () => ({}))
vi.mock('@/lib/site/code/parts/chrome', () => ({}))
vi.mock('@/lib/shared/db', () => ({ queryMany: vi.fn(async () => []), queryOne: vi.fn(async () => null), withTransaction: vi.fn() }))
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children?: ReactNode }) => createElement('a', { href, ...rest }, children) }))

import { checkSection, compileSection, type CompiledSection } from '@/lib/site/code/compile'
import type { CodeNode } from '@/lib/site/code/ast'
import { codeSkeleton } from '@/lib/site/code/skeleton'
import CodeSectionSkeleton from '@/components/visitor/site/code/CodeSectionSkeleton'

const wrap = (jsx: string, before = '') => `${before}\nexport default function Section() {\n  return (\n    ${jsx}\n  )\n}\n`
function astOf(src: string): CodeNode {
  const r = checkSection(src, { page: 'home' })
  if (!r.ok) throw new Error(JSON.stringify(r.issues))
  return r.ast
}
const draw = (section: Partial<CompiledSection>) =>
  renderToStaticMarkup(createElement(CodeSectionSkeleton, { section: { id: 'cs-0000abcd', classes: [], css: '', components: [], ...section } as CompiledSection, page: 'home' }))
const count = (html: string, re: RegExp) => (html.match(re) ?? []).length
const BAR = /<span class="sk inline-block h-\[0\.7em\][^"]*"><\/span>/g

describe('code section skeletons', () => {
  it('keeps the layout and draws text as bars, pictures as blocks and buttons as pills', () => {
    const ast = astOf(`import { Image, Link, Icon } from '@site/ui'
export default function Section() {
  return (
    <section className="bg-surface py-16 md:py-28">
      <div className="mx-auto grid max-w-7xl gap-8 md:grid-cols-2">
        <div>
          <p className="text-xs uppercase tracking-widest">New season</p>
          <h1 className="mt-3 font-display text-5xl">Handwoven sarees from Kanchipuram</h1>
          <Link href="/products" className="mt-8 inline-flex rounded-full bg-primary-600 px-6 py-3 text-white hover:bg-primary-700">Shop now <Icon name="arrow-right" size="sm" /></Link>
          <a href="/about" className="ml-6 text-sm underline">Our story</a>
        </div>
        <Image src="https://cdn.example.com/a.jpg" alt="Saree" aspect="4:5" className="rounded-xl" />
      </div>
    </section>
  )
}`)
    const skeleton = codeSkeleton(ast)
    expect(JSON.stringify(skeleton)).not.toMatch(/"t":"cmp"|Handwoven|Our story|cdn\.example/)
    const html = draw({ ast, skeleton })
    expect(html).toMatch(/^<div data-code-section="cs-0000abcd" aria-hidden="true"><section class="bg-surface py-16 md:py-28[ "]/)
    expect(html).toMatch(/<div class="mx-auto grid max-w-7xl gap-8 md:grid-cols-2[ "]/)
    // Bars sit in the text's own element, sized in its font (capitals run wider); a long line wraps as words.
    expect(html).toMatch(/<p class="text-xs uppercase tracking-widest[^"]*"><span class="sk inline-block h-\[0\.7em\][^"]*w-\[12ch\]/)
    expect(html).toMatch(/<h1 class="mt-3 font-display text-5xl[^"]*"><span class="[^"]*w-\[18ch\][^"]*"><\/span> <span class="[^"]*w-\[10ch\][^"]*"><\/span><\/h1>/)
    // The button keeps its size and shape, loses its colours, and hides its label; a plain link is text.
    expect(html).toMatch(/<span class="mt-8 inline-flex rounded-full px-6 py-3 sk rounded-full bg-border-default text-transparent[^"]*">Shop now <span class="inline-block shrink-0 h-4 w-4[^"]*"><\/span><\/span>/)
    expect(html).toMatch(/<span class="ml-6 text-sm underline[^"]*"><span class="sk inline-block[^"]*w-\[8ch\]/)
    expect(html).toMatch(/<span class="rounded-xl sk block bg-border-default\/50 aspect-\[4\/5\] w-full[ "]/)
    expect(html).not.toMatch(/<a |<img|bg-primary|text-white/)
    expect(count(html, BAR)).toBe(4)
  })

  it('repeats a list item, unrolls literal lists and draws parts as their own skeleton', () => {
    const ast = astOf(
      wrap(
        `<section>
      <Products query={{ sort: 'new', limit: 6 }} aspect="1:1" className="grid grid-cols-2 gap-4 md:grid-cols-3" />
      <Categories limit={4} className="grid grid-cols-4 gap-2">{(c, i) => (
        <Link href={c.url} className={i === 0 ? 'col-span-2 block' : 'block'}>
          <Image src={c.image} aspect="1:1" />
          <span className="text-sm">{c.name}</span>
          {c.image ? <em>photo</em> : <b>none</b>}
        </Link>
      )}</Categories>
      <ul>{FEATURES.map(f => <li className="text-sm">{f}</li>)}</ul>
    </section>`,
        "const FEATURES = ['Free shipping', 'Handmade in India by weavers']"
      )
    )
    const html = draw({ ast })
    // Six product cards in the section's own grid, four categories through their render function.
    expect(html).toMatch(/<div class="grid grid-cols-2 gap-4 md:grid-cols-3[^"]*">(<div class="flex h-full flex-col[^"]*"><span class="sk block[^"]*aspect-square[^"]*"><\/span>(<span[^>]*><\/span>){3}<\/div>){6}<\/div>/)
    expect(count(html, /<span class="col-span-2 block[ "]/g)).toBe(1)
    expect(count(html, /<span class="block[ "]/g)).toBe(3)
    // A data test takes its present branch; a data value gets the field's usual length.
    expect(count(html, /<em[ >]/g)).toBe(4)
    expect(html).not.toContain('<b')
    expect(html).toMatch(/<span class="text-sm[^"]*"><span class="sk inline-block[^"]*w-\[16ch\]/)
    // Literal items keep their own lengths.
    expect(html).toMatch(/<li class="text-sm[^"]*"><span class="[^"]*w-\[12ch\][^"]*"><\/span><\/li><li class="text-sm[^"]*"><span class="[^"]*w-\[24ch\]/)

    const nav = draw({ id: 'cs-0000beef', ast: { t: 'cmp', name: 'NavLinks', props: { className: { k: 'lit', v: 'flex gap-6' } }, children: [] } })
    expect(nav).toMatch(/^<div data-code-section="cs-0000beef" aria-hidden="true"><div class="flex gap-6[^"]*">(<span class="sk inline-block[^"]*w-\[8ch\][^"]*"><\/span>){5}<\/div><\/div>$/)
  })

  it('stores the skeleton when a section compiles, and derives one for a section saved before', async () => {
    const source = wrap('<h2 className="text-3xl">Our story</h2>')
    const r = await compileSection(source, { page: 'home' })
    if (!r.ok) throw new Error(JSON.stringify(r.issues))
    expect(r.section.skeleton).toEqual(codeSkeleton(r.section.ast))
    expect(r.section.skeleton).toMatchObject({ t: 'el', tag: 'h2', children: [{ t: 'el', tag: 'span' }] })

    const { skeleton: _stored, ...older } = r.section
    const html = draw(older)
    expect(html).toContain(`<style>${r.section.css}</style>`)
    expect(html).toMatch(/<h2 class="text-3xl[^"]*"><span class="sk inline-block[^"]*"><\/span><\/h2>/)
    expect(html).toBe(draw(r.section))
  })
})
