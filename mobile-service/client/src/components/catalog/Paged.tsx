import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { Inbox } from 'lucide-react-native'
import { Button, Card, EmptyState, Notice, ProductGridSkeleton, Skeleton, Spinner, Text, type IconComponent } from '../../ui'

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
  const { total, hasMore, loadingMore, error, loadMore, retry } = control
  if (!shown && !hasMore && !error) return null
  const of = total != null && total >= shown ? total : null
  return (
    <View className="px-1 pt-3">
      {error ? (
        <Notice tone="danger">
          <View className="flex-row items-center justify-between gap-3">
            <Text className="flex-1 text-sm leading-5 text-red-700 dark:text-red-300">{error}</Text>
            <Button label="Retry" variant="outline" size="sm" block={false} onPress={retry ?? loadMore} />
          </View>
        </Notice>
      ) : loadingMore ? (
        <View className="flex-row items-center justify-center gap-2 py-2">
          <Spinner size="small" fill={false} />
          <Text className="text-xs text-foreground-muted">Loading more...</Text>
        </View>
      ) : hasMore ? (
        <View className="items-center py-1">
          <Button label="Load more" variant="outline" size="sm" block={false} onPress={loadMore} />
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
      {/* The name is in the screen header; the band holds the logo and description. */}
      <View className="border-b border-border-default bg-surface-elevated px-4 py-4">
        <View className="flex-row items-center gap-4">
          {logo ? <Skeleton width={64} height={64} rounded="rounded-xl" /> : null}
          <View className="flex-1 gap-2.5">
            <Skeleton height={14} width="85%" />
            <Skeleton height={14} width="55%" />
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
  icon = Inbox,
}: {
  title: string
  body: string
  cta?: string
  onPress?: () => void
  icon?: IconComponent
}) {
  const router = useRouter()
  return (
    <Card padded={false}>
      <EmptyState
        icon={icon}
        title={title}
        message={body}
        actionLabel={cta}
        onAction={onPress ?? (() => router.navigate({ pathname: '/(tabs)/products', params: {} }))}
      />
    </Card>
  )
}
