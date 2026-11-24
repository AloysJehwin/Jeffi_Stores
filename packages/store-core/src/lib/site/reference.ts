import { FONT_CHOICES } from '@jeffi/site-blocks'
import { aiChat } from '@/lib/shared/ai-client'
import { parseAiJson } from '@/lib/auth/ai-scope'
import { fetchPublic } from '@/lib/shared/safe-fetch'

// Reading a site the owner likes, without a browser: the page's HTML is cut into its sections (store themes mark each
// one: Shopify's "shopify-section-…", plain <section>s), each summarised by what it holds (headings, pictures,
// prices, product and collection links, forms, carousel or marquee hints). Fonts and colours come from the page's own
// font links and CSS variables. The AI turns that skeleton into a profile: the order of the home page's patterns and
// its feel. Nothing is copied: only patterns and style cues are kept.

export const PATTERNS = [
  'announcement',
  'hero_image',
  'hero_split',
  'product_carousel',
  'product_grid',
  'collection_tiles',
  'campaign_banner',
  'testimonials',
  'press_marquee',
  'brand_logos',
  'usp_strip',
  'text_story',
  'image_text',
  'newsletter',
  'countdown',
  'faq',
  'blog',
  'social',
  'video',
  'other',
] as const
export type Pattern = (typeof PATTERNS)[number]

export interface ReferenceProfile {
  url: string
  title: string
  sequence: { pattern: Pattern; note: string }[]
  fonts: { display?: string; body?: string }
  colors: string[]
  uppercaseLabels: boolean
  density: 'compact' | 'comfortable' | 'airy'
  imageLed: boolean
  feel: string
}

interface Chunk {
  tag: string
  hint: string
  headings: string[]
  imgs: number
  prices: number
  productLinks: number
  collectionLinks: number
  email: boolean
  buttons: string[]
  cues: string[]
}

const CUES = ['swiper', 'slider', 'carousel', 'marquee', 'ticker', 'testimonial', 'review', 'newsletter', 'subscribe', 'announcement', 'logo', 'press', 'countdown', 'timer', 'video', 'faq', 'accordion', 'instagram', 'blog', 'hero', 'banner', 'collection', 'featured', 'usp', 'benefit']

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()

function summarise(tag: string, attrs: string, body: string): Chunk {
  const lower = `${attrs} ${body.slice(0, 20000)}`.toLowerCase()
  const id = attrs.match(/id=["']([^"']+)/i)?.[1] ?? ''
  const cls = attrs.match(/class=["']([^"']+)/i)?.[1] ?? ''
  return {
    tag,
    hint: `${id} ${cls}`.replace(/template--\d+__/g, '').replace(/\s+/g, ' ').trim().slice(0, 120),
    headings: [...body.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)].map(m => text(m[1])).filter(h => h && h.length < 100).slice(0, 4),
    imgs: (body.match(/<img\b/gi) ?? []).length,
    prices: (body.match(/(₹|Rs\.?|\$|€|£)\s?\d/g) ?? []).length,
    productLinks: (body.match(/href=["'][^"']*\/products?\//gi) ?? []).length,
    collectionLinks: (body.match(/href=["'][^"']*\/(collections|categories|category)\//gi) ?? []).length,
    email: /type=["']email["']/i.test(body),
    buttons: [...body.matchAll(/<(?:a|button)\b[^>]*>([\s\S]{1,120}?)<\/(?:a|button)>/gi)]
      .map(m => text(m[1]))
      .filter(b => b && b.length <= 24)
      .slice(0, 4),
    cues: CUES.filter(c => lower.includes(c)),
  }
}

/** The page's sections in order, header and footer included. */
export function skeleton(html: string): Chunk[] {
  const clean = html
    .replace(/<script[\s\S]*?<\/script\b[^>]*>/gi, '')
    .replace(/<style[\s\S]*?<\/style\b[^>]*>/gi, '')
    .replace(/<svg[\s\S]*?<\/svg>/gi, '<svg/>')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
  // Section starts: theme section wrappers first, else <section>, plus the header and footer.
  const shopify = /<(div|section)\b([^>]*\bid=["']shopify-section-[^"']+["'][^>]*)>/gi
  const plain = /<(section|header|footer)\b([^>]*)>/gi
  const re = clean.match(shopify) ? new RegExp(`${shopify.source}|<(header|footer)\\b([^>]*)>`, 'gi') : plain
  const starts = [...clean.matchAll(re)].map(m => ({ at: m.index ?? 0, tag: (m[1] ?? m[3] ?? 'section').toLowerCase(), attrs: m[2] ?? m[4] ?? '' }))
  const chunks = starts.map((s, i) => summarise(s.tag, s.attrs, clean.slice(s.at, starts[i + 1]?.at ?? clean.length)))
  // Wrappers that hold nothing, and overlays (menus, drawers, pop-ups, the cart, sign-in), are dropped; capped.
  const overlay = /popup|pop-up|modal|drawer|mega-menu|megamenu|search|cart|merge|login|sign-in|account|quick-view/i
  return chunks
    .filter(c => c.headings.length || c.imgs || c.prices || c.email || c.buttons.length)
    .filter(c => c.tag !== 'header' && !overlay.test(`${c.hint} ${c.headings.join(' ')}`))
    .slice(0, 30)
}

// Fonts a site may use that the themes do not have, as the closest one they do.
const FONT_ALIASES: Record<string, string> = {
  helvetica: 'Inter', 'helvetica neue': 'Inter', arial: 'Inter', roboto: 'Inter', 'open sans': 'Inter', 'source sans pro': 'Inter', 'sf pro display': 'Inter', 'sf pro text': 'Inter',
  futura: 'Jost', 'proxima nova': 'Montserrat', gotham: 'Montserrat', avenir: 'Manrope', 'avenir next': 'Manrope', circular: 'DM Sans', gilroy: 'Plus Jakarta Sans', 'nunito sans': 'Nunito',
  georgia: 'Libre Baskerville', times: 'Libre Baskerville', 'times new roman': 'Libre Baskerville', merriweather: 'Lora', 'eb garamond': 'Cormorant Garamond', garamond: 'Cormorant Garamond',
  anton: 'Oswald', 'abril fatface': 'Playfair Display', 'bodoni moda': 'Playfair Display', archivo: 'Space Grotesk', 'ibm plex mono': 'Space Mono', 'jetbrains mono': 'Space Mono',
}
const GENERIC_FONT = /^(var\(.*|-apple-system|blinkmacsystemfont|system-ui|inherit|initial|sans-serif|serif|monospace|cursive|ui-\w+|segoe ui|.*(icon|awesome|star|glyph|emoji).*)$/i

function rgbHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map(v => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('')}`
}
const longHex = (c: string) => (c.length === 4 ? `#${[...c.slice(1)].map(x => x + x).join('')}` : c).toLowerCase()

/** Saturation and lightness of a #rrggbb colour (0-1). */
function satLight(hex: string): [number, number] {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, l]
  const d = max - min
  return [l > 0.5 ? d / (2 - max - min) : d / (max + min), l]
}

/** Fonts, colours and uppercase labels from the page's font links and @font-face rules, its CSS and meta. */
export function styleCues(html: string) {
  const fontCount = new Map<string, number>()
  const countFont = (f: string, w = 1) => {
    const name = f.replace(/\\?["']/g, '').trim()
    if (name.length > 1 && !GENERIC_FONT.test(name)) fontCount.set(name, (fontCount.get(name) ?? 0) + w)
  }
  for (const m of html.matchAll(/fonts\.googleapis\.com\/css2?\?([^"'>]+)/gi)) for (const f of m[1].matchAll(/family=([^:&;]+)/g)) countFont(decodeURIComponent(f[1].replace(/\+/g, ' ')), 5)
  for (const m of html.matchAll(/font-family:\s*([^;}{]{2,80})/gi)) countFont(m[1].split(',')[0])
  const fonts = [...fontCount.entries()].sort((a, b) => b[1] - a[1]).map(([f]) => f).slice(0, 8)
  const known = new Map(FONT_CHOICES.map(f => [f.name.toLowerCase(), f.name]))
  const matched = [...new Set(fonts.map(f => known.get(f.toLowerCase()) ?? FONT_ALIASES[f.toLowerCase()]).filter((f): f is string => !!f))]

  // Colours, weighted: brand variables and backgrounds count most, any colour used in the CSS counts too.
  const counts = new Map<string, number>()
  const add = (c: string, w: number) => {
    const hex = longHex(c)
    if (/^#[0-9a-f]{6}$/.test(hex)) counts.set(hex, (counts.get(hex) ?? 0) + w)
  }
  const theme = html.match(/<meta[^>]+name=["']theme-color["'][^>]+content=["'](#[0-9a-f]{3,6})["']/i)?.[1]
  if (theme) add(theme, 3)
  for (const m of html.matchAll(/--[\w-]*(?:color|colour|accent|primary|brand|button)[\w-]*\s*:\s*(#[0-9a-f]{6}\b|#[0-9a-f]{3}\b)/gi)) add(m[1], 3)
  for (const m of html.matchAll(/--[\w-]*(?:color|colour|accent|primary|brand|button)[\w-]*\s*:\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\b/gi)) add(rgbHex(+m[1], +m[2], +m[3]), 3)
  for (const m of html.matchAll(/background(?:-color)?\s*:\s*(#[0-9a-f]{6}\b|#[0-9a-f]{3}\b)/gi)) add(m[1], 2)
  for (const m of html.matchAll(/rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/gi)) add(rgbHex(+m[1], +m[2], +m[3]), 1)
  for (const m of html.matchAll(/(?<![-\w])color\s*:\s*(#[0-9a-f]{6}\b|#[0-9a-f]{3}\b)/gi)) add(m[1], 1)
  // Brand colours first (saturated, not near white or black), then the darkest neutrals for text.
  const ranked = [...counts.entries()].map(([c, n]) => ({ c, n, sl: satLight(c) }))
  const brand = ranked.filter(x => x.sl[0] > 0.35 && x.sl[1] > 0.18 && x.sl[1] < 0.82).sort((a, b) => b.n - a.n)
  const neutral = ranked.filter(x => !brand.includes(x) && x.sl[1] < 0.3).sort((a, b) => b.n - a.n)
  const palette = [...brand.slice(0, 4), ...neutral.slice(0, 2)].map(x => x.c)
  return { fonts, matched, palette, uppercase: (html.match(/text-transform:\s*uppercase/gi) ?? []).length }
}

/** Patterns read straight from the skeleton: the fallback when the model's answer is thin, and a cross-check. */
export function classify(chunks: Chunk[]): { pattern: Pattern; note: string }[] {
  const out: { pattern: Pattern; note: string }[] = []
  let heroSeen = false
  for (const c of chunks) {
    if (c.tag === 'footer') continue
    const has = (...k: string[]) => k.some(x => c.cues.includes(x) || c.hint.toLowerCase().includes(x))
    const heads = c.headings.join(' ').toLowerCase()
    let p: Pattern | null = null
    let note = ''
    if (has('announcement')) p = 'announcement'
    else if (c.prices >= 3 || c.productLinks >= 3) {
      p = has('swiper', 'slider', 'carousel') ? 'product_carousel' : 'product_grid'
      note = c.buttons.some(b => /add to cart|quick add/i.test(b)) ? 'quick add on cards' : ''
    } else if (has('testimonial', 'review')) p = 'testimonials'
    else if (/appreciated|featured in|as seen|press/.test(heads) || (has('logo', 'press') && c.imgs >= 4)) p = 'press_marquee'
    else if (c.email) p = 'newsletter'
    else if (has('faq', 'accordion')) p = 'faq'
    else if (has('instagram')) p = 'social'
    else if (has('blog')) p = 'blog'
    else if (c.collectionLinks >= 3 && c.imgs >= 3) p = 'collection_tiles'
    else if (c.imgs >= 1 && (has('banner', 'hero') || c.buttons.length)) {
      p = heroSeen ? 'campaign_banner' : 'hero_image'
      note = c.buttons.length >= 2 ? `${c.buttons.length} buttons` : c.headings.length ? '' : 'image-only'
      heroSeen = true
    } else if (c.imgs >= 1 && c.headings.length) p = 'image_text'
    // A lone heading above the hero is usually an SEO title, not a section.
    else if (c.headings.length && heroSeen) p = 'text_story'
    if (p && !(p === out[out.length - 1]?.pattern && p === 'text_story')) out.push({ pattern: p, note })
  }
  return out.slice(0, 14)
}

/** A reference site's profile, or null when it can't be read. */
export async function readReferenceProfile(url: string): Promise<ReferenceProfile | null> {
  let html: string
  try {
    html = (await fetchPublic(url, 2_500_000, { truncate: true })).bytes.toString('utf8')
  } catch {
    return null
  }
  const title = text(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').slice(0, 120)
  const chunks = skeleton(html)
  const cues = styleCues(html)
  if (!chunks.length) return null
  const lines = chunks.map(
    (c, i) =>
      `${i + 1}. <${c.tag}> ${c.hint || '-'} | headings: ${c.headings.join(' / ') || '-'} | imgs ${c.imgs}, prices ${c.prices}, product links ${c.productLinks}, collection links ${c.collectionLinks}${c.email ? ', email form' : ''} | buttons: ${c.buttons.join(', ') || '-'} | cues: ${c.cues.join(', ') || '-'}`
  )
  const r = await aiChat({
    feature: 'site_builder',
    modelHint: 'agent',
    maxTokens: 1500,
    jsonMode: true,
    temperature: 0.2,
    noCache: true,
    messages: [
      {
        role: 'system',
        content: `You read the structure of an online store's home page and describe its design patterns, never its words. Patterns: ${PATTERNS.join(', ')}.
Return JSON {"sequence": [{"pattern": one of the patterns, "note": "a few words on how it looks or behaves (e.g. 'image-only, two buttons', 'hover image swap, badges')"}], "density": "compact"|"comfortable"|"airy", "imageLed": true|false, "uppercaseLabels": true|false, "feel": "one sentence on the overall style"}.
List the home page sections in order (skip the header and footer, keep an announcement bar). At most 14.`,
      },
      { role: 'user', content: `Page: ${title}\nSections:\n${lines.join('\n')}\nFonts: ${cues.fonts.join(', ') || 'unknown'}. Uppercase rules in CSS: ${cues.uppercase}.` },
    ],
  }).catch(() => null)
  const out = r ? parseAiJson<Partial<ReferenceProfile> & Record<string, unknown>>(r.content) : null
  // Models name the list differently and give items as strings or objects; read any of those.
  const rawList = [out?.sequence, out?.sections, out?.patterns].find(Array.isArray) as unknown[] | undefined
  const fromModel = (rawList ?? [])
    .map(item => {
      const o = (item && typeof item === 'object' ? item : { pattern: item }) as Record<string, unknown>
      const name = String(o.pattern ?? o.type ?? o.kind ?? '').toLowerCase().replace(/[\s-]+/g, '_')
      return { pattern: (PATTERNS as readonly string[]).includes(name) ? (name as Pattern) : ('other' as Pattern), note: String(o.note ?? o.description ?? '').slice(0, 120) }
    })
    .filter(x => x.pattern !== 'other' || x.note)
  const heuristic = classify(chunks)
  const sequence = (fromModel.filter(x => x.pattern !== 'other').length >= Math.min(3, heuristic.length) ? fromModel : heuristic).slice(0, 14)
  return {
    url,
    title,
    sequence,
    fonts: { display: cues.matched[0], body: cues.matched[1] ?? cues.matched[0] },
    colors: cues.palette,
    uppercaseLabels: typeof out?.uppercaseLabels === 'boolean' ? out.uppercaseLabels : cues.uppercase > 5,
    density: out?.density === 'compact' || out?.density === 'airy' ? out.density : 'comfortable',
    imageLed: !!out?.imageLed,
    feel: String(out?.feel ?? '').slice(0, 240),
  }
}
