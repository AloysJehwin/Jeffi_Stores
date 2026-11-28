import type { SkillIssue } from '../types'

// A minimal YAML subset for skill frontmatter: scalars, [a, b] lists, { a: b } flow maps, "- item" lists, maps nested two
// levels below a key (the inputs: block), # comments.

export interface Frontmatter {
  data: Record<string, unknown>
  /** Everything after the closing fence (or the whole text when there is no frontmatter). */
  body: string
  /** 1-based line of the body's first line in the original text. */
  bodyLine: number
  issues: SkillIssue[]
}

const err = (code: string, message: string, line?: number): SkillIssue => ({ level: 'error', code, message, line })
const warn = (code: string, message: string, line?: number): SkillIssue => ({ level: 'warning', code, message, line })

/** Drops a trailing "# comment" (a # at the start or after whitespace, outside quotes). */
function stripComment(s: string): string {
  let q: string | null = null
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (q) {
      if (c === '\\' && q === '"') i++
      else if (c === q) q = null
    } else if (c === '"' || c === "'") {
      if (i === 0 || /[\s[{,:]/.test(s[i - 1])) q = c
    } else if (c === '#' && (i === 0 || /\s/.test(s[i - 1]))) {
      return s.slice(0, i)
    }
  }
  return s
}

function unquote(s: string): { value: string } | { error: string } {
  const q = s[0]
  if (s.length < 2 || s[s.length - 1] !== q) return { error: 'Unterminated quote' }
  const inner = s.slice(1, -1)
  if (q === "'") return { value: inner.replace(/''/g, "'") }
  return { value: inner.replace(/\\(["\\nt])/g, (_, c: string) => (c === 'n' ? '\n' : c === 't' ? '\t' : c)) }
}

function scalar(raw: string): { value: unknown } | { error: string } {
  const s = raw.trim()
  if (!s) return { value: null }
  if (s[0] === '"' || s[0] === "'") return unquote(s)
  if (/^-?\d+(\.\d+)?$/.test(s)) return { value: Number(s) }
  if (s === 'true') return { value: true }
  if (s === 'false') return { value: false }
  if (s === 'null' || s === '~') return { value: null }
  return { value: s }
}

/** Splits the inside of [a, b, "c, d"] or { a: b, c: [x, y] } on top-level commas. */
function splitList(inner: string): string[] | { error: string } {
  const parts: string[] = []
  let cur = ''
  let q: string | null = null
  let depth = 0
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i]
    if (q) {
      cur += c
      if (c === '\\' && q === '"' && i + 1 < inner.length) cur += inner[++i]
      else if (c === q) q = null
    } else if (c === '"' || c === "'") {
      q = c
      cur += c
    } else if (c === '[' || c === '{') {
      depth++
      cur += c
    } else if (c === ']' || c === '}') {
      depth--
      cur += c
    } else if (c === ',' && depth === 0) {
      parts.push(cur)
      cur = ''
    } else cur += c
  }
  if (q) return { error: 'Unterminated quote in list' }
  if (cur.trim() || parts.length) parts.push(cur)
  return parts
}

/** Index of the first top-level ":" in a flow-map entry, or -1. */
function colonAt(part: string): number {
  let q: string | null = null
  let depth = 0
  for (let i = 0; i < part.length; i++) {
    const c = part[i]
    if (q) {
      if (c === '\\' && q === '"') i++
      else if (c === q) q = null
    } else if (c === '"' || c === "'") q = c
    else if (c === '[' || c === '{') depth++
    else if (c === ']' || c === '}') depth--
    else if (c === ':' && depth === 0 && (i + 1 === part.length || /\s/.test(part[i + 1]))) return i
  }
  return -1
}

function value(raw: string): { value: unknown } | { error: string } {
  const s = raw.trim()
  if (s[0] === '[') {
    if (s[s.length - 1] !== ']') return { error: 'Unclosed [ list' }
    const parts = splitList(s.slice(1, -1))
    if ('error' in parts) return parts
    const out: unknown[] = []
    for (const p of parts) {
      if (!p.trim()) continue
      const v = value(p)
      if ('error' in v) return v
      out.push(v.value)
    }
    return { value: out }
  }
  if (s[0] === '{') {
    if (s[s.length - 1] !== '}') return { error: 'Unclosed { map' }
    const parts = splitList(s.slice(1, -1))
    if ('error' in parts) return parts
    const out: Record<string, unknown> = {}
    for (const p of parts) {
      if (!p.trim()) continue
      const at = colonAt(p)
      if (at < 0) return { error: `Expected "name: value" inside { }, got "${p.trim().slice(0, 40)}"` }
      const k = scalar(p.slice(0, at))
      if ('error' in k || typeof k.value !== 'string') return { error: `Bad key inside { }: "${p.slice(0, at).trim().slice(0, 40)}"` }
      const v = value(p.slice(at + 1))
      if ('error' in v) return v
      out[k.value] = v.value
    }
    return { value: out }
  }
  return scalar(s)
}

const indentOf = (l: string) => l.length - l.trimStart().length

interface Row {
  text: string
  line: number
}

const KEY = /^([A-Za-z_][\w-]*)\s*:(?:\s+(.*))?$/
/** Maps may nest this many levels below a top-level key (inputs → name → fields). */
const MAX_DEPTH = 2

function blockValue(path: string, block: Row[], depth: number, issues: SkillIssue[]): unknown {
  if (!block.length) return null
  if (block[0].text.trim().startsWith('-')) {
    const list: unknown[] = []
    for (const b of block) {
      const t = b.text.trim()
      if (!/^-(\s|$)/.test(t)) {
        issues.push(err('frontmatter_list', `${path}: every line of a "- item" list must start with "- "`, b.line))
        continue
      }
      const v = scalar(t.slice(1))
      if ('error' in v) issues.push(err('frontmatter_value', `${path}: ${v.error}`, b.line))
      else list.push(v.value)
    }
    return list
  }
  const base = indentOf(block[0].text)
  const map: Record<string, unknown> = {}
  for (let i = 0; i < block.length; i++) {
    const b = block[i]
    const sm = indentOf(b.text) === base ? KEY.exec(b.text.trim()) : null
    if (!sm) {
      issues.push(err('frontmatter_syntax', `${path}: expected "name: value", got "${b.text.trim().slice(0, 60)}"`, b.line))
      continue
    }
    const sub = (sm[2] ?? '').trim()
    if (sub) {
      const v = value(sub)
      if ('error' in v) issues.push(err('frontmatter_value', `${path}.${sm[1]}: ${v.error}`, b.line))
      else map[sm[1]] = v.value
      continue
    }
    const child: Row[] = []
    while (i + 1 < block.length && indentOf(block[i + 1].text) > base) child.push(block[++i])
    if (!child.length) continue
    if (depth >= MAX_DEPTH) {
      issues.push(err('frontmatter_nested', `${path}.${sm[1]}: maps nest at most two levels below a key`, b.line))
      continue
    }
    map[sm[1]] = blockValue(`${path}.${sm[1]}`, child, depth + 1, issues)
  }
  return map
}

export function parseFrontmatter(raw: string): Frontmatter {
  const text = raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  const lines = text.split('\n')
  if (lines[0].trimEnd() !== '---') return { data: {}, body: text, bodyLine: 1, issues: [] }
  let end = -1
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trimEnd() === '---') {
      end = i
      break
    }
  }
  if (end < 0) {
    return { data: {}, body: text, bodyLine: 1, issues: [err('frontmatter_unclosed', 'The frontmatter starts with --- but is never closed with a second ---', 1)] }
  }
  const issues: SkillIssue[] = []
  const data: Record<string, unknown> = {}
  const rows: Row[] = lines.slice(1, end).map((l, i) => ({ text: stripComment(l).replace(/\s+$/, ''), line: i + 2 }))

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    if (!row.text.trim()) continue
    if (indentOf(row.text) > 0) {
      issues.push(err('frontmatter_indent', 'Unexpected indented line', row.line))
      continue
    }
    const m = KEY.exec(row.text)
    if (!m) {
      issues.push(err('frontmatter_syntax', `Expected "key: value", got "${row.text.trim().slice(0, 60)}"`, row.line))
      continue
    }
    const key = m[1]
    if (key in data) issues.push(warn('frontmatter_duplicate', `"${key}" is set twice; the last one wins`, row.line))
    const rest = (m[2] ?? '').trim()
    if (rest) {
      const v = value(rest)
      if ('error' in v) issues.push(err('frontmatter_value', `${key}: ${v.error}`, row.line))
      else data[key] = v.value
      continue
    }
    // "key:" alone: a block of indented lines follows (a list or a nested map), or the value is null.
    const block: typeof rows = []
    while (i + 1 < rows.length && (!rows[i + 1].text.trim() || indentOf(rows[i + 1].text) > 0)) {
      i++
      if (rows[i].text.trim()) block.push(rows[i])
    }
    data[key] = blockValue(key, block, 1, issues)
  }
  return { data, body: lines.slice(end + 1).join('\n'), bodyLine: end + 2, issues }
}
