import type { ReactNode } from 'react'
import { ScrollView, View, useWindowDimensions } from 'react-native'
import { useHomeLayout, type LayoutEntry } from '../../stores/homeLayoutStore'
import { CircleRowSkeleton, GUTTER, HomeSkeleton, ProductCardSkeleton, Skeleton } from '../../ui'
import type { HomeAudience, SectionType } from '../../types/home'

// One placeholder per section type, padded and backed like the real component (SectionRenderer's
// counterparts), laid out in the order of the last layout the app saw. Mirrors the web's
// skeletons/sections.tsx.

function Head({ bar = true, className = 'mb-7' }: { bar?: boolean; className?: string }) {
  return (
    <View className={`flex-row items-end justify-between ${className}`}>
      <View className="flex-row items-center gap-3">
        {bar ? <View className="h-9 w-1 rounded-full bg-primary-500/40" /> : null}
        <View className="gap-1.5">
          <Skeleton height={9} width={70} rounded="rounded" />
          <Skeleton height={20} width={170} rounded="rounded-md" />
        </View>
      </View>
      <Skeleton height={12} width={48} />
    </View>
  )
}

function CentredHead() {
  return (
    <View className="mb-6 items-center gap-2">
      <Skeleton height={9} width={70} rounded="rounded" />
      <Skeleton height={22} width={200} rounded="rounded-md" />
    </View>
  )
}

function Pair() {
  const { width } = useWindowDimensions()
  const w = Math.floor((width - GUTTER * 2 - 12) / 2)
  return (
    <View className="flex-row gap-3">
      <ProductCardSkeleton width={w} />
      <ProductCardSkeleton width={w} />
    </View>
  )
}

// ProductRowSection's ROW_STYLES by row index.
const ROW_BG = ['bg-surface-secondary', 'bg-surface', 'bg-surface-secondary']

function ProductRow({ rowIndex }: { rowIndex: number }) {
  const i = rowIndex % ROW_BG.length
  return (
    <View className={`px-4 py-12 ${ROW_BG[i]}`}>
      <Head bar={i < 2} />
      <Pair />
    </View>
  )
}

function Tiles({ n, children, className = 'bg-surface px-4 py-12', head = <CentredHead /> }: { n: number; children: ReactNode; className?: string; head?: ReactNode }) {
  return (
    <View className={className}>
      {head}
      <View className="gap-4">
        {Array.from({ length: n }).map((_, i) => (
          <View key={i}>{children}</View>
        ))}
      </View>
    </View>
  )
}

const CARD = 'rounded-panel border border-transparent bg-surface-elevated p-4 dark:border-border-default'

type Draw = (ctx: { rowIndex: number }) => ReactNode

const DRAW: Record<SectionType, Draw> = {
  hero: () => (
    <View className="mb-3 px-4 pt-3">
      <Skeleton aspectRatio={16 / 10} rounded="rounded-sheet" />
    </View>
  ),
  motion_hero: () => (
    <View className="bg-surface px-4 pb-4 pt-3">
      <Skeleton aspectRatio={4 / 5} rounded="rounded-sheet" />
    </View>
  ),
  offer_slider: () => (
    <View className="bg-surface py-8">
      <CentredHead />
      <View className="flex-row justify-center gap-3 overflow-hidden px-4">
        <View style={{ width: '82%' }}>
          <Skeleton aspectRatio={4 / 5} rounded="rounded-sheet" />
        </View>
      </View>
    </View>
  ),
  trust_strip: () => (
    <View className="flex-row flex-wrap border-b border-border-default bg-surface-elevated">
      {Array.from({ length: 4 }).map((_, i) => (
        <View key={i} className={`w-1/2 flex-row items-center gap-2 px-3 py-3 ${i % 2 ? 'border-l border-border-default' : ''} ${i >= 2 ? 'border-t border-border-default' : ''}`}>
          <Skeleton width={20} height={20} rounded="rounded-full" />
          <Skeleton height={11} width="60%" />
        </View>
      ))}
    </View>
  ),
  category_grid: () => (
    <View className="bg-surface pb-12 pt-8">
      <View className="px-4">
        <Head bar={false} />
      </View>
      <CircleRowSkeleton size={56} />
    </View>
  ),
  brand_carousel: () => (
    <View className="border-y border-border-default bg-surface-elevated px-4 py-8">
      <Head bar={false} className="mb-5" />
      <View className="flex-row gap-3 overflow-hidden">
        {Array.from({ length: 4 }).map((_, i) => (
          <View key={i} className="flex-1 items-center gap-2 rounded-xl border border-border-default bg-surface p-3">
            <Skeleton width={40} height={40} rounded="rounded-full" />
            <Skeleton height={10} width="80%" />
            <Skeleton height={8} width="50%" />
          </View>
        ))}
      </View>
    </View>
  ),
  product_row: ({ rowIndex }) => <ProductRow rowIndex={rowIndex} />,
  category_showcase: () => (
    <View className="px-4 py-10">
      <Head bar={false} className="mb-6" />
      <View className="flex-row gap-3">
        {[0, 1].map(i => (
          <View key={i} className="flex-1 overflow-hidden rounded-xl border border-transparent bg-surface-elevated dark:border-border-default">
            <View className="flex-row items-center justify-between px-3 py-2.5">
              <Skeleton height={13} width="50%" />
              <Skeleton height={10} width={36} />
            </View>
            <View className="flex-row flex-wrap gap-1 p-2 pt-1">
              {Array.from({ length: 4 }).map((_, j) => (
                <View key={j} style={{ width: '48%' }}>
                  <Skeleton aspectRatio={1} />
                </View>
              ))}
            </View>
          </View>
        ))}
      </View>
    </View>
  ),
  deal_of_the_day: () => (
    <View className="bg-surface-secondary px-4 py-12">
      <Head bar={false} />
      <Pair />
    </View>
  ),
  promo_banner: () => (
    <View className="bg-surface px-4 py-8">
      <Skeleton aspectRatio={16 / 9} rounded="rounded-sheet" />
    </View>
  ),
  featured_for_you: () => null,
  benefits: () => (
    <Tiles n={3} className="border-y border-border-default bg-surface px-4 py-8">
      <View className={`${CARD} flex-row items-start gap-3`}>
        <Skeleton width={40} height={40} rounded="rounded-xl" />
        <View className="flex-1 gap-2 pt-1">
          <Skeleton height={13} width="60%" />
          <Skeleton height={10} width="90%" />
        </View>
      </View>
    </Tiles>
  ),
  why_us: () => (
    <Tiles n={3} className="bg-surface-secondary px-4 py-12">
      <View className={`${CARD} p-6`}>
        <Skeleton width={48} height={48} rounded="rounded-xl" className="mb-5" />
        <Skeleton height={18} width="50%" className="mb-3" />
        <Skeleton height={11} className="mb-1.5" />
        <Skeleton height={11} width="80%" />
      </View>
    </Tiles>
  ),
  about: () => (
    <View className="bg-surface px-4 py-12">
      <Skeleton aspectRatio={4 / 3} rounded="rounded-sheet" className="mb-6" />
      <View className="gap-3">
        <Skeleton height={9} width={70} rounded="rounded" />
        <Skeleton height={24} width="75%" rounded="rounded-md" />
        <Skeleton height={12} />
        <Skeleton height={12} />
        <Skeleton height={12} width="65%" />
      </View>
    </View>
  ),
  business_cta: () => (
    <View className="bg-surface px-3 py-3">
      <Skeleton height={340} rounded="rounded-sheet" />
    </View>
  ),
  countdown_deal: () => (
    <View className="bg-surface px-4 py-10">
      <View className={CARD}>
        <Skeleton aspectRatio={1} rounded="rounded-xl" className="mb-5" />
        <Skeleton height={9} width={70} rounded="rounded" className="mb-3" />
        <Skeleton height={22} width="75%" rounded="rounded-md" className="mb-4" />
        <View className="flex-row gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} width={44} height={44} rounded="rounded-lg" />
          ))}
        </View>
      </View>
    </View>
  ),
  testimonials: () => (
    <Tiles n={2} className="bg-surface-secondary px-4 py-12">
      <View className={CARD}>
        <Skeleton height={12} width={90} className="mb-4" />
        <Skeleton height={11} className="mb-1.5" />
        <Skeleton height={11} className="mb-1.5" />
        <Skeleton height={11} width="65%" className="mb-4" />
        <View className="flex-row items-center gap-3 border-t border-border-default pt-3">
          <Skeleton width={36} height={36} rounded="rounded-full" />
          <View className="gap-1.5">
            <Skeleton height={11} width={90} />
            <Skeleton height={9} width={60} />
          </View>
        </View>
      </View>
    </Tiles>
  ),
  recently_viewed: () => null,
  category_tabs: () => (
    <View className="bg-surface px-4 py-12">
      <Head bar={false} className="mb-4" />
      <View className="mb-6 flex-row gap-2">
        {[96, 80, 110].map(w => (
          <Skeleton key={w} width={w} height={34} rounded="rounded-full" />
        ))}
      </View>
      <Pair />
    </View>
  ),
  bundle_spotlight: () => <ProductRow rowIndex={1} />,
  back_in_stock: () => null,
  blog_teaser: () => (
    <Tiles n={2} className="bg-surface px-4 py-12" head={<Head bar={false} />}>
      <View className="overflow-hidden rounded-xl border border-transparent bg-surface-elevated dark:border-border-default">
        <Skeleton aspectRatio={16 / 9} rounded="rounded-none" />
        <View className="gap-2 p-4">
          <Skeleton height={14} width="75%" />
          <Skeleton height={10} />
          <Skeleton height={10} width="65%" />
        </View>
      </View>
    </Tiles>
  ),
  social_strip: () => (
    <View className="bg-surface-secondary px-4 py-12">
      <Head bar={false} />
      <View className="flex-row gap-2">
        {[0, 1].map(i => (
          <View key={i} className="flex-1">
            <Skeleton aspectRatio={1} rounded="rounded-xl" />
          </View>
        ))}
      </View>
    </View>
  ),
  value_stats: () => (
    <View className="bg-surface px-4 py-12">
      <CentredHead />
      <View className="flex-row flex-wrap gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <View key={i} className={`${CARD} items-center gap-3 p-5`} style={{ width: '47%' }}>
            <Skeleton height={32} width={70} />
            <Skeleton height={10} width={90} />
          </View>
        ))}
      </View>
    </View>
  ),
  stories: () => (
    <View className="bg-surface pb-6 pt-8">
      <View className="px-4">
        <Head className="mb-4" />
      </View>
      <CircleRowSkeleton size={72} />
    </View>
  ),
  product_spotlight: () => (
    <View className="bg-surface px-4 py-8">
      <Skeleton aspectRatio={1} rounded="rounded-sheet" className="mb-6" />
      <View className="gap-3">
        <Skeleton height={9} width={70} rounded="rounded" />
        <Skeleton height={24} width="75%" rounded="rounded-md" />
        <Skeleton height={12} />
        <Skeleton height={12} width="80%" />
      </View>
    </View>
  ),
  rewards_game: () => (
    <View className="bg-surface-secondary px-4 py-10">
      <CentredHead />
      <View className="items-center">
        <Skeleton width={280} height={280} rounded="rounded-full" />
      </View>
    </View>
  ),
  slides: () => (
    <View className="bg-surface py-8">
      <View className="px-4">
        <Head className="mb-4" />
      </View>
      <ScrollView horizontal scrollEnabled={false} showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: GUTTER, gap: 12 }}>
        {[0, 1, 2].map(i => (
          <View key={i} style={{ width: 150 }}>
            <Skeleton aspectRatio={4 / 5} rounded="rounded-sheet" />
          </View>
        ))}
      </ScrollView>
    </View>
  ),
  business_reorder: ({ rowIndex }) => <ProductRow rowIndex={rowIndex} />,
  business_offers: ({ rowIndex }) => <ProductRow rowIndex={rowIndex} />,
  business_quotes: () => (
    <Tiles n={2} className="bg-surface px-4 py-12" head={null}>
      <View className={`${CARD} gap-3 p-5`}>
        <Skeleton height={20} width="50%" rounded="rounded-md" />
        <Skeleton height={11} />
        <Skeleton height={40} width={150} rounded="rounded-lg" />
      </View>
    </Tiles>
  ),
  business_account: () => (
    <Tiles n={3} className="bg-surface-secondary px-4 py-12" head={<Head bar={false} />}>
      <View className={`${CARD} gap-3`}>
        <Skeleton height={12} width="35%" />
        <Skeleton height={26} width="50%" rounded="rounded-md" />
        <Skeleton height={10} width="65%" />
      </View>
    </Tiles>
  ),
}

const isRow = (type: SectionType) => type === 'product_row' || type === 'business_reorder' || type === 'business_offers'

export function SectionSkeleton({ type, rowIndex = 0 }: { type: SectionType; rowIndex?: number }) {
  return <>{(DRAW[type] ?? (() => null))({ rowIndex })}</>
}

/** The sections of the last home layout seen, each as its placeholder; the fixed HomeSkeleton before any. */
export function HomeLayoutSkeleton({ audience = 'store' }: { audience?: HomeAudience }) {
  const layout = useHomeLayout('home', audience)
  if (!layout?.length) return <HomeSkeleton />
  let rowIndex = 0
  return (
    <View>
      {layout.map((s, i) => (
        <SectionSkeleton key={i} type={s.type} rowIndex={isRow(s.type) ? rowIndex++ : rowIndex} />
      ))}
    </View>
  )
}

/** Listing pages: the sections placed within the first `count` cards, for ProductGridSkeleton's inserts. */
export function listingSkeletonInserts(layout: LayoutEntry[] | undefined, count: number, cols: number) {
  if (!layout?.length) return []
  return layout
    .filter(s => (s.after ?? 0) < count)
    .map(s => ({ at: cols > 1 ? Math.ceil((s.after ?? 0) / cols) * cols : (s.after ?? 0), node: <SectionSkeleton type={s.type} /> }))
    .sort((a, b) => a.at - b.at)
}
