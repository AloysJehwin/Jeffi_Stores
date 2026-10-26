import { useState } from 'react'
import { Pressable, ScrollView, View, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native'
import { Button, Media } from '../../ui'
import { useRouter } from 'expo-router'
import Animated from 'react-native-reanimated'
import { GUTTER, SectionHeading } from './layout'
import { useOnScreen } from './scroll-context'
import { openHref } from '../../lib/links'
import type { SectionProps } from '../../types/home'

// Mirror of controller-service components/visitor/home/SocialStrip.tsx at the mobile breakpoint.

interface SocialStripItem {
  imageUrl: string
  url: string
  caption: string
  /** Optional MP4/WebM; `imageUrl` is its poster. */
  video?: string
}

// homepage-sections safeHref: http(s) or a site-relative path only.
const safeHref = (url: string | null | undefined) => {
  const u = (url ?? '').trim()
  return /^(https?:\/\/|\/(?![/\\]))/i.test(u) ? u : null
}

const TILE = 160
const GAP = 8

export default function SocialStrip({ section }: SectionProps) {
  const items = (section.items as SocialStripItem[] | null) ?? []
  if (items.length === 0) return null
  return <Strip section={section} items={items} />
}

/** The tiles in view, by index, for a strip scrolled to `x`. */
function inView(x: number, width: number): [number, number] {
  const step = TILE + GAP
  return [Math.floor(Math.max(0, x - GUTTER) / step), Math.floor((x + width - GUTTER) / step)]
}

function Strip({ section, items }: { section: SectionProps['section']; items: SocialStripItem[] }) {
  const router = useRouter()
  const { width } = useWindowDimensions()
  const ctaUrl = safeHref(section.copy.ctaUrl)
  // Clips play on the tiles in view, while the strip is on screen.
  const { ref, onLayout, onScreen } = useOnScreen(items.some(i => i.video))
  const [range, setRange] = useState<[number, number]>(() => inView(0, width))
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = inView(e.nativeEvent.contentOffset.x, width)
    if (next[0] !== range[0] || next[1] !== range[1]) setRange(next)
  }

  return (
    <Animated.View ref={ref} onLayout={onLayout} collapsable={false} className="bg-surface-secondary px-4 py-12">
      <View className="mb-7 gap-4">
        <SectionHeading
          eyebrow={section.copy.eyebrow ?? 'Follow along'}
          title={section.copy.title ?? 'Find us on social'}
          eyebrowClassName="text-primary-500"
          className=""
        />
        {ctaUrl ? <Button label={section.copy.ctaLabel ?? 'Follow us'} size="md" block={false} onPress={() => openHref(router, ctaUrl)} /> : null}
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={TILE + GAP}
        decelerationRate="fast"
        onScroll={onScroll}
        scrollEventThrottle={100}
        style={{ marginHorizontal: -GUTTER }}
        contentContainerStyle={{ paddingHorizontal: GUTTER, gap: GAP }}
      >
        {items.map((item, i) => (
          <Pressable
            key={`${item.url}-${i}`}
            onPress={() => openHref(router, item.url)}
            accessibilityRole="button"
            accessibilityLabel={item.caption || 'Open post'}
            className="overflow-hidden rounded-panel bg-surface"
            style={{ width: TILE, height: TILE }}
          >
            {/* the caption overlay is hover/focus-only on the web, so it never shows on touch */}
            <View className="h-full w-full bg-gray-200 dark:bg-gray-700">
              <Media
                image={item.imageUrl}
                video={item.video}
                accessibilityLabel={item.caption || undefined}
                style={{ width: '100%', height: '100%' }}
                width={TILE}
                transition={300}
                active={onScreen && i >= range[0] && i <= range[1]}
              />
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </Animated.View>
  )
}
