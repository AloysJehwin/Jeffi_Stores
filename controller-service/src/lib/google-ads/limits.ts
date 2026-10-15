// Google Ads text limits for the assets the console writes. Client-safe: the wizard shows counters
// with these and the server enforces them again before anything reaches Google.

export const LIMITS = {
  headline: 30,
  longHeadline: 90,
  description: 90,
  /** Performance Max needs at least one description this short. */
  shortDescription: 60,
  path: 15,
  businessName: 25,
  sitelinkText: 25,
  sitelinkDescription: 35,
  callout: 25,
  snippetValue: 25,
  promotionTarget: 20,
  priceHeader: 25,
  priceDescription: 25,
  keyword: 80,
  name: 120,
} as const

export type LimitKey = keyof typeof LIMITS

/** [min, max] item counts. */
export const COUNTS = {
  rsaHeadlines: [3, 15],
  rsaDescriptions: [2, 4],
  pmaxHeadlines: [3, 15],
  pmaxLongHeadlines: [1, 5],
  pmaxDescriptions: [2, 5],
  snippetValues: [3, 10],
  priceOfferings: [3, 8],
  sitelinks: [0, 20],
  callouts: [0, 20],
} as const

// Google counts CJK and other full-width characters as two.
const WIDE: [number, number][] = [
  [0x1100, 0x115f],
  [0x2e80, 0xa4cf],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe30, 0xfe4f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
]
const isWide = (cp: number) => WIDE.some(([a, b]) => cp >= a && cp <= b)

export function adTextLength(s: string): number {
  let n = 0
  for (const ch of s) n += isWide(ch.codePointAt(0) ?? 0) ? 2 : 1
  return n
}

export function fits(s: string | null | undefined, max: number): boolean {
  return !!s && adTextLength(s) <= max
}

const EMOJI = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu

/** Whitespace and punctuation Google's editorial review rejects (emoji, repeated !, all-caps runs are left to the admin). */
export function cleanAdText(s: string, opts: { headline?: boolean } = {}): string {
  let t = String(s ?? '')
    .replace(EMOJI, '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/!{2,}/g, '!')
    .replace(/^["'\s]+|["'\s]+$/g, '')
    .trim()
  // Headlines may not carry an exclamation mark.
  if (opts.headline) t = t.replace(/!/g, '').trim()
  return t
}

/** Shorten at a word boundary; null when what is left is too short to keep. */
export function clipAtWord(s: string, max: number, minRatio = 0.6): string | null {
  if (adTextLength(s) <= max) return s
  const words = s.split(' ')
  let out = ''
  for (const w of words) {
    const next = out ? `${out} ${w}` : w
    if (adTextLength(next) > max) break
    out = next
  }
  out = out.replace(/[\s,;:\-–—&/]+$/u, '').trim()
  return out && adTextLength(out) >= Math.floor(max * minRatio) ? out : null
}

/** Clean, length-check (clipping when it still reads), dedupe and cap a list of ad texts. */
export function enforceTexts(
  items: unknown,
  max: number,
  opts: { headline?: boolean; maxItems?: number; clip?: boolean } = {}
): { kept: string[]; dropped: number } {
  const seen = new Set<string>()
  const kept: string[] = []
  let dropped = 0
  for (const raw of Array.isArray(items) ? items : []) {
    if (typeof raw !== 'string') {
      dropped++
      continue
    }
    let t = cleanAdText(raw, { headline: opts.headline })
    if (t && adTextLength(t) > max) t = opts.clip === false ? '' : clipAtWord(t, max) ?? ''
    const key = t.toLowerCase()
    if (!t || seen.has(key)) {
      dropped++
      continue
    }
    seen.add(key)
    kept.push(t)
  }
  const cap = opts.maxItems ?? kept.length
  return { kept: kept.slice(0, cap), dropped: dropped + Math.max(0, kept.length - cap) }
}

/** Problems with one text list: counts and lengths. Empty strings are ignored. */
export function textListProblems(label: string, items: string[], max: number, count?: readonly [number, number]): string[] {
  const list = items.map(s => s.trim()).filter(Boolean)
  const out: string[] = []
  list.forEach((s, i) => {
    if (adTextLength(s) > max) out.push(`${label} ${i + 1} is longer than ${max} characters`)
  })
  const plural = `${label.charAt(0).toLowerCase()}${label.slice(1)}s`
  if (count && list.length < count[0]) out.push(`Add at least ${count[0]} ${plural}`)
  if (count && list.length > count[1]) out.push(`Use at most ${count[1]} ${plural}`)
  const dupes = list.filter((s, i) => list.findIndex(x => x.toLowerCase() === s.toLowerCase()) !== i)
  if (dupes.length) out.push(`${label}s must be unique ("${dupes[0]}" is repeated)`)
  return out
}

// Characters Google does not accept in keywords.
const KEYWORD_BAD = /[!@%^()={};~`<>?\\|,*]/g

export function cleanKeyword(s: string): string {
  return cleanAdText(s).replace(KEYWORD_BAD, ' ').replace(/\s{2,}/g, ' ').trim().toLowerCase()
}

export function keywordProblem(s: string): string | null {
  const t = cleanKeyword(s)
  if (!t) return 'Keyword is empty'
  if (adTextLength(t) > LIMITS.keyword) return `Keyword "${t.slice(0, 20)}..." is longer than ${LIMITS.keyword} characters`
  if (t.split(' ').length > 10) return `Keyword "${t}" has more than 10 words`
  return null
}
