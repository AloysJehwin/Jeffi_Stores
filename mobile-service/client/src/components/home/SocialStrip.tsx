import { Pressable, ScrollView, View } from 'react-native'
import { Text } from '../../ui'
import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import { GUTTER, SectionHeading } from './layout'
import { absUrl, openHref } from '../../lib/links'
import type { SectionProps } from '../../types/home'

// Mirror of controller-service components/visitor/home/SocialStrip.tsx at the mobile breakpoint.

interface SocialStripItem {
  imageUrl: string
  url: string
  caption: string
}

// homepage-sections safeHref: http(s) or a site-relative path only.
const safeHref = (url: string | null | undefined) => {
  const u = (url ?? '').trim()
  return /^(https?:\/\/|\/(?![/\\]))/i.test(u) ? u : null
}

const TILE = 160
const GAP = 8

export default function SocialStrip({ section }: SectionProps) {
  const router = useRouter()
  const items = (section.items as SocialStripItem[] | null) ?? []
  if (items.length === 0) return null
  const ctaUrl = safeHref(section.copy.ctaUrl)

  return (
    <View className="bg-surface-secondary px-4 py-12">
      <View className="mb-7 gap-4">
        <SectionHeading
          eyebrow={section.copy.eyebrow ?? 'Follow along'}
          title={section.copy.title ?? 'Find us on social'}
          eyebrowClassName="text-primary-500"
          className=""
        />
        {ctaUrl ? (
          <Pressable
            onPress={() => openHref(router, ctaUrl)}
            className="flex-row items-center self-start rounded-xl bg-primary-500 px-5 py-2.5 active:bg-primary-600"
          >
            <Text className="text-sm font-bold text-white">{section.copy.ctaLabel ?? 'Follow us'}</Text>
          </Pressable>
        ) : null}
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={TILE + GAP}
        decelerationRate="fast"
        style={{ marginHorizontal: -GUTTER }}
        contentContainerStyle={{ paddingHorizontal: GUTTER, gap: GAP }}
      >
        {items.map((item, i) => (
          <Pressable
            key={`${item.url}-${i}`}
            onPress={() => openHref(router, item.url)}
            accessibilityLabel={item.caption || 'Open post'}
            className="overflow-hidden rounded-xl bg-surface"
            style={{ width: TILE, height: TILE }}
          >
            {/* the caption overlay is hover/focus-only on the web, so it never shows on touch */}
            <View className="h-full w-full bg-gray-200 dark:bg-gray-700">
              <Image
                source={{ uri: absUrl(item.imageUrl) ?? undefined }}
                accessibilityLabel={item.caption}
                style={{ width: '100%', height: '100%' }}
                contentFit="cover"
                transition={300}
              />
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  )
}
