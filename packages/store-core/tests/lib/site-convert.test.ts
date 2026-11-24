import { describe, it, expect, vi } from 'vitest'
import { Fragment, createElement, isValidElement, type ReactNode } from 'react'

// "Convert to editable section": each convertible block rewritten as a code section shows the same words, links and
// pictures as the block did (rendered both ways and compared), compiles as v2, and keeps the store's own details live.

vi.mock('@/lib/shared/db', () => ({ queryMany: vi.fn(async () => []), queryOne: vi.fn(async () => null), query: vi.fn(async () => ({ rows: [] })), withTransaction: vi.fn() }))
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children?: ReactNode }) => createElement('a', { href, ...rest }, children) }))
vi.mock('@/lib/catalog/site-controls', async orig => ({
  ...(await orig<object>()),
  getStoreIdentity: async () => ({ name: 'Chai Co', email: 'hello@chai.example', phone: '+91 98765 43210', logoUrl: '', whatsapp: '', socials: {} }),
  getStorefrontContent: async () => ({ businessHours: 'Mon–Sat: 10am–8pm\nSun: closed', metaTagline: '', aboutCopy: '' }),
  getFeatureFlags: async () => ({ gstEnabled: false }),
}))
vi.mock('@/lib/catalog/brand', async orig => ({ ...(await orig<object>()), storeAddressLine: async () => '12 MG Road, Chennai' }))

import type { Block } from '@jeffi/site-blocks'
import { ContentBlock } from '@/components/visitor/site/ContentBlocks'
import CodeSection from '@/components/visitor/site/code/CodeSection'
import { Resolve } from '@/components/visitor/site/code/interpret'
import { convertBlock, isConvertible } from '@/lib/site/convert'
import { dbSiteData } from '@/lib/site/data'
import type { CompiledSection } from '@/lib/site/code/compile'

const isAsync = (f: unknown) => typeof f === 'function' && f.constructor.name === 'AsyncFunction'
async function drawn(node: unknown, depth = 0): Promise<unknown> {
  if (depth > 300 || node == null || typeof node === 'boolean') return null
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return (await Promise.all(node.map(n => drawn(n, depth + 1)))).flat(Infinity).filter(x => x != null && x !== '')
  if (typeof (node as Promise<unknown>).then === 'function') return drawn(await node, depth + 1)
  if (!isValidElement(node)) return null
  const { children, ...props } = node.props as { children?: ReactNode }
  if (node.type === Fragment) return drawn([children], depth + 1)
  if (node.type === Resolve) return drawn([await (props as { promise: Promise<ReactNode> }).promise], depth + 1)
  if (isAsync(node.type)) return drawn([await (node.type as (p: unknown) => Promise<ReactNode>)(node.props)], depth + 1)
  // Server components render here too; a client one (its hooks need React) stays a leaf with its props.
  if (typeof node.type === 'function') {
    let out: ReactNode | undefined
    try {
      out = (node.type as (p: unknown) => ReactNode)(node.props)
    } catch {
      out = undefined
    }
    if (out !== undefined) return drawn([out], depth + 1)
  }
  return { type: typeof node.type === 'string' ? node.type : ((node.type as { name?: string }).name ?? '?'), props, children: await drawn([children], depth + 1) }
}

/** What a visitor sees: each run of words, every link and every picture. */
function seen(tree: unknown) {
  const words = new Set<string>()
  const links = new Set<string>()
  const pictures = new Set<string>()
  const walk = (n: unknown) => {
    if (typeof n === 'string') return void (n.replace(/\s+/g, ' ').trim() && words.add(n.replace(/\s+/g, ' ').trim()))
    if (Array.isArray(n)) return n.forEach(walk)
    if (!n || typeof n !== 'object') return
    const { type, props, children } = n as { type: string; props: Record<string, unknown>; children: unknown }
    if (typeof props?.href === 'string') links.add(props.href)
    if (type === 'img' && typeof props.src === 'string') pictures.add(props.src.split('?')[0])
    if (type === 'source' && typeof props['data-raw'] === 'string') pictures.add(String(props['data-raw']).split('?')[0])
    walk(children)
  }
  walk(tree)
  return { words: [...words].sort(), links: [...links].sort(), pictures: [...pictures].sort() }
}

const block = (type: string, props: Record<string, unknown>): Block => ({ id: 'b1', type, v: 1, props })
async function both(b: Block) {
  const before = seen(await drawn(ContentBlock({ block: b, page: 'home' })))
  const r = await convertBlock(b, 'home')
  if (!r?.ok) throw new Error(`not converted: ${JSON.stringify(r)}`)
  const section = r.block.props.compiled as CompiledSection
  const after = seen(await drawn(await CodeSection({ section, page: 'home', data: dbSiteData(), always: true })))
  return { before, after, converted: r.block }
}

const IMG = 'https://cdn.example.com/media/a.jpg'
const CASES: [string, Block][] = [
  ['rich text', block('rich_text', { heading: 'Our story', body: 'We brew tea.\n\nSince 1998,\nin Chennai.', align: 'center', width: 'wide' })],
  ['picture with text', block('image_text', { image: IMG, heading: 'Fresh leaves', body: 'Picked by hand.', ctaLabel: 'Shop tea', ctaUrl: '/products', imageSide: 'right', aspect: '1:1' })],
  ['banner with a phone picture', block('image_banner', { image: IMG, mobileImage: 'https://cdn.example.com/media/m.jpg', heading: 'Monsoon sale', subheading: 'Up to 30% off', ctaLabel: 'See offers', ctaUrl: '/offers', overlay: 'dark', align: 'left', height: 'tall' })],
  ['questions', block('faq', { heading: 'Questions', items: [{ q: 'Do you ship?', a: 'Yes, across India.' }, { q: 'Returns?', a: 'Within 7 days.\n\nUnopened only.' }] })],
  ['contact details', block('contact_details', { heading: 'Visit us', note: 'Drop by any time.', showEmail: true, showPhone: true, showAddress: true, showHours: true })],
  ['contact details, some hidden', block('contact_details', { heading: 'Write to us', showPhone: false, showAddress: false, showHours: false })],
  [
    'composed',
    block('composed', {
      label: 'Why us',
      tree: {
        kind: 'section',
        tone: 'brand',
        padding: 'lg',
        width: 'normal',
        children: [
          { kind: 'badge', text: 'New' },
          { kind: 'heading', text: 'Why shop with us', level: 2, align: 'center' },
          { kind: 'columns', ratio: '1:2', children: [{ kind: 'image', src: IMG, alt: 'Tea', href: '/about', aspect: { web: '4:3', web_mobile: '1:1' } }, { kind: 'stack', children: [{ kind: 'text', text: 'Small batches.\n\nFair prices.' }, { kind: 'button', label: 'Read more', href: '/about', variant: 'outline' }] }] },
          { kind: 'divider' },
          { kind: 'spacer', size: 'md' },
          { kind: 'products', query: { sort: 'new', limit: 4 }, layout: 'grid' },
        ],
      },
    }),
  ],
]

describe('convert to editable section', () => {
  for (const [name, b] of CASES)
    it(`${name}: the same words, links and pictures, as a v2 code section`, async () => {
      const { before, after, converted } = await both(b)
      expect(after).toEqual(before)
      expect(before.words.length).toBeGreaterThan(0)
      expect(converted).toMatchObject({ id: 'b1', type: 'code_section' })
      expect(converted.props.tree).toBeTruthy()
      expect(String(converted.props.source)).toContain('data-e=')
    })

  it('keeps the store’s details live, and only the rows the block showed', async () => {
    const all = await both(CASES[4][1])
    expect(all.after.links).toEqual(['https://www.google.com/maps/search/?api=1&query=12%20MG%20Road%2C%20Chennai', 'mailto:hello@chai.example', 'tel:+919876543210'])
    expect(all.after.words).toEqual(expect.arrayContaining(['Opening hours', 'Mon–Sat', '10am–8pm', 'Sun', 'closed']))
    const some = await both(CASES[5][1])
    expect(some.after.links).toEqual(['mailto:hello@chai.example'])
    expect(String(some.converted.props.source)).toContain('<Store')
  })

  it('converts only the blocks it knows, keeping the block’s place and visibility', async () => {
    expect(isConvertible('rich_text')).toBe(true)
    expect(isConvertible('product_row')).toBe(false)
    expect(await convertBlock(block('product_row', {}), 'home')).toBeNull()
    const hidden = await convertBlock({ ...block('rich_text', { heading: 'Hi', body: 'There' }), visibility: { hidden: true } }, 'home')
    expect(hidden?.ok && hidden.block.visibility).toEqual({ hidden: true })
    expect(await convertBlock(block('composed', { tree: null }), 'home')).toMatchObject({ ok: false })
  })
})
