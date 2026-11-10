import ReviewCouponPopup from '@/components/visitor/ReviewCouponPopup'
import SectionRenderer from '@/components/visitor/home/SectionRenderer'
import Reveal from '@/components/visitor/home/Reveal'
import { buildHomeModel } from '@/lib/catalog/homepage-model'
import { getWebSurface } from '@/lib/catalog/web-surface'

export const revalidate = 120

export default async function HomePage({ searchParams }: { searchParams: Promise<{ layout?: string }> }) {
  // Same model the app reads from GET /api/home; phones get the mobile web layout.
  const surface = await getWebSurface((await searchParams).layout)
  const { sections, data } = await buildHomeModel({ surface })

  return (
    <div className="bg-surface">
      {sections.map((section, i) => {
        const rendered = (
          <SectionRenderer
            key={section.id}
            section={section}
            rowIndex={sections.slice(0, i).filter(s => s.type === 'product_row').length}
            data={data}
          />
        )
        if (section.type === 'hero' || section.type === 'motion_hero') return rendered
        return (
          <Reveal key={section.id} disabled={i <= 1}>
            {rendered}
          </Reveal>
        )
      })}

      <ReviewCouponPopup />
    </div>
  )
}
