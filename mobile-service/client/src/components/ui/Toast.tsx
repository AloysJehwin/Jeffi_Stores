import { useEffect } from 'react'
import { Text, View } from 'react-native'
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { CheckCircle2, AlertCircle, Info } from 'lucide-react-native'
import { useToastStore } from '../../stores/toastStore'
import { status, useTokens } from '../../theme'

const ICONS = { success: CheckCircle2, error: AlertCircle, info: Info }

export default function Toast() {
  const { message, kind, seq, hide } = useToastStore()
  const insets = useSafeAreaInsets()
  const t = useTokens()

  useEffect(() => {
    if (!message) return
    const t = setTimeout(hide, 2600)
    return () => clearTimeout(t)
  }, [seq, message, hide])

  if (!message) return null
  const Icon = ICONS[kind]
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 16, right: 16, bottom: insets.bottom + 72 }}>
      <Animated.View
        key={seq}
        entering={FadeInDown.duration(180)}
        exiting={FadeOutDown.duration(160)}
        className="flex-row items-center gap-2 self-center rounded-xl border border-border-default bg-surface-elevated px-4 py-3 shadow-lg"
      >
        <Icon size={18} color={kind === 'error' ? status.danger : kind === 'success' ? status.success : t.accent500} />
        <Text className="text-sm font-medium text-foreground">{message}</Text>
      </Animated.View>
    </View>
  )
}
