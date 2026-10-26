import { Children, type ReactNode } from 'react'
import { Pressable, View, type ViewProps } from 'react-native'
import Animated from 'react-native-reanimated'
import { ChevronRight } from 'lucide-react-native'
import { status, useTokens } from '../theme'
import { Text } from './Text'
import { cn } from './cn'
import { elevationClass, useElevation, type Elevation } from './elevation'
import { usePressScale } from './motion'
import type { IconComponent } from './Button'

export interface CardProps extends ViewProps {
  children: ReactNode
  elevation?: Elevation
  /** Inner padding; false for edge-to-edge content (lists, images). */
  padded?: boolean
  onPress?: () => void
  accessibilityLabel?: string
  className?: string
  /** Layout classes (margins, flex) for a pressable card's outer wrapper. */
  wrapperClassName?: string
}

export function Card({ onPress, ...props }: CardProps) {
  // Only a pressable card pays for the press animation.
  return onPress ? <PressableCard onPress={onPress} {...props} /> : <StaticCard {...props} />
}

function StaticCard({ children, elevation = 'raised', padded = true, className, wrapperClassName: _w, style, accessibilityLabel: _l, ...rest }: CardProps) {
  const shadow = useElevation(elevation)
  return (
    <View style={[shadow, style]} className={cn('rounded-panel bg-surface-elevated', elevationClass(elevation), padded && 'p-4', className)} {...rest}>
      {children}
    </View>
  )
}

function PressableCard({ children, elevation = 'raised', padded = true, onPress, className, wrapperClassName, style, accessibilityLabel, ...rest }: CardProps) {
  const shadow = useElevation(elevation)
  const press = usePressScale(0.985)
  const frame = cn('rounded-panel bg-surface-elevated', elevationClass(elevation), padded && 'p-4', className)
  return (
    <Animated.View style={[shadow, { borderRadius: 20 }, press.style, style]} className={wrapperClassName} {...rest}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        onPress={onPress}
        unstable_pressDelay={80}
        {...press.handlers}
        className={cn(frame, 'active:opacity-90')}
      >
        {children}
      </Pressable>
    </Animated.View>
  )
}

/** One slice of a Card that a list renders row by row; `top` and `bottom` round its ends. */
export function CardSegment({
  position = 'middle',
  children,
  className,
}: {
  position?: 'top' | 'middle' | 'bottom' | 'single'
  children: ReactNode
  className?: string
}) {
  const shadow = useElevation('raised')
  const top = position === 'top' || position === 'single'
  const bottom = position === 'bottom' || position === 'single'
  return (
    <View
      style={shadow}
      className={cn(
        'bg-surface-elevated dark:border-x dark:border-border-default',
        top && 'rounded-t-panel dark:border-t',
        bottom && 'rounded-b-panel dark:border-b',
        className,
      )}
    >
      {children}
    </View>
  )
}

/** `CardSegment` position of row `i` of `n` rows, given whether the card has its own header and footer slices. */
export function segmentAt(i: number, n: number, { header = false, footer = false } = {}): 'top' | 'middle' | 'bottom' | 'single' {
  const first = i === 0 && !header
  const last = i === n - 1 && !footer
  return first && last ? 'single' : first ? 'top' : last ? 'bottom' : 'middle'
}

export function Divider({ inset, className }: { inset?: boolean; className?: string }) {
  return <View className={cn('h-px bg-border-default', inset && 'ml-14', className)} />
}

export interface ListRowProps {
  title: string
  subtitle?: string
  icon?: IconComponent
  /** Tone of the icon tile. */
  iconTone?: 'neutral' | 'accent' | 'danger'
  leading?: ReactNode
  trailing?: ReactNode
  /** Shown before the chevron (a count, the current value). */
  value?: string
  onPress?: () => void
  chevron?: boolean
  destructive?: boolean
  disabled?: boolean
  className?: string
}

/** One row of a settings-style list. */
export function ListRow({ title, subtitle, icon: Icon, iconTone = 'neutral', leading, trailing, value, onPress, chevron, destructive, disabled, className }: ListRowProps) {
  const t = useTokens()
  const tile = iconTone === 'accent' ? 'bg-accent-50 dark:bg-accent-900/30' : iconTone === 'danger' || destructive ? 'bg-red-50 dark:bg-red-900/20' : 'bg-surface-secondary'
  const iconColour = iconTone === 'accent' ? t.accent600 : iconTone === 'danger' || destructive ? status.danger : t.foregroundSecondary
  const body = (
    <>
      {leading ?? (Icon ? (
        <View className={cn('h-10 w-10 items-center justify-center rounded-xl', tile)}>
          <Icon size={20} color={iconColour} />
        </View>
      ) : null)}
      <View className="flex-1">
        <Text numberOfLines={1} className={cn('text-[15px] font-semibold', destructive ? 'text-red-600 dark:text-red-400' : 'text-foreground')}>
          {title}
        </Text>
        {subtitle ? (
          <Text numberOfLines={2} className="mt-0.5 text-[13px] leading-[18px] text-foreground-muted">
            {subtitle}
          </Text>
        ) : null}
      </View>
      {value ? <Text className="text-sm text-foreground-muted">{value}</Text> : null}
      {trailing}
      {(chevron ?? !!onPress) ? <ChevronRight size={18} color={t.foregroundMuted} /> : null}
    </>
  )
  const frame = cn('min-h-[56px] flex-row items-center gap-3 px-4 py-3', disabled && 'opacity-50', className)
  if (!onPress) return <View className={frame}>{body}</View>
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title} disabled={disabled} onPress={onPress} className={cn(frame, 'active:bg-surface-secondary')}>
      {body}
    </Pressable>
  )
}

/** A card of ListRows with dividers between them. */
export function ListGroup({ children, title, className }: { children: ReactNode; title?: string; className?: string }) {
  const rows = Children.toArray(children)
  return (
    <View className={className}>
      {title ? <Text className="mb-2 px-1 text-[11px] font-extrabold uppercase tracking-wider text-foreground-muted">{title}</Text> : null}
      <Card padded={false} className="overflow-hidden">
        {rows.map((row, i) => (
          <View key={(row as { key?: string }).key ?? i}>
            {i > 0 ? <Divider inset /> : null}
            {row}
          </View>
        ))}
      </Card>
    </View>
  )
}
