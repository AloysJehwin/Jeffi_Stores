import type { HomeSection, SectionPlacement } from '../types/home'

// Where a listing page's sections sit between its products. Mirrors the server's placementPositions.

/** The product indices a section shows before; never at or past `total`, so it never trails the last product. */
export function placementPositions(p: SectionPlacement, total: number, max = 12): number[] {
  const out: number[] = []
  for (let at = p.after; at < total && out.length < (p.every ? max : 1); at += p.every ?? total) out.push(at)
  return out
}

/** Up to the next whole row, so a grid has no half-empty row above a section. */
export const snapToRow = (at: number, columns: number) => (columns > 1 ? Math.ceil(at / columns) * columns : at)

export interface PlacedSection {
  section: HomeSection
  /** Product index it sits before. */
  at: number
  key: string
}

/** Every placed section over the products loaded so far, by position then section order. */
export function placedSections(sections: HomeSection[], loadedCount: number, total: number | undefined, columns: number): PlacedSection[] {
  // Until the products after a position are loaded, the section would sit at the end of the list.
  const bound = Math.min(loadedCount, total ?? loadedCount)
  const out: (PlacedSection & { order: number })[] = []
  sections.forEach((section, order) => {
    // An older server ignores ?page and sends the home layout, which has no placement.
    if (!section.placement) return
    for (const p of placementPositions(section.placement, bound)) {
      const at = snapToRow(p, columns)
      if (at < bound) out.push({ section, at, key: `${section.id}:${at}`, order })
    }
  })
  return out.sort((a, b) => a.at - b.at || a.order - b.order).map(({ section, at, key }) => ({ section, at, key }))
}
