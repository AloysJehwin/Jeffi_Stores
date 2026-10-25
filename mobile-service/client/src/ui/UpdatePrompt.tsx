import { useState } from 'react'
import { Linking, Platform, Pressable, Text, View } from 'react-native'
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useQuery } from '@tanstack/react-query'
import Constants from 'expo-constants'
import { X } from 'lucide-react-native'
import { getAppConfig, isOlderVersion } from '../api/appConfig'
import { useTokens } from '../theme'

const PACKAGE = 'com.jeffistores.app'
const STORE_URL = Platform.select({
  android: `https://play.google.com/store/apps/details?id=${PACKAGE}`,
  default: null,
})

/** A dismissible card when this build is older than the backend's MIN_APP_VERSION (no OTA updates here). */
export default function UpdatePrompt() {
  const insets = useSafeAreaInsets()
  const t = useTokens()
  const [dismissed, setDismissed] = useState(false)
  const { data } = useQuery({ queryKey: ['app-config'], queryFn: getAppConfig, staleTime: 60 * 60_000, retry: 0 })
  const current = Constants.expoConfig?.version
  if (dismissed || !data || !isOlderVersion(current, data.min_app_version)) return null
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left: 16, right: 16, bottom: insets.bottom + 132 }}>
      <Animated.View
        entering={FadeInDown.duration(220)}
        exiting={FadeOutDown.duration(160)}
        className="flex-row items-center gap-3 rounded-2xl border border-border-default bg-surface-elevated px-4 py-3 shadow-lg"
      >
        <View className="flex-1">
          <Text className="text-sm font-semibold text-foreground">A newer version is available</Text>
          <Text className="text-xs text-foreground-secondary">Update to keep everything working smoothly.</Text>
        </View>
        {STORE_URL ? (
          <Pressable onPress={() => Linking.openURL(STORE_URL).catch(() => {})} className="rounded-full bg-accent-500 px-3.5 py-2">
            <Text className="text-xs font-bold text-white">Update</Text>
          </Pressable>
        ) : null}
        <Pressable onPress={() => setDismissed(true)} hitSlop={8} accessibilityLabel="Dismiss">
          <X size={18} color={t.foregroundMuted} />
        </Pressable>
      </Animated.View>
    </View>
  )
}
