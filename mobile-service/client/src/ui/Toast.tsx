import { useEffect } from 'react'
import { View } from 'react-native'
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { CheckCircle2, AlertCircle, Info } from 'lucide-react-native'
import { useToastStore } from '../stores/toastStore'
import { status, useTokens } from '../theme'
import { Text } from './Text'
import { elevationClass, useElevation } from './elevation'
import { useEntering } from './motion'

const ICONS = { success: CheckCircle2, error: AlertCircle, info: Info }

export default function Toast() {
  const { message, kind, seq, hide } = useToastStore()
  const insets = useSafeAreaInsets()
  const t = useTokens()
  const shadow = useElevation('floating')
  const entering = useEntering(FadeInDown.duration(180))
  const exiting = useEntering(FadeOutDown.duration(160))

  useEffect(() => {
    if (!message) return
    const id = setTimeout(hide, 2600)
    return () => clearTimeout(id)
  }, [seq, message, hide])

  if (!message) return null
  const Icon = ICONS[kind]
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 16, right: 16, bottom: insets.bottom + 72 }}>
      <Animated.View
        key={seq}
        accessibilityLiveRegion="polite"
        entering={entering}
        exiting={exiting}
        style={shadow}
        className={`max-w-full flex-row items-center gap-2.5 self-center rounded-field bg-surface-elevated px-4 py-3 ${elevationClass('floating')}`}
      >
        <Icon size={18} color={kind === 'error' ? status.danger : kind === 'success' ? status.success : t.accent500} />
        <Text className="flex-shrink text-sm font-semibold text-foreground">{message}</Text>
      </Animated.View>
    </View>
  )
}
