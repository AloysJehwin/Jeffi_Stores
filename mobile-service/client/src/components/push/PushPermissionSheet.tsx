import { useState } from 'react'
import { Linking, View } from 'react-native'
import { useQueryClient } from '@tanstack/react-query'
import { BellRing, Settings, ShieldCheck, Truck } from 'lucide-react-native'
import { BottomSheet, Button, Notice, SheetFooter, SheetHeader, Text, toast, type IconComponent } from '../../ui'
import { usePushPermission } from '../../hooks/useNotifications'
import { isBlocked, markSoftAskDeclined, PUSH_PERMISSION_KEY, requestPushPermission, syncPushDevice } from '../../lib/push'
import { usePushPromptStore, type PushPromptReason } from '../../stores/pushPromptStore'
import { useTokens } from '../../theme'

// The soft ask: explains push first, and only "Turn on" shows the Android 13 system prompt.

const COPY: Record<PushPromptReason, { title: string; subtitle: string }> = {
  order: { title: 'Get delivery updates', subtitle: "We'll let you know when your order ships, is out for delivery and arrives." },
  settings: { title: 'Turn on notifications', subtitle: 'Order and account updates as they happen. You choose what else you get.' },
}

const POINTS: { icon: IconComponent; text: string }[] = [
  { icon: Truck, text: 'Shipping and delivery updates' },
  { icon: ShieldCheck, text: 'Payment, refund and account alerts' },
  { icon: Settings, text: 'Choose what you get in Notification settings' },
]

export function PushPermissionSheetHost() {
  const reason = usePushPromptStore(s => s.reason)
  const close = usePushPromptStore(s => s.close)
  // The last copy stays mounted while the sheet slides away.
  const [shown, setShown] = useState<PushPromptReason | null>(reason)
  if (reason && reason !== shown) setShown(reason)
  const dismiss = () => {
    void markSoftAskDeclined()
    close()
  }
  return (
    <BottomSheet open={!!reason} onClose={dismiss}>
      {shown ? <PushPermissionContent reason={shown} onDismiss={dismiss} onDone={close} /> : null}
    </BottomSheet>
  )
}

function PushPermissionContent({ reason, onDismiss, onDone }: { reason: PushPromptReason; onDismiss: () => void; onDone: () => void }) {
  const t = useTokens()
  const qc = useQueryClient()
  const { data: permission } = usePushPermission()
  const [busy, setBusy] = useState(false)
  const blocked = isBlocked(permission)
  const copy = COPY[reason]

  const turnOn = async () => {
    setBusy(true)
    try {
      const p = await requestPushPermission()
      qc.setQueryData(PUSH_PERMISSION_KEY, p)
      if (p.granted) {
        onDone()
        toast.success('Notifications are on')
        void syncPushDevice()
      } else {
        onDismiss()
      }
    } catch {
      toast.error("Couldn't turn on notifications")
    } finally {
      setBusy(false)
    }
  }

  return (
    <View>
      <View className="mb-4 mt-1 h-14 w-14 items-center justify-center rounded-panel bg-accent-50 dark:bg-accent-900/30">
        <BellRing size={28} color={t.accent600} />
      </View>
      <SheetHeader title={copy.title} subtitle={copy.subtitle} />
      <View className="gap-3">
        {POINTS.map(({ icon: Icon, text }) => (
          <View key={text} className="flex-row items-center gap-3">
            <View className="h-9 w-9 items-center justify-center rounded-xl bg-surface-secondary">
              <Icon size={18} color={t.foregroundSecondary} />
            </View>
            <Text className="flex-1 text-[15px] text-foreground">{text}</Text>
          </View>
        ))}
      </View>
      {blocked ? <Notice className="mt-5">Notifications are off for this app. Turn them on in Android settings.</Notice> : null}
      <SheetFooter>
        <View className="gap-2">
          {blocked ? (
            <Button
              label="Open settings"
              onPress={() => {
                onDone()
                void Linking.openSettings()
              }}
            />
          ) : (
            <Button label="Turn on" loading={busy} haptics onPress={turnOn} />
          )}
          <Button label="Not now" variant="ghost" size="md" disabled={busy} onPress={onDismiss} />
        </View>
      </SheetFooter>
    </View>
  )
}
