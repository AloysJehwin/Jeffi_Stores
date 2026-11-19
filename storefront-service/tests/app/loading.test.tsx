import { describe, it, expect, vi } from 'vitest'
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('@/lib/site/code/parts/product', () => ({}))
vi.mock('@/lib/site/code/parts/listing', () => ({}))
vi.mock('@/lib/site/code/parts/cart', () => ({}))
vi.mock('@/lib/site/code/parts/checkout', () => ({}))
vi.mock('@/lib/site/code/parts/chrome', () => ({}))
vi.mock('@/lib/shared/db', () => ({ queryMany: vi.fn(async () => []), queryOne: vi.fn(async () => null), withTransaction: vi.fn() }))
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children?: ReactNode }) => createElement('a', { href, ...rest }, children) }))
const { loadSitePage } = vi.hoisted(() => ({ loadSitePage: vi.fn() }))
vi.mock('@/lib/site/page', () => ({ loadSitePage }))

import { checkSection } from '@/lib/site/code/compile'
import AboutLoading from '@storefront/app/(marketing)/about/loading'
import ProductLoading from '@storefront/app/(storefront)/products/[slug]/loading'

type B = { id: string; type: string; props: Record<string, unknown> }
const published = (blocks: B[]) => ({
  doc: { schemaVersion: 1, blocks: Object.fromEntries(blocks.map(b => [b.id, { ...b, v: 1 }])), order: blocks.map(b => b.id) },
  surface: 'web',
  selectable: false,
  title: null,
})
const html = async (loading: () => Promise<ReactNode>) => renderToStaticMarkup(createElement('div', null, await loading()))

describe('storefront loading screens', () => {
  it("draw the AI design's skeleton when the published page has one, else their own", async () => {
    const r = checkSection('export default function Section() { return <h2 className="text-3xl">Our story</h2> }', { page: 'about' })
    if (!r.ok) throw new Error(JSON.stringify(r.issues))
    const section: B = { id: 'a', type: 'code_section', props: { compiled: { id: r.id, ast: r.ast, classes: r.classes, css: '', components: [] } } }

    loadSitePage.mockResolvedValueOnce(published([section]))
    const studio = await html(AboutLoading)
    expect(loadSitePage).toHaveBeenCalledWith({ audience: 'store', page: 'about' })
    expect(studio).toContain(`data-code-section="${r.id}"`)
    expect(studio).not.toContain('Who We Are')

    // A page built from blocks, or none: the route's own skeleton.
    loadSitePage.mockResolvedValueOnce(published([{ id: 'b', type: 'rich_text', props: {} }]))
    expect(await html(AboutLoading)).toContain('Who We Are')
    loadSitePage.mockResolvedValueOnce(null)
    expect(await html(AboutLoading)).toContain('Who We Are')

    // A design that kept the page's own block shows the route's skeleton for it there.
    loadSitePage.mockResolvedValueOnce(published([section, { id: 'c', type: 'product_main', props: {} }]))
    const product = await html(ProductLoading)
    expect(product).toContain(`data-code-section="${r.id}"`)
    expect(product.indexOf('Product Description')).toBeGreaterThan(product.indexOf('data-code-section'))
  })
})
