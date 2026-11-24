import type { Block, CodeNode, CodeValue, PageKey } from '@jeffi/site-blocks'
import { CODE_ICON_NAMES } from './code/parts/icon-names'
import { compileCodeProps, CODE_SECTION, type CompileIssue } from './code/compile'
import { printSection } from './code/print'
import { cleanTree, type ComposedNode, type NodeOf } from './composed'
import { isConvertible, type Convertible } from './convertible'

// "Convert to editable section" (docs/plans/SITE_EDITOR_PLAN.md phase 5): a content or composed block rewritten, by
// rule, as a code section the visual editor edits (v2: tree, printed source, compiled). The tree mirrors the block's
// own renderer (components/visitor/site/ContentBlocks.tsx, ComposedBlock.tsx): the same words, links and pictures, in
// the same classes; store data stays live through the code parts (<Store>, <Products>…). Run on demand, one block at
// a time; the result is saved through the usual compile, never trusted from a browser.

export { CONVERTIBLE, isConvertible, type Convertible } from './convertible'

type P = Record<string, unknown>
const lit = (v: string | number | boolean | Record<string, unknown> | unknown[] | null): CodeValue => ({ k: 'lit', v })
const path = (root: string, ...p: string[]): CodeValue => ({ k: 'path', root, path: p })
const tpl = (...parts: (string | CodeValue)[]): CodeValue => ({ k: 'tpl', parts })
const tx = (value: string): CodeNode => ({ t: 'text', value })
const show = (v: CodeValue): CodeNode => ({ t: 'expr', value: v })
const when = (test: CodeValue, then: CodeNode): CodeNode => ({ t: 'cond', test, then })
const el = (tag: string, cls: string, children: CodeNode[] = [], props: Record<string, CodeValue> = {}): CodeNode => ({
  t: 'el',
  tag,
  props: { ...(cls.trim() ? { className: lit(cls.replace(/\s+/g, ' ').trim()) } : {}), ...props },
  children,
})
const cmp = (name: string, props: Record<string, CodeValue>, children: CodeNode[] = [], render?: { param: string; body: CodeNode }): CodeNode => ({
  t: 'cmp',
  name,
  props,
  children,
  ...(render ? { render } : {}),
})
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null)
/** A picture as the Image part: responsive, and the first one in the page's LCP section loads eagerly at high priority. */
const pic = (src: string, alt: string, cls: string, sizes?: string): CodeNode =>
  cmp('Image', { src: lit(src), alt: lit(alt), className: lit(cls.replace(/\s+/g, ' ').trim()), ...(sizes ? { sizes: lit(sizes) } : {}) })
const paras = (text: string) => text.split(/\n{2,}/).map(p => p.trim()).filter(Boolean)
const some = (...nodes: (CodeNode | null | false | undefined | '')[]) => nodes.filter((n): n is CodeNode => !!n)

// ── Content blocks (ContentBlocks.tsx) ────────────────────────────────────────────────────────────

const RATIO: Record<string, string> = { '1:1': 'aspect-square', '4:5': 'aspect-[4/5]', '4:3': 'aspect-[4/3]', '16:9': 'aspect-video' }
const HEIGHT: Record<string, string> = { short: 'min-h-[220px] md:min-h-[320px]', medium: 'min-h-[360px] md:min-h-[480px]', tall: 'min-h-[520px] md:min-h-[680px]' }
const CARD = 'rounded-[var(--radius-card,0.75rem)] border border-border-default bg-surface-elevated'

const paragraphs = (text: string, cls = '') => el('div', `space-y-3 text-foreground-secondary leading-relaxed ${cls}`, paras(text).map(p => el('p', 'whitespace-pre-line', [tx(p)])))
const button = (label: string | null, href: string | null, light = false) =>
  label && href
    ? cmp('Link', {
        href: lit(href),
        className: lit(
          `inline-flex items-center justify-center min-h-12 px-5 rounded-[var(--radius-button,0.5rem)] text-sm font-semibold transition-colors ${light ? 'bg-white text-gray-900 hover:bg-gray-100' : 'bg-accent-500 text-white hover:bg-accent-600'}`
        ),
      }, [tx(label)])
    : null
const heading = (text: string | null, cls: string) => (text ? el('h2', `font-display text-3xl md:text-4xl text-foreground ${cls}`, [tx(text)]) : null)

function richText(p: P): CodeNode {
  const center = p.align === 'center'
  return el('section', 'container mx-auto px-4 py-10 md:py-14', [
    el('div', `${p.width === 'wide' ? 'max-w-5xl' : 'max-w-2xl'} ${center ? 'mx-auto text-center' : ''}`, some(heading(str(p.heading), 'mb-4'), paragraphs(String(p.body ?? ''), 'text-base md:text-lg'))),
  ])
}

function imageText(p: P): CodeNode {
  const image = str(p.image)
  return el('section', 'container mx-auto px-4 py-10 md:py-14', [
    el('div', 'grid gap-6 md:gap-12 md:grid-cols-2 items-center', [
      el(
        'div',
        `${RATIO[String(p.aspect)] ?? RATIO['4:5']} relative overflow-hidden rounded-[var(--radius-card,0.75rem)] bg-surface-secondary ${p.imageSide === 'right' ? 'md:order-2' : ''}`,
        image ? [pic(image, str(p.heading) ?? '', 'absolute inset-0 h-full w-full object-cover')] : []
      ),
      el('div', 'space-y-4', some(heading(str(p.heading), ''), paragraphs(String(p.body ?? '')), button(str(p.ctaLabel), str(p.ctaUrl)))),
    ]),
  ])
}

function imageBanner(p: P): CodeNode {
  const img = str(p.image)
  const mobile = str(p.mobileImage)
  const overlay = p.overlay === 'light' ? 'bg-white/45' : p.overlay === 'none' ? '' : 'bg-black/40'
  const light = p.overlay !== 'light'
  const left = p.align === 'left'
  const picture = (src: string, cls: string) => pic(src, str(p.heading) ?? '', `absolute inset-0 h-full w-full object-cover ${cls}`, '100vw')
  return el('section', `relative flex items-center overflow-hidden bg-secondary-800 ${HEIGHT[String(p.height)] ?? HEIGHT.medium}`, [
    // A phone picture of its own shows below md, the main one from md up (the block's <picture> source). The phone one
    // comes first, so on a first section it is the one loaded at high priority (a lazy picture hidden by CSS never loads).
    ...(img && mobile ? [picture(mobile, 'md:hidden')] : []),
    ...(img ? [picture(img, mobile ? 'hidden md:block' : '')] : []),
    ...(overlay ? [el('div', `absolute inset-0 ${overlay}`)] : []),
    el('div', `relative container mx-auto px-4 py-10 ${left ? 'text-left' : 'text-center'}`, [
      el(
        'div',
        `max-w-2xl space-y-4 ${left ? '' : 'mx-auto'} ${light ? 'text-white' : 'text-gray-900'}`,
        some(
          str(p.heading) && el('h2', 'font-display text-4xl md:text-6xl leading-tight', [tx(str(p.heading)!)]),
          str(p.subheading) && el('p', 'text-base md:text-lg opacity-90', [tx(str(p.subheading)!)]),
          button(str(p.ctaLabel), str(p.ctaUrl), light)
        )
      ),
    ]),
  ])
}

function faq(p: P): CodeNode {
  const items = (Array.isArray(p.items) ? p.items : []).filter((x): x is { q: string; a: string } => !!x && typeof (x as P).q === 'string' && typeof (x as P).a === 'string')
  return el('section', 'container mx-auto px-4 py-10 md:py-14', [
    el(
      'div',
      'max-w-3xl mx-auto',
      some(
        heading(str(p.heading), 'mb-6 text-center'),
        el(
          'div',
          `divide-y divide-border-default ${CARD}`,
          items.map(it =>
            el('details', 'group px-4 md:px-6', [
              el('summary', 'flex min-h-[52px] cursor-pointer items-center justify-between gap-4 py-3 font-medium text-foreground list-none', [
                tx(it.q),
                el('span', 'text-xl text-foreground-muted transition-transform group-open:rotate-45', [tx('+')]),
              ]),
              paragraphs(it.a, 'pb-4'),
            ])
          )
        )
      )
    ),
  ])
}

/** The store's own contact details stay live: <Store> gives its email, phone, address and opening hours. */
function contactDetails(p: P): CodeNode {
  const row = (label: string, value: CodeValue, href: CodeValue, test: CodeValue) =>
    when(test, el('a', `${CARD} p-4 hover:border-accent-500 transition-colors`, [el('span', 'block text-xs uppercase tracking-wide text-foreground-muted', [tx(label)]), el('span', 'block mt-1 font-medium text-foreground break-words', [show(value)])], { href }))
  const s = (k: string) => path('s', k)
  const rows = some(
    p.showEmail !== false && row('Email', s('email'), tpl('mailto:', s('email')), s('email')),
    p.showPhone !== false && row('Phone', s('phone'), s('phoneUrl'), s('phone')),
    p.showAddress !== false && row('Address', s('address'), s('mapsUrl'), s('address')),
    p.showHours !== false &&
      when(
        path('s', 'hours', 'length'),
        el(`div`, `${CARD} p-4 sm:col-span-2`, [
          el('span', 'block text-xs uppercase tracking-wide text-foreground-muted', [tx('Opening hours')]),
          el('dl', 'mt-2 grid gap-1', [
            { t: 'each', items: s('hours'), param: 'h', body: el('div', 'flex justify-between gap-4', [el('dt', 'text-foreground-secondary', [show(path('h', 'label'))]), el('dd', 'text-foreground', [show(path('h', 'value'))])]) },
          ]),
        ])
      )
  )
  return el('section', 'container mx-auto px-4 py-10 md:py-14', [
    el(
      'div',
      'max-w-3xl mx-auto space-y-6',
      some(
        str(p.heading) && el('h2', 'font-display text-3xl md:text-4xl text-foreground text-center', [tx(str(p.heading)!)]),
        str(p.note) && paragraphs(str(p.note)!, 'text-center'),
        cmp('Store', {}, [], { param: 's', body: el('div', 'grid gap-4 sm:grid-cols-2', rows) })
      )
    ),
  ])
}

// ── Composed blocks (ComposedBlock.tsx) ───────────────────────────────────────────────────────────

const BG: Record<string, string> = { default: 'bg-surface text-foreground', muted: 'bg-surface-secondary text-foreground', brand: 'bg-primary-600 text-white', accent: 'bg-accent-500 text-white', dark: 'bg-gray-900 text-white' }
const FG: Record<string, string> = { default: '', muted: 'opacity-75', brand: 'text-primary-600', accent: 'text-accent-600', dark: 'text-gray-900' }
const CHIP: Record<string, string> = { default: 'bg-surface-elevated text-foreground', muted: 'bg-surface-secondary text-foreground-secondary', brand: 'bg-primary-600 text-white', accent: 'bg-accent-500 text-white', dark: 'bg-gray-900 text-white' }
const PAD: Record<string, string> = { none: 'py-0', xs: 'py-2', sm: 'py-4', md: 'py-8', lg: 'py-12 md:py-16', xl: 'py-16 md:py-24' }
const GAP: Record<string, string> = { none: 'gap-0', xs: 'gap-1', sm: 'gap-2', md: 'gap-4', lg: 'gap-8', xl: 'gap-12' }
const SPACE: Record<string, string> = { none: 'h-0', xs: 'h-2', sm: 'h-4', md: 'h-8', lg: 'h-12', xl: 'h-20' }
const ALIGN: Record<string, string> = { left: 'text-left items-start', center: 'text-center items-center', right: 'text-right items-end' }
const JUSTIFY: Record<string, string> = { left: 'justify-start', center: 'justify-center', right: 'justify-end' }
const WIDTH: Record<string, string> = { narrow: 'max-w-3xl', normal: 'max-w-7xl', full: 'max-w-none' }
const COLS_M: Record<number, string> = { 1: 'grid-cols-1', 2: 'grid-cols-2', 3: 'grid-cols-3' }
const COLS_D: Record<number, string> = { 1: 'md:grid-cols-1', 2: 'md:grid-cols-2', 3: 'md:grid-cols-3', 4: 'md:grid-cols-4', 5: 'md:grid-cols-5', 6: 'md:grid-cols-6' }
const ASPECT_M: Record<string, string> = { auto: '', '1:1': 'aspect-square', '4:5': 'aspect-[4/5]', '3:4': 'aspect-[3/4]', '4:3': 'aspect-[4/3]', '16:9': 'aspect-video', '21:9': 'aspect-[21/9]', '3:1': 'aspect-[3/1]' }
const ASPECT_D: Record<string, string> = { auto: '', '1:1': 'md:aspect-square', '4:5': 'md:aspect-[4/5]', '3:4': 'md:aspect-[3/4]', '4:3': 'md:aspect-[4/3]', '16:9': 'md:aspect-video', '21:9': 'md:aspect-[21/9]', '3:1': 'md:aspect-[3/1]' }
const RADIUS: Record<string, string> = { none: 'rounded-none', sm: 'rounded', md: 'rounded-lg', lg: 'rounded-2xl', full: 'rounded-full' }
const COLS_RATIO: Record<string, string> = { '1:1': 'md:grid-cols-2', '1:2': 'md:grid-cols-[1fr_2fr]', '2:1': 'md:grid-cols-[2fr_1fr]', '1:3': 'md:grid-cols-[1fr_3fr]', '3:1': 'md:grid-cols-[3fr_1fr]' }
const H_SIZE: Record<number, string> = { 1: 'font-display text-4xl md:text-5xl', 2: 'font-display text-2xl md:text-3xl', 3: 'text-lg md:text-xl font-semibold' }
const T_SIZE: Record<string, string> = { sm: 'text-base', md: 'text-base', lg: 'text-lg' }
// The composed icons as the code library names them (absent ones fall back to a star, as ComposedBlock's do).
const ICONS: Record<string, string> = { truck: 'truck', shield: 'shield-check', star: 'star', heart: 'heart', gift: 'gift', tag: 'tag', sparkles: 'sparkles', leaf: 'leaf', award: 'award', clock: 'clock', phone: 'phone', 'map-pin': 'map-pin', check: 'check', percent: 'percent', package: 'package', refresh: 'rotate-ccw' }
const aspectClass = (a?: { web?: string; web_mobile?: string }) => (a ? `${ASPECT_M[a.web_mobile ?? a.web ?? 'auto'] ?? ''} ${ASPECT_D[a.web ?? 'auto'] ?? ''}` : '')
const gridCls = (cols: { web: number; web_mobile: number }) => `grid gap-4 ${COLS_M[cols.web_mobile] ?? 'grid-cols-2'} ${COLS_D[cols.web] ?? 'md:grid-cols-4'}`
const queryProps = (q: Record<string, unknown>): Record<string, CodeValue> => Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => [k, lit(v as never)]))

function composedNode(n: ComposedNode): CodeNode | null {
  const kids = () => (n.children ?? []).map(composedNode).filter((c): c is CodeNode => !!c)
  switch (n.kind) {
    case 'section':
      return el('section', `${BG[n.tone]} ${PAD[n.padding]}`, [el('div', `mx-auto px-4 ${WIDTH[n.width]} flex flex-col gap-6`, kids())])
    case 'grid':
      return el('div', `grid ${GAP[n.gap]} ${COLS_M[n.cols.web_mobile] ?? 'grid-cols-1'} ${COLS_D[n.cols.web] ?? 'md:grid-cols-3'}`, kids())
    case 'stack':
      return el('div', `flex flex-col ${GAP[n.gap]} ${ALIGN[n.align]}`, kids())
    case 'columns':
      return el('div', `grid grid-cols-1 ${COLS_RATIO[n.ratio]} ${GAP[n.gap]} ${n.valign === 'center' ? 'md:items-center' : 'md:items-start'}`, kids())
    case 'carousel':
      return cmp('Carousel', { label: lit('Gallery'), itemClassName: lit('w-[85%] md:w-[31%]') }, kids())
    case 'heading':
      return el(`h${n.level}`, `${H_SIZE[n.level]} ${FG[n.tone]} ${ALIGN[n.align]}`, [tx(n.text)])
    case 'text':
      return el('div', `${T_SIZE[n.size]} ${FG[n.tone]} ${ALIGN[n.align]} space-y-3 whitespace-pre-line`, n.text.split(/\n{2,}/).map(t => el('p', '', [tx(t)])))
    case 'image': {
      const has = aspectClass(n.aspect).trim()
      const box = el('div', `group relative overflow-hidden bg-surface-secondary ${RADIUS[n.radius]} ${aspectClass(n.aspect)}`, [
        pic(n.src, n.alt, `${has ? 'absolute inset-0 h-full' : 'block'} w-full object-cover transition-opacity duration-500 ${n.hoverSrc ? 'group-hover:opacity-0' : ''}`),
        ...(n.hoverSrc ? [el('img', 'absolute inset-0 h-full w-full object-cover opacity-0 transition-opacity duration-500 group-hover:opacity-100', [], { src: lit(n.hoverSrc), alt: lit('') })] : []),
      ])
      return n.href ? cmp('Link', { href: lit(n.href) }, [box]) : box
    }
    case 'button': {
      const cls = n.variant === 'solid' ? 'bg-accent-500 text-white hover:bg-accent-600' : n.variant === 'outline' ? 'border border-current hover:bg-black/5' : 'underline underline-offset-4'
      return cmp('Link', { href: lit(n.href), className: lit(`inline-flex min-h-12 items-center justify-center self-start rounded-lg px-5 text-sm font-semibold transition-colors ${cls}`) }, [tx(n.label)])
    }
    case 'badge':
      return el('span', `inline-block self-start rounded-full px-3 py-1 text-xs font-semibold ${CHIP[n.tone]}`, [tx(n.text)])
    case 'icon': {
      const name = CODE_ICON_NAMES.includes(ICONS[n.name]) ? ICONS[n.name] : CODE_ICON_NAMES.includes('star') ? 'star' : CODE_ICON_NAMES[0]
      return cmp('Icon', { name: lit(name), size: lit(n.size === 'sm' ? 'md' : n.size === 'lg' ? 'xl' : 'lg'), className: lit(FG[n.tone] || 'text-current') })
    }
    case 'spacer':
      return el('div', SPACE[n.size], [], { 'aria-hidden': lit('true') })
    case 'divider':
      return el('hr', 'border-border-default')
    case 'products': {
      const p = n as NodeOf<'products'>
      return cmp('Products', { query: lit(p.query as never), layout: lit(p.layout), ...(p.aspect?.web ? { aspect: lit(p.aspect.web) } : {}), className: lit(gridCls(p.cols)) })
    }
    case 'categories': {
      const c = n as NodeOf<'categories'>
      return cmp('Categories', { ...queryProps(c.query), layout: lit(c.layout), className: lit(gridCls(c.cols)) })
    }
    case 'brands': {
      const b = n as NodeOf<'brands'>
      return cmp('Brands', { ...queryProps(b.query), layout: lit(b.layout), className: lit(gridCls({ web: 6, web_mobile: 3 })) })
    }
    case 'review': {
      const r = n as NodeOf<'review'>
      return cmp('Reviews', { ...queryProps(r.query), layout: lit(r.layout), className: lit('grid gap-4 grid-cols-1 md:grid-cols-3') })
    }
    case 'offers': {
      const o = n as NodeOf<'offers'>
      return cmp('Offers', { ...queryProps(o.query), layout: lit(o.layout), className: lit('grid gap-4 grid-cols-1 md:grid-cols-3') })
    }
    case 'countdown':
      return el('div', `flex ${JUSTIFY[n.align]}`, [cmp('Countdown', { endsAt: lit(n.endsAt), label: lit(n.label) })])
    case 'marquee':
      return el('div', `overflow-hidden rounded-lg py-3 ${CHIP[n.tone]}`, [
        cmp('Marquee', { speed: lit(n.speed) }, n.items.map(t => el('span', 'mx-5 whitespace-nowrap text-sm font-semibold', [tx(t)]))),
      ])
    default:
      return null
  }
}

function composed(p: P): CodeNode | null {
  const { tree } = cleanTree(p.tree)
  return tree ? composedNode(tree) : null
}

// ── Converting ────────────────────────────────────────────────────────────────────────────────────

/** A convertible block's tree (no ids yet), or null when there is nothing to convert. */
export function blockTree(block: Pick<Block, 'type' | 'props'>): CodeNode | null {
  const p = (block.props ?? {}) as P
  switch (block.type) {
    case 'rich_text':
      return richText(p)
    case 'image_text':
      return imageText(p)
    case 'image_banner':
      return imageBanner(p)
    case 'faq':
      return faq(p)
    case 'contact_details':
      return contactDetails(p)
    case 'composed':
      return composed(p)
    default:
      return null
  }
}

const LABEL: Record<Convertible, string> = { rich_text: 'Text', image_text: 'Picture with text', image_banner: 'Banner', faq: 'Questions', contact_details: 'Contact details', composed: 'Custom block' }

/**
 * The block as a code section (same id, place and visibility): its tree printed and compiled as every save is. Issues
 * when the compile refuses it (a block whose settings no longer fit), null when it isn't convertible.
 */
export async function convertBlock(block: Block, page: PageKey | null): Promise<{ ok: true; block: Block } | { ok: false; issues: CompileIssue[] } | null> {
  if (!isConvertible(block.type)) return null
  const tree = blockTree(block)
  if (!tree) return { ok: false, issues: [{ message: 'This block is empty, so there is nothing to convert' }] }
  const p = block.props as P
  const label = (typeof p.label === 'string' && p.label.trim()) || str(p.heading) || LABEL[block.type]
  const r = await compileCodeProps({ label: label.slice(0, 80), tree, source: printSection(tree) }, page)
  if (!r.ok) return r
  return { ok: true, block: { id: block.id, type: CODE_SECTION, v: 1, props: r.props, ...(block.visibility ? { visibility: block.visibility } : {}) } }
}
