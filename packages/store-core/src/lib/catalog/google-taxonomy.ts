// Google product taxonomy (Merchant Center google_product_category). Server only: the snapshot is ~0.5 MB.
// Refresh with `node scripts/refresh-google-taxonomy.mjs`.
import data from './google-taxonomy.json'
import { aiChat } from '@/lib/shared/ai-client'
import { parseAiJson } from '@/lib/auth/ai-scope'
import { queryOne } from '@/lib/shared/db'

export interface TaxonomyEntry {
  id: number
  path: string
}

const ENTRIES: TaxonomyEntry[] = (data.entries as [number, string][]).map(([id, path]) => ({ id, path }))
const BY_ID = new Map(ENTRIES.map(e => [e.id, e]))
const BY_PATH = new Map(ENTRIES.map(e => [e.path.toLowerCase(), e]))

export const GOOGLE_TAXONOMY_VERSION: string = data.version

const STOP = new Set(['and', 'the', 'for', 'with', 'of', 'in', 'on', 'to', 'a', 'an', 'or', 'all', 'other', 'misc', 'accessories', 'products', 'items', 'supplies', 'equipment'])

function stem(w: string): string {
  if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y'
  if (w.length > 4 && /(ches|shes|sses|xes)$/.test(w)) return w.slice(0, -2)
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1)
  return w
}

function tokens(s: string): string[] {
  return (s.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(w => w.length > 1 && !STOP.has(w)).map(stem)
}

const INDEX = ENTRIES.map(e => {
  const parts = e.path.split(' > ')
  return { e, leaf: new Set(tokens(parts[parts.length - 1])), all: new Set(tokens(e.path)), depth: parts.length }
})

/** The official entry for a stored value: a numeric id, an exact path (any case), or "id - path". */
export function findGoogleCategory(value: string | null | undefined): TaxonomyEntry | null {
  const v = (value ?? '').trim()
  if (!v) return null
  const withId = v.match(/^(\d+)(?:\s*-\s*.*)?$/)
  if (withId) return BY_ID.get(Number(withId[1])) ?? null
  return BY_PATH.get(v.toLowerCase().replace(/\s*>\s*/g, ' > ')) ?? null
}

interface Weighted {
  text: string
  weight: number
}

function rank(parts: Weighted[], within?: string | null, limit = 30): TaxonomyEntry[] {
  const q = new Map<string, number>()
  for (const p of parts) for (const t of tokens(p.text)) q.set(t, Math.max(q.get(t) ?? 0, p.weight))
  if (!q.size) return []
  const prefix = within ? within.toLowerCase() : null
  const scored: { e: TaxonomyEntry; s: number }[] = []
  for (const row of INDEX) {
    let s = 0
    for (const [t, w] of q) {
      if (row.leaf.has(t)) s += 3 * w
      else if (row.all.has(t)) s += w
    }
    if (!s) continue
    // A leaf naming something else ("Welding Helmets" for welding electrodes) is a worse fit than a broader one.
    let unmatched = 0
    for (const t of row.leaf) if (!q.has(t)) unmatched++
    s -= unmatched * 1.5
    if (prefix && row.e.path.toLowerCase().startsWith(prefix)) s += 2
    scored.push({ e: row.e, s: s - row.depth * 0.01 })
  }
  return scored.sort((a, b) => b.s - a.s).slice(0, limit).map(x => x.e)
}

/** Admin picker search: by id, or by words across the path. */
export function searchGoogleTaxonomy(query: string, limit = 20): TaxonomyEntry[] {
  const exact = findGoogleCategory(query)
  const ranked = rank([{ text: query, weight: 1 }], null, limit)
  return exact ? [exact, ...ranked.filter(e => e.id !== exact.id)].slice(0, limit) : ranked
}

export interface CategoryHints {
  name: string
  description?: string | null
  parentName?: string | null
  /** The parent category's stored google_product_category, used to prefer its subtree. */
  parentGoogleCategory?: string | null
  /** true = also ask AI (the caller holds AI access for categories); keyword match only otherwise. */
  ai?: boolean
}

// A slow or unreachable AI gateway must not hold up saving a category; the keyword match stands in.
const AI_TIMEOUT_MS = 8000
function withTimeout<T>(p: Promise<T>): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error('AI timed out')), AI_TIMEOUT_MS))])
}

function describe(h: CategoryHints): string {
  return [
    `Category: ${h.name}`,
    h.parentName ? `Parent category: ${h.parentName}` : '',
    h.description ? `Description: ${h.description.slice(0, 400)}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

/** Taxonomy-style search terms for trade names the taxonomy words differently ("V belts" → power transmission). */
async function expandTerms(h: CategoryHints): Promise<string | null> {
  if (h.ai !== true) return null
  try {
    const r = await withTimeout(aiChat({
      feature: 'enrichment',
      modelHint: 'fast',
      jsonMode: true,
      temperature: 0,
      maxTokens: 80,
      messages: [
        {
          role: 'system',
          content:
            'Give 3-6 short generic search terms, in the wording the Google product taxonomy uses, that describe what this store category sells ' +
            '(e.g. "hardware fasteners", "power transmission", "work safety protective gear"). Reply only with JSON {"terms":["…"]}.',
        },
        { role: 'user', content: describe(h) },
      ],
    }))
    const terms = parseAiJson<{ terms?: unknown }>(r.content)?.terms
    return Array.isArray(terms) ? terms.filter(t => typeof t === 'string').join(' ') : ''
  } catch {
    return null
  }
}

/** Best official match for a store category: keyword shortlist, then AI picks from it (keyword top on failure). */
export async function suggestGoogleCategory(h: CategoryHints): Promise<TaxonomyEntry | null> {
  const parent = findGoogleCategory(h.parentGoogleCategory)
  // null = AI off or unreachable: skip the second call too.
  const expanded = await expandTerms(h)
  const candidates = rank(
    [
      { text: h.name, weight: 3 },
      { text: expanded ?? '', weight: 2 },
      { text: h.parentName ?? '', weight: 1.5 },
      { text: h.description ?? '', weight: 1 },
    ],
    parent?.path
  )
  if (!candidates.length) return parent
  if (expanded === null) return candidates[0]
  try {
    const r = await withTimeout(aiChat({
      feature: 'enrichment',
      modelHint: 'fast',
      jsonMode: true,
      temperature: 0,
      maxTokens: 30,
      messages: [
        {
          role: 'system',
          content:
            'You map an online store category to the Google product taxonomy. Pick the single best entry from the numbered list: ' +
            'the most specific one that still covers every product the category would hold. Reply only with JSON {"id":<number>}.',
        },
        {
          role: 'user',
          content: [describe(h), '', ...candidates.map(c => `${c.id} - ${c.path}`)].join('\n'),
        },
      ],
    }))
    const id = Number(parseAiJson<{ id?: number | string }>(r.content)?.id)
    const pick = candidates.find(c => c.id === id)
    if (pick) return pick
  } catch (err) {
    console.error('[google-taxonomy] AI match failed, using keyword match', err)
  }
  return candidates[0]
}

/** resolveGoogleCategory for a category row being saved; looks up the parent's name and taxonomy. */
export async function resolveCategoryGoogleCategory(
  input: string | null | undefined,
  c: { name: string; description?: string | null; parentId?: string | null; ai?: boolean }
): Promise<string | null> {
  const parent = c.parentId
    ? await queryOne<{ name: string; google_product_category: string | null }>(
        `SELECT name, google_product_category FROM categories WHERE id = $1`,
        [c.parentId]
      ).catch(() => null)
    : null
  return resolveGoogleCategory(input, {
    name: c.name,
    description: c.description,
    parentName: parent?.name,
    parentGoogleCategory: parent?.google_product_category,
    ai: c.ai,
  })
}

/** The value to store: the official path when the input is valid, otherwise an automatic match (or null). */
export async function resolveGoogleCategory(input: string | null | undefined, h: CategoryHints): Promise<string | null> {
  const valid = findGoogleCategory(input)
  if (valid) return valid.path
  if (!h.name?.trim()) return null
  return (await suggestGoogleCategory(h))?.path ?? null
}
