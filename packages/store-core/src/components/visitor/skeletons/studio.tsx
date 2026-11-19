import type { ReactNode } from 'react'
import { blockVisible, topBlocks, type PageDoc, type PageKey } from '@jeffi/site-blocks'
import CodeSectionSkeleton from '@/components/visitor/site/code/CodeSectionSkeleton'
import type { SectionType } from '@/lib/catalog/homepage-sections'
import { CORE_BLOCKS, isSectionBlock } from '@/lib/site/blocks'
import type { CompiledSection } from '@/lib/site/code/compile'
import { loadSitePage } from '@/lib/site/page'
import { SectionSkeleton } from './sections'

// The loading screen of a page the AI Site Studio designed: each code section's own skeleton, generated when it was
// compiled, in the page's order. The site's header and footer stay drawn by the layout.

const CORE = new Set<string>(CORE_BLOCKS.map(d => d.type))
const isCode = (type: string) => type === 'code_section'

/** A page's blocks as their skeletons; `core` stands in for the page's own working part where its block sits. */
export function StudioPageSkeleton({ doc, page, core = null }: { doc: PageDoc; page: PageKey; core?: ReactNode }) {
  const now = Date.now()
  return (
    <div className="bg-surface" role="status" aria-busy="true" aria-label="Loading">
      {topBlocks(doc)
        .filter(b => blockVisible(b, now))
        .map(b =>
          isCode(b.type) ? (
            <CodeSectionSkeleton key={b.id} section={b.props.compiled as CompiledSection | null} page={page} />
          ) : CORE.has(b.type) ? (
            <div key={b.id}>{core}</div>
          ) : isSectionBlock(b.type) ? (
            <SectionSkeleton key={b.id} type={b.type as SectionType} />
          ) : null
        )}
    </div>
  )
}

/**
 * The route's loading screen when the store's published page is an AI design (it has code sections), else null for
 * the route's own. Read through loadSitePage, so it shares the page's per-tenant cache.
 */
export async function studioSkeleton(page: PageKey, core?: ReactNode): Promise<ReactNode | null> {
  const site = await loadSitePage({ audience: 'store', page }).catch(() => null)
  const now = Date.now()
  if (!site || !topBlocks(site.doc).some(b => isCode(b.type) && blockVisible(b, now))) return null
  return <StudioPageSkeleton doc={site.doc} page={page} core={core} />
}
