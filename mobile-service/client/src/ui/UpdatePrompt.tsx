import { useState } from 'react'
import { Linking, Platform, View } from 'react-native'
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useQuery } from '@tanstack/react-query'
import Constants from 'expo-constants'
import { X } from 'lucide-react-native'
import { getAppConfig, isOlderVersion } from '../api/appConfig'
import { useTokens } from '../theme'
import { Button, IconButton } from './Button'
import { Caption, Text } from './Text'
import { cn } from './cn'
import { elevationClass, useElevation } from './elevation'
import { useMotion } from './motion'

const PACKAGE = 'com.jeffistores.app'
const STORE_URL = Platform.select({
  android: `https://play.google.com/store/apps/details?id=${PACKAGE}`,
  default: null,
})

/** A dismissible card when this build is older than the backend's MIN_APP_VERSION (no OTA updates here). */
export default function UpdatePrompt() {
  const insets = useSafeAreaInsets()
  const t = useTokens()
  const shadow = useElevation('floating')
  const { animate } = useMotion()
  const [dismissed, setDismissed] = useState(false)
  const { data } = useQuery({ queryKey: ['app-config'], queryFn: getAppConfig, staleTime: 60 * 60_000, retry: 0 })
  const current = Constants.expoConfig?.version
  if (dismissed || !data || !isOlderVersion(current, data.min_app_version)) return null
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left: 16, right: 16, bottom: insets.bottom + 132 }}>
      <Animated.View
        entering={animate ? FadeInDown.duration(220) : undefined}
        exiting={animate ? FadeOutDown.duration(160) : undefined}
        style={shadow}
        className={cn('flex-row items-center gap-3 rounded-panel bg-surface-elevated py-3 pl-4 pr-2', elevationClass('floating'))}
      >
        <View className="flex-1">
          <Text className="text-sm font-semibold">A newer version is available</Text>
          <Caption className="text-foreground-secondary">Update to keep everything working smoothly.</Caption>
        </View>
        {STORE_URL ? <Button label="Update" size="sm" block={false} onPress={() => Linking.openURL(STORE_URL).catch(() => {})} /> : null}
        <IconButton icon={X} label="Dismiss" size="sm" color={t.foregroundMuted} onPress={() => setDismissed(true)} />
      </Animated.View>
    </View>
  )
}
