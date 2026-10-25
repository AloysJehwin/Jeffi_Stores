import { useRef } from 'react'
import { Linking, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { BadgePercent, BellRing, Mail, MessageCircle, MessageSquare, Settings, Smartphone } from 'lucide-react-native'
import {
  getNotificationPreferences, saveNotificationPreferences,
  type NotificationCategory, type NotificationChannel, type NotificationPreferences,
} from '../../src/api/notifications'
import { CATEGORY_META } from '../../src/components/push/categories'
import { usePushPermission } from '../../src/hooks/useNotifications'
import { getDeviceOffersOptIn, isBlocked, OFFERS_OPT_IN_KEY, setDeviceOffersOptIn, type PushPermission } from '../../src/lib/push'
import { useAuthStore } from '../../src/stores/authStore'
import { openPushPrompt } from '../../src/stores/pushPromptStore'
import {
  Button, ListGroup, ListRow, ListSkeleton, Notice, Screen, Switch, Text, TextButton, toast, type IconComponent,
} from '../../src/ui'

// Notification settings: the device permission, then categories × channels (signed in) or just this
// install's offers consent (signed out).

const CHANNELS: { id: NotificationChannel; label: string; icon: IconComponent }[] = [
  { id: 'push', label: 'Push', icon: Smartphone },
  { id: 'email', label: 'Email', icon: Mail },
  { id: 'sms', label: 'SMS', icon: MessageSquare },
  { id: 'whatsapp', label: 'WhatsApp', icon: MessageCircle },
]

function PermissionNotice({ permission }: { permission: PushPermission | undefined }) {
  if (!permission) return null
  if (permission.granted) {
    return (
      <Notice tone="success" className="mb-6">
        <Text className="text-sm leading-5 text-green-800 dark:text-green-300">Push notifications are on for this device.</Text>
        <TextButton label="Manage in Android settings" onPress={() => void Linking.openSettings()} className="mt-1" />
      </Notice>
    )
  }
  const blocked = isBlocked(permission)
  return (
    <Notice className="mb-6">
      <Text className="text-sm leading-5 text-accent-800 dark:text-accent-200">
        {blocked
          ? 'Notifications are off for this app in Android settings. Your inbox still gets every update.'
          : 'Push notifications are off on this device. Your inbox still gets every update.'}
      </Text>
      <View className="mt-3">
        <Button
          size="sm"
          block={false}
          icon={blocked ? Settings : BellRing}
          label={blocked ? 'Open settings' : 'Turn on'}
          onPress={() => (blocked ? void Linking.openSettings() : openPushPrompt('settings'))}
        />
      </View>
    </Notice>
  )
}

function SignedOutSettings({ permission }: { permission: PushPermission | undefined }) {
  const router = useRouter()
  const qc = useQueryClient()
  const { data: offers = false } = useQuery({ queryKey: OFFERS_OPT_IN_KEY, queryFn: () => getDeviceOffersOptIn().then(v => v ?? false) })

  const toggle = async (on: boolean) => {
    qc.setQueryData(OFFERS_OPT_IN_KEY, on)
    try {
      await setDeviceOffersOptIn(on)
      if (on && permission && !permission.granted && !isBlocked(permission)) openPushPrompt('settings')
    } catch {
      qc.setQueryData(OFFERS_OPT_IN_KEY, !on)
      toast.error("Couldn't save that. Try again.")
    }
  }

  return (
    <View className="gap-6">
      <ListGroup title="This device">
        <ListRow
          title="Offers on this device"
          subtitle="Deals and price drops, even while you're signed out"
          icon={BadgePercent}
          trailing={<Switch value={offers} onChange={toggle} label="Offers on this device" />}
        />
      </ListGroup>
      <Notice>
        <Text className="text-sm leading-5 text-accent-800 dark:text-accent-200">Sign in to choose how you get order updates and account alerts.</Text>
        <View className="mt-3">
          <Button size="sm" block={false} label="Sign in" onPress={() => router.push('/(auth)/login')} />
        </View>
      </Notice>
    </View>
  )
}

export default function NotificationSettingsScreen() {
  const qc = useQueryClient()
  const userId = useAuthStore(s => s.user?.id ?? null)
  const authLoading = useAuthStore(s => s.isLoading)
  const { data: permission } = usePushPermission()
  const key = ['notification-preferences', userId]
  const prefs = useQuery({ queryKey: key, queryFn: getNotificationPreferences, enabled: !!userId })
  // A server reply only replaces the cache once no other save is in flight, so quick toggles don't flicker.
  const inflight = useRef(0)

  const setChannel = (category: NotificationCategory, channel: NotificationChannel, value: boolean) =>
    qc.setQueryData<NotificationPreferences>(key, d =>
      d ? { ...d, categories: d.categories.map(c => (c.category === category ? { ...c, [channel]: value } : c)) } : d,
    )

  const save = async (category: NotificationCategory, channel: NotificationChannel, value: boolean) => {
    setChannel(category, channel, value)
    inflight.current += 1
    try {
      const next = await saveNotificationPreferences([{ category, [channel]: value }])
      if (inflight.current === 1) qc.setQueryData(key, next)
    } catch {
      setChannel(category, channel, !value)
      toast.error("Couldn't save that. Try again.")
    } finally {
      inflight.current -= 1
    }
  }

  const data = prefs.data

  return (
    <Screen
      title="Notification settings"
      loading={authLoading || (!!userId && prefs.isLoading)}
      skeleton={
        <View className="gap-6">
          <ListSkeleton rows={4} />
          <ListSkeleton rows={4} />
        </View>
      }
      error={userId && !data ? prefs.error : undefined}
      onRetry={() => prefs.refetch()}
    >
      <PermissionNotice permission={permission} />
      {!userId ? (
        <SignedOutSettings permission={permission} />
      ) : data ? (
        data.categories.map(c => {
          const meta = CATEGORY_META[c.category]
          const locked = c.kind === 'marketing' && data.marketing_opt_out
          return (
            <View key={c.category} className="mb-6">
              {c.category === 'offers' && data.marketing_opt_out ? (
                <Notice className="mb-4">You unsubscribed from marketing messages, so offers and price alerts are off.</Notice>
              ) : null}
              <ListGroup title={meta.label}>
                {CHANNELS.map(ch => (
                  <ListRow
                    key={ch.id}
                    title={ch.label}
                    icon={ch.icon}
                    trailing={<Switch value={c[ch.id]} disabled={locked} onChange={v => void save(c.category, ch.id, v)} label={`${meta.label} by ${ch.label}`} />}
                  />
                ))}
              </ListGroup>
              <Text className="mt-2 px-1 text-[13px] leading-[18px] text-foreground-muted">{meta.description}</Text>
            </View>
          )
        })
      ) : null}
    </Screen>
  )
}
