import { ScrollView, View, useWindowDimensions } from 'react-native'
import { Skeleton } from './Skeleton'
import { cn } from './cn'

// Page-shaped placeholders built from Skeleton. Sizes follow the real components (ProductCard, cart lines,
// order cards) so nothing jumps when the data lands.

const GUTTER = 16

function useColumn(cols: number, gap: number) {
  const { width } = useWindowDimensions()
  return Math.floor((width - GUTTER * 2 - gap * (cols - 1)) / cols)
}

/** ProductCard: 5:3 image, two title lines, meta, price and stock row. */
export function ProductCardSkeleton({ width }: { width?: number }) {
  return (
    <View style={{ width }} className="overflow-hidden rounded-lg border border-border-default bg-surface-elevated">
      <View className="px-3 pt-3">
        <Skeleton aspectRatio={5 / 3} rounded="rounded-lg" />
      </View>
      <View className="gap-2 p-2.5">
        <Skeleton height={13} />
        <Skeleton height={13} width="70%" />
        <Skeleton height={10} width="45%" className="mt-1" />
        <Skeleton height={18} width="40%" className="mt-2" />
        <View className="mt-1 flex-row justify-between">
          <Skeleton height={10} width="35%" />
          <Skeleton height={10} width="25%" />
        </View>
      </View>
    </View>
  )
}

export function ProductGridSkeleton({ cols = 2, count = 6, gap = 12 }: { cols?: number; count?: number; gap?: number }) {
  const w = useColumn(cols, gap)
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap }}>
      {Array.from({ length: count }).map((_, i) => (
        <ProductCardSkeleton key={i} width={w} />
      ))}
    </View>
  )
}

/** A horizontal rail of product cards (home rows, related products). */
export function ProductRailSkeleton({ title = true, count = 3 }: { title?: boolean; count?: number }) {
  const { width } = useWindowDimensions()
  const w = Math.floor((width - GUTTER * 2) * 0.45)
  return (
    <View className="mb-6">
      {title ? <SectionTitleSkeleton /> : null}
      <ScrollView horizontal scrollEnabled={false} showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: GUTTER, gap: 12 }}>
        {Array.from({ length: count }).map((_, i) => (
          <ProductCardSkeleton key={i} width={w} />
        ))}
      </ScrollView>
    </View>
  )
}

export function SectionTitleSkeleton({ className }: { className?: string }) {
  return (
    <View className={cn('mb-3 gap-1.5 px-4', className)}>
      <Skeleton height={9} width={70} rounded="rounded" />
      <Skeleton height={20} width={170} rounded="rounded-md" />
    </View>
  )
}

/** A row of round category icons with labels. */
export function CircleRowSkeleton({ count = 5, size = 64 }: { count?: number; size?: number }) {
  return (
    <View className="mb-6 flex-row gap-4 overflow-hidden px-4">
      {Array.from({ length: count }).map((_, i) => (
        <View key={i} className="items-center gap-2">
          <Skeleton width={size} height={size} rounded="rounded-full" />
          <Skeleton width={size - 12} height={10} rounded="rounded" />
        </View>
      ))}
    </View>
  )
}

/** The home screen: hero card, category circles, two product rails. */
export function HomeSkeleton() {
  return (
    <View className="pt-4">
      <View className="mb-6 px-4">
        <Skeleton aspectRatio={16 / 10} rounded="rounded-sheet" />
      </View>
      <CircleRowSkeleton />
      <ProductRailSkeleton />
      <ProductRailSkeleton />
    </View>
  )
}

/** One list row: icon tile, two lines, trailing value. */
export function ListRowSkeleton({ icon = true, trailing = true }: { icon?: boolean; trailing?: boolean }) {
  return (
    <View className="min-h-[56px] flex-row items-center gap-3 px-4 py-3">
      {icon ? <Skeleton width={40} height={40} rounded="rounded-xl" /> : null}
      <View className="flex-1 gap-2">
        <Skeleton height={13} width="55%" />
        <Skeleton height={10} width="80%" />
      </View>
      {trailing ? <Skeleton height={13} width={48} /> : null}
    </View>
  )
}

/** A card of list rows. */
export function ListSkeleton({ rows = 5, icon = true, className }: { rows?: number; icon?: boolean; className?: string }) {
  return (
    <View className={cn('overflow-hidden rounded-panel bg-surface-elevated dark:border dark:border-border-default', className)}>
      {Array.from({ length: rows }).map((_, i) => (
        <View key={i}>
          {i > 0 ? <View className={cn('h-px bg-border-default', icon && 'ml-16')} /> : null}
          <ListRowSkeleton icon={icon} />
        </View>
      ))}
    </View>
  )
}

/** Totals card: a few label/value rows and a total. */
export function SummarySkeleton({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <View className={cn('gap-3 rounded-lg border border-border-default bg-surface-elevated p-4', className)}>
      <Skeleton height={16} width={130} />
      {Array.from({ length: rows }).map((_, i) => (
        <View key={i} className="flex-row justify-between">
          <Skeleton height={12} width="40%" />
          <Skeleton height={12} width={64} />
        </View>
      ))}
      <View className="h-px bg-border-default" />
      <View className="flex-row justify-between">
        <Skeleton height={16} width="30%" />
        <Skeleton height={16} width={80} />
      </View>
    </View>
  )
}