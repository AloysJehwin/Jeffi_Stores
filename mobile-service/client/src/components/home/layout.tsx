import { Children, type ReactNode } from 'react'
import { View, useWindowDimensions } from 'react-native'
import { ArrowRight } from 'lucide-react-native'
import { GUTTER, Overline, Text } from '../../ui'
import { badgeBg } from '../../lib/badge'
import { status } from '../../theme'

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

/** Room a pager page leaves around its card for the shadow; the pager's ScrollView clips. */
export const SHADOW_ROOM = { top: 8, bottom: 16 } as const

/** The uppercase pill over a media card's title, in the admin's `bg-*` colour. */
export function SlideBadge({ text, color, shape = 'rounded-full' }: { text?: string | null; color?: string | null; shape?: string }) {
  if (!text) return null
  return (
    <View className={`mb-3 self-start px-3 py-1.5 ${shape} ${badgeBg(color, 'bg-primary-500')}`}>
      <Text className="text-[11px] font-extrabold uppercase text-white" style={{ letterSpacing: 1.5 }}>
        {text}
      </Text>
    </View>
  )
}

const CTA = {
  sm: { box: 'py-2', text: 'text-xs', icon: 14 },
  md: { box: 'py-2.5', text: 'text-sm', icon: 16 },
} as const

/** The white "label →" pill on a media card. */
export function SlideCta({ label, size = 'sm', className = 'mt-3' }: { label?: string | null; size?: keyof typeof CTA; className?: string }) {
  if (!label) return null
  const c = CTA[size]
  return (
    <View className={`${className} flex-row items-center gap-1.5 self-start rounded-full bg-white px-4 ${c.box}`}>
      <Text className={`${c.text} font-bold text-black`}>{label}</Text>
      <ArrowRight size={c.icon} color={status.black} strokeWidth={2.5} />
    </View>
  )
}
