// The allowlist a code section is held to, shared by the compiler (on save) and the interpreter (on render).

export const MAX_SOURCE_BYTES = 30 * 1024
export const MAX_NODES = 400
export const MAX_DEPTH = 20
export const MAX_CLASSES = 800
/** Items a `.map` or data list renders at most. */
export const MAX_EACH = 60

/** Where the AI imports library components from (the import is optional). */
export const LIBRARY_MODULE = '@site/ui'
export const LIBRARY_MODULES = new Set([LIBRARY_MODULE, '@site', '@/site', 'site'])

export const HTML_TAGS = new Set([
  'div', 'section', 'article', 'aside', 'header', 'footer', 'main', 'nav', 'span', 'p',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'em', 'b', 'i', 'u', 's', 'small', 'mark', 'sup', 'sub', 'br', 'hr',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'blockquote', 'q', 'cite', 'figure', 'figcaption', 'a', 'img', 'time', 'abbr',
  'address', 'details', 'summary', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'code', 'pre', 'del', 'ins',
])
export const VOID_TAGS = new Set(['br', 'hr', 'img'])

/** Tags that are refused with a pointer to what to use instead. */
export const BLOCKED_TAGS: Record<string, string> = {
  script: 'scripts are not allowed',
  style: 'use Tailwind classes instead of <style>',
  iframe: 'embeds are not allowed',
  object: 'embeds are not allowed',
  embed: 'embeds are not allowed',
  frame: 'embeds are not allowed',
  frameset: 'embeds are not allowed',
  portal: 'embeds are not allowed',
  form: 'forms are not allowed: an email sign-up is <NewsletterForm />; search, cart and checkout come with their own library components',
  input: 'form fields are not allowed; use the library components',
  textarea: 'form fields are not allowed; use the library components',
  select: 'form fields are not allowed; use the library components',
  button: 'use <Link href="…" className="…"> styled as a button, or a library component for actions',
  link: 'not allowed',
  meta: 'not allowed',
  base: 'not allowed',
  template: 'not allowed',
  slot: 'not allowed',
  noscript: 'not allowed',
  svg: 'inline SVG is not allowed; use <Icon name="…" />',
  math: 'not allowed',
  video: 'video is not allowed in code sections',
  audio: 'audio is not allowed in code sections',
  canvas: 'not allowed',
}

export const GLOBAL_ATTRS = new Set(['className', 'id', 'title', 'role', 'dir', 'lang', 'hidden', 'key'])
export const TAG_ATTRS: Record<string, Set<string>> = {
  a: new Set(['href', 'target']),
  img: new Set(['src', 'alt', 'width', 'height', 'loading']),
  td: new Set(['colSpan', 'rowSpan']),
  th: new Set(['colSpan', 'rowSpan', 'scope']),
  time: new Set(['dateTime']),
  details: new Set(['open']),
  ol: new Set(['start', 'reversed']),
  abbr: new Set(['title']),
}
export const isAriaAttr = (name: string) => /^aria-[a-z]+$/.test(name)
export const attrAllowed = (tag: string, name: string) => GLOBAL_ATTRS.has(name) || isAriaAttr(name) || !!TAG_ATTRS[tag]?.has(name)

/** Property names a path may never step through. */
export const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor', '__defineGetter__', '__defineSetter__', '__lookupGetter__', '__lookupSetter__'])

/** Links: https, same-site /paths, #anchors, mailto: and tel:. */
export function safeHref(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const u = raw.trim()
  if (!u || u.length > 2000 || /[\s\u0000-\u001f\u007f\\<>"'`]/.test(u)) return null
  if (/^https:\/\/[a-z0-9.-]+(?::\d+)?(?:[/?#]|$)/i.test(u)) return u
  if (/^\/(?![/\\])/.test(u)) return u
  if (/^#[A-Za-z0-9_-]*$/.test(u)) return u
  if (/^mailto:[^\s@/]+@[^\s@/]+$/i.test(u)) return u
  if (/^tel:\+?[0-9 ()-]{3,20}$/i.test(u)) return u
  return null
}

/** Images: https or same-site /paths only (no data:, blob: or javascript:). */
export function safeSrc(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const u = raw.trim()
  if (!u || u.length > 2000 || /[\s\u0000-\u001f\u007f\\<>"'`]/.test(u)) return null
  if (/^https:\/\/[a-z0-9.-]+(?::\d+)?(?:[/?#]|$)/i.test(u)) return u
  if (/^\/(?![/\\])/.test(u)) return u
  return null
}

// The store's category and brand pages and listing filters, as AI code writes them.
const TAXONOMY_PATH = /^\/(categories|category|brands|brand)\/([a-z0-9][a-z0-9-]*)\/?$/i
const TAXONOMY_QUERY = /^\/products\/?\?(.*)$/i

/** The category or brand a site link points at, if any. */
export function taxonomyOf(href: string): { kind: 'categories' | 'brands'; slug: string } | null {
  const m = TAXONOMY_PATH.exec(href)
  if (m) return { kind: m[1].toLowerCase().startsWith('cat') ? 'categories' : 'brands', slug: m[2].toLowerCase() }
  const q = TAXONOMY_QUERY.exec(href)
  if (!q) return null
  const params = new URLSearchParams(q[1])
  const cat = params.get('category')
  if (cat) return { kind: 'categories', slug: cat.toLowerCase() }
  const brand = params.get('brand')
  return brand ? { kind: 'brands', slug: brand.toLowerCase() } : null
}

/** One Tailwind class: no url() (no outside requests), no characters that could leave a CSS rule. */
export function safeClass(token: string): boolean {
  return (
    token.length > 0 &&
    token.length <= 120 &&
    /^[A-Za-z0-9_\-:/.[\]#%(),&>+~*=!@']+$/.test(token) &&
    !/url\(|image-set\(|@import|expression\(|\\/i.test(token)
  )
}

export const splitClasses = (s: string) => s.split(/\s+/).filter(Boolean)

/** Makes stored CSS safe to put in a <style> element, whatever wrote it. */
export const inertCss = (css: unknown) =>
  typeof css === 'string'
    ? css
        .replace(/</g, '\\3c ')
        .replace(/@import[^;]*;?/gi, '')
        .replace(/url\s*\(/gi, 'invalid(')
        .replace(/expression\s*\(/gi, 'invalid(')
    : ''

/** The rules, for the AI prompt (the library itself comes from describeLibrary). */
export function codeRules(): string {
  return [
    `Write ONE React component in TSX: \`export default function Section() { return (…) }\`. Optionally \`import { … } from '${LIBRARY_MODULE}'\` for library components; no other imports.`,
    'Style only with Tailwind classes in className (string literals, template literals or ternaries of literals). Make it responsive with sm:/md:/lg: prefixes; one source serves desktop and phone.',
    'Theme colours: bg-surface, bg-surface-secondary, text-foreground, text-foreground-secondary, text-foreground-muted, border-border-default, and the primary-/secondary-/accent-50…900 scales; font-display for headings.',
    `HTML tags allowed: ${[...HTML_TAGS].join(', ')}. Use <Image> rather than <img>, and <Link> for links.`,
    'Attributes: className, id, title, role, aria-*, plus href/target on <a>, alt on images, colSpan/rowSpan on cells. No style, no event handlers (onClick…), no refs, no spreads, no dangerouslySetInnerHTML.',
    'Expressions: literals, fields of a render-function parameter (p.name, p.price.formatted), &&, ||, ?:, !, ===, <, >, template literals, and LIST.map((item, i) => <…/>) over a literal list, a const holding one, or a bound array. `const NAME = <literal>` is allowed before the return. No other function calls (no .toFixed, .slice, Date…), no other variables.',
    'Data comes from library components: <Products query={{ sort: "new", limit: 8 }} className="grid grid-cols-2 md:grid-cols-4 gap-4" /> draws each product as the site\'s product card; a render function shapes each item yourself: <Categories className="…">{c => <Link href={c.url}>…</Link>}</Categories>.',
    'Links and images: https:// URLs or same-site paths like /products; mailto: and tel: links are fine. Interactivity (carousel, tabs, accordion, marquee, reveal, countdown, add to cart…) only through library components.',
    'Logo, NavLinks, CartIcon, AccountLink, ProductCard, QuickAdd, WishlistToggle, forms and the data components\' default cards are links or controls already: never put them inside <Link> or <a>, and never put a link inside a link.',
    `Limits: ${MAX_SOURCE_BYTES / 1024} KB of source, ${MAX_NODES} JSX elements, nesting depth ${MAX_DEPTH}.`,
  ].join('\n')
}
