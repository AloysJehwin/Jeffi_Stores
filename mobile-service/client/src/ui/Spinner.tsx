import { ActivityIndicator, View } from 'react-native'
import { useTokens } from '../theme'
import { Text } from './Text'
import { cn } from './cn'

/** A spinner; `fill` centres it in the available space (a whole-screen load). */
export default function Spinner({ size = 'large', color, fill = true, label, className }: { size?: 'small' | 'large'; color?: string; fill?: boolean; label?: string; className?: string }) {
  const t = useTokens()
  return (
    <View accessibilityRole="progressbar" accessibilityLabel={label ?? 'Loading'} className={cn(fill ? 'flex-1 items-center justify-center py-8' : 'items-center justify-center', className)}>
      <ActivityIndicator size={size} color={color ?? t.accent500} />
      {label ? <Text className="mt-3 text-sm text-foreground-muted">{label}</Text> : null}
    </View>
  )
}

export { Spinner }
