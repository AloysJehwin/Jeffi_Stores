import { Pressable, View } from 'react-native'
import { Text } from '../../ui'
import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import { Grid, useColumnWidth } from './layout'
import type { SectionProps } from '../../types/home'

// Mirror of controller-service components/visitor/home/CategoryShowcase.tsx.
export default function CategoryShowcase({ section, data }: SectionProps) {
  const router = useRouter()
  const cardWidth = useColumnWidth(2, 16)
  // Card minus its 1px border and p-2, split into two columns with gap-1.
  const tileWidth = Math.floor((cardWidth - 2 - 16 - 4) / 2)
  const items = data.categoryShowcase
  if (items.length === 0) return null

  const openCategory = (slug: string) => router.push(`/category/${slug}`)

  // "All categories" is hidden below sm on the web.
  return (
    <View className="px-4 py-10">
      <View className="mb-6">
        <Text className="mb-1 text-[10px] font-black uppercase text-accent-500" style={{ letterSpacing: 2 }}>
          {section.copy.eyebrow}
        </Text>
        <Text className="text-2xl font-black text-foreground" style={{ letterSpacing: -0.6 }}>
          {section.copy.title}
        </Text>
      </View>
      <Grid cols={2} gap={16}>
        {items.map(cat => (
          <View key={cat.id} className="grow overflow-hidden rounded-2xl border border-border-default bg-surface-elevated">
            <View className="flex-row items-center justify-between px-4 pb-2 pt-4">
              <Pressable className="shrink" onPress={() => openCategory(cat.slug)}>
                <Text className="text-sm font-bold text-foreground" style={{ lineHeight: 17.5 }}>
                  {cat.name}
                </Text>
              </Pressable>
              <Pressable className="ml-2 shrink-0" onPress={() => openCategory(cat.slug)}>
                <Text numberOfLines={1} className="text-[10px] font-semibold text-accent-500">
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
                    className="gap-1.5 rounded-xl bg-surface p-2"
                    style={{ width: tileWidth }}
                  >
                    <View className="aspect-square items-center justify-center overflow-hidden rounded-lg bg-surface-secondary">
                      {src ? (
                        <Image source={{ uri: src }} contentFit="contain" style={{ width: '100%', height: '100%' }} accessibilityLabel={p.name} />
                      ) : (
                        <View className="h-full w-full rounded-lg bg-surface-secondary" />
                      )}
                    </View>
                    <Text numberOfLines={2} className="text-[11px] font-medium text-foreground" style={{ lineHeight: 13.75 }}>
                      {p.name}
                    </Text>
                    <Text className="text-[11px] font-bold text-accent-500">₹{Number(p.displayPrice).toLocaleString('en-IN')}</Text>
                  </Pressable>
                )
              })}
            </View>
          </View>
        ))}
      </Grid>
    </View>
  )
}
