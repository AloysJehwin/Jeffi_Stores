import type { ReactNode } from 'react'
import { View } from 'react-native'
import Animated, { FadeIn } from 'react-native-reanimated'
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

/** An inline message box (form errors, notices). */
export function Notice({ tone = 'info', children, className }: { tone?: 'info' | 'danger' | 'success'; children: ReactNode; className?: string }) {
  const frame = tone === 'danger' ? 'bg-red-50 dark:bg-red-900/20' : tone === 'success' ? 'bg-green-50 dark:bg-green-900/20' : 'bg-accent-50 dark:bg-accent-900/20'
  const text = tone === 'danger' ? 'text-red-700 dark:text-red-300' : tone === 'success' ? 'text-green-800 dark:text-green-300' : 'text-accent-800 dark:text-accent-200'
  return (
    <View accessibilityLiveRegion="polite" className={cn('rounded-field px-4 py-3', frame, className)}>
      {typeof children === 'string' ? <Text className={cn('text-sm leading-5', text)}>{children}</Text> : children}
    </View>
  )
}
