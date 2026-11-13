import { useEffect, useRef, useState } from 'react'
import { AppState } from 'react-native'
import { useRootNavigationState, useRouter, useSegments } from 'expo-router'
import { useQueryClient } from '@tanstack/react-query'
import * as Notifications from 'expo-notifications'
import { markNotificationOpened } from '../../api/notifications'
import { openHref } from '../../lib/links'
import {
  detachPushDevice,
  initPush,
  maybePromptForPush,
  maybePromptOnFirstLaunch,
  maybeRemindOnOpen,
  PUSH_PERMISSION_KEY,
  pushData,
  recordAppOpen,
  syncPushDevice,
} from '../../lib/push'
import { usePushPromptStore } from '../../stores/pushPromptStore'

// Back after this long in the background counts as a new app open.
const REOPEN_AFTER_MS = 10 * 60_000
import { useAuthStore } from '../../stores/authStore'

// Root-level push wiring: channels and handler, device registration per signed-in user, taps from a
// warm or cold start, and the soft ask on first launch and after an order is placed.

export function PushBootstrap() {
  const router = useRouter()
  const qc = useQueryClient()
  const segments = useSegments() as string[]
  const navReady = !!useRootNavigationState()?.key
  const userId = useAuthStore(s => s.user?.id ?? null)
  const authLoading = useAuthStore(s => s.isLoading)

  useEffect(() => {
    void initPush()
    const token = Notifications.addPushTokenListener(t => {
      if (typeof t.data === 'string') void syncPushDevice(t.data)
    })
    const received = Notifications.addNotificationReceivedListener(() => qc.invalidateQueries({ queryKey: ['notifications'] }))
    const app = AppState.addEventListener('change', s => {
      if (s !== 'active') return
      qc.invalidateQueries({ queryKey: ['notifications', 'unread'] })
      qc.invalidateQueries({ queryKey: PUSH_PERMISSION_KEY })
    })
    return () => {
      token.remove()
      received.remove()
      app.remove()
    }
  }, [qc])

  // Register on launch and on sign-in; detach on sign-out (no re-register then, so a session the
  // logout call failed to end can't re-attach the user).
  const lastUser = useRef<string | null | undefined>(undefined)
  useEffect(() => {
    if (authLoading) return
    const prev = lastUser.current
    lastUser.current = userId
    if (prev && !userId) void detachPushDevice()
    else if (prev !== userId) void syncPushDevice()
  }, [authLoading, userId])

  // Taps wait for auth rehydration and the navigator before routing.
  const [tap, setTap] = useState<Notifications.NotificationResponse | null>(null)
  const handled = useRef(new Set<string>())
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener(setTap)
    Notifications.getLastNotificationResponseAsync()
      .then(r => r && setTap(prev => prev ?? r))
      .catch(() => {})
    return () => sub.remove()
  }, [])
  useEffect(() => {
    if (!tap || authLoading || !navReady) return
    setTap(null)
    const id = tap.notification.request.identifier
    if (handled.current.has(id)) return
    handled.current.add(id)
    void Notifications.clearLastNotificationResponseAsync().catch(() => {})
    const { link, notification_id } = pushData(tap.notification)
    if (notification_id && userId) {
      markNotificationOpened(notification_id)
        .then(() => qc.invalidateQueries({ queryKey: ['notifications'] }))
        .catch(() => {})
    }
    if (link) openHref(router, link)
    else if (userId) router.push('/notifications')
  }, [tap, authLoading, navReady, userId, router, qc])

  // First launch: offer notifications once the storefront has settled (once per install). Every
  // later open is counted, and push still off on every third one brings the ask back.
  const onTabs = segments[0] === '(tabs)'
  const pendingOpen = useRef(true)
  useEffect(() => {
    let backgroundedAt = 0
    const sub = AppState.addEventListener('change', s => {
      if (s === 'background') backgroundedAt = Date.now()
      else if (s === 'active' && backgroundedAt && Date.now() - backgroundedAt >= REOPEN_AFTER_MS) pendingOpen.current = true
    })
    return () => sub.remove()
  }, [])
  const appActive = useAppActive()
  useEffect(() => {
    if (!navReady || authLoading || !onTabs || !appActive || !pendingOpen.current) return
    pendingOpen.current = false
    const timer = setTimeout(async () => {
      const opens = await recordAppOpen()
      if (opens === 1) await maybePromptOnFirstLaunch()
      else if (!usePushPromptStore.getState().reason) await maybeRemindOnOpen(opens)
    }, 2500)
    return () => clearTimeout(timer)
  }, [navReady, authLoading, onTabs, appActive])

  // The order placed page: offer delivery updates once the celebration has played.
  const onConfirmation = segments.join('/') === 'checkout/confirmation'
  useEffect(() => {
    if (!onConfirmation) return
    const timer = setTimeout(() => void maybePromptForPush('order'), 2000)
    return () => clearTimeout(timer)
  }, [onConfirmation])

  return null
}

/** Re-renders when the app comes to the foreground, so a counted reopen runs its effect. */
function useAppActive(): boolean {
  const [active, setActive] = useState(AppState.currentState === 'active')
  useEffect(() => {
    const sub = AppState.addEventListener('change', s => setActive(s === 'active'))
    return () => sub.remove()
  }, [])
  return active
}
