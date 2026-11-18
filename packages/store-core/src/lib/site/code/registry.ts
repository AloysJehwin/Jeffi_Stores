import type { ReactNode } from 'react'
import type { z } from 'zod'
import type { PageKey } from '@jeffi/site-blocks'
import type { SiteData } from '../data/types'

// The component registry, apart from library.ts so the part modules can register while library.ts loads them.

export interface RenderCtx {
  /** The element's children, already rendered. */
  children: ReactNode
  /** The element's render function (`{p => …}`), when it has one: call it per item with its index, or once with a record. */
  renderItem: ((value: unknown, index?: number) => ReactNode) | null
  /** The catalogue to read (the live store, or the studio's sample catalogue). */
  data: SiteData
  /** The page the section is on, when known. */
  page: PageKey | null
  /** The section's scope id (its `data-code-section`). */
  sectionId: string
  /** True for the first caller when the section holds the page's LCP image: load that one eagerly. */
  claimPriority: () => boolean
}

export interface CodeComponentDef {
  /** JSX name, PascalCase. */
  name: string
  pages: PageKey[] | 'any'
  /** Literal props schema (a z.object); `className` and `key` are always accepted on top. */
  props: z.ZodTypeAny
  /** Render-prop parameter fields → description (for the AI and the validator). */
  binding?: Record<string, string>
  /** Pages that must contain it (e.g. PaymentStep on checkout). */
  required?: PageKey[]
  /** One line for the AI prompt. */
  describe: string
  render: (props: Record<string, unknown>, ctx: RenderCtx) => ReactNode | Promise<ReactNode>
  /** Data components: how many items these props would show, so a section whose data is all empty can hide. */
  count?: (props: Record<string, unknown>, data: SiteData) => Promise<number>
}

export const REGISTRY = new Map<string, CodeComponentDef>()

export function defineCodeComponent(def: CodeComponentDef): CodeComponentDef {
  if (!/^[A-Z][A-Za-z0-9]*$/.test(def.name)) throw new Error(`Code component names are PascalCase: ${def.name}`)
  // Re-registering replaces (hot reload evaluates part modules again).
  REGISTRY.set(def.name, def)
  return def
}
