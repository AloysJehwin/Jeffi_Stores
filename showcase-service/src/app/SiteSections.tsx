import { blockVisible, topBlocks, type PageDoc } from '@jeffi/site-blocks'
import CodeSection, { planSections } from '@/components/visitor/site/code/CodeSection'
import type { CompiledSection } from '@/lib/site/code/compile'
import type { SiteData } from '@/lib/site/data'

/**
 * The page's code sections in order, as the studio preview draws them; the first is the LCP section. The header and
 * the opening always draw, and links to a section that draws nothing are left out (planSections).
 */
export default async function SiteSections({ doc, data }: { doc: PageDoc; data: SiteData }) {
  const now = Date.now()
  const blocks = topBlocks(doc).filter(b => b.type === 'code_section' && b.props.compiled && blockVisible(b, now))
  const plan = await planSections(blocks.map(b => b.props.compiled as CompiledSection), data)
  return (
    <>
      {blocks.map((b, i) => (
        <CodeSection key={b.id} section={b.props.compiled as CompiledSection} id={b.id} page="showcase" data={data} priority={i === 0} always={plan.always[i]} anchors={plan.anchors} />
      ))}
    </>
  )
}
