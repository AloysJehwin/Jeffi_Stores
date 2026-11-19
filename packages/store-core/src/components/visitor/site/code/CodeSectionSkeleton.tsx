import type { PageKey } from '@jeffi/site-blocks'
import { inertCss } from '@/lib/site/code/allow'
import { CARD_PAGE, type CodeNode } from '@/lib/site/code/ast'
import type { CompiledSection } from '@/lib/site/code/compile'
import { currentCss } from '@/lib/site/code/css'
import { codeSkeleton } from '@/lib/site/code/skeleton'
import { siteData } from '@/lib/site/data'
import { makeEnv, renderNode } from './interpret'

// Sections compiled before skeletons were stored get theirs derived once, by scope id (a hash of the source).
const derived = new Map<string, CodeNode>()
const MEMO = 500

function skeletonOf(s: Partial<CompiledSection>, id: string): CodeNode | null {
  if (s.skeleton && typeof s.skeleton === 'object') return s.skeleton
  if (!s.ast || typeof s.ast !== 'object') return null
  if (!/^cs-[0-9a-f]{8}$/.test(id)) return codeSkeleton(s.ast)
  let hit = derived.get(id)
  if (!hit) {
    if (derived.size >= MEMO) derived.clear()
    derived.set(id, (hit = codeSkeleton(s.ast)))
  }
  return hit
}

/**
 * A code section's loading skeleton (lib/site/code/skeleton.ts), drawn by the interpreter in the section's own
 * wrapper with its scoped CSS, so it has the section's layout. It reads no data.
 */
export default function CodeSectionSkeleton({ section, page = null }: { section: CompiledSection | null | undefined; page?: PageKey | null }) {
  const s = section as Partial<CompiledSection> | null | undefined
  // A site card's CSS is scoped to its own wrapper; the card page has no route to load.
  if (!s || typeof s !== 'object' || page === CARD_PAGE) return null
  const id = typeof s.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(s.id) ? s.id : 'cs'
  const skeleton = skeletonOf(s, id)
  if (!skeleton) return null
  // The interpreter marks the skeleton's elements with the section's id, as CodeSection's.
  const css = inertCss(currentCss(s.css, id))
  return (
    <div data-code-section={id} aria-hidden>
      {css && <style dangerouslySetInnerHTML={{ __html: css }} />}
      {renderNode(skeleton, makeEnv({ data: siteData(), page, sectionId: id }))}
    </div>
  )
}
