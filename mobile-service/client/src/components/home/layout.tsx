import { Children, type ReactNode } from 'react'
import { View, useWindowDimensions } from 'react-native'
import { GUTTER, Overline, Text } from '../../ui'

// Shared building blocks for the home sections (web: container px-4, grid-cols-N). The snap row is ui's Rail.

export { GUTTER }

/** Width of one column in an N-column grid inside the px-4 container. */
export function useColumnWidth(cols: number, gap: number, inset = 0): number {
  const { width } = useWindowDimensions()
  return Math.floor((width - GUTTER * 2 - inset * 2 - gap * (cols - 1)) / cols)
}

/** `grid grid-cols-N gap-X` */
export function Grid({ cols = 2, gap = 12, inset = 0, children }: { cols?: number; gap?: number; inset?: number; children: ReactNode }) {
  const w = useColumnWidth(cols, gap, inset)
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap }}>
      {Children.toArray(children).map((child, i) => (
        <View key={i} style={{ width: w }}>
          {child}
        </View>
      ))}
    </View>
  )
}

/** The small all-caps eyebrow over a section title. */
export function Eyebrow({ children, className = 'text-accent-500', spacing = 2 }: { children: ReactNode; className?: string; spacing?: number }) {
  if (!children) return null
  return (
    <Overline className={`mb-1 ${className}`} style={{ letterSpacing: spacing }}>
      {children}
    </Overline>
  )
}

/** Eyebrow + heading, optionally with the left accent bar the product rows use. */
export function SectionHeading({
  eyebrow,
  title,
  eyebrowClassName,
  titleClassName = 'font-display text-2xl font-extrabold leading-8 tracking-tight text-foreground',
  barClassName,
  className = 'mb-7',
}: {
  eyebrow?: string | null
  title?: string | null
  eyebrowClassName?: string
  titleClassName?: string
  barClassName?: string
  className?: string
}) {
  const heading = (
    <View className="shrink">
      <Eyebrow className={eyebrowClassName}>{eyebrow}</Eyebrow>
      {title ? (
        <Text accessibilityRole="header" className={titleClassName}>
          {title}
        </Text>
      ) : null}
    </View>
  )
  return (
    <View className={className}>
      {barClassName ? (
        <View className="flex-row items-center gap-4">
          <View className={`h-10 w-1 rounded-full ${barClassName}`} />
          {heading}
        </View>
      ) : (
        heading
      )}
    </View>
  )
}
