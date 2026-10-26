import { memo } from 'react'
import { Pressable, View } from 'react-native'
import { Card, Text } from '../../ui'
import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import { Grid, SectionHeading, useColumnWidth } from './layout'
import { useImageSource } from '../../hooks/useImageSource'
import { num } from '../../lib/format'
import type { HomeData, HomeSection, SectionProps } from '../../types/home'

// Mirror of controller-service components/visitor/home/CategoryShowcase.tsx.

type ShowcaseCategory = HomeData['categoryShowcase'][number]

export default function CategoryShowcase({ section, data }: SectionProps) {
  const items = data.categoryShowcase
  if (items.length === 0) return null

  // "All categories" is hidden below sm on the web.
  return (
    <View className="px-4 py-10">
      <SectionHeading eyebrow={section.copy.eyebrow} title={section.copy.title} className="mb-6" />
      <Grid cols={2} gap={16}>
        {items.map(cat => (
          <ShowcaseCard key={cat.id} cat={cat} />
        ))}
      </Grid>
    </View>
  )
}

// The home feed's split form (SectionRenderer feedItems): the heading, then a row of two per item.

export function ShowcaseHead({ section }: { section: HomeSection }) {
  return (
    <View className="px-4 pt-10">
      <SectionHeading eyebrow={section.copy.eyebrow} title={section.copy.title} className="mb-6" />
    </View>
  )
}

export const ShowcaseRow = memo(function ShowcaseRow({ cats, last }: { cats: ShowcaseCategory[]; last: boolean }) {
  const w = useColumnWidth(2, 16)
  return (
    <View className="flex-row px-4" style={{ gap: 16, paddingBottom: last ? 40 : 16 }}>
      {cats.map(cat => (
        <View key={cat.id} style={{ width: w }}>
          <ShowcaseCard cat={cat} />
        </View>
      ))}
    </View>
  )
})

function ShowcaseCard({ cat }: { cat: ShowcaseCategory }) {
  const router = useRouter()
  const cardWidth = useColumnWidth(2, 16)
  // Card minus its 1px border and p-2, split into two columns with gap-1.
  const tileWidth = Math.floor((cardWidth - 2 - 16 - 4) / 2)
  const imgSource = useImageSource()
  const openCategory = () => router.push(`/category/${cat.slug}`)

  return (
    <Card padded={false} className="grow overflow-hidden">
      <View className="flex-row items-center justify-between px-4 pb-2 pt-4">
        <Pressable className="shrink" hitSlop={8} accessibilityRole="button" onPress={openCategory}>
          <Text className="text-sm font-bold text-foreground" style={{ lineHeight: 17.5 }}>
            {cat.name}
          </Text>
        </Pressable>
        <Pressable className="ml-2 shrink-0" hitSlop={8} accessibilityRole="button" accessibilityLabel={`See all ${cat.name}`} onPress={openCategory}>
          <Text numberOfLines={1} className="text-[11px] font-semibold text-accent-600 dark:text-accent-400">
            See all
          </Text>
        </Pressable>
      </View>
      <View className="flex-row flex-wrap p-2 pt-1" style={{ gap: 4 }}>
        {cat.products.slice(0, 4).map(p => {
          const img = p.primaryImage
          const src = img ? img.thumbnail_url || img.image_url : null
          return (
            <Pressable
              key={p.id}
              onPress={() => router.push(`/product/${p.slug}`)}
              accessibilityRole="button"
              accessibilityLabel={p.name}
              className="gap-1.5 rounded-xl bg-surface p-2"
              style={{ width: tileWidth }}
            >
              <View className="aspect-square items-center justify-center overflow-hidden rounded-lg bg-surface-secondary">
                {src ? (
                  <Image recyclingKey={src} source={imgSource(src, tileWidth - 16)} contentFit="contain" style={{ width: '100%', height: '100%' }} accessibilityLabel={p.name} />
                ) : (
                  <View className="h-full w-full rounded-lg bg-surface-secondary" />
                )}
              </View>
              <Text numberOfLines={2} className="text-[11px] font-medium text-foreground" style={{ lineHeight: 13.75 }}>
                {p.name}
              </Text>
              <Text className="text-[11px] font-bold text-accent-500">₹{num(p.displayPrice)}</Text>
            </Pressable>
          )
        })}
      </View>
    </Card>
  )
}
