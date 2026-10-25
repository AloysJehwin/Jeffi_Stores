import { useMemo, useState } from 'react'
import { FlatList, RefreshControl, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useInfiniteQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query'
import { Bell, BellOff, CheckCheck } from 'lucide-react-native'
import { listNotifications, markNotificationOpened, markNotificationsRead, type InboxItem, type InboxPage } from '../src/api/notifications'
import { categoryIcon } from '../src/components/push/categories'
import { inboxKey, unreadKey, useUnreadCount } from '../src/hooks/useNotifications'
import { timeAgo } from '../src/lib/format'
import { openHref } from '../src/lib/links'
import { useAuthStore } from '../src/stores/authStore'
import { useTokens } from '../src/theme'
import { Card, EmptyState, ErrorState, IconButton, ListSkeleton, Screen, ScreenHeader, Spinner, Text, cn, toast, useBottomInset } from '../src/ui'

// The inbox: every push lands here too, newest first, paged by cursor.

function NotificationRow({ item, onPress }: { item: InboxItem; onPress: () => void }) {
  const t = useTokens()
  const Icon = categoryIcon(item.category)
  const unread = !item.is_read
  return (
    <Card
      onPress={onPress}
      padded={false}
      wrapperClassName="mx-4"
      className="flex-row gap-3 p-4"
      accessibilityLabel={`${unread ? 'Unread. ' : ''}${item.title}${item.body ? `. ${item.body}` : ''}`}
    >
      <View className={cn('h-10 w-10 items-center justify-center rounded-xl', unread ? 'bg-accent-50 dark:bg-accent-900/30' : 'bg-surface-secondary')}>
        <Icon size={20} color={unread ? t.accent600 : t.foregroundSecondary} />
      </View>
      <View className="flex-1">
        <View className="flex-row items-start gap-2">
          <Text numberOfLines={2} className={cn('flex-1 text-[15px] leading-5', unread ? 'font-bold text-foreground' : 'font-semibold text-foreground-secondary')}>
            {item.title}
          </Text>
          <Text className="pt-0.5 text-xs text-foreground-muted">{timeAgo(item.created_at)}</Text>
        </View>
        {item.body ? (
          <Text numberOfLines={3} className="mt-1 text-[13px] leading-[18px] text-foreground-muted">
            {item.body}
          </Text>
        ) : null}
      </View>
      {unread ? <View className="mt-1.5 h-2.5 w-2.5 rounded-full bg-accent-500" /> : null}
    </Card>
  )
}

export default function NotificationsScreen() {
  const router = useRouter()
  const t = useTokens()
  const qc = useQueryClient()
  const bottom = useBottomInset(32)
  const userId = useAuthStore(s => s.user?.id ?? null)
  const authLoading = useAuthStore(s => s.isLoading)
  const { count: unread } = useUnreadCount()
  const [refreshing, setRefreshing] = useState(false)
  const key = inboxKey(userId)

  const q = useInfiniteQuery({
    queryKey: key,
    queryFn: async ({ pageParam }) => {
      const page = await listNotifications(pageParam)
      qc.setQueryData(unreadKey(userId), page.unread_count)
      return page
    },
    initialPageParam: null as string | null,
    getNextPageParam: last => last.next_cursor,
    enabled: !!userId,
  })
  const items = useMemo(() => q.data?.pages.flatMap(p => p.items) ?? [], [q.data])

  const patch = (fn: (i: InboxItem) => InboxItem) =>
    qc.setQueryData<InfiniteData<InboxPage, string | null>>(key, d => (d ? { ...d, pages: d.pages.map(p => ({ ...p, items: p.items.map(fn) })) } : d))

  const open = (item: InboxItem) => {
    if (!item.is_read) qc.setQueryData<number>(unreadKey(userId), n => Math.max(0, (n ?? 1) - 1))
    if (!item.opened_at) {
      markNotificationOpened(item.id).catch(() => {})
    } else if (!item.is_read) {
      markNotificationsRead({ ids: [item.id] })
        .then(r => qc.setQueryData(unreadKey(userId), r.unread_count))
        .catch(() => {})
    }
    patch(i => (i.id === item.id ? { ...i, is_read: true, opened_at: i.opened_at ?? new Date().toISOString() } : i))
    if (item.link) openHref(router, item.link)
  }

  const markAll = async () => {
    const before = qc.getQueryData(key)
    const beforeUnread = qc.getQueryData<number>(unreadKey(userId))
    patch(i => ({ ...i, is_read: true }))
    qc.setQueryData(unreadKey(userId), 0)
    try {
      const r = await markNotificationsRead({ all: true })
      qc.setQueryData(unreadKey(userId), r.unread_count)
    } catch {
      qc.setQueryData(key, before)
      qc.setQueryData(unreadKey(userId), beforeUnread)
      toast.error("Couldn't mark them as read")
    }
  }

  const refresh = async () => {
    setRefreshing(true)
    try {
      await q.refetch()
    } finally {
      setRefreshing(false)
    }
  }

  const header = (
    <ScreenHeader
      title="Notifications"
      actions={
        userId && items.length ? (
          <IconButton icon={CheckCheck} label="Mark all read" color={t.foregroundSecondary} disabled={unread === 0} onPress={markAll} />
        ) : null
      }
    />
  )

  if (!userId) {
    return (
      <Screen
        header={header}
        loading={authLoading}
        empty={
          <EmptyState
            fill
            icon={Bell}
            title="Sign in to see your notifications"
            message="Order updates, account alerts and offers show up here."
            actionLabel="Sign in"
            onAction={() => router.push('/(auth)/login')}
          />
        }
      />
    )
  }

  return (
    <Screen header={header} mode="none">
      {q.isLoading ? (
        <View className="px-4 pt-4">
          <ListSkeleton rows={6} />
        </View>
      ) : q.error && !items.length ? (
        <ErrorState fill onRetry={() => q.refetch()} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={i => i.id}
          renderItem={({ item }) => <NotificationRow item={item} onPress={() => open(item)} />}
          ItemSeparatorComponent={() => <View className="h-3" />}
          contentContainerStyle={{ paddingTop: 16, paddingBottom: bottom, flexGrow: items.length ? undefined : 1 }}
          ListEmptyComponent={<EmptyState fill icon={BellOff} title="No notifications yet" message="Order updates, account alerts and offers will show up here." />}
          ListFooterComponent={q.isFetchingNextPage ? <Spinner fill={false} className="py-6" /> : null}
          onEndReached={() => {
            if (q.hasNextPage && !q.isFetchingNextPage) void q.fetchNextPage()
          }}
          onEndReachedThreshold={0.5}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={t.accent500} colors={[t.accent500]} progressBackgroundColor={t.surfaceElevated} />
          }
        />
      )}
    </Screen>
  )
}
