import { Pressable, View } from 'react-native'
import { Text } from '../../ui'
import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import { BookOpen } from 'lucide-react-native'
import { SectionHeading } from './layout'
import { absUrl, openHref } from '../../lib/links'
import { useTokens } from '../../theme'
import type { SectionProps } from '../../types/home'

// Mirror of controller-service components/visitor/home/BlogTeaser.tsx at the mobile breakpoint.

interface BlogTeaserItem {
  title: string
  excerpt: string
  url: string
  imageUrl: string
}

// homepage-sections safeHref: http(s) or a site-relative path only.
const safeHref = (url: string | null | undefined) => {
  const u = (url ?? '').trim()
  return /^(https?:\/\/|\/(?![/\\]))/i.test(u) ? u : null
}

export default function BlogTeaser({ section }: SectionProps) {
  const router = useRouter()
  const t = useTokens()
  const items = (section.items as BlogTeaserItem[] | null) ?? []
  if (items.length === 0) return null
  const ctaUrl = safeHref(section.copy.ctaUrl)
  const ctaLabel = section.copy.ctaLabel

  return (
    <View className="bg-surface px-4 py-12">
      <SectionHeading eyebrow={section.copy.eyebrow ?? 'Guides'} title={section.copy.title ?? 'Tips and how-tos'} />
      <View className="gap-5">
        {items.map((item, i) => {
          const img = absUrl(item.imageUrl)
          return (
            <Pressable
              key={`${item.url}-${i}`}
              onPress={() => openHref(router, item.url)}
              className="overflow-hidden rounded-2xl border border-border-default bg-surface-elevated active:border-accent-300"
            >
              <View className="relative overflow-hidden bg-surface-secondary" style={{ aspectRatio: 16 / 9 }}>
                {img ? (
                  <View className="h-full w-full bg-gray-200 dark:bg-gray-700">
                    <Image source={{ uri: img }} style={{ width: '100%', height: '100%' }} contentFit="cover" transition={300} />
                  </View>
                ) : (
                  <View className="h-full w-full items-center justify-center">
                    <BookOpen size={40} color={t.foregroundMuted} />
                  </View>
                )}
              </View>
              <View className="grow gap-2 p-5">
                <Text className="text-base font-bold text-foreground" numberOfLines={2}>
                  {item.title}
                </Text>
                {item.excerpt ? (
                  <Text className="text-sm text-foreground-secondary" numberOfLines={3}>
                    {item.excerpt}
                  </Text>
                ) : null}
                <Text className="mt-auto pt-2 text-sm font-semibold text-accent-500">Read more</Text>
              </View>
            </Pressable>
          )
        })}
      </View>
      {ctaUrl && ctaLabel ? (
        <View className="mt-6 items-center">
          <Pressable onPress={() => openHref(router, ctaUrl)} hitSlop={8}>
            <Text className="text-sm font-semibold text-accent-500">{ctaLabel}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  )
}
