import type { ReactNode } from 'react'
import { StyleSheet, View, type StyleProp, type TextStyle } from 'react-native'
import Animated, { FadeIn } from 'react-native-reanimated'
import { cssInterop } from 'nativewind'
import { CloudOff, PackageOpen } from 'lucide-react-native'
import { useTokens } from '../theme'
import { Text } from './Text'
import { Button, type IconComponent } from './Button'
import { cn } from './cn'
import { useEntering } from './motion'

interface StateProps {
  icon?: IconComponent
  title: string
  message?: string
  actionLabel?: string
  onAction?: () => void
  children?: ReactNode
  /** Centre in the remaining space (a whole screen with nothing to show). */
  fill?: boolean
  className?: string
}

function StateView({ icon: Icon, title, message, actionLabel, onAction, children, fill, className, tile }: StateProps & { tile: string }) {
  const t = useTokens()
  const entering = useEntering(FadeIn.duration(220))
  return (
    <Animated.View entering={entering} className={cn('items-center px-8 py-12', fill && 'flex-1 justify-center', className)}>
      {Icon ? (
        <View className={cn('mb-4 h-16 w-16 items-center justify-center rounded-panel', tile)}>
          <Icon size={30} color={t.foregroundMuted} strokeWidth={1.8} />
        </View>
      ) : null}
      <Text className="text-center font-display text-lg font-extrabold text-foreground">{title}</Text>
      {message ? <Text className="mt-1.5 text-center text-sm leading-5 text-foreground-secondary">{message}</Text> : null}
      {children}
      {actionLabel && onAction ? (
        <View className="mt-5 w-full max-w-[260px]">
          <Button label={actionLabel} onPress={onAction} size="md" />
        </View>
      ) : null}
    </Animated.View>
  )
}

export function EmptyState({ icon = PackageOpen, ...props }: StateProps) {
  return <StateView icon={icon} tile="bg-surface-secondary" {...props} />
}

/** A failed load, with a retry. */
export function ErrorState({ title = "Couldn't load this", message = 'Check your connection and try again.', onRetry, icon = CloudOff, ...props }: Partial<StateProps> & { onRetry?: () => void }) {
  return <StateView icon={icon} tile="bg-red-50 dark:bg-red-900/20" title={title} message={message} actionLabel={onRetry ? 'Try again' : undefined} onAction={onRetry} {...props} />
}

const NOTICE = {
  info: { frame: 'bg-accent-50 dark:bg-accent-900/20', text: 'text-accent-800 dark:text-accent-200' },
  danger: { frame: 'bg-red-50 dark:bg-red-900/20', text: 'text-red-700 dark:text-red-300' },
  success: { frame: 'bg-green-50 dark:bg-green-900/20', text: 'text-green-800 dark:text-green-300' },
  warning: { frame: 'bg-orange-50 dark:bg-orange-900/20', text: 'text-orange-800 dark:text-orange-300' },
}

// A lucide icon coloured by a text-* class, so the icon follows the notice's tone in both schemes.
function ToneIcon({ icon: Icon, style }: { icon: IconComponent; style?: StyleProp<TextStyle> }) {
  return <Icon size={20} color={StyleSheet.flatten(style)?.color as string | undefined} />
}
const TintedIcon = cssInterop(ToneIcon, { className: 'style' })

/** An inline message box (form errors, order notices); string children take the tone's colour. */
export function Notice({
  tone = 'info',
  title,
  icon,
  children,
  className,
}: {
  tone?: keyof typeof NOTICE
  title?: string
  icon?: IconComponent
  children?: ReactNode
  className?: string
}) {
  const { frame, text } = NOTICE[tone]
  return (
    <View accessibilityLiveRegion="polite" className={cn('flex-row gap-3 rounded-field px-4 py-3', frame, className)}>
      {icon ? (
        <View className="mt-px">
          <TintedIcon icon={icon} className={text} />
        </View>
      ) : null}
      <View className="flex-1">
        {title ? <Text className={cn('text-[15px] font-bold leading-[22px]', text)}>{title}</Text> : null}
        {typeof children === 'string' ? <Text className={cn('text-sm leading-5', title && 'mt-0.5', text)}>{children}</Text> : children}
      </View>
    </View>
  )
}
