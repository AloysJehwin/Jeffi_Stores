// A Tailwind grid's auto-placement worked out from its classes, without a browser: where a data list's items land at
// a given width for any number of them. A design is written once but a store's catalogue keeps changing size, so the
// studio's lint and the templates' tests use it to catch mosaics that leave holes, spans wider than the grid, and
// items squeezed into slivers.

const SCREENS = new Map([['sm', 640], ['md', 768], ['lg', 1024], ['xl', 1280], ['2xl', 1536]])
const ORDER = ['first', 'last', 'only', 'odd', 'even']

type Where = (i: number, n: number) => boolean
type Variant =
  | { kind: 'screen'; min: number }
  | { kind: 'where'; test: Where; spec: number; rank: number }
  /** A container class aimed at its items: `[&>*:first-child]:…`, `*:…`. */
  | { kind: 'child'; test: Where | null; spec: number }
  | { kind: 'state' }
  | { kind: 'unknown' }

/** `lg:[&:nth-child(2)]:col-span-6` → ['lg', '[&:nth-child(2)]', 'col-span-6'] (colons inside brackets kept). */
function parts(token: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of token) {
    if (ch === '[' || ch === '(') depth++
    else if (ch === ']' || ch === ')') depth--
    if (ch === ':' && depth === 0) {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out
}

/** An+B as a test on a 1-based position. */
function nth(formula: string): ((p: number) => boolean) | null {
  const f = formula.replace(/_/g, ' ').replace(/\s+/g, '').toLowerCase()
  if (f === 'odd') return p => p % 2 === 1
  if (f === 'even') return p => p % 2 === 0
  if (/^[+-]?\d+$/.test(f)) return p => p === Number(f)
  const m = /^([+-]?\d*)n([+-]\d+)?$/.exec(f)
  if (!m) return null
  const a = m[1] === '' || m[1] === '+' ? 1 : m[1] === '-' ? -1 : Number(m[1])
  const b = m[2] ? Number(m[2]) : 0
  return p => (a === 0 ? p === b : (p - b) / a >= 0 && Number.isInteger((p - b) / a))
}

/** `:nth-child(2):last-child`, `:not(:first-child)`… as a test on an item's index, with its specificity. */
function pseudo(sel: string): { test: Where; spec: number } | null {
  const tests: Where[] = []
  let spec = 0
  let rest = sel
  while (rest) {
    const m = /^:([a-z-]+)(?:\(((?:[^()]|\([^()]*\))*)\))?/.exec(rest)
    if (!m) return null
    rest = rest.slice(m[0].length)
    const [, name, arg] = m
    if (name === 'first-child') tests.push(i => i === 0)
    else if (name === 'last-child') tests.push((i, n) => i === n - 1)
    else if (name === 'only-child') tests.push((_i, n) => n === 1)
    else if ((name === 'nth-child' || name === 'nth-last-child') && arg != null) {
      const f = nth(arg)
      if (!f) return null
      tests.push(name === 'nth-child' ? i => f(i + 1) : (i, n) => f(n - i))
    } else if (name === 'not' && arg != null) {
      const inner = pseudo(arg)
      if (!inner) return null
      tests.push((i, n) => !inner.test(i, n))
      spec += inner.spec - 1
    } else return null
    spec++
  }
  return tests.length ? { test: (i, n) => tests.every(t => t(i, n)), spec } : null
}

function variant(v: string): Variant {
  const min = SCREENS.get(v)
  if (min != null) return { kind: 'screen', min }
  switch (v) {
    case 'first':
      return { kind: 'where', test: i => i === 0, spec: 1, rank: 1 }
    case 'last':
      return { kind: 'where', test: (i, n) => i === n - 1, spec: 1, rank: 2 }
    case 'only':
      return { kind: 'where', test: (_i, n) => n === 1, spec: 1, rank: 3 }
    case 'odd':
      return { kind: 'where', test: i => i % 2 === 0, spec: 1, rank: 4 }
    case 'even':
      return { kind: 'where', test: i => i % 2 === 1, spec: 1, rank: 5 }
  }
  if (v === '*') return { kind: 'child', test: null, spec: 0 }
  if (v.startsWith('[&') && v.endsWith(']')) {
    const sel = v.slice(2, -1).replace(/_/g, ' ').trim()
    const child = /^>\s*\*?\s*(.*)$/.exec(sel)
    if (child) {
      if (!child[1]) return { kind: 'child', test: null, spec: 0 }
      const p = pseudo(child[1])
      return p ? { kind: 'child', test: p.test, spec: p.spec } : { kind: 'unknown' }
    }
    const p = pseudo(sel)
    return p ? { kind: 'where', ...p, rank: ORDER.length + 1 } : { kind: 'unknown' }
  }
  // Other media and container queries and arbitrary selectors change where things go in ways not worked out here.
  if (/^(max-|min-|supports-|@)/.test(v) || v.startsWith('[')) return { kind: 'unknown' }
  // hover, focus, group-*, peer-*, dark, aria-*, data-*, motion-*, print…: not the layout a page loads with.
  return { kind: 'state' }
}

type Util = { k: 'col' | 'row'; span: number } | { k: 'cols'; n: number } | { k: 'display'; grid: boolean; hidden: boolean } | { k: 'flow'; dense: boolean; col: boolean } | { k: 'unknown' }

function utility(raw: string): Util | null {
  const u = raw.replace(/^!/, '')
  let m: RegExpExecArray | null
  if ((m = /^(col|row)-span-(\d+|full)$/.exec(u))) return { k: m[1] as 'col' | 'row', span: m[2] === 'full' ? Infinity : Number(m[2]) }
  if ((m = /^(col|row)-auto$/.exec(u))) return { k: m[1] as 'col' | 'row', span: 1 }
  if ((m = /^grid-cols-(\d+)$/.exec(u))) return { k: 'cols', n: Number(m[1]) }
  if (/^grid-cols-/.test(u) || /^(col|row)-(start|end)-/.test(u) || u === 'contents' || u === 'subgrid') return { k: 'unknown' }
  if (/^(block|inline-block|inline|flex|inline-flex|grid|inline-grid|table|flow-root|list-item|hidden)$/.test(u)) return { k: 'display', grid: u === 'grid' || u === 'inline-grid', hidden: u === 'hidden' }
  if ((m = /^grid-flow-(row|col|dense|row-dense|col-dense)$/.exec(u))) return { k: 'flow', dense: m[1].includes('dense'), col: m[1].startsWith('col') }
  return null
}

type Rule = { util: Util; min: number; where: Where | null; spec: number; arbitrary: boolean; rank: number; value: number; child: boolean }

/** An element's classes as rules; a container's rules aimed at its items carry `child`. Null when one can't be read. */
function rules(classes: string[]): Rule[] | null {
  const out: Rule[] = []
  for (const token of classes) {
    const p = parts(token)
    const util = utility(p[p.length - 1])
    if (!util) continue
    let min = 0
    let spec = 1
    let rank = 0
    let arbitrary = false
    const tests: Where[] = []
    let state = false
    let child = false
    for (const v of p.slice(0, -1).map(variant)) {
      if (v.kind === 'unknown') return null
      if (v.kind === 'state') state = true
      else if (v.kind === 'screen') min = Math.max(min, v.min)
      else if (v.kind === 'child') {
        if (child) return null
        child = true
        spec += v.spec
        arbitrary = true
        if (v.test) tests.push(v.test)
      } else {
        tests.push(v.test)
        spec += v.spec
        rank = Math.max(rank, v.rank)
        arbitrary ||= v.rank > ORDER.length
      }
    }
    if (state) continue
    if (util.k === 'unknown') return null
    const value = util.k === 'col' || util.k === 'row' ? util.span : util.k === 'cols' ? util.n : 0
    out.push({ util, min, where: tests.length ? (i, n) => tests.every(t => t(i, n)) : null, spec, arbitrary, rank, value, child })
  }
  return out
}

/** The winning rule of a kind for an element at a width (specificity, then Tailwind's order: arbitrary variants last). */
function pick(list: Rule[], kind: Util['k'], width: number, i: number, n: number): Rule | null {
  let best: Rule | null = null
  const key = (r: Rule) => [r.spec, r.arbitrary ? 1 : 0, r.min, r.rank, r.value]
  for (const r of list) {
    if (r.util.k !== kind || r.min > width || (r.where && !r.where(i, n))) continue
    if (!best) best = r
    else {
      const a = key(r)
      const b = key(best)
      const at = a.findIndex((x, j) => x !== b[j])
      if (at >= 0 && a[at] > b[at]) best = r
    }
  }
  return best
}

export interface GridCheck {
  width: number
  cols: number
  rows: number
  /** Empty cells inside the grid's rectangle (a plain grid's short last row is not counted). */
  holes: number
  /** An item spans more columns than the grid has (the browser adds columns and the layout breaks). */
  overflow: boolean
  /** An item narrower than an eighth of the row. */
  narrow: boolean
}

/**
 * Where the items (each its own classes, in order) land in the container at a width. Null when the container is not a
 * grid there, or the classes use something not worked out here (explicit lines, column flow, other queries).
 */
export function checkGrid(container: string[], items: string[][], width: number): GridCheck | null {
  const all = rules(container)
  if (!all) return null
  const box = all.filter(r => !r.child)
  const toItems = all.filter(r => r.child)
  const display = pick(box, 'display', width, 0, 1)
  if (!display || display.util.k !== 'display' || !display.util.grid) return null
  const flow = pick(box, 'flow', width, 0, 1)
  if (flow?.util.k === 'flow' && flow.util.col) return null
  const dense = flow?.util.k === 'flow' && flow.util.dense
  const colsRule = pick(box, 'cols', width, 0, 1)
  const cols = colsRule?.util.k === 'cols' ? colsRule.util.n : 1
  if (!(cols >= 1)) return null

  const n = items.length
  const spans: [number, number][] = []
  for (let i = 0; i < n; i++) {
    const mine = rules(items[i])
    if (!mine) return null
    const own = [...mine.filter(r => !r.child), ...toItems]
    const d = pick(own, 'display', width, i, n)
    if (d?.util.k === 'display' && d.util.hidden) continue
    const c = pick(own, 'col', width, i, n)
    const r = pick(own, 'row', width, i, n)
    spans.push([c?.util.k === 'col' ? c.util.span : 1, r?.util.k === 'row' ? r.util.span : 1])
  }
  if (spans.some(([, h]) => !Number.isFinite(h))) return null

  const taken: boolean[][] = []
  const free = (y: number, x: number, w: number, h: number) => {
    for (let r = y; r < y + h; r++) for (let c = x; c < x + w; c++) if (taken[r]?.[c]) return false
    return true
  }
  let overflow = false
  let narrow = false
  let rows = 0
  let cells = 0
  let y = 0
  let x = 0
  for (const [w0, h] of spans) {
    if (w0 > cols && Number.isFinite(w0)) overflow = true
    const w = Math.min(w0, cols)
    if (w / cols < 1 / 8) narrow = true
    if (dense) y = x = 0
    while (!(x + w <= cols && free(y, x, w, h))) {
      x++
      if (x + w > cols) {
        y++
        x = 0
      }
    }
    for (let r = y; r < y + h; r++) for (let c = x; c < x + w; c++) (taken[r] ??= [])[c] = true
    rows = Math.max(rows, y + h)
    cells += w * h
  }
  const plain = spans.every(([w, h]) => w === 1 && h === 1)
  const empty = rows * cols - cells
  return { width, cols, rows, holes: plain && empty < cols ? 0 : empty, overflow, narrow }
}

export const PHONE = 390
export const DESKTOP = 1440

/**
 * The first item count (1…max) at which a data list's grid goes wrong on a phone or a desktop: every item wearing the
 * same classes (structural variants such as first: pick them out). Null when it holds for every count, or can't tell.
 */
export function gridTrouble(container: string[], item: string[], max: number): { n: number; check: GridCheck } | null {
  for (let n = 1; n <= max; n++)
    for (const width of [PHONE, DESKTOP]) {
      const check = checkGrid(container, Array.from({ length: n }, () => item), width)
      if (check && (check.holes > 0 || check.overflow || check.narrow)) return { n, check }
    }
  return null
}
