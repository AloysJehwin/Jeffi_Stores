import { Children, type ReactNode } from 'react'
import { ScrollView, View, useWindowDimensions } from 'react-native'
import { GUTTER } from './Screen'

/** SectionCarousel at the mobile breakpoint: a full-bleed snap-scrolling row, items w-[45%], gap-3. */
export function Rail({ itemWidth = 0.45, gap = 12, children }: { itemWidth?: number; gap?: number; children: ReactNode }) {
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
