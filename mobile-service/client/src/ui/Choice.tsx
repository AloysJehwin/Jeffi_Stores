import { useEffect, type ReactNode } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import Animated, { interpolateColor, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated'
import { Check } from 'lucide-react-native'
import { status, useTokens } from '../theme'
import { Text } from './Text'
import { cn } from './cn'
import { haptic } from './haptics'
import { SPRING, useMotion } from './motion'
import type { IconComponent } from './Button'

export interface ChipProps {
  label: string
  selected?: boolean
  onPress?: () => void
  icon?: IconComponent
  /** Shown after the label, e.g. a count. */
  meta?: string | number
  disabled?: boolean
  /** Struck through (an option that's out of stock). */
  unavailable?: boolean
  size?: 'sm' | 'md'
}

/** A pill toggle: filters, variant options, channel pickers. */
export function Chip({ label, selected, onPress, icon: Icon, meta, disabled, unavailable, size = 'md' }: ChipProps) {
  const t = useTokens()
  const fg = selected ? t.accent600 : t.foregroundSecondary
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected, disabled: !!disabled }}
      disabled={disabled}
      onPress={() => {
        haptic.select()
        onPress?.()
      }}
      hitSlop={size === 'sm' ? 6 : 3}
      className={cn(
        'flex-row items-center gap-1.5 rounded-full border-2',
        size === 'sm' ? 'min-h-[32px] px-3' : 'min-h-[38px] px-4',
        selected ? 'border-accent-500 bg-accent-50 dark:bg-accent-900/30' : 'border-border-default bg-surface-elevated active:bg-surface-secondary',
        disabled && 'opacity-40',
      )}
    >
      {Icon ? <Icon size={size === 'sm' ? 14 : 16} color={fg} /> : null}
      <Text
        numberOfLines={1}
        className={cn(
          size === 'sm' ? 'text-[13px]' : 'text-sm',
          'font-semibold',
          selected ? 'text-accent-700 dark:text-accent-300' : 'text-foreground-secondary',
          unavailable && 'line-through',
        )}
      >
        {label}
      </Text>
      {meta != null ? <Text className="text-xs font-medium text-foreground-muted">{meta}</Text> : null}
    </Pressable>
  )
}

/** Chips in a wrapping row, or a horizontal scroller when `scroll` is set. */
export function ChipGroup({ children, scroll, className }: { children: ReactNode; scroll?: boolean; className?: string }) {
  if (scroll) {
    return (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }} className={className}>
        {children}
      </ScrollView>
    )
  }
  return <View className={cn('flex-row flex-wrap gap-2', className)}>{children}</View>
}

function Tick({ on }: { on: boolean }) {
  return (
    <View className={cn('h-[22px] w-[22px] items-center justify-center rounded-md border-2', on ? 'border-accent-500 bg-accent-500' : 'border-border-secondary bg-surface')}>
      {on ? <Check size={14} color={status.white} strokeWidth={3.2} /> : null}
    </View>
  )
}

function Dot({ on }: { on: boolean }) {
  return (
    <View className={cn('h-[22px] w-[22px] items-center justify-center rounded-full border-2', on ? 'border-accent-500' : 'border-border-secondary bg-surface')}>
      {on ? <View className="h-2.5 w-2.5 rounded-full bg-accent-500" /> : null}
    </View>
  )
}

interface ChoiceRowProps {
  checked: boolean
  onChange: (v: boolean) => void
  label?: string
  description?: string
  children?: ReactNode
  disabled?: boolean
  className?: string
}

export function Checkbox({ checked, onChange, label, description, children, disabled, className }: ChoiceRowProps) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled: !!disabled }}
      disabled={disabled}
      onPress={() => {
        haptic.select()
        onChange(!checked)
      }}
      className={cn('min-h-[44px] flex-row items-start gap-3 py-2', disabled && 'opacity-50', className)}
    >
      <View className="mt-px">
        <Tick on={checked} />
      </View>
      <View className="flex-1">
        {label ? <Text className="text-[15px] leading-[22px] text-foreground">{label}</Text> : null}
        {description ? <Text className="mt-0.5 text-[13px] text-foreground-muted">{description}</Text> : null}
        {children}
      </View>
    </Pressable>
  )
}

/** One option of a single-choice list; `selected` decides the dot. */
export function Radio({
  selected,
  onSelect,
  label,
  description,
  trailing,
  children,
  disabled,
  card,
  className,
}: {
  selected: boolean
  onSelect: () => void
  label?: string
  description?: string
  trailing?: ReactNode
  children?: ReactNode
  disabled?: boolean
  /** Bordered card style (checkout options). */
  card?: boolean
  className?: string
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, disabled: !!disabled }}
      disabled={disabled}
      onPress={() => {
        haptic.select()
        onSelect()
      }}
      className={cn(
        'min-h-[44px] flex-row items-start gap-3',
        card ? cn('rounded-panel border-2 p-4', selected ? 'border-accent-500 bg-accent-50 dark:bg-accent-900/20' : 'border-border-default bg-surface-elevated') : 'py-2',
        disabled && 'opacity-50',
        className,
      )}
    >
      <View className="mt-px">
        <Dot on={selected} />
      </View>
      <View className="flex-1">
        {label ? <Text className="text-[15px] font-semibold leading-[22px] text-foreground">{label}</Text> : null}
        {description ? <Text className="mt-0.5 text-[13px] leading-[18px] text-foreground-muted">{description}</Text> : null}
        {children}
      </View>
      {trailing}
    </Pressable>
  )
}

const TRACK_W = 50
const TRACK_H = 30
const KNOB = 24

export function Switch({ value, onChange, disabled, label }: { value: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: string }) {
  const t = useTokens()
  const { animate } = useMotion()
  const p = useSharedValue(value ? 1 : 0)
  useEffect(() => {
    p.value = animate ? withSpring(value ? 1 : 0, SPRING) : withTiming(value ? 1 : 0, { duration: 0 })
  }, [value, animate, p])
  const track = useAnimatedStyle(() => ({ backgroundColor: interpolateColor(p.value, [0, 1], [t.borderSecondary, t.accent500]) }))
  const knob = useAnimatedStyle(() => ({ transform: [{ translateX: 3 + p.value * (TRACK_W - KNOB - 6) }] }))
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value, disabled: !!disabled }}
      disabled={disabled}
      hitSlop={8}
      onPress={() => {
        haptic.select()
        onChange(!value)
      }}
      className={disabled ? 'opacity-50' : undefined}
    >
      <Animated.View style={[{ width: TRACK_W, height: TRACK_H, borderRadius: TRACK_H / 2, justifyContent: 'center' }, track]}>
        <Animated.View style={[{ width: KNOB, height: KNOB, borderRadius: KNOB / 2 }, knob]} className="bg-white" />
      </Animated.View>
    </Pressable>
  )
}
