import { memo } from 'react'
import { View } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { FeedItemView, feedItems, type FeedItem } from './SectionRenderer'
import { getHome } from '../../api/home'
import { placedSections } from '../../lib/placement'
import type { HomeData, HomeModel, HomePage, HomeSection } from '../../types/home'

// The sections an admin placed between a listing page's products, drawn with the home feed's items
// (a card grid splits into its heading plus a row of two per item, like on home).

export type ListingPage = Exclude<HomePage, 'home'>

export interface ListingFeedEntry {
  key: string
  item: FeedItem
  /** Product index it sits before. */
  at: number
  /** The section's last item: it keeps the products' gap below. */
  last: boolean
}

export function useListingLayout(page: ListingPage): HomeModel | undefined {
  return useQuery({ queryKey: ['home', page], queryFn: () => getHome(page), staleTime: 120_000 }).data
}

// A section's feed items, built once per layout so mounted items keep their props across page loads.
const built = new WeakMap<HomeModel, Map<HomeSection, FeedItem[]>>()

function itemsOf(layout: HomeModel, section: HomeSection): FeedItem[] {
  let bySection = built.get(layout)
  if (!bySection) built.set(layout, (bySection = new Map()))
  let items = bySection.get(section)
  if (!items) bySection.set(section, (items = feedItems([section], layout.data)))
  return items
}

/** The placed sections' feed items over the products loaded so far, sorted by position. */
export function listingFeed(layout: HomeModel | undefined, loadedCount: number, total: number | undefined, columns: number): ListingFeedEntry[] {
  if (!layout?.sections.length) return []
  return placedSections(layout.sections, loadedCount, total, columns).flatMap(({ section, at, key }) => {
    const items = itemsOf(layout, section)
    return items.map((item, i) => ({ key: `feed:${key}:${i}`, item, at, last: i === items.length - 1 }))
  })
}

/** One feed item between the products, full width. */
export const ListingFeedItem = memo(
  function ListingFeedItem({ entry, data, gap }: { entry: ListingFeedEntry; data: HomeData; gap: number }) {
    return (
      <View style={entry.last ? { marginBottom: gap } : undefined}>
        <FeedItemView item={entry.item} data={data} />
      </View>
    )
  },
  (a, b) => a.entry.item === b.entry.item && a.entry.last === b.entry.last && a.data === b.data && a.gap === b.gap
)
