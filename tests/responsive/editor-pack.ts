// The visual editor's page for the responsive sweep (docs/plans/SITE_EDITOR_PLAN.md phase 6): what owners make with
// it, built through the editor's own operations, so its renders face the same audits as the packs. A hero with free
// layers (placed on Desktop and Tablet, the badge on Phone too) and breakpoint styles from the style panel, then one
// block of each convertible kind converted. Pictures are the storefront's own (/images), so CI loads them.
import { DOC_SCHEMA_VERSION, isTagNode, type Block, type CodeNode, type PageDoc } from '@jeffi/site-blocks'
import { applyOps, type DesignOp } from '@jeffi/site-blocks/design'
import { compileCodeProps, sectionTree } from '@/lib/site/code/compile'
import { classOps, setPanelValue } from '@/lib/site/code/classes'
import { convertBlock } from '@/lib/site/convert'
import { litClass, placeOps } from '@/components/site-editor/free-ops'
import { slideTemplate } from '@/lib/site/code/slide-templates'

const PIC = { hero: '/images/Working.png', side: '/images/Welcome.png', phone: '/images/Tools.png' }

const HERO = `export default function Section() {
  return (
    <section className="bg-surface py-12 md:py-20">
      <div className="mx-auto max-w-6xl px-4">
        <span className="inline-block rounded-full bg-accent-100 px-3 py-1 text-xs font-semibold text-accent-700">New season</span>
        <h1 className="mt-4 max-w-xl font-display text-4xl text-foreground">Made by hand, shipped across India</h1>
        <p className="mt-4 max-w-xl text-base text-foreground-secondary">Small batches from our workshop, packed with care and delivered in days.</p>
        <Image src="${PIC.hero}" alt="Our workshop" aspect="4:3" className="mt-8 w-full max-w-md rounded-xl" />
        <Link href="/products" className="mt-6 inline-flex min-h-12 items-center rounded-lg bg-accent-500 px-5 text-sm font-semibold text-white">Shop now</Link>
      </div>
    </section>
  )
}`

function find(tree: CodeNode, test: (n: CodeNode) => boolean): CodeNode | null {
  if (test(tree)) return tree
  const kids = tree.t === 'el' || tree.t === 'cmp' || tree.t === 'frag' ? tree.children : tree.t === 'cond' ? [tree.then, ...(tree.else ? [tree.else] : [])] : tree.t === 'each' ? [tree.body] : []
  for (const k of kids) {
    const hit = find(k, test)
    if (hit) return hit
  }
  return null
}
const idOf = (tree: CodeNode, test: (n: CodeNode) => boolean) => {
  const n = find(tree, test)
  if (!n?.id) throw new Error('editor pack: an element of the hero is missing')
  return n.id
}

/** The hero as the editor leaves it: free layers, a phone placement, panel styles per breakpoint. */
export function heroTree(): CodeNode {
  const r = sectionTree(HERO, 'home')
  if (!r?.ok) throw new Error(`editor pack: the hero does not compile${r && !r.ok ? `: ${r.issues[0]?.message}` : ''}`)
  let tree = r.tree
  const step = (ops: DesignOp[]) => {
    if (!ops.length) throw new Error('editor pack: an editor step changed nothing')
    tree = applyOps(tree, ops).tree
  }
  const frame = idOf(tree, n => n.t === 'el' && n.tag === 'div')
  const badge = idOf(tree, n => n.t === 'el' && n.tag === 'span')
  const heading = idOf(tree, n => n.t === 'el' && n.tag === 'h1')
  const picture = idOf(tree, n => n.t === 'cmp' && n.name === 'Image')
  // The panel: bigger words from Tablet up, pinned as they were on Phone.
  const style = (id: string, bp: 'base' | 'md' | 'lg', prop: Parameters<typeof setPanelValue>[2], value: string) => {
    const before = litClass(tree, id) ?? ''
    step(classOps(id, before, setPanelValue(before, bp, prop, value)))
  }
  style(heading, 'md', 'fontSize', '6xl')
  style(heading, 'lg', 'letterSpacing', 'tight')
  // Free layers, each placed where the canvas would measure it, its frame made relative with its height kept.
  step(placeOps(tree, picture, 'md', { left: 52, top: 14, width: 44 }, { frame, frameHeight: 560 }))
  step(placeOps(tree, picture, 'lg', { left: 56, top: 8, width: 40 }, { frame, frameHeight: 620 }))
  step(placeOps(tree, badge, 'lg', { left: 78, top: 2, width: 16 }, { frame, frameHeight: 620 }))
  step(placeOps(tree, badge, 'base', { left: 62, top: 1, width: 34 }, { frame, frameHeight: 720 }))
  if (!isTagNode(tree)) throw new Error('editor pack: the hero lost its root')
  return tree
}

/** A poster slide (frame, free layers at Tablet and Desktop, words in container units), its picture the storefront's own. */
export function slideTree(): CodeNode {
  const tree = slideTemplate('poster')
  if (!isTagNode(tree)) throw new Error('editor pack: the slide lost its root')
  const kids = tree.children.map(c => (c.t === 'cmp' && c.name === 'Image' ? { ...c, props: { ...c.props, src: { k: 'lit' as const, v: PIC.side } } } : c))
  return { ...tree, children: kids }
}

const classic = (id: string, type: string, props: Record<string, unknown>): Block => ({ id, type, v: 1, props })

/** One of each convertible kind, as "Convert to editable section" leaves it. */
export const CONVERTED: Block[] = [
  classic('ed-banner', 'image_banner', { image: PIC.side, mobileImage: PIC.phone, heading: 'Monsoon sale', subheading: 'Up to 30% off everything handmade', ctaLabel: 'See offers', ctaUrl: '/products', overlay: 'dark', align: 'left', height: 'tall' }),
  classic('ed-story', 'rich_text', { heading: 'Our story', body: 'We started in a small room with one loom.\n\nToday twelve people make everything you see here, by hand, in Chennai.', align: 'center', width: 'wide' }),
  classic('ed-split', 'image_text', { image: PIC.side, heading: 'Fresh from the workshop', body: 'Every piece is checked twice before it ships.', ctaLabel: 'Shop the range', ctaUrl: '/products', imageSide: 'right', aspect: '4:5' }),
  classic('ed-faq', 'faq', { heading: 'Questions', items: [{ q: 'Do you ship across India?', a: 'Yes, to every pin code we can reach, usually in three to five days.' }, { q: 'Can I return an order?', a: 'Within seven days, unused and in its packaging.' }] }),
  classic('ed-contact', 'contact_details', { heading: 'Visit us', note: 'Drop by any weekday.', showEmail: true, showPhone: true, showAddress: true, showHours: true }),
  classic('ed-composed', 'composed', {
    label: 'Why us',
    tree: {
      kind: 'section',
      tone: 'brand',
      padding: 'lg',
      width: 'normal',
      children: [
        { kind: 'badge', text: 'Why us' },
        { kind: 'heading', text: 'Small batches, fair prices', level: 2, align: 'center' },
        { kind: 'columns', ratio: '1:2', children: [{ kind: 'image', src: PIC.hero, alt: 'Hands at work', aspect: { web: '4:3', web_mobile: '1:1' } }, { kind: 'stack', children: [{ kind: 'text', text: 'Made to order.\n\nPacked without plastic.' }, { kind: 'button', label: 'Read more', href: '/about', variant: 'outline' }] }] },
        { kind: 'divider' },
        { kind: 'products', query: { sort: 'new', limit: 4 }, layout: 'grid' },
      ],
    },
  }),
]

/** The home page the sweep renders: every section a v2 code section, compiled as the editor's save compiles it. */
export async function editorHomeDoc(): Promise<PageDoc> {
  const blocks: Record<string, Block> = {}
  const hero = await compileCodeProps({ label: 'Hero', tree: heroTree(), source: '' }, 'home')
  if (!hero.ok) throw new Error(`editor pack: the hero does not save: ${hero.issues[0]?.message}`)
  blocks['ed-hero'] = { id: 'ed-hero', type: 'code_section', v: 1, props: hero.props }
  const slide = await compileCodeProps({ label: 'Slide', tree: slideTree(), source: '' }, 'home')
  if (!slide.ok) throw new Error(`editor pack: the slide does not save: ${slide.issues[0]?.message}`)
  blocks['ed-slide'] = { id: 'ed-slide', type: 'code_section', v: 1, props: slide.props }
  for (const b of CONVERTED) {
    const r = await convertBlock(b, 'home')
    if (!r?.ok) throw new Error(`editor pack: ${b.type} does not convert${r && !r.ok ? `: ${r.issues[0]?.message}` : ''}`)
    blocks[b.id] = r.block
  }
  return { schemaVersion: DOC_SCHEMA_VERSION, blocks, order: Object.keys(blocks) }
}
