import type { CodeNode } from '@jeffi/site-blocks'
import { placeFree, type FreeRect } from './free'
import { setCqwFont, slideFrameClasses, type SlideAspectId } from './slide'

// Five starter slides, each a code section tree whose root is a slide frame (./slide.ts): every child a free layer
// placed in % at Tablet and Desktop, its words in container units, stacked in tree order on phones. Pictures are the
// Image part with no address (a styled placeholder until the owner picks one); the product spotlight holds a live
// <Products> part in a clipped box. Built fresh on each call, so ids never repeat between sections.

export type SlideTemplateId = 'poster' | 'split' | 'quote' | 'stats' | 'product'

export interface SlideTemplate {
  id: SlideTemplateId
  label: string
  description: string
  aspect: SlideAspectId
}

export const SLIDE_TEMPLATES: SlideTemplate[] = [
  { id: 'poster', label: 'Poster hero', description: 'A big heading, a line, a button and a picture.', aspect: '16:9' },
  { id: 'split', label: 'Picture and words', description: 'A picture on one side, a heading and text on the other.', aspect: '16:9' },
  { id: 'quote', label: 'Quote', description: 'One customer quote, large, with a name.', aspect: '16:9' },
  { id: 'stats', label: 'Numbers', description: 'Three numbers that say why to shop here.', aspect: '21:9' },
  { id: 'product', label: 'Product spotlight', description: 'One live product beside a heading and a button.', aspect: '16:9' },
]

const lit = (v: string | number | boolean) => ({ k: 'lit' as const, v })

/** One build: its ids run e1, e2…; a layer is placed at Desktop then Tablet (so Tablet's does not pin Desktop to the flow). */
function builder(aspect: SlideAspectId) {
  let n = 1
  const next = () => `e${n++}`
  const at = (cls: string, rect: FreeRect, cqw?: number) => {
    const placed = placeFree(placeFree(cls, 'lg', rect, 10), 'md', rect, 10)
    return cqw === undefined ? placed : setCqwFont(placed, 'md', cqw)
  }
  const rootId = next()
  const el = (tag: string, cls: string, rect: FreeRect, cqw: number, text: string): CodeNode => {
    const id = next()
    return { t: 'el', tag, id, props: { className: lit(at(cls, rect, cqw)) }, children: [{ t: 'text', value: text, id: `${id}.0` }] }
  }
  const link = (cls: string, rect: FreeRect, cqw: number, href: string, text: string): CodeNode => {
    const id = next()
    return { t: 'cmp', name: 'Link', id, props: { href: lit(href), className: lit(at(cls, rect, cqw)) }, children: [{ t: 'text', value: text, id: `${id}.0` }] }
  }
  const picture = (cls: string, rect: FreeRect, imageAspect: string, alt: string): CodeNode => {
    const id = next()
    return { t: 'cmp', name: 'Image', id, props: { alt: lit(alt), aspect: lit(imageAspect), className: lit(at(cls, rect)) }, children: [] }
  }
  // A live data part in a clipped box with a height of its own: owners resize the box, not the items.
  const part = (name: string, props: Record<string, ReturnType<typeof lit>>, cls: string, rect: FreeRect): CodeNode => {
    const id = next()
    return { t: 'cmp', name, id, props: { ...props, className: lit(at(`${cls} overflow-hidden`, rect)) }, children: [] }
  }
  const section = (cls: string, children: CodeNode[]): CodeNode => ({
    t: 'el',
    tag: 'section',
    id: rootId,
    props: { className: lit(`${slideFrameClasses(aspect)} ${cls}`) },
    children,
  })
  return { el, link, picture, part, section }
}

const BUTTON = 'inline-flex min-h-12 items-center justify-center rounded-lg px-5 text-sm font-semibold md:rounded-[0.8cqw] md:px-[1.6cqw] md:py-[1cqw]'

function poster(): CodeNode {
  const b = builder('16:9')
  return b.section('flex flex-col gap-4 bg-primary-900 px-5 py-10 text-white', [
    b.el('h1', 'font-display text-4xl font-semibold leading-tight', { left: 6, top: 14, width: 52 }, 5.4, 'Pieces made to be kept for years'),
    b.el('p', 'text-base text-primary-100', { left: 6, top: 52, width: 42 }, 1.9, 'Small batches from our workshop, packed with care and delivered across India.'),
    b.link(`${BUTTON} bg-white text-primary-900`, { left: 6, top: 74, width: 22 }, 1.7, '/products', 'Shop the collection'),
    b.picture('w-full rounded-2xl md:rounded-[1.6cqw]', { left: 62, top: 8, width: 32 }, '4:5', 'A handmade piece from our latest collection'),
  ])
}

function split(): CodeNode {
  const b = builder('16:9')
  return b.section('flex flex-col gap-4 bg-surface px-5 py-10 text-foreground', [
    b.picture('w-full rounded-2xl md:rounded-[1.6cqw]', { left: 4, top: 9, width: 46 }, '1:1', 'Our workshop at work'),
    b.el('span', 'text-sm font-semibold uppercase tracking-wide text-accent-600', { left: 56, top: 14, width: 38 }, 1.4, 'From the workshop'),
    b.el('h2', 'font-display text-3xl font-semibold leading-tight', { left: 56, top: 23, width: 38 }, 3.6, 'Made by hand, checked twice'),
    b.el('p', 'text-base text-foreground-secondary', { left: 56, top: 48, width: 36 }, 1.7, 'Every order is cut, finished and inspected by the same small team before it leaves us.'),
    b.link(`${BUTTON} bg-primary-600 text-white`, { left: 56, top: 72, width: 22 }, 1.7, '/products', 'See what is new'),
  ])
}

function quote(): CodeNode {
  const b = builder('16:9')
  return b.section('flex flex-col gap-4 bg-surface-secondary px-5 py-10 text-foreground', [
    b.el('span', 'font-display text-6xl leading-none text-accent-500', { left: 8, top: 2, width: 12 }, 14, '“'),
    b.el('blockquote', 'font-display text-2xl font-medium leading-snug', { left: 14, top: 24, width: 72 }, 3.6, 'We moved our orders here in March and our weekend sales doubled. Customers say it just feels easier.'),
    b.el('p', 'text-base font-semibold', { left: 14, top: 68, width: 40 }, 1.9, 'Maria Fernandes'),
    b.el('p', 'text-sm text-foreground-muted', { left: 14, top: 77, width: 40 }, 1.5, 'Owner, Fernandes Home Goods'),
  ])
}

function stats(): CodeNode {
  const b = builder('21:9')
  const stat = (left: number, value: string, label: string) => [
    b.el('p', 'font-display text-5xl font-semibold', { left, top: 40, width: 26 }, 6, value),
    b.el('p', 'text-base text-primary-100', { left, top: 66, width: 26 }, 1.7, label),
  ]
  return b.section('flex flex-col gap-4 bg-primary-800 px-5 py-10 text-white', [
    b.el('h2', 'font-display text-2xl font-semibold', { left: 8, top: 12, width: 60 }, 3.2, 'Why people shop with us'),
    ...stat(8, '12,000+', 'orders delivered'),
    ...stat(38, '4.8 / 5', 'average review'),
    ...stat(68, '3 days', 'usual delivery'),
  ])
}

function product(): CodeNode {
  const b = builder('16:9')
  return b.section('flex flex-col gap-4 bg-surface px-5 py-10 text-foreground', [
    b.el('span', 'text-sm font-semibold uppercase tracking-wide text-accent-600', { left: 6, top: 16, width: 40 }, 1.4, 'Just in'),
    b.el('h2', 'font-display text-3xl font-semibold leading-tight', { left: 6, top: 26, width: 44 }, 4, 'Our newest piece, ready to ship'),
    b.el('p', 'text-base text-foreground-secondary', { left: 6, top: 55, width: 40 }, 1.7, 'Fresh from the workshop this week, in limited numbers.'),
    b.link(`${BUTTON} bg-primary-600 text-white`, { left: 6, top: 74, width: 22 }, 1.7, '/products', 'Shop now'),
    b.part('Products', { sort: lit('new'), limit: lit(1) }, 'grid grid-cols-1', { left: 58, top: 8, width: 34, height: 84 }),
  ])
}

const BUILD: Record<SlideTemplateId, () => CodeNode> = { poster, split, quote, stats, product }

/** A starter slide's tree, with fresh ids. */
export const slideTemplate = (id: SlideTemplateId): CodeNode => BUILD[id]()

/** A starter slide as the props the editor saves a new code section with (compileCodeProps compiles them). */
export function slideSectionProps(id: SlideTemplateId): { label: string; tree: CodeNode; source: '' } {
  const t = SLIDE_TEMPLATES.find(x => x.id === id)
  return { label: t?.label ?? 'Slide', tree: slideTemplate(id), source: '' }
}
