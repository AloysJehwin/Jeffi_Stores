import type { ComponentType, ReactNode } from 'react'
import { ActivityIndicator, Pressable, View, type PressableProps } from 'react-native'
import Animated from 'react-native-reanimated'
import { status, useTokens } from '../theme'
import { Text } from './Text'
import { cn } from './cn'
import { haptic } from './haptics'
import { usePressScale } from './motion'

type Variant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'destructive'
type Size = 'sm' | 'md' | 'lg'
export type IconComponent = ComponentType<{ size?: number; color?: string; strokeWidth?: number }>

const FRAME: Record<Variant, { on: string; off: string }> = {
  primary: { on: 'bg-accent-500 active:bg-accent-600', off: 'bg-accent-500/40' },
  secondary: { on: 'bg-surface-secondary active:bg-border-default', off: 'bg-surface-secondary opacity-60' },
  outline: { on: 'border-2 border-border-secondary bg-surface active:bg-surface-secondary', off: 'border-2 border-border-default bg-surface opacity-60' },
  ghost: { on: 'active:bg-surface-secondary', off: 'opacity-50' },
  destructive: { on: 'bg-red-600 active:bg-red-700', off: 'bg-red-600/40' },
}
const LABEL: Record<Variant, string> = {
  primary: 'text-white',
  secondary: 'text-foreground',
  outline: 'text-foreground',
  ghost: 'text-accent-600 dark:text-accent-400',
  destructive: 'text-white',
}
const HEIGHT: Record<Size, string> = { sm: 'h-10 px-4 rounded-xl', md: 'h-12 px-5 rounded-field', lg: 'h-14 px-6 rounded-field' }
const TEXT: Record<Size, string> = { sm: 'text-sm', md: 'text-[15px]', lg: 'text-base' }
const ICON: Record<Size, number> = { sm: 16, md: 18, lg: 20 }

export interface ButtonProps extends Omit<PressableProps, 'children' | 'style'> {
  label: string
  loadingLabel?: string
  onPress?: () => void
  variant?: Variant
  size?: Size
  loading?: boolean
  disabled?: boolean
  /** Stretch to the parent's width (the default). */
  block?: boolean
  icon?: IconComponent
  trailing?: ReactNode
  haptics?: boolean
  className?: string
}

export function Button({
  label,
  loadingLabel,
  onPress,
  variant = 'primary',
  size = 'lg',
  loading,
  disabled,
  block = true,
  icon: Icon,
  trailing,
  haptics,
  className,
  ...rest
}: ButtonProps) {
  const t = useTokens()
  const press = usePressScale()
  const off = !!(disabled || loading)
  const fg = variant === 'primary' || variant === 'destructive' ? status.white : variant === 'ghost' ? t.accent600 : t.foreground
  return (
    <Animated.View style={press.style} className={cn(block ? 'self-stretch' : 'self-start', className)}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: off, busy: !!loading }}
        disabled={off}
        onPress={() => {
          if (haptics) haptic.tap()
          onPress?.()
        }}
        {...press.handlers}
        {...rest}
        className={cn('flex-row items-center justify-center gap-2', HEIGHT[size], off ? FRAME[variant].off : FRAME[variant].on)}
      >
        {loading ? <ActivityIndicator size="small" color={fg} /> : Icon ? <Icon size={ICON[size]} color={fg} strokeWidth={2.2} /> : null}
        <Text numberOfLines={1} className={cn('font-bold', TEXT[size], LABEL[variant])}>
          {loading && loadingLabel ? loadingLabel : label}
        </Text>
        {trailing}
      </Pressable>
    </Animated.View>
  )
}

export interface IconButtonProps extends Omit<PressableProps, 'children' | 'style'> {
  icon: IconComponent
  /** Read out by screen readers; icon-only buttons have no other name. */
  label: string
  onPress?: () => void
  variant?: 'plain' | 'tinted' | 'solid' | 'overlay'
  size?: 'sm' | 'md' | 'lg'
  color?: string
  badge?: number
  className?: string
}

const ICON_FRAME = {
  plain: 'active:bg-surface-secondary',
  tinted: 'bg-surface-secondary active:bg-border-default',
  solid: 'bg-accent-500 active:bg-accent-600',
  overlay: 'bg-black/35 active:bg-black/50',
}

/** A round icon-only button with a 44pt touch target. */
export function IconButton({ icon: Icon, label, onPress, variant = 'plain', size = 'md', color, badge, className, ...rest }: IconButtonProps) {
  const t = useTokens()
  const press = usePressScale(0.92)
  const box = size === 'sm' ? 'h-9 w-9' : size === 'lg' ? 'h-12 w-12' : 'h-11 w-11'
  const fg = color ?? (variant === 'solid' || variant === 'overlay' ? status.white : t.foreground)
  return (
    <Animated.View style={press.style} className={className}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={badge ? `${label}, ${badge}` : label}
        hitSlop={size === 'sm' ? 6 : 2}
        onPress={onPress}
        {...press.handlers}
        {...rest}
        className={cn('items-center justify-center rounded-full', box, ICON_FRAME[variant], rest.disabled && 'opacity-40')}
      >
        <Icon size={size === 'sm' ? 18 : size === 'lg' ? 24 : 22} color={fg} strokeWidth={2} />
        {badge ? (
          <View className="absolute right-0.5 top-0.5 h-[18px] min-w-[18px] items-center justify-center rounded-full bg-accent-500 px-1">
            <Text className="text-[11px] font-bold leading-[14px] text-white">{badge > 99 ? '99+' : badge}</Text>
          </View>
        ) : null}
      </Pressable>
    </Animated.View>
  )
}

/** An inline text link ("Use email instead", "See all"). */
export function TextButton({ label, onPress, tone = 'accent', className }: { label: string; onPress: () => void; tone?: 'accent' | 'muted' | 'danger'; className?: string }) {
  const colour = tone === 'muted' ? 'text-foreground-secondary' : tone === 'danger' ? 'text-red-600 dark:text-red-400' : 'text-accent-600 dark:text-accent-400'
  return (
    <Pressable accessibilityRole="button" onPress={onPress} hitSlop={8} className={cn('self-start py-1', className)}>
      <Text className={cn('text-sm font-semibold', colour)}>{label}</Text>
    </Pressable>
  )
}
