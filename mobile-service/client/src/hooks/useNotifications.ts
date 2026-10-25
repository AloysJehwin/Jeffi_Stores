import { useCallback, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { listNotifications } from '../api/notifications'
import { useAuthStore } from '../stores/authStore'
import { getPushPermission, PUSH_PERMISSION_KEY } from '../lib/push'

// Every inbox query sits under ['notifications'], so one invalidation refreshes the list and the bell.
export const unreadKey = (userId: string | null) => ['notifications', 'unread', userId] as const
export const inboxKey = (userId: string | null) => ['notifications', 'inbox', userId] as const

/** The bell's unread count; 0 while signed out. */
export function useUnreadCount() {
  const userId = useAuthStore(s => s.user?.id ?? null)
  const q = useQuery({
    queryKey: unreadKey(userId),
    queryFn: () => listNotifications().then(p => p.unread_count),
    enabled: !!userId,
    staleTime: 60_000,
  })
  const latest = useRef({ userId, q })
  latest.current = { userId, q }
  // Stable, so it can drive useFocusEffect; skips a refetch made in the last few seconds.
  const refresh = useCallback(() => {
    const { userId: id, q: query } = latest.current
    if (id && Date.now() - query.dataUpdatedAt > 10_000) void query.refetch()
  }, [])
  return { count: userId ? q.data ?? 0 : 0, refresh }
}

/** The OS permission; PushBootstrap re-reads it when the app returns to the foreground. */
export function usePushPermission() {
  return useQuery({ queryKey: PUSH_PERMISSION_KEY, queryFn: getPushPermission, staleTime: 0 })
}
