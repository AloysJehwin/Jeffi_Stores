import { Pressable, View } from 'react-native'
import { Text } from '../../ui'
import { useRouter } from 'expo-router'
import { Carousel, Grid } from './layout'
import { openHref } from '../../lib/links'
import type { SectionProps } from '../../types/home'

// Mirror of controller-service components/visitor/home/BrandCarousel.tsx.
export default function BrandCarousel({ section, data }: SectionProps) {
  const router = useRouter()
  const brands = data.topBrands
  if (brands.length === 0) return null

  const items = brands.map(brand => (
    <Pressable
      key={brand.id}
      onPress={() => openHref(router, `/brands/${brand.slug}`)}
      className="flex-1 items-center gap-2 rounded-xl border border-border-default bg-surface p-3"
    >
      <View className="h-10 w-10 items-center justify-center rounded-full bg-accent-500/10">
        <Text className="text-xs font-black text-accent-600 dark:text-accent-400">{brand.name.slice(0, 2).toUpperCase()}</Text>
      </View>
      <Text numberOfLines={2} className="text-center text-[11px] font-semibold text-foreground" style={{ lineHeight: 14 }}>
        {brand.name}
      </Text>
      <Text className="text-[10px] text-foreground-muted">{brand.product_count} items</Text>
    </Pressable>
  ))

  // "All brands" is hidden below sm on the web.
  return (
    <View className="border-y border-border-default bg-surface-elevated px-4 py-8">
      <View className="mb-5">
        <Text className="mb-0.5 text-[10px] font-black uppercase text-primary-500" style={{ letterSpacing: 2 }}>
          {section.copy.eyebrow}
        </Text>
        <Text className="text-xl font-black text-foreground" style={{ letterSpacing: -0.5 }}>
          {section.copy.title}
        </Text>
      </View>
      {section.layout === 'carousel' ? (
        <Carousel itemWidth={0.22}>{items}</Carousel>
      ) : (
        <Grid cols={4} gap={12}>{items}</Grid>
      )}
    </View>
  )
}
