// Three-way merge of a draft against live (docs/plans/MULTI_DRAFT_PLAN.md).
// base = live when the draft started, mine = the draft, live = now. A draft stores the whole form,
// so fields the admin never touched take the newer live value instead of reverting it.

export type Content = Record<string, unknown>
/** Array fields merged per element: field name -> the element's id key (e.g. { variants: 'id' }). */
export type ArrayKeys = Record<string, string>

export interface MergeConflict {
  path: string
  label: string
  base: unknown
  theirs: unknown
  mine: unknown
  theirsBy?: string | null
  theirsAt?: string | null
}

export type Resolution = 'mine' | 'theirs' | { value: unknown }

export interface MergeResult {
  merged: Content
  mineChanged: string[]
  theirsChanged: string[]
  conflicts: MergeConflict[]
}

/** Comparable form: '' / undefined -> null, numbers and numeric strings compare as text, keys sorted. */
function canon(v: unknown): unknown {
  if (v === undefined || v === '') return null
  if (typeof v === 'number') return String(v)
  if (typeof v === 'string') {
    // "12.50" from a form equals 12.5 from the db; "0401" (HSN, pincode) stays text.
    if (/^-?(0|[1-9]\d*)(\.\d+)?$/.test(v)) return String(Number(v))
    if (v === 'true' || v === 'false') return v === 'true'
    return v
  }
  if (Array.isArray(v)) return v.map(canon)
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {}
    for (const k of Object.keys(v as object).sort()) o[k] = canon((v as Record<string, unknown>)[k])
    return o
  }
  return v
}

export function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(canon(a)) === JSON.stringify(canon(b))
}

const PRESENT = '__present__'
const isEl = (p: string) => p.endsWith(`]`)

/** Flat path map: scalar fields as `field`, keyed array elements as `field[id]` (presence) and `field[id].sub`. */
export function flatten(obj: Content, arrayKeys: ArrayKeys = {}): Map<string, unknown> {
  const out = new Map<string, unknown>()
  for (const [k, v] of Object.entries(obj ?? {})) {
    const idKey = arrayKeys[k]
    if (idKey && Array.isArray(v)) {
      v.forEach((el, i) => {
        if (!el || typeof el !== 'object') return
        const id = String((el as Record<string, unknown>)[idKey] ?? `#${i}`)
        out.set(`${k}[${id}]`, PRESENT)
        for (const [s, sv] of Object.entries(el as Record<string, unknown>)) out.set(`${k}[${id}].${s}`, sv)
      })
    } else out.set(k, v)
  }
  return out
}

function unflatten(flat: Map<string, unknown>, order: Content[], arrayKeys: ArrayKeys): Content {
  const out: Content = {}
  const els: Record<string, Map<string, Record<string, unknown>>> = {}
  for (const [p, v] of flat) {
    const m = /^([^[]+)\[([^\]]*)\](?:\.(.+))?$/.exec(p)
    if (m && arrayKeys[m[1]]) {
      const [, field, id, sub] = m
      els[field] ??= new Map()
      if (!sub) {
        if (v === PRESENT && !els[field].has(id)) els[field].set(id, {})
      } else if (els[field].has(id) || flat.get(`${field}[${id}]`) === PRESENT) {
        if (!els[field].has(id)) els[field].set(id, {})
        if (v !== undefined) els[field].get(id)![sub] = v
      }
    } else if (v !== undefined) out[p] = v
  }
  for (const field of Object.keys(arrayKeys)) {
    const present = els[field]
    if (!present) continue
    // Order: mine, then theirs, then base; elements nobody kept are dropped.
    const ids: string[] = []
    for (const src of order) {
      const arr = src?.[field]
      if (!Array.isArray(arr)) continue
      arr.forEach((el, i) => {
        const id = String((el as Record<string, unknown>)?.[arrayKeys[field]] ?? `#${i}`)
        if (present.has(id) && !ids.includes(id)) ids.push(id)
      })
    }
    out[field] = ids.map(id => present.get(id)!)
  }
  return out
}

/** Paths whose value differs between two contents (same flattening as the merge). */
export function changedPaths(before: Content, after: Content, arrayKeys: ArrayKeys = {}): Record<string, { from: unknown; to: unknown }> {
  const a = flatten(before, arrayKeys)
  const b = flatten(after, arrayKeys)
  const out: Record<string, { from: unknown; to: unknown }> = {}
  for (const p of new Set([...a.keys(), ...b.keys()])) {
    if (!same(a.get(p), b.get(p))) out[p] = { from: a.get(p) ?? null, to: b.get(p) ?? null }
  }
  return out
}

/** Restrict live to the fields the draft carries (live rows have extra columns). */
export function project(live: Content, shape: Content[]): Content {
  const keys = new Set(shape.flatMap(s => Object.keys(s ?? {})))
  const out: Content = {}
  for (const k of keys) if (k in live) out[k] = live[k]
  return out
}

function elementPath(p: string): string | null {
  const m = /^([^[]+\[[^\]]*\])\./.exec(p)
  return m ? m[1] : null
}

export function threeWayMerge(
  base: Content,
  mine: Content,
  live: Content,
  opts: { arrayKeys?: ArrayKeys; labels?: Record<string, string>; resolutions?: Record<string, Resolution> } = {}
): MergeResult {
  const ak = opts.arrayKeys ?? {}
  const B = flatten(base, ak)
  const M = flatten(mine, ak)
  const L = flatten(live, ak)
  const merged = new Map<string, unknown>()
  const mineChanged: string[] = []
  const theirsChanged: string[] = []
  const conflicts: MergeConflict[] = []
  const paths = new Set([...B.keys(), ...M.keys(), ...L.keys()])

  // An element deleted on one side and edited on the other is one conflict on the element.
  const elConflicts = new Set<string>()
  for (const p of paths) {
    if (!isEl(p)) continue
    const mineGone = B.has(p) && !M.has(p)
    const theirsGone = B.has(p) && !L.has(p)
    if (!mineGone && !theirsGone) continue
    const prefix = `${p}.`
    const edited = (X: Map<string, unknown>) => [...paths].some(q => q.startsWith(prefix) && !same(B.get(q), X.get(q)))
    if ((mineGone && !theirsGone && edited(L)) || (theirsGone && !mineGone && edited(M))) elConflicts.add(p)
  }

  for (const p of paths) {
    const el = isEl(p) ? p : elementPath(p)
    if (el && elConflicts.has(el)) continue
    const b = B.get(p)
    const m = M.get(p)
    const l = L.get(p)
    const mc = !same(m, b)
    const tc = !same(l, b)
    if (mc) mineChanged.push(p)
    if (tc) theirsChanged.push(p)
    if (mc && tc && !same(m, l)) {
      conflicts.push({ path: p, label: labelOf(p, opts.labels), base: b ?? null, theirs: l ?? null, mine: m ?? null })
      merged.set(p, m)
    } else merged.set(p, mc ? m : l)
  }

  for (const el of elConflicts) {
    const pick = (X: Map<string, unknown>) => {
      if (!X.has(el)) return null
      const o: Record<string, unknown> = {}
      for (const [q, v] of X) if (q.startsWith(`${el}.`)) o[q.slice(el.length + 1)] = v
      return o
    }
    conflicts.push({ path: el, label: labelOf(el, opts.labels), base: pick(B), theirs: pick(L), mine: pick(M) })
    for (const [q, v] of M) if (q === el || q.startsWith(`${el}.`)) merged.set(q, v)
  }

  // Apply the admin's choices; anything still unresolved stays in `conflicts`.
  const res = opts.resolutions ?? {}
  const open: MergeConflict[] = []
  for (const c of conflicts) {
    const r = res[c.path]
    if (!r) {
      open.push(c)
      continue
    }
    const src = r === 'theirs' ? L : r === 'mine' ? M : null
    if (src) {
      for (const k of [...merged.keys()]) if (k === c.path || k.startsWith(`${c.path}.`)) merged.delete(k)
      for (const [q, v] of src) if (q === c.path || q.startsWith(`${c.path}.`)) merged.set(q, v)
    } else merged.set(c.path, (r as { value: unknown }).value)
  }

  return { merged: unflatten(merged, [mine, live, base], ak), mineChanged, theirsChanged, conflicts: open }
}

function labelOf(p: string, labels: Record<string, string> = {}): string {
  if (labels[p]) return labels[p]
  const m = /^([^[]+)\[([^\]]*)\](?:\.(.+))?$/.exec(p)
  const pretty = (s: string) => labels[s] ?? s.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase())
  if (!m) return pretty(p)
  return m[3] ? `${pretty(m[1])} · ${m[2].slice(0, 8)} · ${pretty(m[3])}` : `${pretty(m[1])} · ${m[2].slice(0, 8)}`
}
