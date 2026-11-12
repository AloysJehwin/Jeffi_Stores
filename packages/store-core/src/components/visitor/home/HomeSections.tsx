import SectionRenderer from '@/components/visitor/home/SectionRenderer'
import Reveal from '@/components/visitor/home/Reveal'
import { groupRows, type HomepageSection } from '@/lib/catalog/homepage-sections'
import type { SectionData } from '@/lib/catalog/homepage-model'
import { HALF_CELL, HALF_ROW } from './layout-classes'

export { HALF_CELL, HALF_ROW }

const noReveal = (type: HomepageSection['type']) => type === 'hero' || type === 'motion_hero'

/** A page's sections as rows: one full-width section, or a left + right pair side by side on lg+. */
export default function HomeSections({
  sections,
  data,
  portal,
}: {
  sections: HomepageSection[]
  data: SectionData
  portal?: 'storefront' | 'business'
}) {
  let rowIndex = 0
  let seen = 0
  const render = (section: HomepageSection) => {
    const node = (
      <SectionRenderer
        key={section.id}
        section={section}
        rowIndex={section.type === 'product_row' ? rowIndex++ : rowIndex}
        data={data}
        portal={portal}
      />
    )
    const i = seen++
    if (noReveal(section.type)) return node
    return (
      <Reveal key={section.id} disabled={i <= 1}>
        {node}
      </Reveal>
    )
  }
  return (
    <>
      {groupRows(sections).map(row =>
        row.length === 2 ? (
          <div key={row[0].id} className={HALF_ROW}>
            {row.map(section => (
              <div key={section.id} className={HALF_CELL}>
                {render(section)}
              </div>
            ))}
          </div>
        ) : (
          render(row[0])
        )
      )}
    </>
  )
}
