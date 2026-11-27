import type { SkillIssue } from '../types'

// A minimal YAML subset for skill frontmatter: scalars, [a, b] lists, "- item" lists, one level of "sub: value" maps, # comments.

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
      if (i === 0 || /[\s[,:]/.test(s[i - 1])) q = c
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

/** Splits the inside of [a, b, "c, d"] on top-level commas. */
function splitList(inner: string): string[] | { error: string } {
  const parts: string[] = []
  let cur = ''
  let q: string | null = null
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i]
    if (q) {
      cur += c
      if (c === '\\' && q === '"' && i + 1 < inner.length) cur += inner[++i]
      else if (c === q) q = null
    } else if (c === '"' || c === "'") {
      q = c
      cur += c
    } else if (c === ',') {
      parts.push(cur)
      cur = ''
    } else cur += c
  }
  if (q) return { error: 'Unterminated quote in list' }
  if (cur.trim() || parts.length) parts.push(cur)
  return parts
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
      const v = scalar(p)
      if ('error' in v) return v
      out.push(v.value)
    }
    return { value: out }
  }
  return scalar(s)
}

const indentOf = (l: string) => l.length - l.trimStart().length

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
  const rows = lines.slice(1, end).map((l, i) => ({ text: stripComment(l).replace(/\s+$/, ''), line: i + 2 }))
  const KEY = /^([A-Za-z_][\w-]*)\s*:(?:\s+(.*))?$/

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
    // "key:" alone: a block of indented lines follows (a list or a one-level map), or the value is null.
    const block: typeof rows = []
    while (i + 1 < rows.length && (!rows[i + 1].text.trim() || indentOf(rows[i + 1].text) > 0)) {
      i++
      if (rows[i].text.trim()) block.push(rows[i])
    }
    if (!block.length) {
      data[key] = null
    } else if (block[0].text.trim().startsWith('-')) {
      const list: unknown[] = []
      for (const b of block) {
        const t = b.text.trim()
        if (!/^-(\s|$)/.test(t)) {
          issues.push(err('frontmatter_list', `${key}: every line of a "- item" list must start with "- "`, b.line))
          continue
        }
        const v = scalar(t.slice(1))
        if ('error' in v) issues.push(err('frontmatter_value', `${key}: ${v.error}`, b.line))
        else list.push(v.value)
      }
      data[key] = list
    } else {
      const map: Record<string, unknown> = {}
      for (const b of block) {
        const sm = KEY.exec(b.text.trim())
        if (!sm) {
          issues.push(err('frontmatter_syntax', `${key}: expected "name: value", got "${b.text.trim().slice(0, 60)}"`, b.line))
          continue
        }
        const sub = (sm[2] ?? '').trim()
        if (!sub) {
          issues.push(err('frontmatter_nested', `${key}.${sm[1]}: only one level of nesting is supported`, b.line))
          continue
        }
        const v = value(sub)
        if ('error' in v) issues.push(err('frontmatter_value', `${key}.${sm[1]}: ${v.error}`, b.line))
        else map[sm[1]] = v.value
      }
      data[key] = map
    }
  }
  return { data, body: lines.slice(end + 1).join('\n'), bodyLine: end + 2, issues }
}
