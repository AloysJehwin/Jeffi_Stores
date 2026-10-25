import type { ReactNode } from 'react'
import { ActivityIndicator, Pressable, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { InboxIcon } from './icons'
import { useTokens } from '../../theme'
import { ProductGridSkeleton, Skeleton } from '../../ui'

// The admin kit's InfiniteFooter (ServerPagedItems / useReveal), the listing skeletons and empty card.

export interface InfiniteControl {
  total?: number | null
  hasMore: boolean
  loadingMore: boolean
  error?: string | null
  loadMore: () => void
  retry?: () => void
}

/** "Loading more..." / "Load more" / "Showing X of Y products"; the list's onEndReached drives auto-loading. */
export function InfiniteFooter({ shown, control, noun = 'products' }: { shown: number; control: InfiniteControl; noun?: string }) {
  const t = useTokens()
  const { total, hasMore, loadingMore, error, loadMore, retry } = control
  if (!shown && !hasMore && !error) return null
  const of = total != null && total >= shown ? total : null
  return (
    <View className="px-1 pt-3">
      {error ? (
        <View className="flex-row items-center justify-center gap-2 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2">
          <Text className="text-xs text-red-600 dark:text-red-400">{error}</Text>
          <Pressable onPress={retry ?? loadMore} className="h-[26px] items-center justify-center rounded border border-red-500/40 px-2">
            <Text className="text-xs text-red-600 dark:text-red-400">Retry</Text>
          </Pressable>
        </View>
      ) : loadingMore ? (
        <View className="flex-row items-center justify-center gap-2 py-2">
          <ActivityIndicator size="small" color={t.foregroundMuted} />
          <Text className="text-xs text-foreground-muted">Loading more...</Text>
        </View>
      ) : hasMore ? (
        <View className="items-center py-1">
          <Pressable onPress={loadMore} className="h-8 flex-row items-center justify-center rounded-lg border border-border-default px-3">
            <Text className="text-sm text-foreground-secondary">Load more</Text>
          </Pressable>
        </View>
      ) : null}
      {shown > 0 ? (
        <Text className="pt-1 text-center text-xs text-foreground-muted">
          Showing <Text className="font-medium text-foreground">{shown}</Text>
          {of != null ? (
            <>
              {' '}
              of <Text className="font-medium text-foreground">{of}</Text>
            </>
          ) : null}{' '}
          {noun}
        </Text>
      ) : null}
    </View>
  )
}

export { ProductGridSkeleton }

/** A category / brand page while it loads: the header band (breadcrumb, logo, title), the count line and the grid. */
export function ListingPageSkeleton({ logo = false, cols = 2, gap = 12 }: { logo?: boolean; cols?: 1 | 2; gap?: number }) {
  return (
    <View className="flex-1 overflow-hidden">
      <View className="border-b border-border-default bg-surface-elevated px-4 py-4">
        <Skeleton height={14} width={180} rounded="rounded" className="mb-5" />
        <View className="flex-row items-center gap-4">
          {logo ? <Skeleton width={64} height={64} rounded="rounded-lg" /> : null}
          <View className="flex-1 gap-2.5">
            <Skeleton height={28} width="60%" />
            <Skeleton height={14} width="85%" />
          </View>
        </View>
      </View>
      <View className="px-4 pt-4">
        <Skeleton height={22} width={140} className="mb-6" />
        <ProductGridSkeleton cols={cols} gap={gap} count={cols === 1 ? 3 : 6} />
      </View>
    </View>
  )
}

/** The "No Products …" card with its inbox icon and the browse-all button. */
export function EmptyCard({
  title,
  body,
  cta = 'Browse All Products',
  onPress,
  icon,
}: {
  title: string
  body: string
  cta?: string
  onPress?: () => void
  icon?: ReactNode
}) {
  const router = useRouter()
  const t = useTokens()
  return (
    <View className="items-center rounded-lg border border-border-default bg-surface-elevated p-12 shadow-sm">
      <View className="mb-4">{icon ?? <InboxIcon size={96} strokeWidth={1} color={t.foregroundMuted} />}</View>
      <Text className="mb-2 self-stretch text-center text-xl font-semibold text-foreground">{title}</Text>
      <Text className="mb-6 self-stretch text-center text-foreground-secondary">{body}</Text>
      <Pressable
        onPress={onPress ?? (() => router.navigate({ pathname: '/(tabs)/products', params: {} }))}
        className="rounded-lg bg-accent-500 px-6 py-3 active:bg-accent-600"
      >
        <Text className="font-semibold text-white">{cta}</Text>
      </Pressable>
    </View>
  )
}

/** The Home / Section / Page breadcrumb row. */
export function Breadcrumb({ items }: { items: { label: string; onPress?: () => void }[] }) {
  return (
    <View className="flex-row flex-wrap items-center gap-2">
      {items.map((it, i) => (
        <View key={i} className="flex-row items-center gap-2">
          {i > 0 ? <Text className="text-sm text-foreground-muted">/</Text> : null}
          {it.onPress ? (
            <Pressable onPress={it.onPress}>
              <Text className="text-sm text-foreground-muted">{it.label}</Text>
            </Pressable>
          ) : (
            <Text className="text-sm font-medium text-foreground">{it.label}</Text>
          )}
        </View>
      ))}
    </View>
  )
}
