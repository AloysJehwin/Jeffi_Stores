import type { ZodType } from 'zod'
import { normalizeDoc, type Block, type PageDoc } from './doc'
import type { PageKey, PageRef, SiteAudience, SiteSurface } from './layouts'

// One definition per block drives server validation, the editor's property form, the AI's tool schema and the web /
// native renderers. `fields` carries what a form and an AI need beyond the type: labels, hints, choices and whether a
// desktop document may override the value on tablets.

export type BlockCategory = 'structure' | 'content' | 'commerce' | 'interactive' | 'page' | 'business'
export type FieldKind =
  | 'text'
  | 'richtext'
  | 'number'
  | 'boolean'
  | 'select'
  | 'color'
  | 'image'
  | 'link'
  | 'product'
  | 'products'
  | 'category'
  | 'brand'
  | 'list'
  | 'json'

export interface FieldMeta {
  kind: FieldKind
  label?: string
  responsive?: boolean
  aiHint?: string
  options?: { value: string; label: string }[]
  /** `list` fields: the keys each item has (a link list when absent: label + href). */
  item?: { key: string; label: string; kind: 'text' | 'richtext' | 'link' }[]
  /** `image` fields: the shape the image is cut to (for uploads and AI generation). */
  size?: 'square' | 'portrait' | 'story' | 'landscape' | 'wide' | 'hero'
}

/** An image the block shows, with the shape it wants on each surface (the AI generates one crop per surface). */
export interface AspectSlot {
  key: string
  label: string
  aspect: Partial<Record<SiteSurface, string>>
}

export interface BlockDef<P = Record<string, unknown>> {
  type: string
  v: number
  label: string
  description?: string
  category: BlockCategory
  props: ZodType<P>
  fields?: Partial<Record<Extract<keyof P, string>, FieldMeta>>
  pages?: PageKey[]
  audiences?: SiteAudience[]
  surfaces?: SiteSurface[]
  singleton?: boolean
  /** A page-core block: it can be moved and styled but not removed. */
  locked?: boolean
  slots?: string[]
  /** The plan scope the block needs; absent means every plan. */
  plan?: string
  presets?: { label: string; props: Partial<P> }[]
  aspectSlots?: AspectSlot[]
  /** Upgrades props written for an older version. */
  migrate?: (props: unknown, fromV: number) => unknown
}

export const defineBlock = <P>(def: BlockDef<P>): BlockDef<P> => def

export interface Registry {
  get(type: string): BlockDef<any> | undefined
  all(): BlockDef<any>[]
  /** Types that may go on this page of this layout. */
  allowedOn(ref: Pick<PageRef, 'audience' | 'surface' | 'page'>): BlockDef<any>[]
}

const fits = (d: BlockDef<any>, ref: Pick<PageRef, 'audience' | 'surface' | 'page'>) =>
  (!d.pages || d.pages.includes(ref.page)) &&
  (!d.audiences || d.audiences.includes(ref.audience)) &&
  (!d.surfaces || d.surfaces.includes(ref.surface))

export function createRegistry(defs: BlockDef<any>[]): Registry {
  const byType = new Map<string, BlockDef<any>>()
  for (const d of defs) {
    if (byType.has(d.type)) throw new Error(`Block type ${d.type} defined twice`)
    byType.set(d.type, d)
  }
  return {
    get: type => byType.get(type),
    all: () => [...byType.values()],
    allowedOn: ref => [...byType.values()].filter(d => fits(d, ref)),
  }
}

export interface DocIssue {
  blockId?: string
  message: string
}

/**
 * A document checked against the registry: unknown types and blocks the page can't have are dropped, props are
 * migrated and parsed (so defaults apply), singletons are kept once. Returns the cleaned doc and what was wrong.
 */
export function validateDoc(input: unknown, registry: Registry, ref?: Pick<PageRef, 'audience' | 'surface' | 'page'>) {
  const doc = normalizeDoc(input as Partial<PageDoc>)
  const issues: DocIssue[] = []
  const singletons = new Set<string>()
  const blocks: Record<string, Block> = {}
  for (const b of Object.values(doc.blocks)) {
    const def = registry.get(b.type)
    if (!def) {
      issues.push({ blockId: b.id, message: `Unknown block type ${b.type}` })
      continue
    }
    if (ref && !fits(def, ref)) {
      issues.push({ blockId: b.id, message: `${def.label} can't go on this page` })
      continue
    }
    if (def.singleton) {
      if (singletons.has(def.type)) {
        issues.push({ blockId: b.id, message: `${def.label} can only appear once` })
        continue
      }
      singletons.add(def.type)
    }
    const raw = b.v < def.v && def.migrate ? def.migrate(b.props, b.v) : b.props
    const parsed = def.props.safeParse(raw)
    if (!parsed.success) {
      issues.push({ blockId: b.id, message: `${def.label}: ${parsed.error.issues[0]?.message ?? 'invalid settings'}` })
      continue
    }
    blocks[b.id] = { ...b, v: def.v, props: parsed.data as Record<string, unknown> }
  }
  return { ok: issues.length === 0, issues, doc: normalizeDoc({ ...doc, blocks }) }
}
