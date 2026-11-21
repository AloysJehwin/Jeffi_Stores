// Comparing what an owner typed with what a document says, tolerant of OCR noise: names by token similarity
// (legal suffixes and honorifics ignored), dates in the formats Indian certificates print, IDs with the usual
// letter/digit confusions repaired by position.

const SUFFIXES = new Set([
  'PRIVATE', 'PVT', 'LIMITED', 'LTD', 'LLP', 'CO', 'COMPANY', 'CORP', 'CORPORATION', 'INC', 'OPC', 'THE', 'AND',
  'M', 'S', 'MS', 'MR', 'MRS', 'SHRI', 'SMT', 'KUMARI', 'DR', 'FIRM', 'PROPRIETOR', 'PROP',
])

/** A name as comparable tokens: capitals, letters and digits only, legal suffixes and honorifics dropped. */
export function nameTokens(v: string | null | undefined): string[] {
  return String(v ?? '')
    .toUpperCase()
    .replace(/&/g, ' AND ')
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter(t => t && !SUFFIXES.has(t))
}

function editDistance(a: string, b: string): number {
  if (a === b) return 0
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]
    prev[0] = i
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j]
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1))
      diag = up
    }
  }
  return prev[b.length]
}

const tokenSim = (a: string, b: string) => 1 - editDistance(a, b) / Math.max(a.length, b.length, 1)

/**
 * How alike two names are, 0..1: each expected token is matched to its closest token on the document (an OCR slip
 * costs a little), and initials match a word they begin. Word order doesn't matter.
 */
export function nameSimilarity(expected: string, found: string): number {
  const e = nameTokens(expected)
  const f = nameTokens(found)
  if (!e.length || !f.length) return 0
  const used = new Set<number>()
  let score = 0
  for (const t of e) {
    let best = 0
    let at = -1
    f.forEach((u, i) => {
      if (used.has(i)) return
      const s = t.length === 1 || u.length === 1 ? (t[0] === u[0] ? 0.9 : 0) : tokenSim(t, u)
      if (s > best) {
        best = s
        at = i
      }
    })
    if (at >= 0 && best >= 0.6) used.add(at)
    score += best >= 0.6 ? best : 0
  }
  // Extra words on the document (a father's name, "TRADERS") cost less than missing ones.
  const extra = f.length - used.size
  return score / (e.length + extra * 0.25)
}

export const NAME_MATCH = 0.85
export const NAME_CLOSE = 0.6

/** The line (or two adjoining lines) of `lines` that best matches `expected`, with its score. */
export function bestNameLine(expected: string, lines: string[]): { text: string; score: number } | null {
  let best: { text: string; score: number } | null = null
  for (let i = 0; i < lines.length; i++) {
    for (const text of [lines[i], i + 1 < lines.length ? `${lines[i]} ${lines[i + 1]}` : '']) {
      if (!text) continue
      const score = nameSimilarity(expected, text)
      if (!best || score > best.score) best = { text: text.trim(), score }
    }
  }
  return best
}

const MONTHS: Record<string, number> = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, SEPT: 9, OCT: 10, NOV: 11, DEC: 12 }

const iso = (y: number, m: number, d: number) => {
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1 || d > 31) return null
  const s = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  return new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s ? s : null
}

/** Every date in `text` as YYYY-MM-DD, in order: 31/12/2026, 31-12-2026, 31.12.2026, 31 Dec 2026, 2026-12-31. */
export function datesIn(text: string): string[] {
  const out: string[] = []
  const re = /\b(\d{4})-(\d{2})-(\d{2})\b|\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\b|\b(\d{1,2})[\s-]*([A-Za-z]{3,9})[,\s-]*(\d{4})\b/g
  for (const m of text.matchAll(re)) {
    const d = m[1]
      ? iso(+m[1], +m[2], +m[3])
      : m[4]
        ? iso(+m[6], +m[5], +m[4])
        : iso(+m[9], MONTHS[m[8].toUpperCase().slice(0, m[8].toUpperCase().startsWith('SEPT') ? 4 : 3)] ?? 0, +m[7])
    if (d) out.push(d)
  }
  return out
}

/** The first date after `label` on its line, or on the line after it. */
export function labelledDate(lines: string[], label: RegExp): string | null {
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(label)
    if (!m) continue
    const here = datesIn(lines[i].slice((m.index ?? 0) + m[0].length))[0] ?? datesIn(lines[i + 1] ?? '')[0]
    if (here) return here
  }
  return null
}

// OCR reads 0/O, 1/I, 5/S, 8/B, 2/Z and 6/G for one another; an ID's layout says which one a position must be.
const TO_LETTER: Record<string, string> = { '0': 'O', '1': 'I', '2': 'Z', '5': 'S', '6': 'G', '8': 'B', '4': 'A', '7': 'T' }
const TO_DIGIT: Record<string, string> = { O: '0', Q: '0', D: '0', I: '1', L: '1', Z: '2', S: '5', G: '6', B: '8', T: '7', A: '4' }

/** `raw` repaired to `layout` (A: a letter, 9: a digit, X: either), or null when a position can't be either. */
export function repairId(raw: string, layout: string): string | null {
  const s = raw.toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (s.length !== layout.length) return null
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (layout[i] === 'A') out += /[A-Z]/.test(c) ? c : (TO_LETTER[c] ?? '?')
    else if (layout[i] === '9') out += /[0-9]/.test(c) ? c : (TO_DIGIT[c] ?? '?')
    else out += c
  }
  return out.includes('?') ? null : out
}

/** Every run of letters and digits in `text` (gaps of single spaces or hyphens bridged) of exactly `len` characters. */
export function idCandidates(text: string, len: number): string[] {
  const out = new Set<string>()
  const compact = text.toUpperCase().replace(/[^A-Z0-9\n]+/g, m => (/\n/.test(m) ? '\n' : m.length <= 2 ? '' : ' '))
  for (const line of compact.split('\n')) {
    for (const word of line.split(' ')) for (let i = 0; i + len <= word.length; i++) out.add(word.slice(i, i + len))
  }
  return [...out]
}
