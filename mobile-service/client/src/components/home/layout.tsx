import { Children, type ReactNode } from 'react'
import { ScrollView, View, useWindowDimensions } from 'react-native'
import { Overline, Text } from '../../ui'

// Shared building blocks for the home sections (web: container px-4, SectionCarousel, grid-cols-N).

export const GUTTER = 16

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

/** SectionCarousel at the mobile breakpoint: snap-scrolling row, items w-[45%], gap-3. */
export function Carousel({ itemWidth = 0.45, gap = 12, children }: { itemWidth?: number; gap?: number; children: ReactNode }) {
  const { width } = useWindowDimensions()
  const w = Math.floor((width - GUTTER * 2) * itemWidth)
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      snapToInterval={w + gap}
      decelerationRate="fast"
      style={{ marginHorizontal: -GUTTER }}
      contentContainerStyle={{ paddingHorizontal: GUTTER, gap }}
    >
      {Children.toArray(children).map((child, i) => (
        <View key={i} style={{ width: w }}>
          {child}
        </View>
      ))}
    </ScrollView>
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
